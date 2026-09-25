'use client';

/**
 * ★ THE ADMIN OPERATIONS DASHBOARD — "what do I do next?"
 *
 * ── HOW THIS DIFFERS FROM THE SUPER-ADMIN OVERVIEW ──────────────────────────
 * The governance overview answers "is the marketplace healthy?" with GMV, a
 * trend line and a 90-day window. This answers a different question for a
 * different person: an operations admin at 19:05 on a Friday wants a WORK
 * QUEUE, not a wall of totals. Nothing on this page is a number you admire;
 * every number is a number you clear.
 *
 * ── SEVERITY BEATS SYMMETRY ─────────────────────────────────────────────────
 * The layout is ordered by what hurts, not by what tiles nicely:
 *
 *   1. SLA breaches, if there are any. They outrank the entire page — a late
 *      order is the only thing here a customer is already noticing.
 *   2. The queues, non-empty first, worst first. Empty queues sink, calmly.
 *   3. The live lanes, so you can see where the backlog is forming.
 *   4. Dispatch capacity and today's totals.
 *   5. The activity feed — context, last, because it is the only thing here
 *      that is purely retrospective.
 *
 * ── DATA ────────────────────────────────────────────────────────────────────
 * `GET /admin/ops/summary`, polled every 30s, is the whole page above the
 * feed. One request rather than eight, because eight panels refreshing at
 * eight different moments cannot be read as a single picture of "now" — a
 * dashboard whose halves disagree is worse than one a few seconds old.
 *
 * The feed is `GET /admin/audit-logs`, which is the only record of what people
 * actually did. It degrades on its own: a failing audit query blanks one
 * panel, not the dashboard.
 *
 * ── NULLS ARE REAL ANSWERS ──────────────────────────────────────────────────
 * `avgAssignMinutes` and `onTimePct` are `number | null`, and null means
 * "nothing has completed today", not zero. A dashboard that renders an empty
 * morning as "0% on time" is a dashboard that starts every day with a
 * false alarm.
 */

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useAdminQuery, useFreshness, useOpsSummary } from '@/hooks';
import { formatCount, formatDate, humanise } from '@/lib/admin/format';
import {
  OPS_LANES,
  OPS_LANE_LABEL,
  OPS_LANE_STATUSES,
  type AuditLogRow,
  type OpsLaneKey,
  type OpsSummary,
  type Paginated,
} from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  EmptyState,
  IconAlert,
  IconBoard,
  IconClock,
  IconDispatch,
  IconInbox,
  IconIssues,
  IconOrders,
  IconRiders,
  IconStock,
  IconVendors,
  KpiTile,
  RelativeTime,
} from '@/components/admin';
import { LiveMeta } from './LiveMeta';
import { QueueTile, type QueueTone } from './QueueTile';

const REFRESH_MS = 30_000;
const SUMMARY_PATH = '/admin/ops/summary';
const AUDIT_PATH = '/admin/audit-logs';

/* ================================================================== */
/* Queue definitions                                                   */
/* ================================================================== */

interface QueueDef {
  key: string;
  label: string;
  href: string;
  tone: QueueTone;
  hint: (count: number) => string;
  clearHint: string;
  icon: ReactNode;
  /** tie-breaker within a tone — lower is worse */
  rank: number;
  read: (summary: OpsSummary) => number;
}

const QUEUES: readonly QueueDef[] = [
  {
    key: 'stuckOrders',
    label: 'Stuck orders',
    href: '/admin/board',
    tone: 'crit',
    hint: (n) => `${n === 1 ? 'An order has' : `${n} orders have`} sat in one status too long.`,
    clearHint: 'Every live order is moving.',
    icon: <IconClock />,
    rank: 0,
    read: (s) => s.needsAction.stuckOrders,
  },
  {
    key: 'failedDeliveries',
    label: 'Failed deliveries',
    href: '/admin/orders?status=DELIVERY_FAILED',
    tone: 'crit',
    hint: (n) => `${n} ${n === 1 ? 'delivery' : 'deliveries'} came back. Decide: retry or refund.`,
    clearHint: 'Nothing came back today.',
    icon: <IconAlert />,
    rank: 1,
    read: (s) => s.needsAction.failedDeliveries,
  },
  {
    key: 'unassignedOrders',
    label: 'Unassigned orders',
    href: '/admin/dispatch',
    tone: 'crit',
    hint: (n) => `${n} packed and waiting for a rider.`,
    clearHint: 'Everything packed has a rider.',
    icon: <IconDispatch />,
    rank: 2,
    read: (s) => s.needsAction.unassignedOrders,
  },
  {
    key: 'outOfStockItems',
    label: 'Out of stock',
    href: '/admin/stock',
    tone: 'crit',
    hint: (n) => `${n} ${n === 1 ? 'line is' : 'lines are'} selling nothing right now.`,
    clearHint: 'Nothing is out of stock.',
    icon: <IconStock />,
    rank: 3,
    read: (s) => s.needsAction.outOfStockItems,
  },
  {
    key: 'openIssues',
    label: 'Open issues',
    href: '/admin/issues',
    tone: 'warn',
    hint: (n) => `${n} customer ${n === 1 ? 'issue' : 'issues'} waiting on a human.`,
    clearHint: 'No open issues.',
    icon: <IconIssues />,
    rank: 4,
    read: (s) => s.needsAction.openIssues,
  },
  {
    key: 'pendingVendors',
    label: 'Pending vendors',
    href: '/admin/approvals',
    tone: 'warn',
    hint: (n) => `${n} ${n === 1 ? 'store' : 'stores'} cannot trade until someone approves them.`,
    clearHint: 'No stores waiting.',
    icon: <IconVendors />,
    rank: 5,
    read: (s) => s.needsAction.pendingVendors,
  },
  {
    key: 'pendingRiders',
    label: 'Pending riders',
    href: '/admin/approvals',
    tone: 'warn',
    hint: (n) => `${n} ${n === 1 ? 'rider' : 'riders'} cannot take a job until verified.`,
    clearHint: 'No riders waiting.',
    icon: <IconRiders />,
    rank: 6,
    read: (s) => s.needsAction.pendingRiders,
  },
  {
    key: 'lowStockItems',
    label: 'Low stock',
    href: '/admin/stock',
    tone: 'warn',
    hint: (n) => `${n} ${n === 1 ? 'line is' : 'lines are'} below their threshold.`,
    clearHint: 'Stock levels are healthy.',
    icon: <IconInbox />,
    rank: 7,
    read: (s) => s.needsAction.lowStockItems,
  },
];

const TONE_WEIGHT: Record<QueueTone, number> = { crit: 0, warn: 1, neutral: 2 };

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export function OpsDashboard() {
  const summary = useOpsSummary({ refreshMs: REFRESH_MS });
  const data = summary.data;
  const freshness = useFreshness(data, REFRESH_MS * 2.5);

  /**
   * Non-empty queues first, worst first; cleared queues fall to the back in
   * their natural order. The row is therefore never the same shape twice — and
   * that is the point: the eye goes to the top-left and finds the worst thing.
   */
  const ordered = useMemo(() => {
    if (data === null) return QUEUES;
    return [...QUEUES].sort((a, b) => {
      const aEmpty = a.read(data) === 0 ? 1 : 0;
      const bEmpty = b.read(data) === 0 ? 1 : 0;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;
      const weight = TONE_WEIGHT[a.tone] - TONE_WEIGHT[b.tone];
      return weight !== 0 ? weight : a.rank - b.rank;
    });
  }, [data]);

  const loading = summary.loading && data === null;

  if (summary.error !== null && data === null) {
    return (
      <AdminPage
        title="Operations"
        description="What needs doing right now, across every vendor and every rider."
      >
        <EmptyState
          title="The operations summary is not available"
          body={
            <>
              {summary.error.friendlyMessage} This screen reads{' '}
              <code>GET {SUMMARY_PATH}</code>. Nothing below it can be drawn without that.
            </>
          }
          action={
            <button type="button" className="adm-btn adm-btn--primary" onClick={summary.refetch}>
              Try again
            </button>
          }
        />
      </AdminPage>
    );
  }

  const breaches = data?.today.slaBreaches ?? 0;
  const onTimePct = data?.today.onTimePct ?? null;

  return (
    <AdminPage
      title="Operations"
      description="What needs doing right now, across every vendor and every rider. Governance numbers live under Reports."
      isFixture={summary.isFixture}
      fixturePaths={summary.isFixture ? [SUMMARY_PATH] : undefined}
      actions={
        <LiveMeta
          freshness={freshness}
          intervalMs={REFRESH_MS}
          onRefresh={summary.refetch}
          loading={summary.loading}
        />
      }
    >
      {/* ---- 1. SLA. Above everything. ------------------------------ */}
      {breaches > 0 ? (
        <Link className="adm-breachbar" href="/admin/board?sla=breached">
          <span className="adm-breachbar__glyph" aria-hidden="true">
            <svg viewBox="0 0 12 12">
              <path d="M1.8 1.8h8.4v8.4H1.8Z" />
            </svg>
          </span>
          <span>
            <strong>
              {formatCount(breaches)} {breaches === 1 ? 'order has' : 'orders have'} breached the
              delivery promise today
            </strong>
            <span className="adm-breachbar__body">
              These are customers who already know something is wrong. Clear them before anything
              else on this page.
            </span>
          </span>
          <span className="adm-breachbar__cta">Open the board →</span>
        </Link>
      ) : null}

      {/* ---- 2. The queues ------------------------------------------ */}
      <AdminSection
        title="Needs action"
        description="Eight queues, worst first. A queue with nothing in it is not a problem — it says Clear."
      >
        <div className="adm-qrow">
          {ordered.map((queue, index) => (
            <QueueTile
              key={queue.key}
              label={queue.label}
              href={queue.href}
              tone={queue.tone}
              icon={queue.icon}
              count={data === null ? 0 : queue.read(data)}
              hint={data === null ? '' : queue.hint(queue.read(data))}
              clearHint={queue.clearHint}
              loading={loading}
              isFixture={summary.isFixture}
              index={index}
            />
          ))}
        </div>
      </AdminSection>

      {/* ---- 3. Live lanes ------------------------------------------ */}
      <AdminSection
        title={`Live orders${data === null ? '' : ` · ${formatCount(data.liveOrders.total)}`}`}
        description="Everything currently in flight, folded into the board's five lanes. The widest bar is where the backlog is."
        actions={
          <Link className="adm-btn adm-btn--sm" href="/admin/board">
            <IconBoard style={{ width: 14, height: 14 }} />
            Open the live board
          </Link>
        }
      >
        <LiveLanes summary={data} loading={loading} />
      </AdminSection>

      {/* ---- 4. Dispatch + today ------------------------------------ */}
      <div className="adm-grid adm-grid--split">
        <AdminSection title="Today" description="Since midnight, UTC day boundary.">
          <div className="adm-kpirow">
            <KpiTile
              label="Placed"
              value={data?.today.ordersPlaced ?? 0}
              loading={loading}
              isFixture={summary.isFixture}
              index={0}
            />
            <KpiTile
              label="Delivered"
              value={data?.today.ordersDelivered ?? 0}
              tone="good"
              loading={loading}
              isFixture={summary.isFixture}
              index={1}
            />
            <KpiTile
              label="Cancelled"
              value={data?.today.ordersCancelled ?? 0}
              tone={(data?.today.ordersCancelled ?? 0) > 0 ? 'warn' : 'neutral'}
              loading={loading}
              isFixture={summary.isFixture}
              index={2}
            />
            <KpiTile
              label="SLA breaches"
              value={breaches}
              tone={breaches > 0 ? 'crit' : 'good'}
              loading={loading}
              isFixture={summary.isFixture}
              index={3}
            />
            {/* `null` is not zero. A morning with nothing delivered yet has no
                on-time percentage, and printing 0% would be a false alarm. */}
            {onTimePct === null && !loading ? (
              <div className="adm-tile" data-tone="neutral">
                <p className="adm-tile__label">On time</p>
                <p className="adm-tile__value">—</p>
                <div className="adm-tile__foot">
                  <span className="adm-dim" style={{ fontSize: 'var(--adm-fs-sm)' }}>
                    Nothing has completed today yet.
                  </span>
                </div>
              </div>
            ) : (
              <KpiTile
                label="On time"
                value={onTimePct ?? 0}
                unit="%"
                tone={(onTimePct ?? 100) >= 95 ? 'good' : 'warn'}
                loading={loading}
                isFixture={summary.isFixture}
                index={4}
              />
            )}
          </div>
        </AdminSection>

        <AdminSection
          title="Dispatch pulse"
          description="Who is out there, and how fast work finds them."
        >
          <DispatchPulse summary={data} loading={loading} />
        </AdminSection>
      </div>

      {/* ---- 5. Activity -------------------------------------------- */}
      <AdminSection
        title="Recent activity"
        description="What people actually did, newest first. Straight off the audit log."
        panel
      >
        <ActivityFeed />
      </AdminSection>

      <p className="adm-dim adm-asof">
        Live counts, read straight from <code>{SUMMARY_PATH}</code>.
        {summary.isFixture ? ' Currently showing a LOCAL FIXTURE — none of it is real.' : null}
      </p>
    </AdminPage>
  );
}

/* ================================================================== */
/* Live lanes                                                          */
/* ================================================================== */

/**
 * The summary reports live orders BY STATUS; the board groups them into five
 * lanes. Folding happens here, with `OPS_LANE_STATUSES` — which is kept in
 * step with the API's own lane specs — so the strip and the board never
 * disagree about how many orders are "preparing".
 */
function LiveLanes({ summary, loading }: { summary: OpsSummary | null; loading: boolean }) {
  const counts = useMemo(() => {
    const byStatus = new Map(
      (summary?.liveOrders.byStatus ?? []).map((row) => [row.status, row.count]),
    );
    const out = new Map<OpsLaneKey, number>();
    for (const lane of OPS_LANES) {
      out.set(
        lane,
        OPS_LANE_STATUSES[lane].reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0),
      );
    }
    return out;
  }, [summary]);

  const peak = Math.max(1, ...OPS_LANES.map((lane) => counts.get(lane) ?? 0));

  return (
    <div className="adm-lanes">
      {OPS_LANES.map((lane, index) => {
        const count = counts.get(lane) ?? 0;
        return (
          <Link
            key={lane}
            className="adm-lanes__item"
            href={`/admin/board?lane=${lane}`}
            style={{ ['--adm-i' as string]: String(index) }}
            data-empty={count === 0 ? 'true' : undefined}
          >
            <span className="adm-lanes__label">{OPS_LANE_LABEL[lane]}</span>
            <span className="adm-lanes__count adm-num">{loading ? '—' : formatCount(count)}</span>
            <span className="adm-lanes__bar" aria-hidden="true">
              <span
                className="adm-lanes__fill"
                style={{ width: `${loading ? 0 : Math.round((count / peak) * 100)}%` }}
              />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/* Dispatch pulse                                                      */
/* ================================================================== */

function DispatchPulse({ summary, loading }: { summary: OpsSummary | null; loading: boolean }) {
  if (loading || summary === null) {
    return (
      <div className="adm-panel adm-panel--pad adm-stack" aria-busy="true">
        <div className="adm-skel adm-skel--line" style={{ width: '70%' }} />
        <div className="adm-skel adm-skel--line" style={{ width: '50%' }} />
        <div className="adm-skel adm-skel--line" style={{ height: 10 }} />
      </div>
    );
  }

  const { ridersOnline, ridersAvailable, ridersOnDelivery, avgAssignMinutes } = summary.dispatch;
  const busyPct = ridersOnline === 0 ? 0 : Math.round((ridersOnDelivery / ridersOnline) * 100);

  // Nobody free WHILE orders wait is the thing worth calling out. A fully
  // committed fleet with an empty queue is a good evening, not a problem.
  const squeezed = ridersAvailable === 0 && summary.needsAction.unassignedOrders > 0;

  return (
    <div className="adm-panel adm-panel--pad adm-stack">
      <div className="adm-pulse">
        <Stat label="Online" value={formatCount(ridersOnline)} />
        <Stat
          label="Available"
          value={formatCount(ridersAvailable)}
          tone={squeezed ? 'crit' : ridersAvailable > 0 ? 'good' : 'neutral'}
        />
        <Stat label="On delivery" value={formatCount(ridersOnDelivery)} />
        <Stat
          label="Avg assign"
          // null means nothing has been assigned today — not "zero minutes".
          value={avgAssignMinutes === null ? '—' : `${avgAssignMinutes.toFixed(1)}m`}
          tone={avgAssignMinutes !== null && avgAssignMinutes > 8 ? 'warn' : 'neutral'}
        />
      </div>

      <div>
        <div
          className="adm-capacity"
          role="img"
          aria-label={`${busyPct}% of online riders are on a delivery`}
        >
          <span className="adm-capacity__fill" style={{ width: `${busyPct}%` }} />
        </div>
        <p className="adm-dim" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--adm-fs-sm)' }}>
          {ridersOnline === 0
            ? 'Nobody is signed in to the delivery app.'
            : `${busyPct}% of the online fleet is mid-delivery.`}
          {squeezed ? ' Nobody is free and orders are waiting — that is the bottleneck.' : null}
          {avgAssignMinutes === null ? ' No assignments yet today.' : null}
        </p>
      </div>

      <Link className="adm-btn adm-btn--sm" href="/admin/dispatch">
        <IconDispatch style={{ width: 14, height: 14 }} />
        Open dispatch
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'crit';
}) {
  return (
    <div className="adm-pulse__stat" data-tone={tone}>
      <p className="adm-pulse__label">{label}</p>
      <p className="adm-pulse__value adm-num">{value}</p>
    </div>
  );
}

/* ================================================================== */
/* Activity                                                            */
/* ================================================================== */

/**
 * The audit log, compacted.
 *
 * `vendor.commission.update` becomes "Vendor commission update" — the dotted
 * action is the machine's name for the event, and an operator should not have
 * to decode one. The full action string stays in the row's `title` attribute
 * so it is still greppable when somebody is debugging.
 */
function ActivityFeed() {
  const audit = useAdminQuery<Paginated<AuditLogRow>>(AUDIT_PATH, { page: 1, limit: 8 });
  const items = audit.data?.data ?? [];

  if (audit.loading && items.length === 0) {
    return (
      <div className="adm-stack" style={{ padding: 'var(--s-3)' }} aria-busy="true">
        {Array.from({ length: 4 }, (_unused, i) => (
          <div className="adm-skel adm-skel--row" key={i} />
        ))}
      </div>
    );
  }

  if (audit.error !== null) {
    return (
      <EmptyState
        title="The activity feed is unavailable"
        body={
          <>
            {audit.error.friendlyMessage} Everything else on this page is unaffected — this panel
            reads <code>{AUDIT_PATH}</code> on its own.
          </>
        }
        icon={<IconOrders />}
        action={
          <button type="button" className="adm-btn adm-btn--sm" onClick={audit.refetch}>
            Try again
          </button>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Quiet"
        body="Nobody has changed anything recently."
        icon={<IconOrders />}
      />
    );
  }

  return (
    <ul className="adm-acts">
      {items.map((item, index) => (
        <li key={item.id} style={{ ['--adm-i' as string]: String(Math.min(index, 14)) }}>
          <span className="adm-acts__item" title={`${item.action} · ${item.method} ${item.path}`}>
            <span className="adm-acts__dot" data-tone={toneOf(item.action)} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <strong className="adm-acts__title">{humanise(item.action.replace(/\./g, ' '))}</strong>
              <span className="adm-acts__detail">
                {item.entity}
                {item.entityId === null ? '' : ` ${item.entityId.slice(-6)}`} · by a{' '}
                {humanise(item.actorRole).toLowerCase()} · {formatDate(item.at, 'time')}
              </span>
            </span>
            <RelativeTime value={item.at} className="adm-acts__when" live={false} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Semantic tone for an audit action. Unknown actions stay neutral. */
function toneOf(action: string): 'neutral' | 'good' | 'warn' | 'crit' {
  if (/(reject|suspend|cancel|delete|unassign)/.test(action)) return 'crit';
  if (/(approve|resolve|assign|deliver)/.test(action)) return 'good';
  if (/(update|refund)/.test(action)) return 'warn';
  return 'neutral';
}
