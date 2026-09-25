'use client';

import { useMemo, useState } from 'react';

import {
  AdminPage,
  AdminSection,
  EmptyState,
  FilterBar,
  KpiTile,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useDebounced } from '@/hooks';
import { formatDate, humanise } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  useSourcedList,
  withinRange,
} from '../_shared-pages/useSourced';
import { AuditDiff } from './AuditDiff';
import { diffSnapshots, summarise } from './diff';
import {
  ACTION_OPTIONS,
  AUDIT_FIXTURE,
  ENTITY_OPTIONS,
  ROLE_OPTIONS,
  type AuditRow,
} from './fixtures';

const ENDPOINT = '/admin/audit-logs';
const LIMIT = 10;

interface Filters {
  q: string;
  role: string;
  action: string;
  entity: string;
  /** <FilterBar>'s daterange occupies two keys: `range` and `rangeTo`. */
  range: string;
  rangeTo: string;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  role: '',
  action: '',
  entity: '',
  range: '',
  rangeTo: '',
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`${styles.auditChevron} ${open ? styles.auditChevronOpen : ''}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}

function AuditEntry({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);

  // The diff is cheap, and computing it up front lets the header show the
  // change counts before anything is expanded — which is what makes the list
  // scannable rather than a wall of identical rows.
  const summary = useMemo(() => summarise(diffSnapshots(row.before, row.after)), [row]);
  const moved = summary.changed + summary.added + summary.removed;

  return (
    <li className={styles.auditItem}>
      <button
        type="button"
        className={styles.auditHead}
        aria-expanded={open}
        aria-controls={`audit-diff-${row.id}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Chevron open={open} />

        <span className={styles.twoLine}>
          <span className={styles.strong}>{humanise(row.action)}</span>
          <span className={styles.subtle}>
            <span className={styles.mono}>{row.action}</span> · {row.entity}{' '}
            <span className={styles.mono}>{row.entityId}</span>
          </span>
        </span>

        <span className={styles.twoLine}>
          <span>{row.actorName}</span>
          <span className={styles.subtle}>
            <StatusPill status={row.actorRole} kind="user" /> from{' '}
            <span className={styles.mono}>{row.ip}</span>
          </span>
        </span>

        <span className={styles.twoLine} style={{ textAlign: 'right' }}>
          <span className={styles.subtle} title={formatDate(row.at, 'full')}>
            <RelativeTime value={row.at} />
          </span>
          <span className={styles.auditCounts}>
            {moved === 0 ? (
              <span className={styles.muted}>no field changes</span>
            ) : (
              <>
                {summary.changed > 0 ? (
                  <span className={styles.warn}>{summary.changed} changed</span>
                ) : null}
                {summary.added > 0 ? (
                  <span className={styles.good}>+{summary.added}</span>
                ) : null}
                {summary.removed > 0 ? (
                  <span className={styles.crit}>−{summary.removed}</span>
                ) : null}
              </>
            )}
          </span>
        </span>
      </button>

      {/*
        A height transition without a magic pixel number: the wrapper animates
        grid-template-rows from 0fr to 1fr, so the diff opens to exactly its own
        height whatever that turns out to be. Under prefers-reduced-motion the
        transition is dropped and it simply appears.
      */}
      <div
        id={`audit-diff-${row.id}`}
        className={`${styles.diffWrap} ${open ? styles.diffWrapOpen : ''}`}
        role="region"
        aria-label={`Changes made by ${row.action}`}
      >
        <div className={styles.diffClip}>
          <div className={styles.auditBody}>
            {open ? <AuditDiff before={row.before} after={row.after} /> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function AuditView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        actorRole: filters.role,
        action: filters.action,
        entity: filters.entity,
        from: filters.range,
        to: filters.rangeTo,
        page,
        limit: LIMIT,
      }),
    [
      debouncedQ,
      filters.role,
      filters.action,
      filters.entity,
      filters.range,
      filters.rangeTo,
      page,
    ],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<AuditRow>(
    ENDPOINT,
    params,
    AUDIT_FIXTURE,
  );

  const filtered = useMemo(
    () =>
      rows
        .filter((row) => {
          if (
            !matchesSearch(
              [row.actorName, row.action, row.entity, row.entityId, row.ip],
              debouncedQ,
            )
          ) {
            return false;
          }
          if (filters.role !== '' && row.actorRole !== filters.role) return false;
          if (filters.action !== '' && row.action !== filters.action) return false;
          if (filters.entity !== '' && row.entity !== filters.entity) return false;
          if (!withinRange(row.at, filters.range, filters.rangeTo)) return false;
          return true;
        })
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [
      rows,
      debouncedQ,
      filters.role,
      filters.action,
      filters.entity,
      filters.range,
      filters.rangeTo,
    ],
  );

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);
  const pages = pageCount(filtered.length, LIMIT);

  const kpis = useMemo(() => {
    const actors = new Set(rows.map((row) => row.actorId));
    const byAdmin = rows.filter((row) => row.actorRole === 'admin').length;
    const withDiff = rows.filter((row) => row.before !== null || row.after !== null).length;
    return { total: rows.length, actors: actors.size, byAdmin, withDiff };
  }, [rows]);

  return (
    <AdminPage
      title="Audit trail"
      description="Who changed what, when, and exactly which fields moved. Append-only — nothing here can be edited."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Audit', href: '/admin/audit' },
      ]}
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Events"
          value={kpis.total}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Distinct actors"
          value={kpis.actors}
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="By an admin"
          value={kpis.byAdmin}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="With a snapshot"
          value={kpis.withDiff}
          deltaLabel="reads and exports record none"
          loading={loading}
        />
      </div>

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search' },
          { key: 'role', label: 'Actor', type: 'select', options: ROLE_OPTIONS },
          { key: 'action', label: 'Action', type: 'select', options: ACTION_OPTIONS },
          { key: 'entity', label: 'Entity', type: 'select', options: ENTITY_OPTIONS },
          { key: 'range', label: 'Date', type: 'daterange' },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            q: next.q ?? '',
            role: next.role ?? '',
            action: next.action ?? '',
            entity: next.entity ?? '',
            range: next.range ?? '',
            rangeTo: next.rangeTo ?? '',
          });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <AdminSection title="Events">
        {loading ? (
          <ul className={styles.auditList}>
            {[0, 1, 2, 3, 4].map((index) => (
              <li key={index} className={styles.auditItem}>
                {/* Shaped like a real entry: chevron, two stacked lines, a time. */}
                <div className={styles.auditHead} aria-hidden="true">
                  <span className={`${styles.skel} ${styles.auditChevron}`} />
                  <span className={styles.twoLine}>
                    <span className={`${styles.skel} ${styles.skelLine}`} style={{ width: '60%' }} />
                    <span className={`${styles.skel} ${styles.skelLine}`} style={{ width: '40%' }} />
                  </span>
                  <span className={styles.twoLine}>
                    <span className={`${styles.skel} ${styles.skelLine}`} style={{ width: '50%' }} />
                    <span className={`${styles.skel} ${styles.skelLine}`} style={{ width: '35%' }} />
                  </span>
                  <span className={`${styles.skel} ${styles.skelLine}`} style={{ width: '5rem' }} />
                </div>
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching events"
            body="Nothing in the audit trail matches those filters. The trail is append-only, so an empty result means it did not happen — not that it was removed."
          />
        ) : (
          <>
            <ul className={styles.auditList}>
              {visible.map((row) => (
                <AuditEntry key={row.id} row={row} />
              ))}
            </ul>

            {pages > 1 ? (
              <div className={styles.pager}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={page <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span className={styles.num}>
                  Page {page} of {pages}
                </span>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={page >= pages}
                  onClick={() => setPage((prev) => Math.min(pages, prev + 1))}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </AdminSection>
    </AdminPage>
  );
}
