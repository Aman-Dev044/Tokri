/**
 * SAMPLE OPS DATA — NOT REAL NUMBERS. THE OFFLINE CASE ONLY.
 *
 * The `/admin/ops/*` endpoints are LIVE. Every ops screen calls the real path
 * through `useAdminQuery` and gets real data. This file exists for exactly one
 * situation: the API is unreachable — not running locally, or down — in which
 * case the hook falls back here and sets `isFixture`, which every ops screen
 * renders as the amber `<FixtureBanner/>` and the sidebar renders as a visibly
 * derated badge.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A fixture number must NEVER be presentable as a real one. An operations
 * console is the worst possible place to get this wrong: a dispatcher acting
 * on an invented "6 orders unassigned" wastes a shift. The banner is the
 * contract that makes this file safe to ship.
 *
 * ── IT MIRRORS THE LIVE CONTRACT EXACTLY ────────────────────────────────────
 * Same field names, same nesting, same nullability — including the bare-array
 * board response. A fixture that differs from the endpoint it stands in for is
 * worse than no fixture: it hides a shape bug until production.
 *
 * Everything is produced from a SEEDED generator against a FROZEN clock, so a
 * server render and the first client render agree and screenshots do not drift.
 */

import type {
  OpsBoardLane,
  OpsBoardResponse,
  OpsDispatchResponse,
  OpsDispatchRider,
  OpsLaneKey,
  OpsOrderCard,
  OpsSla,
  OpsSlaState,
  OpsStuckOrder,
  OpsSummary,
  OpsUnassignedOrder,
  OrderStatus,
} from './types';
import { OPS_LANE_LABEL } from './types';

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-randomness                                     */
/* ------------------------------------------------------------------ */

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  const item = list[Math.floor(rng() * list.length)];
  // noUncheckedIndexedAccess: the modulo guarantees a hit, but prove it.
  if (item === undefined) throw new Error('ops-fixtures: empty pick list');
  return item;
}

function between(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** The clock is frozen — see `fixtures.ts` for why. */
const NOW = Date.parse('2026-09-24T18:40:00+05:30');
const MINUTE = 60_000;

function ago(minutes: number): string {
  return new Date(NOW - minutes * MINUTE).toISOString();
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const VENDORS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '6ab4fc85b6df888b1b34f60d', name: 'Ganesh Fresh Mart' },
  { id: '6ab4fc86b6df888b1b34f625', name: 'Mumbai Daily Needs' },
  { id: '6ab4fc86b6df888b1b34f631', name: 'Nashik Daily Mandi' },
  { id: '6ab4fc86b6df888b1b34f63d', name: 'Bandra Bread Co.' },
];

const CUSTOMERS = [
  'Siddharth Rane',
  'Ananya Rao',
  'Rohan Bhat',
  'Fatima Shaikh',
  'Karthik Iyer',
  'Meera Joshi',
  'Sandeep Patil',
  'Neha Kulkarni',
];

const RIDERS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '6ab4fc86b6df888b1b34f823', name: 'Imtiaz Khan' },
  { id: '6ab4fc87b6df888b1b34f853', name: 'Naveen Dsouza' },
  { id: '6ab4fc87b6df888b1b34f859', name: 'Kamal Singh' },
  { id: '6ab4fc87b6df888b1b34f85f', name: 'Tanvi More' },
  { id: '6ab4fc87b6df888b1b34f865', name: 'Deepak Yadav' },
  { id: '6ab4fc87b6df888b1b34f86b', name: 'Sunita Gaikwad' },
];

const VEHICLES = ['bike', 'ev_scooter', 'bicycle'];

/** Which status a fixture card in each lane carries. */
const LANE_STATUS: Record<OpsLaneKey, OrderStatus> = {
  new: 'PLACED',
  preparing: 'PACKING',
  ready: 'READY_FOR_PICKUP',
  assigned: 'ASSIGNED',
  in_transit: 'OUT_FOR_DELIVERY',
};

/* ------------------------------------------------------------------ */
/* SLA                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The state is decided the same way the API decides it: warning opens at 80%
 * of the target, breached is strictly past 100%. Keeping the rule identical is
 * what lets the fixture catch a display bug instead of hiding one.
 */
function sla(targetMinutes: number, elapsedMinutes: number): OpsSla {
  const ratio = elapsedMinutes / targetMinutes;
  const state: OpsSlaState = ratio > 1 ? 'breached' : ratio >= 0.8 ? 'warning' : 'ok';
  return { targetMinutes, elapsedMinutes, state };
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

/** total held by the fake server vs how many it returns, per lane */
const LANE_SHAPE: Record<OpsLaneKey, { total: number; cap: number }> = {
  new: { total: 4, cap: 4 },
  preparing: { total: 11, cap: 8 },
  ready: { total: 3, cap: 3 },
  assigned: { total: 3, cap: 3 },
  in_transit: { total: 3, cap: 3 },
};

function buildCard(rng: () => number, lane: OpsLaneKey, index: number): OpsOrderCard {
  const vendor = pick(rng, VENDORS);
  const minutesInStatus = between(rng, 1, lane === 'in_transit' ? 48 : 34);

  const roll = rng();
  const elapsed = roll < 0.2 ? between(rng, 32, 90) : roll < 0.4 ? between(rng, 24, 30) : between(rng, 2, 20);

  const assigned = lane === 'assigned' || lane === 'in_transit';
  const rider = pick(rng, RIDERS);

  return {
    id: `ord_fx_${lane}_${index}`,
    orderNo: `MND-20260924-${String(9000 + index * 7 + lane.length * 13).padStart(4, '0')}`,
    status: LANE_STATUS[lane],
    vendorId: vendor.id,
    vendorName: vendor.name,
    customerName: pick(rng, CUSTOMERS),
    itemCount: between(rng, 1, 12),
    grandTotal: between(rng, 18_000, 486_000),
    placedAt: ago(minutesInStatus + between(rng, 3, 40)),
    minutesInStatus,
    riderId: assigned ? rider.id : null,
    riderName: assigned ? rider.name : null,
    sla: sla(30, elapsed),
  };
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

function buildBoard(vendorId: string | null, query: string): OpsBoardResponse {
  const rng = seeded(0x0b_0a_2d);

  return (Object.keys(LANE_SHAPE) as OpsLaneKey[]).map<OpsBoardLane>((lane) => {
    const shape = LANE_SHAPE[lane];
    const cards: OpsOrderCard[] = [];
    for (let i = 0; i < shape.cap; i += 1) cards.push(buildCard(rng, lane, i));

    // The fake server filters, exactly as the real one does — the client is
    // never the thing that decides which orders exist.
    const needle = query.toLowerCase();
    const orders = cards.filter((card) => {
      if (vendorId !== null && card.vendorId !== vendorId) return false;
      if (needle === '') return true;
      return (
        card.orderNo.toLowerCase().includes(needle) ||
        (card.customerName ?? '').toLowerCase().includes(needle)
      );
    });

    const narrowed = vendorId !== null || needle !== '';

    return {
      lane,
      label: OPS_LANE_LABEL[lane],
      orders,
      total: narrowed ? orders.length : shape.total,
      truncated: !narrowed && shape.total > shape.cap,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function buildSummary(): OpsSummary {
  return {
    liveOrders: {
      total: 16,
      byStatus: [
        { status: 'PLACED', count: 4 },
        { status: 'ACCEPTED', count: 1 },
        { status: 'PACKING', count: 2 },
        { status: 'READY_FOR_PICKUP', count: 3 },
        { status: 'ASSIGNED', count: 1 },
        { status: 'PICKED_UP', count: 2 },
        { status: 'OUT_FOR_DELIVERY', count: 3 },
      ],
    },
    needsAction: {
      pendingVendors: 2,
      pendingRiders: 0,
      unassignedOrders: 3,
      stuckOrders: 11,
      failedDeliveries: 0,
      openIssues: 21,
      lowStockItems: 6,
      outOfStockItems: 0,
    },
    dispatch: {
      ridersOnline: 9,
      ridersAvailable: 2,
      ridersOnDelivery: 4,
      avgAssignMinutes: 3.9,
    },
    today: {
      ordersPlaced: 16,
      ordersDelivered: 2,
      ordersCancelled: 0,
      slaBreaches: 10,
      onTimePct: 50,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Stuck                                                               */
/* ------------------------------------------------------------------ */

const STUCK_COPY: ReadonlyArray<{ reason: string; action: string }> = [
  {
    reason: 'The vendor has not accepted this order yet.',
    action: 'Call the store. If they cannot fulfil it, cancel and refund.',
  },
  {
    reason: 'Packed and ready, but no rider has been assigned.',
    action: 'Assign someone from the dispatch monitor.',
  },
  {
    reason: 'A rider has held this order without collecting it.',
    action: 'Call the rider. Unassign and reassign if they cannot reach the store.',
  },
  {
    reason: 'Out for delivery far longer than the route should take.',
    action: 'Check the rider’s last position, then call the customer.',
  },
];

function buildStuck(): OpsStuckOrder[] {
  const rng = seeded(0x57_0c_4b);
  const lanes: OpsLaneKey[] = ['new', 'ready', 'assigned', 'in_transit'];

  return lanes.flatMap((lane, laneIndex) =>
    Array.from({ length: 2 }, (_unused, i): OpsStuckOrder => {
      const card = buildCard(rng, lane, laneIndex * 3 + i);
      const copy = pick(rng, STUCK_COPY);
      return {
        ...card,
        sla: sla(30, between(rng, 34, 220)),
        reason: copy.reason,
        suggestedAction: copy.action,
        stuckSinceMinutes: between(rng, 3, 180),
      };
    }),
  ).sort((a, b) => b.stuckSinceMinutes - a.stuckSinceMinutes);
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

function buildRiders(): OpsDispatchRider[] {
  const rng = seeded(0xd1_5a_70);

  return RIDERS.map((rider, index): OpsDispatchRider => {
    const roll = rng();
    const online = roll > 0.15;
    const onJob = online && roll < 0.65;

    return {
      id: rider.id,
      userId: `usr_fx_${index}`,
      name: rider.name,
      phone: `98303000${String(10 + index).slice(0, 2)}`,
      email: `${rider.name.toLowerCase().replace(/\s+/g, '-')}@demo.mandi.app`,
      vendorId: null,
      vendorName: null,
      vehicleType: pick(rng, VEHICLES),
      isOnline: online,
      isAvailable: online && !onJob,
      status: 'active',
      statusReason: null,
      completedCount: between(rng, 40, 210),
      rating: Math.round((3.8 + rng() * 1.2) * 10) / 10,
      activeOrderId: onJob ? `ord_fx_in_transit_${index % 3}` : null,
      location: { lat: 12.94 + rng() / 50, lng: 77.63 + rng() / 50 },
      locationAt: ago(between(rng, 1, 14)),
      createdAt: ago(60 * 24 * 40),
      activeOrderNo: onJob ? `MND-20260924-90${String(10 + index).slice(0, 2)}` : null,
      minutesOnCurrentJob: onJob ? between(rng, 2, 68) : null,
      distanceToDropKm: onJob ? Math.round(rng() * 62) / 10 : null,
    };
  });
}

function buildUnassigned(riders: readonly OpsDispatchRider[]): OpsUnassignedOrder[] {
  const rng = seeded(0x1a_55_19);

  return Array.from({ length: 3 }, (_unused, index): OpsUnassignedOrder => {
    const card = buildCard(rng, 'ready', index);
    const waitingMinutes = between(rng, 3, 58);

    const nearestRiders = riders
      .filter((rider) => rider.isOnline)
      .slice(0, 3)
      .map((rider) => ({
        id: rider.id,
        name: rider.name,
        distanceKm: Math.round(rng() * 74) / 10,
        isAvailable: rider.isAvailable,
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return {
      ...card,
      riderId: null,
      riderName: null,
      sla: sla(30, index === 0 ? between(rng, 40, 90) : between(rng, 8, 28)),
      waitingMinutes,
      nearestRiders,
    };
  });
}

function buildDispatch(): OpsDispatchResponse {
  const riders = buildRiders();
  return { unassigned: buildUnassigned(riders), riders };
}

/* ------------------------------------------------------------------ */
/* Resolver                                                            */
/* ------------------------------------------------------------------ */

/**
 * Called from `resolveFixture` in `fixtures.ts`. Returns `null` for a path this
 * file knows nothing about, so a genuinely missing endpoint still surfaces as a
 * real error rather than as quiet sample data.
 */
export function resolveOpsFixture(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): unknown | null {
  if (path === '/admin/ops/summary') return buildSummary();

  if (path === '/admin/ops/board') {
    const rawVendor = params.vendorId;
    const vendorId =
      rawVendor === undefined || rawVendor === null ? null : String(rawVendor);
    const rawQuery = params.q;
    const q = rawQuery === undefined || rawQuery === null ? '' : String(rawQuery).trim();
    return buildBoard(vendorId, q);
  }

  if (path === '/admin/ops/dispatch') return buildDispatch();

  if (path === '/admin/ops/stuck') {
    const limit = Math.max(1, Number(params.limit ?? 20) || 20);
    const rows = buildStuck();
    return {
      data: rows.slice(0, limit),
      meta: { page: 1, limit, total: rows.length, pages: 1 },
    };
  }

  return null;
}
