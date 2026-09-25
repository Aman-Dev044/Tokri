'use client';

/**
 * THE SUPPORT QUEUE
 *
 * The question this page answers is not "what issues exist" — it is "what
 * should I pick up next". So the default order is not newest-first, which is
 * how a queue quietly starves its oldest ticket; it is urgent-and-oldest first,
 * and age is on every row with its distance from target drawn beside it.
 *
 * An urgent issue open for three days is the single most important thing here,
 * and it is designed to be unmissable three ways at once: it sorts to the top,
 * its age is red and bold with a ▲, and its subject carries a left rule.
 *
 * ── LIST STATE SURVIVES A ROUND TRIP TO THE DETAIL PAGE ─────────────────────
 * Issues open as their own route (see IssueDetailView for why), which means the
 * list unmounts. Filters, page and sort are cached in a module-scoped object so
 * Back returns to the queue you were triaging rather than to a fresh one. It is
 * per-session and deliberately not the URL: a support queue is a working view,
 * not something anyone bookmarks.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AdminPage, DataTable, DetailDrawer, FilterBar, KpiTile } from '@/components/admin';
import { useAdminMutation, useDebounced } from '@/hooks';
import { formatDate } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import shared from '../_shared-pages/pages.module.css';
import { isoDay, useNow } from '../_shared-pages/useNow';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  type SortState,
} from '../_shared-pages/useSourced';
import styles from './issues.module.css';
import {
  AgeCell,
  IssueStatusChip,
  PRIORITY_RANK,
  PriorityChip,
  STATUS_WEIGHT,
  TypeChip,
  agePressure,
  ageHours,
  isOpenish,
  urgencyScore,
} from './severity';
import {
  ISSUES_FIXTURE,
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_LABEL,
  ISSUE_TYPE_LABEL,
  SUPPORT_AGENTS,
  type Issue,
  type IssuePriority,
  type IssueType,
} from './fixtures';

const ENDPOINT = '/admin/ops/issues';
const LIMIT = 15;

const UNASSIGNED = '__none__';

interface Filters {
  q: string;
  status: string;
  priority: string;
  type: string;
  assignee: string;
}

const EMPTY_FILTERS: Filters = { q: '', status: '', priority: '', type: '', assignee: '' };

const DEFAULT_SORT: SortState = { key: 'urgency', dir: 'desc' };

/**
 * Per-session view state. Module scope, not a store: it exists purely so the
 * browser Back button lands where the operator left, and it is correct for it
 * to vanish on a reload.
 */
const cache: { filters: Filters; page: number; sort: SortState | null } = {
  filters: EMPTY_FILTERS,
  page: 1,
  sort: DEFAULT_SORT,
};

function sortValue(row: Issue, key: string): string | number | null {
  switch (key) {
    case 'urgency':
      return urgencyScore(row);
    case 'code':
      return row.code;
    case 'subject':
      return row.subject;
    case 'priority':
      return PRIORITY_RANK[row.priority];
    case 'status':
      return STATUS_WEIGHT[row.status];
    case 'age':
      // Descending on this column means oldest first, which is the only
      // direction anyone wants from an age column on a queue.
      return -Date.parse(row.createdAt);
    case 'updated':
      return Date.parse(row.updatedAt);
    case 'assignee':
      return row.assignedToName ?? row.assignedToUserId ?? '';
    default:
      return null;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

interface CreateBody {
  type: IssueType;
  priority: IssuePriority;
  subject: string;
  description: string;
  orderId?: string;
}

const BLANK_DRAFT: CreateBody = {
  type: 'other',
  priority: 'normal',
  subject: '',
  description: '',
};

export function IssuesView() {
  const router = useRouter();

  const [filters, setFilters] = useState<Filters>(cache.filters);
  const [page, setPage] = useState(cache.page);
  const [sort, setSort] = useState<SortState | null>(cache.sort);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<CreateBody>(BLANK_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);

  cache.filters = filters;
  cache.page = page;
  cache.sort = sort;

  // A minute is as fine as an age column ever needs, and it keeps a queue left
  // open on a second monitor from going stale.
  const now = useNow(60_000);
  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        status: filters.status,
        priority: filters.priority,
        type: filters.type,
        assignedToUserId: filters.assignee === UNASSIGNED ? undefined : filters.assignee,
        page,
        limit: LIMIT,
        sort: sort === null ? undefined : `${sort.dir === 'desc' ? '-' : ''}${sort.key}`,
      }),
    [debouncedQ, filters.status, filters.priority, filters.type, filters.assignee, page, sort],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<Issue>(
    ENDPOINT,
    params,
    ISSUES_FIXTURE,
  );

  const create = useAdminMutation<CreateBody, Issue>(ENDPOINT, 'POST');

  /*
   * Filtering, sorting and paging run here as well as on the server: a no-op on
   * the live path, and the only thing making the controls work on the fixture
   * path. One code path instead of two that drift.
   */
  const filtered = useMemo(() => {
    const matched = rows.filter((row) => {
      if (filters.status !== '' && row.status !== filters.status) return false;
      if (filters.priority !== '' && row.priority !== filters.priority) return false;
      if (filters.type !== '' && row.type !== filters.type) return false;
      if (filters.assignee === UNASSIGNED && row.assignedToUserId !== undefined) return false;
      if (
        filters.assignee !== '' &&
        filters.assignee !== UNASSIGNED &&
        row.assignedToUserId !== filters.assignee
      ) {
        return false;
      }
      return matchesSearch(
        [row.code, row.subject, row.description, row.orderNo, row.customerName, row.vendorName],
        debouncedQ,
      );
    });
    return sortRows(matched, sort, sortValue);
  }, [rows, filters, debouncedQ, sort]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const kpis = useMemo(() => {
    const open = rows.filter((row) => row.status === 'open').length;
    const inProgress = rows.filter((row) => row.status === 'in_progress').length;
    const urgent = rows.filter((row) => row.priority === 'urgent' && isOpenish(row.status)).length;

    const today = now === null ? null : isoDay(now);
    const resolvedToday =
      today === null
        ? 0
        : rows.filter((row) => row.resolvedAt !== undefined && row.resolvedAt.slice(0, 10) === today)
            .length;

    const ages = rows
      .filter((row) => isOpenish(row.status))
      .map((row) => ageHours(row.createdAt, now))
      .filter((hours): hours is number => hours !== null);

    const breached = rows.filter((row) => {
      if (!isOpenish(row.status)) return false;
      const pressure = agePressure(row, now);
      return pressure !== null && pressure >= 1;
    }).length;

    return {
      open,
      inProgress,
      urgent,
      resolvedToday,
      medianAgeHours: Math.round(median(ages) * 10) / 10,
      breached,
    };
  }, [rows, now]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const agent of SUPPORT_AGENTS) seen.set(agent.id, agent.name);
    for (const row of rows) {
      if (row.assignedToUserId === undefined) continue;
      if (!seen.has(row.assignedToUserId)) {
        // A live row assigned to someone the fixture roster has never heard of.
        // The id is not a name, but it is truthful and it filters correctly.
        seen.set(row.assignedToUserId, row.assignedToName ?? row.assignedToUserId);
      }
    }
    return [
      { label: 'Anyone', value: '' },
      { label: 'Unassigned', value: UNASSIGNED },
      ...[...seen.entries()].map(([id, name]) => ({ label: name, value: id })),
    ];
  }, [rows]);

  async function submitDraft() {
    const subject = draft.subject.trim();
    const description = draft.description.trim();
    if (subject.length < 6) {
      setDraftError('Give the issue a subject somebody scanning the queue could act on.');
      return;
    }
    if (description.length < 10) {
      setDraftError('Describe what happened. A one-word issue costs the next person ten minutes.');
      return;
    }

    const created = await create.mutate({ ...draft, subject, description });
    if (created === null) return;

    setComposing(false);
    setDraft(BLANK_DRAFT);
    setDraftError(null);
    refetch();
  }

  return (
    <AdminPage
      title="Support queue"
      description="Every customer, vendor and rider problem that needs a person. Sorted by what is burning, not by what is newest."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Support', href: '/admin/issues' },
      ]}
      actions={
        <button
          type="button"
          className={`${shared.btn} ${shared.btnPrimary}`}
          onClick={() => {
            setComposing(true);
            setDraftError(null);
            create.reset();
          }}
        >
          Log an issue
        </button>
      }
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={shared.kpiRow}>
        <KpiTile index={0} isFixture={isSample} label="Open" value={kpis.open} loading={loading} />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="In progress"
          value={kpis.inProgress}
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Urgent, unresolved"
          value={kpis.urgent}
          tone={kpis.urgent > 0 ? 'crit' : 'good'}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Past response target"
          value={kpis.breached}
          tone={kpis.breached > 0 ? 'warn' : 'good'}
          loading={loading || now === null}
        />
        <KpiTile
          index={4}
          isFixture={isSample}
          label="Resolved today"
          value={kpis.resolvedToday}
          tone="good"
          loading={loading || now === null}
        />
        <KpiTile
          index={5}
          isFixture={isSample}
          label="Median age"
          value={kpis.medianAgeHours}
          unit="h"
          loading={loading || now === null}
        />
      </div>

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search', placeholder: 'Code, subject, order, name…' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Any status', value: '' },
              ...Object.entries(ISSUE_STATUS_LABEL).map(([value, label]) => ({ label, value })),
            ],
          },
          {
            key: 'priority',
            label: 'Priority',
            type: 'select',
            options: [
              { label: 'Any priority', value: '' },
              ...Object.entries(ISSUE_PRIORITY_LABEL).map(([value, label]) => ({ label, value })),
            ],
          },
          {
            key: 'type',
            label: 'Type',
            type: 'select',
            options: [
              { label: 'Any type', value: '' },
              ...Object.entries(ISSUE_TYPE_LABEL).map(([value, label]) => ({ label, value })),
            ],
          },
          { key: 'assignee', label: 'Assignee', type: 'select', options: assigneeOptions },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            q: next.q ?? '',
            status: next.status ?? '',
            priority: next.priority ?? '',
            type: next.type ?? '',
            assignee: next.assignee ?? '',
          });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: Issue) => row.id}
        rows={visible}
        loading={loading}
        total={filtered.length}
        empty="No issue matches those filters. Clear them to see the whole queue."
        onRowClick={(row: Issue) => router.push(`/admin/issues/${row.id}`)}
        page={page}
        pageCount={pageCount(filtered.length, LIMIT)}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'code',
            header: 'Ref',
            width: '8rem',
            sortable: true,
            render: (row: Issue) => <span className={shared.mono}>{row.code}</span>,
          },
          {
            key: 'subject',
            header: 'Issue',
            sortable: true,
            render: (row: Issue) => {
              const pressure = agePressure(row, now);
              const hot = isOpenish(row.status) && pressure !== null && pressure >= 1;
              return (
                <span className={`${styles.subjectCell} ${hot ? styles.hot : ''}`}>
                  <span className={styles.subjectLine}>
                    <span className={styles.subjectText}>{row.subject}</span>
                  </span>
                  <span className={styles.subjectMeta}>
                    {[
                      row.orderNo === undefined ? null : `Order ${row.orderNo}`,
                      row.customerName ?? null,
                      row.vendorName ?? null,
                      row.messages.length > 1 ? `${row.messages.length} messages` : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ')}
                  </span>
                </span>
              );
            },
          },
          {
            key: 'type',
            header: 'Type',
            width: '9.5rem',
            render: (row: Issue) => <TypeChip type={row.type} />,
          },
          {
            key: 'priority',
            header: 'Priority',
            width: '7.5rem',
            sortable: true,
            render: (row: Issue) => <PriorityChip priority={row.priority} />,
          },
          {
            key: 'status',
            header: 'Status',
            width: '8.5rem',
            sortable: true,
            render: (row: Issue) => <IssueStatusChip status={row.status} />,
          },
          {
            key: 'assignee',
            header: 'Assignee',
            width: '9rem',
            sortable: true,
            render: (row: Issue) =>
              row.assignedToUserId === undefined ? (
                <span className={shared.muted}>unassigned</span>
              ) : (
                <span className={shared.truncate}>
                  {row.assignedToName ?? (
                    <span className={shared.mono}>{row.assignedToUserId}</span>
                  )}
                </span>
              ),
          },
          {
            key: 'age',
            header: 'Age',
            align: 'right',
            width: '7rem',
            sortable: true,
            render: (row: Issue) => <AgeCell issue={row} now={now} />,
          },
          {
            key: 'updated',
            header: 'Last touched',
            width: '9rem',
            sortable: true,
            render: (row: Issue) => (
              <span className={`${shared.subtle} ${shared.mono}`}>
                {formatDate(row.updatedAt, 'short')}
              </span>
            ),
          },
        ]}
      />

      {/* Logging an issue by hand: a support agent on a phone call, or an ops
          person recording something a vendor reported out of band. */}
      <DetailDrawer
        open={composing}
        onClose={() => setComposing(false)}
        title="Log an issue"
        subtitle="Raised by support, not by the app"
        width="32rem"
        actions={
          <>
            <button
              type="button"
              className={shared.btn}
              onClick={() => setComposing(false)}
              disabled={create.loading}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnPrimary}`}
              onClick={() => {
                void submitDraft();
              }}
              disabled={create.loading}
            >
              {create.loading ? 'Saving…' : 'Create issue'}
            </button>
          </>
        }
      >
        <div className={shared.formGrid}>
          <div className={shared.field}>
            <label className={shared.label} htmlFor="issue-subject">
              Subject
            </label>
            <input
              id="issue-subject"
              className={shared.input}
              value={draft.subject}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              placeholder="What is wrong, in one line"
            />
          </div>

          <div className={shared.field}>
            <label className={shared.label} htmlFor="issue-type">
              Type
            </label>
            <select
              id="issue-type"
              className={shared.select}
              value={draft.type}
              onChange={(event) => setDraft({ ...draft, type: event.target.value as IssueType })}
            >
              {Object.entries(ISSUE_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className={shared.field}>
            <label className={shared.label} htmlFor="issue-priority">
              Priority
            </label>
            <select
              id="issue-priority"
              className={shared.select}
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as IssuePriority })
              }
            >
              {Object.entries(ISSUE_PRIORITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className={shared.field}>
            <label className={shared.label} htmlFor="issue-order">
              Order id <span className={shared.labelHint}>— optional</span>
            </label>
            <input
              id="issue-order"
              className={`${shared.input} ${shared.inputNum}`}
              value={draft.orderId ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  orderId: event.target.value === '' ? undefined : event.target.value,
                })
              }
              placeholder="Links the issue to an order"
            />
          </div>

          <div className={`${shared.field} ${shared.fieldWide}`}>
            <label className={shared.label} htmlFor="issue-description">
              What happened
            </label>
            <textarea
              id="issue-description"
              className={shared.textarea}
              rows={5}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="Everything the next person would need to pick this up cold."
            />
          </div>

          {draftError === null ? null : (
            <p className={`${shared.fieldError} ${shared.fieldWide}`} role="alert">
              {draftError}
            </p>
          )}
          {create.error === null ? null : (
            <p className={`${shared.fieldError} ${shared.fieldWide}`} role="alert">
              {create.error.problem.detail ?? create.error.friendlyMessage} Nothing was saved.
            </p>
          )}
        </div>
      </DetailDrawer>
    </AdminPage>
  );
}
