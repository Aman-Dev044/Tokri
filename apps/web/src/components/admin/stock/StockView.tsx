'use client';

/**
 * STOCK ALERTS
 *
 * Empty shelves, ranked by what they cost. Out of stock outranks low stock
 * everywhere on this page — in the sort, in the colour, in the weight of the
 * type and in a left rule down the product cell — because a zero is lost
 * revenue right now while a low is a warning about tomorrow.
 *
 * Velocity is the second axis and the one that is easy to leave out. A product
 * at zero that sold 1,800 units last month is an emergency; the same zero on
 * something that sold nine is a delisting candidate. Both numbers are on every
 * row so the operator never has to guess which kind of zero they are looking
 * at.
 *
 * ── THERE IS NO RESTOCK BUTTON ──────────────────────────────────────────────
 * Stock is the vendor's to set, and the API has no admin restock endpoint —
 * inventing one in the client would produce a button that 404s. Each row links
 * through to the product in the catalogue instead, which is where the number
 * actually gets changed.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 * Neutral and semantic everywhere, with the single sanctioned exception: the
 * by-aisle chart and its legend use AISLE_SERIES_COLOR, matching the <AisleDot/>
 * beside every product name in the table.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import {
  AdminPage,
  AdminSection,
  AisleDot,
  BarChart,
  KpiTile,
  Money,
  EmptyState,
  FilterBar,
  DataTable,
  type ChartRow,
} from '@/components/admin';
import { formatCompact, formatCount, formatDate } from '@/lib/admin/format';
import { isAisleKey } from '@mandi/design-system';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import shared from '../_shared-pages/pages.module.css';
import { AISLE_OPTIONS, aisleColor, aisleLabel } from '../_shared-pages/aisles';
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../_shared-pages/csv';
import { isoDay, useNow } from '../_shared-pages/useNow';
import {
  cleanParams,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  useSourcedOne,
  type SortState,
} from '../_shared-pages/useSourced';
import styles from './stock.module.css';
import {
  STOCK_ALERTS_FIXTURE,
  STOCK_SUMMARY_FIXTURE,
  STOCK_VENDOR_OPTIONS,
  summaryFrom,
  type StockAlertRow,
  type StockSummary,
} from './fixtures';

const LIST_ENDPOINT = '/admin/ops/stock-alerts';
const SUMMARY_ENDPOINT = '/admin/ops/stock-alerts/summary';
const LIMIT = 15;

/** Past this, the shelf has been empty long enough that nobody is watching it. */
const STALE_RESTOCK_DAYS = 5;

const SEVERITY_OPTIONS = [
  { label: 'Out and low', value: '' },
  { label: 'Out of stock only', value: 'out' },
  { label: 'Low stock only', value: 'low' },
];

interface Filters {
  vendorId: string;
  aisleKey: string;
  severity: string;
}

const EMPTY_FILTERS: Filters = { vendorId: '', aisleKey: '', severity: '' };

const DEFAULT_SORT: SortState = { key: 'severity', dir: 'desc' };

function sortValue(row: StockAlertRow, key: string): string | number | null {
  switch (key) {
    case 'severity':
      // Out first, then the fastest seller — the composite that makes
      // "worst first" mean what an operator means by it.
      return (row.severity === 'out' ? 1e9 : 0) + row.unitsSold30d;
    case 'product':
      return row.name;
    case 'vendor':
      return row.vendorName;
    case 'aisle':
      return aisleLabel(row.aisleKey);
    case 'stock':
      return row.stock;
    case 'velocity':
      return row.unitsSold30d;
    case 'restocked':
      return -Date.parse(row.lastRestockedAt);
    case 'price':
      return row.price;
    default:
      return null;
  }
}

function daysSince(iso: string, now: number | null): number | null {
  if (now === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now - at) / 86_400_000));
}

/** `4 / 20`, with a bar. A bare count says nothing about how close to empty. */
function StockGauge({ row }: { row: StockAlertRow }) {
  const ratio =
    row.lowStockThreshold <= 0 ? 0 : Math.min(1, row.stock / row.lowStockThreshold);
  const out = row.severity === 'out';
  return (
    <span className={styles.gauge}>
      <span className={styles.gaugeText}>
        <span className={out ? styles.gaugeTextOut : undefined}>{formatCount(row.stock)}</span>
        <span className={styles.gaugeOf}> / {formatCount(row.lowStockThreshold)}</span>
      </span>
      <span
        className={`${styles.gaugeTrack} ${out ? styles.gaugeEmpty : ''}`}
        aria-hidden="true"
        title={`${row.stock} in stock against a threshold of ${row.lowStockThreshold}`}
      >
        {out ? null : (
          <span className={styles.gaugeFill} style={{ width: `${Math.round(ratio * 100)}%` }} />
        )}
      </span>
    </span>
  );
}

function SeverityChip({ severity }: { severity: StockAlertRow['severity'] }) {
  const out = severity === 'out';
  return (
    <span className={`${styles.sev} ${out ? styles.sevOut : styles.sevLow}`}>
      {/* Filled square vs half square — the shape says it without the colour. */}
      <span className={styles.sevGlyph} aria-hidden="true">
        {out ? '■' : '◧'}
      </span>
      {out ? 'Out of stock' : 'Low'}
    </span>
  );
}

export function StockView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(DEFAULT_SORT);

  const now = useNow(60_000);

  const params = useMemo(
    () =>
      cleanParams({
        vendorId: filters.vendorId,
        aisleKey: filters.aisleKey,
        severity: filters.severity,
        page,
        limit: LIMIT,
      }),
    [filters, page],
  );

  const list = useSourcedList<StockAlertRow>(LIST_ENDPOINT, params, STOCK_ALERTS_FIXTURE);
  const summaryQuery = useSourcedOne<StockSummary>(SUMMARY_ENDPOINT, STOCK_SUMMARY_FIXTURE);

  const isSample = list.isSample || summaryQuery.isSample;
  const loading = list.loading || summaryQuery.loading;

  const refetchAll = () => {
    list.refetch();
    summaryQuery.refetch();
  };

  /*
   * Filter, sort and paginate here as well as on the server: a no-op on the
   * live path, the only thing making the controls work on the fixture path.
   */
  const filtered = useMemo(() => {
    const matched = list.rows.filter((row) => {
      if (filters.vendorId !== '' && row.vendorId !== filters.vendorId) return false;
      if (filters.aisleKey !== '' && row.aisleKey !== filters.aisleKey) return false;
      if (filters.severity !== '' && row.severity !== filters.severity) return false;
      return true;
    });
    return sortRows(matched, sort, sortValue);
  }, [list.rows, filters, sort]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  /**
   * The summary endpoint counts the WHOLE catalogue; the list is a page of it.
   * When only the fixture is available the two are derived from the same rows,
   * so they cannot disagree with each other on screen.
   */
  const summary = useMemo<StockSummary>(
    () => (summaryQuery.isSample ? summaryFrom(list.rows) : summaryQuery.value),
    [summaryQuery.isSample, summaryQuery.value, list.rows],
  );

  const byAisle = useMemo<ChartRow[]>(
    () =>
      [...summary.byAisle]
        .map((entry) => ({
          aisleKey: entry.aisleKey,
          aisle: aisleLabel(entry.aisleKey),
          alerts: entry.out + entry.low,
          out: entry.out,
          low: entry.low,
        }))
        .sort((a, b) => b.alerts - a.alerts || b.out - a.out),
    [summary.byAisle],
  );

  const vendorsAffected = summary.byVendor.filter((entry) => entry.out + entry.low > 0).length;
  const aislesAffected = byAisle.filter((entry) => Number(entry.alerts) > 0).length;
  const worstVendorAlerts = Math.max(
    1,
    ...summary.byVendor.map((entry) => entry.out + entry.low),
  );

  function exportCsv() {
    const columns: CsvColumn<StockAlertRow>[] = [
      { header: 'Product', value: (row) => row.name },
      { header: 'Product id', value: (row) => row.id },
      { header: 'Vendor', value: (row) => row.vendorName },
      { header: 'Vendor id', value: (row) => row.vendorId },
      { header: 'Aisle', value: (row) => aisleLabel(row.aisleKey) },
      { header: 'Severity', value: (row) => row.severity },
      { header: 'Stock', value: (row) => row.stock },
      { header: 'Low stock threshold', value: (row) => row.lowStockThreshold },
      { header: 'Units sold (30d)', value: (row) => row.unitsSold30d },
      { header: 'Last restocked (ISO)', value: (row) => row.lastRestockedAt },
      { header: 'Days since restock', value: (row) => daysSince(row.lastRestockedAt, now) },
      // Paise, with the unit named in the header — a pre-formatted "₹120.00"
      // is a string no spreadsheet will add up.
      { header: 'Price (paise)', value: (row) => row.price },
      { header: 'Pack', value: (row) => `${row.unitValue} ${row.unit}` },
    ];
    const day = now === null ? '1970-01-01' : isoDay(now);
    downloadCsv(csvFilename('stock-alerts', day), toCsv(filtered, columns));
  }

  return (
    <AdminPage
      title="Stock alerts"
      description="Shelves that are empty, and shelves about to be. Out of stock outranks low stock everywhere on this page."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Stock', href: '/admin/stock' },
      ]}
      actions={
        <button
          type="button"
          className={shared.btn}
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          Export CSV
        </button>
      }
    >
      {isSample ? (
        <SampleBanner
          endpoint={`${LIST_ENDPOINT}, ${SUMMARY_ENDPOINT}`}
          onRetry={refetchAll}
        />
      ) : null}

      <div className={shared.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Out of stock"
          value={summary.out}
          tone={summary.out > 0 ? 'crit' : 'good'}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Low stock"
          value={summary.low}
          tone={summary.low > 0 ? 'warn' : 'good'}
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Vendors affected"
          value={vendorsAffected}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Aisles affected"
          value={aislesAffected}
          loading={loading}
        />
      </div>

      <div className={`${shared.split} ${shared.splitEven}`} style={{ marginBottom: 'var(--s-5)' }}>
        <AdminSection
          title="By aisle"
          description="Where the gaps are. Hues match the swatch beside every product below."
        >
          <div className={shared.panel}>
            <BarChart
              data={byAisle}
              xKey="aisle"
              series={[{ key: 'alerts', label: 'Alerts' }]}
              horizontal
              height={Math.max(180, byAisle.length * 34 + 40)}
              formatValue={(value) => formatCompact(value)}
              // The one sanctioned chromatic use on this surface: the hue IS
              // the aisle, and it matches <AisleDot/> in the table.
              colorByRow={(row) => aisleColor(String(row['aisleKey'] ?? ''))}
              label={`Stock alerts by aisle across ${byAisle.length} aisles`}
            />
            <div className={styles.aisleLegend}>
              {byAisle.map((entry) => {
                const key = String(entry['aisleKey'] ?? '');
                return (
                  <span key={key} className={styles.aisleLegendItem}>
                    <span
                      className={styles.aisleSwatch}
                      style={{ background: aisleColor(key) }}
                      aria-hidden="true"
                    />
                    <span className={styles.aisleLegendName}>{aisleLabel(key)}</span>
                    <span className={styles.aisleLegendCounts}>
                      <span className={Number(entry['out']) > 0 ? styles.countOut : styles.countZero}>
                        {Number(entry['out'])} out
                      </span>
                      <span className={styles.countZero}> · </span>
                      <span className={Number(entry['low']) > 0 ? styles.countLow : styles.countZero}>
                        {Number(entry['low'])} low
                      </span>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </AdminSection>

        <AdminSection
          title="By vendor"
          description="Who has to act. Sorted by empty shelves first."
        >
          <div className={shared.panel}>
            <div className={styles.vendorList}>
              {summary.byVendor.length === 0 ? (
                <div className={shared.panelBody}>
                  <p className={shared.muted}>No vendor has an alert right now.</p>
                </div>
              ) : (
                summary.byVendor.map((entry) => {
                  const total = entry.out + entry.low;
                  return (
                    <div key={entry.vendorId} className={styles.vendorRow}>
                      <div style={{ minWidth: 0 }}>
                        <span className={styles.vendorName}>{entry.vendorName}</span>
                        <span
                          className={styles.vendorBar}
                          aria-hidden="true"
                          title={`${entry.out} out of stock, ${entry.low} low`}
                        >
                          <span
                            className={styles.vendorBarOut}
                            style={{ width: `${(entry.out / worstVendorAlerts) * 100}%` }}
                          />
                          <span
                            className={styles.vendorBarLow}
                            style={{ width: `${(entry.low / worstVendorAlerts) * 100}%` }}
                          />
                        </span>
                      </div>
                      <span className={styles.vendorCounts}>
                        <span className={entry.out > 0 ? styles.countOut : styles.countZero}>
                          {entry.out} out
                        </span>
                        <span className={entry.low > 0 ? styles.countLow : styles.countZero}>
                          {entry.low} low
                        </span>
                        <span className={shared.muted}>({total})</span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </AdminSection>
      </div>

      <FilterBar
        filters={[
          { key: 'vendorId', label: 'Vendor', type: 'select', options: STOCK_VENDOR_OPTIONS },
          {
            key: 'aisleKey',
            label: 'Aisle',
            type: 'select',
            options: [{ label: 'Every aisle', value: '' }, ...AISLE_OPTIONS],
          },
          { key: 'severity', label: 'Severity', type: 'select', options: SEVERITY_OPTIONS },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            vendorId: next.vendorId ?? '',
            aisleKey: next.aisleKey ?? '',
            severity: next.severity ?? '',
          });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: StockAlertRow) => row.id}
        rows={visible}
        loading={loading}
        total={filtered.length}
        page={page}
        pageCount={pageCount(filtered.length, LIMIT)}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        empty={
          <EmptyState
            title="Every shelf is stocked"
            body="No product is out or below its low-stock threshold under these filters. Widen them to check the rest of the catalogue."
          />
        }
        columns={[
          {
            key: 'product',
            header: 'Product',
            sortable: true,
            render: (row: StockAlertRow) => (
              <span
                className={`${styles.productCell} ${
                  row.severity === 'out' ? styles.outRow : ''
                }`}
              >
                <span className={styles.productLine}>
                  {isAisleKey(row.aisleKey) ? <AisleDot aisleKey={row.aisleKey} /> : null}
                  <span className={styles.productName}>{row.name}</span>
                </span>
                <span className={styles.productMeta}>
                  {row.unitValue} {row.unit} · {aisleLabel(row.aisleKey)}
                </span>
              </span>
            ),
          },
          {
            key: 'vendor',
            header: 'Vendor',
            width: '12rem',
            sortable: true,
            render: (row: StockAlertRow) => (
              <Link href={`/admin/vendors/${row.vendorId}`} className={shared.truncate}>
                {row.vendorName}
              </Link>
            ),
          },
          {
            key: 'severity',
            header: 'Severity',
            width: '9.5rem',
            sortable: true,
            render: (row: StockAlertRow) => <SeverityChip severity={row.severity} />,
          },
          {
            key: 'stock',
            header: 'Stock / threshold',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: StockAlertRow) => <StockGauge row={row} />,
          },
          {
            key: 'velocity',
            header: 'Sold, 30d',
            align: 'right',
            width: '7rem',
            sortable: true,
            numeric: true,
            render: (row: StockAlertRow) => (
              <span
                className={shared.num}
                title={`${formatCount(row.unitsSold30d)} units sold in the last 30 days`}
              >
                {formatCompact(row.unitsSold30d)}
              </span>
            ),
          },
          {
            key: 'restocked',
            header: 'Since restock',
            align: 'right',
            width: '8rem',
            sortable: true,
            render: (row: StockAlertRow) => {
              const days = daysSince(row.lastRestockedAt, now);
              if (days === null) {
                // Pre-hydration: the deterministic absolute date.
                return <span className={styles.restock}>{formatDate(row.lastRestockedAt, 'day')}</span>;
              }
              const stale = days >= STALE_RESTOCK_DAYS;
              return (
                <span
                  className={`${styles.restock} ${stale ? styles.restockStale : ''}`}
                  title={`Last restocked ${formatDate(row.lastRestockedAt, 'long')}`}
                >
                  {days === 0 ? 'today' : `${days}d`}
                  {stale ? <span className="adm-sr"> — not restocked in over five days</span> : null}
                </span>
              );
            },
          },
          {
            key: 'price',
            header: 'Price',
            align: 'right',
            width: '8rem',
            sortable: true,
            render: (row: StockAlertRow) => <Money value={row.price} />,
          },
          {
            key: 'fix',
            header: '',
            width: '7rem',
            align: 'right',
            render: (row: StockAlertRow) => (
              /*
               * There is no admin restock endpoint, so this is a link, not a
               * button. It lands on the catalogue, which is where stock is
               * actually edited.
               *
               * TODO: `/admin/catalog` does not read `?q=` yet (Worker C does
               * not own that folder). Once it does, this deep link opens the
               * products tab already filtered to this SKU.
               */
              <Link
                href={`/admin/catalog?tab=products&q=${encodeURIComponent(row.name)}`}
                className={`${shared.btn} ${shared.btnSmall}`}
              >
                Catalogue
              </Link>
            ),
          },
        ]}
      />
    </AdminPage>
  );
}
