'use client';

/**
 * ★ THE LIVE ORDER BOARD — five lanes, every order in flight.
 *
 * ── WHO THIS IS FOR ─────────────────────────────────────────────────────────
 * The person on shift. It is the screen that stays open on the second monitor,
 * so three things matter more than they would anywhere else in this console:
 *
 *   1. It must say how old it is. A board that silently stops polling looks
 *      exactly like a quiet evening — see `<LiveMeta/>`.
 *   2. Trouble must read at a glance, in shape and word as well as colour.
 *      Roughly one man in twelve cannot separate the red from the amber.
 *   3. Nothing may pulse forever. A breach flashes once as it arrives, then
 *      holds. Over an eight-hour shift, a permanently animated page is
 *      something the operator learns to stop seeing.
 *
 * ── POLLING ─────────────────────────────────────────────────────────────────
 * 15s, paused while the tab is hidden (`useAdminQuery` does that for every
 * query — a backgrounded console hammering the API for nobody's benefit is
 * just cost). The lane counts come from the SERVER, not from `cards.length`,
 * so a capped lane reports the real backlog and says it was capped.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 * It does not sort, slice or re-lane anything client-side. Vendor and order-no
 * filtering go to the API. The `lane` and `sla` narrowing IS local, and is
 * labelled as narrowing what was fetched rather than pretending to be a query.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAdminQuery, useDebounced, useFreshness } from '@/hooks';
import { formatCount, formatDate, humanise } from '@/lib/admin/format';
import {
  OPS_LANES,
  OPS_LANE_LABEL,
  type OpsBoardLane,
  type OpsBoardResponse,
  type OpsLaneKey,
  type OpsOrderCard,
  type OpsSlaState,
  type OrderDetail,
} from '@/lib/admin/types';
import {
  AdminPage,
  DetailDrawer,
  EmptyState,
  FilterBar,
  IconDispatch,
  IconOrders,
  Money,
  RelativeTime,
  StatusPill,
  type FilterDef,
  type FilterOption,
  type FilterValues,
} from '@/components/admin';
import { BoardLaneView, LiveMeta, SlaIndicator, slaPhrase } from '@/components/admin/ops';

const REFRESH_MS = 15_000;
const BOARD_PATH = '/admin/ops/board';

const SLA_OPTIONS = [
  { label: 'Any SLA', value: 'all' },
  { label: 'Breached only', value: 'breached' },
  { label: 'Breached or due soon', value: 'atrisk' },
];

const LANE_OPTIONS = [
  { label: 'All lanes', value: 'all' },
  ...OPS_LANES.map((lane) => ({ label: OPS_LANE_LABEL[lane], value: lane })),
];

/**
 * `useSearchParams` opts a route into client-side rendering, and Next refuses
 * to prerender a page that reads it without a Suspense boundary above. There is
 * nothing meaningful to draw before the filters are known: a board rendered
 * unfiltered and then re-filtered under the cursor is worse than one that takes
 * an extra frame to arrive correct.
 */
export default function AdminBoardPage() {
  return (
    <Suspense fallback={<BoardFallback />}>
      <LiveBoard />
    </Suspense>
  );
}

function BoardFallback() {
  return (
    <div className="adm-stack" aria-busy="true">
      <span className="adm-skel adm-skel--line" style={{ width: 240, height: 24 }} />
      <span className="adm-skel adm-skel--chart" />
    </div>
  );
}

/* ================================================================== */

function LiveBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep links from the ops dashboard arrive pre-narrowed: `?sla=breached`
  // has to land as a narrowed board, not one the operator re-narrows by hand.
  const [values, setValues] = useState<FilterValues>(() => ({
    q: searchParams.get('q') ?? '',
    vendorId: searchParams.get('vendorId') ?? 'all',
    lane: searchParams.get('lane') ?? 'all',
    sla: searchParams.get('sla') ?? 'all',
  }));

  const q = useDebounced(values.q ?? '', 300);
  const vendorId = values.vendorId ?? 'all';
  const laneFilter = values.lane ?? 'all';
  const slaFilter = values.sla ?? 'all';

  /**
   * ★ THE RESPONSE IS A BARE ARRAY of five lanes — not `{data, meta}`.
   * Reaching for `.data` on it yields `undefined` and an empty board that
   * looks exactly like a quiet evening, which is the most expensive shape bug
   * this screen could have.
   */
  const board = useAdminQuery<OpsBoardResponse>(
    BOARD_PATH,
    {
      q: q || undefined,
      // The API validates `vendorId` as a Mongo id, so 'all' must never reach
      // it — an invalid filter is a 400, and a 400 here is a blank board.
      vendorId: vendorId === 'all' ? undefined : vendorId,
    },
    { refreshMs: REFRESH_MS },
  );

  const data = board.data;
  const freshness = useFreshness(data, REFRESH_MS * 2.5);

  /* ---- which cards changed lane since the last poll ---------------- */

  const previousLanes = useRef<Map<string, OpsLaneKey>>(new Map());
  const [moved, setMoved] = useState<ReadonlySet<string>>(() => new Set<string>());

  useEffect(() => {
    if (!data) return;

    const next = new Map<string, OpsLaneKey>();
    const changed = new Set<string>();

    for (const lane of data) {
      for (const card of lane.orders) {
        next.set(card.id, lane.lane);
        const before = previousLanes.current.get(card.id);
        // A card seen for the first time is NOT "moved" — everything would
        // animate on the first paint, which says nothing.
        if (before !== undefined && before !== lane.lane) changed.add(card.id);
      }
    }

    previousLanes.current = next;
    if (changed.size === 0) return;

    setMoved(changed);
    // One cycle, then the class comes off. The animation is a notification,
    // not a state.
    const timer = window.setTimeout(() => setMoved(new Set<string>()), 1400);
    return () => window.clearTimeout(timer);
  }, [data]);

  /* ---- local narrowing --------------------------------------------- */

  const lanes = useMemo<OpsBoardLane[]>(() => {
    const raw = data ?? [];
    // The server returns the lanes in a fixed order; pinning that order here
    // as well means a lane can never move column between two polls, which is
    // what makes the board readable at a glance.
    const byKey = new Map(raw.map((lane) => [lane.lane, lane]));

    return OPS_LANES.filter((lane) => laneFilter === 'all' || laneFilter === lane).map((lane) => {
      const found = byKey.get(lane);
      if (!found) {
        return { lane, label: OPS_LANE_LABEL[lane], orders: [], total: 0, truncated: false };
      }
      if (slaFilter === 'all') return found;

      const keep = (state: OpsSlaState) =>
        slaFilter === 'breached' ? state === 'breached' : state !== 'ok';

      const orders = found.orders.filter((card) => keep(card.sla.state));
      return {
        lane,
        label: found.label,
        orders,
        // Narrowed locally, so the header must report what is ON SCREEN. The
        // server total here would claim orders this view is hiding.
        total: orders.length,
        truncated: false,
      };
    });
  }, [data, laneFilter, slaFilter]);

  /**
   * The vendor filter options come from the board itself: the vendors that
   * currently HAVE a live order. There is no vendor list on this endpoint, and
   * offering four hundred stores when six of them have work is a filter nobody
   * uses.
   *
   * ★ THEY ARE ONLY LEARNED FROM THE **UNFILTERED** BOARD. Once a vendor is
   * selected the response contains that vendor alone, so rebuilding the list
   * from it would collapse the dropdown to the option already chosen — and
   * trap the operator on one store with no way back but a reset.
   */
  const [vendorOptions, setVendorOptions] = useState<FilterOption[]>([]);

  useEffect(() => {
    if (data === null || vendorId !== 'all') return;

    const seen = new Map<string, string>();
    for (const lane of data) {
      for (const card of lane.orders) {
        if (!seen.has(card.vendorId)) seen.set(card.vendorId, card.vendorName ?? card.vendorId);
      }
    }

    const next = [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Replace only on a real change, so a poll that returns the same six
    // stores does not hand <FilterBar/> a new array every fifteen seconds.
    setVendorOptions((previous) =>
      previous.length === next.length &&
      previous.every((option, i) => option.value === next[i]?.value)
        ? previous
        : next,
    );
  }, [data, vendorId]);

  const totalShown = lanes.reduce((sum, lane) => sum + lane.orders.length, 0);
  const narrowed = laneFilter !== 'all' || slaFilter !== 'all';

  /* ---- filters ------------------------------------------------------ */

  const filters: FilterDef[] = useMemo(
    () => [
      {
        key: 'q',
        label: 'Order or customer',
        type: 'search',
        placeholder: 'MND-20260924-9007, or a name',
      },
      {
        key: 'vendorId',
        label: 'Vendor',
        type: 'select',
        options: [{ label: 'All vendors', value: 'all' }, ...vendorOptions],
      },
      { key: 'lane', label: 'Lane', type: 'select', options: LANE_OPTIONS },
      { key: 'sla', label: 'SLA', type: 'select', options: SLA_OPTIONS },
    ],
    [vendorOptions],
  );

  /* ---- the drawer --------------------------------------------------- */

  const [selected, setSelected] = useState<OpsOrderCard | null>(null);

  return (
    <AdminPage
      title="Live board"
      description="Every order in flight, by stage. Lane counts come from the server; anything late is called out in shape, colour and words."
      isFixture={board.isFixture}
      fixturePaths={board.isFixture ? [BOARD_PATH] : undefined}
      actions={
        <LiveMeta
          freshness={freshness}
          intervalMs={REFRESH_MS}
          onRefresh={board.refetch}
          loading={board.loading}
        />
      }
    >
      <FilterBar
        filters={filters}
        values={values}
        onChange={setValues}
        onReset={() => {
          setValues({ q: '', vendorId: 'all', lane: 'all', sla: 'all' });
          // Clear the deep-link params too, or a reload re-applies the filter
          // the operator just reset.
          router.replace('/admin/board');
        }}
      />

      {narrowed ? (
        <p className="adm-dim adm-asof" role="status">
          Narrowing what was fetched: {totalShown} {totalShown === 1 ? 'card' : 'cards'} shown
          {laneFilter === 'all' ? '' : ` in ${OPS_LANE_LABEL[laneFilter as OpsLaneKey]}`}
          {slaFilter === 'all' ? '' : slaFilter === 'breached' ? ', breached only' : ', at risk'}.{' '}
          <button
            type="button"
            className="adm-btn adm-btn--sm adm-btn--ghost"
            onClick={() => setValues({ ...values, lane: 'all', sla: 'all' })}
          >
            Show every lane
          </button>
        </p>
      ) : null}

      {board.error !== null && data === null ? (
        <EmptyState
          title="The board is not available"
          body={
            <>
              {board.error.friendlyMessage} This screen reads <code>GET {BOARD_PATH}</code>.
            </>
          }
          action={
            <button type="button" className="adm-btn adm-btn--primary" onClick={board.refetch}>
              Try again
            </button>
          }
        />
      ) : (
        /* The board scrolls sideways inside ITS OWN container. The page body
           never does — that is the house rule that stops a wide surface
           dragging the whole console off-screen. */
        <div className="adm-board" role="group" aria-label="Live order lanes">
          {lanes.map((lane) => (
            <BoardLaneView
              key={lane.lane}
              lane={lane}
              moved={moved}
              onOpen={setSelected}
              moreHref={`/admin/orders?status=${laneStatusParam(lane.lane)}`}
              loading={board.loading && data === null}
              empty={
                narrowed
                  ? 'Nothing here matches the current narrowing.'
                  : `Nothing ${OPS_LANE_LABEL[lane.lane].toLowerCase()}.`
              }
            />
          ))}
        </div>
      )}

      <CardDrawer card={selected} onClose={() => setSelected(null)} />
    </AdminPage>
  );
}

/** Which `/admin/orders` status filter a lane's "see all" link should apply. */
function laneStatusParam(lane: OpsLaneKey): string {
  switch (lane) {
    case 'new':
      return 'PLACED';
    case 'preparing':
      return 'PACKING';
    case 'ready':
      return 'READY_FOR_PICKUP';
    case 'assigned':
      return 'ASSIGNED';
    case 'in_transit':
      return 'OUT_FOR_DELIVERY';
  }
}

/* ================================================================== */
/* The drawer                                                          */
/* ================================================================== */

/**
 * The card you clicked, without losing the board you clicked it from.
 *
 * The timeline comes from `/admin/orders/:id` rather than from the board
 * payload: putting a full status history on every card would multiply the size
 * of a poll that fires every fifteen seconds by the number of transitions each
 * order has been through, to render something nobody is looking at.
 */
function CardDrawer({ card, onClose }: { card: OpsOrderCard | null; onClose: () => void }) {
  const detail = useAdminQuery<OrderDetail>(
    card === null ? '/admin/orders/none' : `/admin/orders/${card.id}`,
    undefined,
    { enabled: card !== null },
  );

  if (card === null) return null;

  const history = detail.data?.statusHistory ?? [];

  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={card.orderNo}
      subtitle={`${card.vendorName ?? 'Store not resolved'} · ${card.customerName ?? 'Customer not resolved'}`}
      width="min(560px, 100vw)"
      actions={
        <>
          <Link className="adm-btn adm-btn--primary" href={`/admin/orders/${card.id}`}>
            <IconOrders style={{ width: 15, height: 15 }} />
            Open the full order
          </Link>
          {card.riderId === null ? (
            <Link className="adm-btn" href="/admin/dispatch">
              <IconDispatch style={{ width: 15, height: 15 }} />
              Assign a rider
            </Link>
          ) : (
            <Link className="adm-btn" href={`/admin/riders/${card.riderId}`}>
              View {card.riderName}
            </Link>
          )}
        </>
      }
    >
      <div className="adm-stack">
        <div className="adm-row" style={{ flexWrap: 'wrap', gap: 'var(--s-2)' }}>
          <StatusPill status={card.status} kind="order" />
          <SlaIndicator sla={card.sla} pulseKey={`drawer:${card.id}:${card.sla.state}`} />
          <span className="adm-dim">
            {card.minutesInStatus}m in {humanise(card.status).toLowerCase()}
          </span>
        </div>

        <dl className="adm-dl">
          <dt>Vendor</dt>
          <dd>{card.vendorName ?? 'Not resolved'}</dd>
          <dt>Customer</dt>
          <dd>{card.customerName ?? 'Not resolved'}</dd>
          <dt>Items</dt>
          <dd>{formatCount(card.itemCount)}</dd>
          <dt>Total</dt>
          <dd>
            <Money value={card.grandTotal} />
          </dd>
          <dt>Rider</dt>
          <dd>{card.riderId === null ? 'Not assigned' : (card.riderName ?? 'Not resolved')}</dd>
          <dt>Placed</dt>
          <dd>
            <RelativeTime value={card.placedAt} live={false} /> ({formatDate(card.placedAt, 'long')}
            )
          </dd>
          <dt>Promise</dt>
          <dd>
            {card.sla.targetMinutes}m target · {card.sla.elapsedMinutes}m elapsed ·{' '}
            {slaPhrase(card.sla)}
          </dd>
        </dl>

        <section aria-label="Status history">
          <h3 className="adm-section__title" style={{ marginBottom: 'var(--s-2)' }}>
            Status history
          </h3>

          {detail.loading && history.length === 0 ? (
            <div className="adm-stack" aria-busy="true">
              <span className="adm-skel adm-skel--row" />
              <span className="adm-skel adm-skel--row" />
              <span className="adm-skel adm-skel--row" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              title="No transitions recorded"
              body="Either this order has only just been placed, or the detail endpoint is unavailable."
            />
          ) : (
            <ol className="adm-timeline">
              {history.map((event, index) => (
                <li
                  className="adm-timeline__item"
                  key={`${event.to}-${event.at}-${index}`}
                  data-tone={
                    event.to === 'DELIVERED'
                      ? 'good'
                      : event.to === 'DELIVERY_FAILED' || event.to === 'CANCELLED'
                        ? 'crit'
                        : 'neutral'
                  }
                  data-current={index === history.length - 1 ? 'true' : undefined}
                  style={{ ['--adm-i' as string]: String(index) }}
                >
                  <span className="adm-timeline__node" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="adm-timeline__head">
                      <span className="adm-timeline__to">{humanise(event.to)}</span>
                    </div>
                    <p className="adm-timeline__actor">
                      by <strong>{event.byName}</strong> ·{' '}
                      <RelativeTime value={event.at} live={false} />
                    </p>
                    {event.reason ? (
                      <p className="adm-timeline__reason">“{event.reason}”</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {detail.isFixture ? (
            <p className="adm-dim adm-asof">
              This history is sample data — <code>/admin/orders/{card.id}</code> was not reachable.
            </p>
          ) : null}
        </section>
      </div>
    </DetailDrawer>
  );
}
