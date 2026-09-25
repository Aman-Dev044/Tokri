'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  AdminPage,
  AdminSection,
  BarChart,
  DataTable,
  DonutChart,
  KpiTile,
  LineChart,
  Money,
  Toolbar,
} from '@/components/admin';
import { formatCount, formatDate, formatPct } from '@/lib/admin/format';

import { aisleColor } from '../_shared-pages/aisles';
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../_shared-pages/csv';
import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { isoDay, useNow } from '../_shared-pages/useNow';
import { cleanParams, useSourcedList } from '../_shared-pages/useSourced';
import {
  REPORT_ROWS,
  REPORTS,
  reportDef,
  type CellKind,
  type ReportKey,
  type ReportRow,
} from './fixtures';

const ENDPOINT = '/admin/reports';

function asNumber(value: string | number | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function asText(value: string | number | undefined): string {
  return value === undefined ? '' : String(value);
}

/** How a raw cell is drawn. Money always goes through <Money/>. */
function renderCell(kind: CellKind, raw: string | number | undefined) {
  switch (kind) {
    case 'money':
      return <Money value={asNumber(raw)} />;
    case 'number':
      return <span className={styles.num}>{formatCount(asNumber(raw))}</span>;
    case 'pct':
      return <span className={styles.num}>{formatPct(asNumber(raw))}</span>;
    case 'date':
      return <span className={styles.mono}>{formatDate(asText(raw), 'day')}</span>;
    default:
      return asText(raw);
  }
}

export function ReportsView() {
  const now = useNow();
  const [report, setReport] = useState<ReportKey>('sales');
  const [grouping, setGrouping] = useState('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const def = reportDef(report);

  // Default the window to the trailing seven days, once the clock is readable.
  useEffect(() => {
    if (now === null || from !== '' || to !== '') return;
    setTo(isoDay(now));
    setFrom(isoDay(now - 6 * 24 * 60 * 60 * 1_000));
  }, [now, from, to]);

  // Keep the grouping legal for whichever report is selected.
  useEffect(() => {
    const first = def.groupings[0];
    if (first !== undefined && !def.groupings.some((g) => g.value === grouping)) {
      setGrouping(first.value);
    }
  }, [def, grouping]);

  const params = useMemo(
    () => cleanParams({ report, grouping, from, to }),
    [report, grouping, from, to],
  );

  const fixture = REPORT_ROWS[report];
  const { rows, loading, isSample, refetch } = useSourcedList<ReportRow>(
    ENDPOINT,
    params,
    fixture,
  );

  /** Chart data: the rows as they are, plus an explicit colour per aisle row. */
  const chartData = useMemo(
    () =>
      def.byAisle
        ? rows.map((row) => ({
            ...row,
            color: aisleColor(asText(row['aisleKey'])),
          }))
        : rows,
    [rows, def.byAisle],
  );

  const donutData = useMemo(
    () =>
      rows.map((row) => ({
        label: asText(row[def.xKey]),
        value: asNumber(row[def.series[0]?.key ?? '']),
        // The one place the aisle hues appear on this surface: a breakdown BY
        // aisle. Everything else uses the neutral/semantic palette (plan §2.4).
        color: def.byAisle ? aisleColor(asText(row['aisleKey'])) : undefined,
      })),
    [rows, def],
  );

  const totals = useMemo(() => {
    const moneyColumns = def.columns.filter((c) => c.kind === 'money');
    const countColumns = def.columns.filter((c) => c.kind === 'number');
    const sum = (key: string) => rows.reduce((acc, row) => acc + asNumber(row[key]), 0);
    return {
      rowCount: rows.length,
      primaryMoney: moneyColumns[0] === undefined ? null : {
        header: moneyColumns[0].header,
        value: sum(moneyColumns[0].key),
      },
      secondMoney: moneyColumns[1] === undefined ? null : {
        header: moneyColumns[1].header,
        value: sum(moneyColumns[1].key),
      },
      primaryCount: countColumns[0] === undefined ? null : {
        header: countColumns[0].header,
        value: sum(countColumns[0].key),
      },
    };
  }, [rows, def.columns]);

  /*
   * CSV is built from the rows already on screen, so the file can never
   * disagree with what the admin is looking at.
   *
   * NOTE: a viewer-initiated download works here — this is a first-party page
   * and the click comes from the user. The same code is INERT inside a
   * published Claude Artifact, where the sandbox silently blocks any download
   * the page starts itself (<a download> with blob:/data: included). If this
   * ever moves into an artifact, render the CSV into a copyable <pre> instead
   * of offering a button that appears to do nothing.
   */
  function exportCsv() {
    const columns: CsvColumn<ReportRow>[] = def.columns.map((column) => ({
      // Money leaves as raw paise, with the unit in the header — a
      // pre-formatted "₹1,234.50" is a string no spreadsheet will add up.
      header: column.kind === 'money' ? `${column.header} (paise)` : column.header,
      value: (row) => row[column.key] ?? '',
    }));
    const stamp = now === null ? '1970-01-01' : isoDay(now);
    downloadCsv(csvFilename(report.replaceAll('_', '-'), stamp), toCsv(rows, columns));
  }

  return (
    <AdminPage
      title="Reports"
      description="Pick a report, a window and a grouping. What you see is what the CSV contains."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Reports', href: '/admin/reports' },
      ]}
      actions={
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          Export CSV
        </button>
      }
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <Toolbar>
        <div className={styles.rowWrap}>
          <span className={styles.field}>
            <label className={styles.label} htmlFor="rep-kind">
              Report
            </label>
            <select
              id="rep-kind"
              className={styles.select}
              value={report}
              onChange={(event) => setReport(event.target.value as ReportKey)}
            >
              {REPORTS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </span>

          <span className={styles.field}>
            <label className={styles.label} htmlFor="rep-from">
              From
            </label>
            <input
              id="rep-from"
              type="date"
              className={`${styles.input} ${styles.inputNum}`}
              value={from}
              max={to === '' ? undefined : to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </span>

          <span className={styles.field}>
            <label className={styles.label} htmlFor="rep-to">
              To
            </label>
            <input
              id="rep-to"
              type="date"
              className={`${styles.input} ${styles.inputNum}`}
              value={to}
              min={from === '' ? undefined : from}
              onChange={(event) => setTo(event.target.value)}
            />
          </span>

          <span className={styles.field}>
            <label className={styles.label} htmlFor="rep-group">
              Group
            </label>
            <select
              id="rep-group"
              className={styles.select}
              value={grouping}
              onChange={(event) => setGrouping(event.target.value)}
            >
              {def.groupings.map((group) => (
                <option key={group.value} value={group.value}>
                  {group.label}
                </option>
              ))}
            </select>
          </span>
        </div>
      </Toolbar>

      <p className={styles.subtle}>{def.description}</p>

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Rows"
          value={totals.rowCount}
          loading={loading}
        />
        {totals.primaryMoney === null ? null : (
          <KpiTile
          index={1}
          isFixture={isSample}
            label={totals.primaryMoney.header}
            value={totals.primaryMoney.value}
            unit="paise"
            loading={loading}
          />
        )}
        {totals.secondMoney === null ? null : (
          <KpiTile
          index={2}
          isFixture={isSample}
            label={totals.secondMoney.header}
            value={totals.secondMoney.value}
            unit="paise"
            loading={loading}
          />
        )}
        {totals.primaryCount === null ? null : (
          <KpiTile
          index={3}
          isFixture={isSample}
            label={totals.primaryCount.header}
            value={totals.primaryCount.value}
            loading={loading}
          />
        )}
      </div>

      <AdminSection title={def.label}>
        <div className={styles.panel}>
          <div className={styles.panelBody}>
            {def.chart === 'line' ? (
              <LineChart data={chartData} xKey={def.xKey} series={def.series} height={260} />
            ) : def.chart === 'bar' ? (
              <BarChart data={chartData} xKey={def.xKey} series={def.series} height={260} />
            ) : (
              <DonutChart data={donutData} height={260} />
            )}

            {def.byAisle ? (
              <div className={styles.legend}>
                {donutData.map((slice) => (
                  <span key={slice.label} className={styles.legendItem}>
                    <span
                      className={styles.legendSwatch}
                      style={{ background: slice.color }}
                      aria-hidden="true"
                    />
                    {slice.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </AdminSection>

      <AdminSection title="Rows">
        <DataTable
          rowKey={(row: ReportRow) => asText(row[def.xKey])}
          rows={rows}
          loading={loading}
          empty="No data in that window."
          columns={def.columns.map((column) => ({
            key: column.key,
            header: column.header,
            align: column.kind === 'text' ? undefined : ('right' as const),
            render: (row: ReportRow) => renderCell(column.kind, row[column.key]),
          }))}
        />
      </AdminSection>
    </AdminPage>
  );
}
