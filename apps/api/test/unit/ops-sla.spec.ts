import 'reflect-metadata';

import { OrderStatus } from '../../src/common/constants/order-status.enum';
import {
  LANE_CARD_CAP,
  OPS_LANES,
  SLA_WARNING_RATIO,
  STUCK_STATUSES,
  STUCK_THRESHOLD_MINUTES,
  buildSla,
  explainStuck,
  haversineKm,
  isStuck,
  laneFor,
  minutesBetween,
  slaState,
  startOfUtcDay,
  stuckThresholdFor,
} from '../../src/modules/admin/ops/sla.util';

const MINUTE = 60_000;
const at = (iso: string): Date => new Date(iso);

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE OPERATIONS CLOCK
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every red badge on the ADMIN console comes out of this module, and an
 * SLA is only ever interesting at its boundary: 29 minutes and 31 minutes
 * are easy, 24 and 30 are where a warning becomes a breach and where a
 * support conversation starts.
 *
 * So the bands are pinned to the minute here, along with the two things
 * that silently corrupt a duration — a floor that rounds the wrong way,
 * and a clock skew that produces a negative age.
 */
describe('ops SLA and stuck maths', () => {
  // ══════════════════════════════════════════════════════════════════
  //  minutesBetween
  // ══════════════════════════════════════════════════════════════════

  describe('minutesBetween', () => {
    it('counts whole elapsed minutes', () => {
      const from = at('2026-09-24T10:00:00.000Z');
      expect(minutesBetween(from, at('2026-09-24T10:00:00.000Z'))).toBe(0);
      expect(minutesBetween(from, at('2026-09-24T10:30:00.000Z'))).toBe(30);
      expect(minutesBetween(from, at('2026-09-24T11:45:00.000Z'))).toBe(105);
    });

    it('FLOORS rather than rounds', () => {
      // 29m59s must never be reported as 30 on a 30-minute promise: an
      // elapsed time is the one number that may not round upward, or the
      // console shows a breach a second before there is one.
      const from = at('2026-09-24T10:00:00.000Z');
      expect(minutesBetween(from, at('2026-09-24T10:29:59.999Z'))).toBe(29);
      expect(minutesBetween(from, at('2026-09-24T10:30:00.000Z'))).toBe(30);
    });

    it('clamps a future timestamp to zero rather than reporting a negative', () => {
      // Clock skew between the app server and the database can produce a
      // document dated a second ahead. "-0 minutes in status" is a bug
      // report, not an incident.
      const from = at('2026-09-24T10:00:05.000Z');
      expect(minutesBetween(from, at('2026-09-24T10:00:00.000Z'))).toBe(0);
    });

    it('accepts epoch milliseconds as well as Dates', () => {
      const from = Date.UTC(2026, 8, 24, 10, 0, 0);
      expect(minutesBetween(from, from + 17 * MINUTE)).toBe(17);
    });

    it('returns 0 for an unparseable input instead of NaN', () => {
      expect(minutesBetween(new Date('nonsense'), at('2026-09-24T10:00:00Z'))).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  slaState — the boundaries
  // ══════════════════════════════════════════════════════════════════

  describe('slaState at the band boundaries (30-minute target)', () => {
    const TARGET = 30;
    // 80% of 30 is exactly 24.
    const WARN_AT = TARGET * SLA_WARNING_RATIO;

    it('is ok below 80% of the target', () => {
      expect(slaState(0, TARGET)).toBe('ok');
      expect(slaState(23, TARGET)).toBe('ok');
      expect(slaState(WARN_AT - 1, TARGET)).toBe('ok');
    });

    it('warns from exactly 80%', () => {
      expect(WARN_AT).toBe(24);
      expect(slaState(24, TARGET)).toBe('warning');
      expect(slaState(25, TARGET)).toBe('warning');
      expect(slaState(29, TARGET)).toBe('warning');
    });

    it('still only warns AT the target, not past it', () => {
      // An order that arrives on the thirtieth minute has used all of the
      // promise and broken none of it. Calling that a breach would report
      // a breach on every order that lands exactly on time.
      expect(slaState(30, TARGET)).toBe('warning');
    });

    it('breaches from the first minute PAST the target', () => {
      expect(slaState(31, TARGET)).toBe('breached');
      expect(slaState(120, TARGET)).toBe('breached');
    });
  });

  describe('slaState with awkward targets', () => {
    it('rounds no band boundary away on a target that is not a multiple of 5', () => {
      // 80% of 45 is 36 exactly; 80% of 25 is 20 exactly.
      expect(slaState(35, 45)).toBe('ok');
      expect(slaState(36, 45)).toBe('warning');
      expect(slaState(45, 45)).toBe('warning');
      expect(slaState(46, 45)).toBe('breached');

      // 80% of 7 is 5.6, so 5 is still ok and 6 warns.
      expect(slaState(5, 7)).toBe('ok');
      expect(slaState(6, 7)).toBe('warning');
      expect(slaState(8, 7)).toBe('breached');
    });

    it('reports ok for a non-positive or non-finite target', () => {
      // An unconfigured SLA must not paint the entire board red.
      expect(slaState(500, 0)).toBe('ok');
      expect(slaState(500, -30)).toBe('ok');
      expect(slaState(500, Number.NaN)).toBe('ok');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  buildSla
  // ══════════════════════════════════════════════════════════════════

  describe('buildSla', () => {
    it('measures from placedAt and echoes the target', () => {
      const placedAt = at('2026-09-24T10:00:00.000Z');
      const now = at('2026-09-24T10:26:30.000Z');

      expect(buildSla(placedAt, now, 30)).toEqual({
        targetMinutes: 30,
        elapsedMinutes: 26,
        state: 'warning',
      });
    });

    it('is ok on a freshly placed order', () => {
      const placedAt = at('2026-09-24T10:00:00.000Z');
      expect(buildSla(placedAt, placedAt, 30)).toEqual({
        targetMinutes: 30,
        elapsedMinutes: 0,
        state: 'ok',
      });
    });

    it('breaches an hour-old live order on a 30-minute promise', () => {
      const placedAt = at('2026-09-24T10:00:00.000Z');
      const now = at('2026-09-24T11:00:00.000Z');
      expect(buildSla(placedAt, now, 30).state).toBe('breached');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Stuck thresholds
  // ══════════════════════════════════════════════════════════════════

  describe('stuck thresholds', () => {
    it('matches the documented per-status ceilings', () => {
      expect(stuckThresholdFor(OrderStatus.PLACED)).toBe(10);
      expect(stuckThresholdFor(OrderStatus.ACCEPTED)).toBe(25);
      expect(stuckThresholdFor(OrderStatus.PACKING)).toBe(25);
      expect(stuckThresholdFor(OrderStatus.READY_FOR_PICKUP)).toBe(15);
      expect(stuckThresholdFor(OrderStatus.ASSIGNED)).toBe(15);
      expect(stuckThresholdFor(OrderStatus.OUT_FOR_DELIVERY)).toBe(45);
    });

    it('has no threshold for a terminal status', () => {
      for (const status of [
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
      ]) {
        expect(stuckThresholdFor(status)).toBeNull();
        // Guards the pipeline: a null threshold must never be compared,
        // because in BSON ordering a number is greater than null and
        // every live order would report as stuck.
        expect(isStuck(status, 10_000, 10_000, 0)).toBe(false);
      }
    });

    it('lists exactly the statuses that carry a threshold', () => {
      expect([...STUCK_STATUSES].sort()).toEqual(
        Object.keys(STUCK_THRESHOLD_MINUTES).sort(),
      );
    });
  });

  describe('isStuck at the threshold boundary', () => {
    const GRACE = 10;

    it('is not stuck AT the threshold, only past it', () => {
      // PLACED > 10 means eleven minutes, not ten.
      expect(isStuck(OrderStatus.PLACED, 10, 10, GRACE)).toBe(false);
      expect(isStuck(OrderStatus.PLACED, 11, 11, GRACE)).toBe(true);
    });

    it('applies each status ceiling independently', () => {
      expect(isStuck(OrderStatus.PACKING, 25, 60, GRACE)).toBe(false);
      expect(isStuck(OrderStatus.PACKING, 26, 60, GRACE)).toBe(true);

      expect(isStuck(OrderStatus.READY_FOR_PICKUP, 15, 60, GRACE)).toBe(false);
      expect(isStuck(OrderStatus.READY_FOR_PICKUP, 16, 60, GRACE)).toBe(true);

      expect(isStuck(OrderStatus.ASSIGNED, 15, 60, GRACE)).toBe(false);
      expect(isStuck(OrderStatus.ASSIGNED, 16, 60, GRACE)).toBe(true);

      expect(isStuck(OrderStatus.OUT_FOR_DELIVERY, 45, 90, GRACE)).toBe(false);
      expect(isStuck(OrderStatus.OUT_FOR_DELIVERY, 46, 90, GRACE)).toBe(true);
    });

    it('holds an order back until it is past the grace age', () => {
      // The grace is a floor on the ORDER's age, not extra slack on the
      // status ceiling — so it can suppress a flag, never invent one.
      expect(isStuck(OrderStatus.PLACED, 11, 11, 20)).toBe(false);
      expect(isStuck(OrderStatus.PLACED, 11, 20, 20)).toBe(true);
    });

    it('is inert at the default grace of 10, because no ceiling is lower', () => {
      // Anything that has exceeded its ceiling is already older than 10
      // minutes, so the default grace changes nothing — which is the
      // property that keeps the documented thresholds honest.
      for (const status of STUCK_STATUSES) {
        const threshold = stuckThresholdFor(status) ?? 0;
        const minutes = threshold + 1;
        expect(isStuck(status, minutes, minutes, 10)).toBe(true);
      }
    });
  });

  describe('explainStuck', () => {
    it('gives a reason and an action for every status that can be stuck', () => {
      for (const status of STUCK_STATUSES) {
        const explanation = explainStuck(status);
        expect(explanation.reason.length).toBeGreaterThan(10);
        expect(explanation.suggestedAction.length).toBeGreaterThan(10);
      }
    });

    it('falls back rather than returning undefined for anything else', () => {
      expect(explainStuck(OrderStatus.DELIVERED).reason).toEqual(
        expect.any(String),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Lanes
  // ══════════════════════════════════════════════════════════════════

  describe('board lanes', () => {
    it('maps each live status to exactly one lane', () => {
      expect(laneFor(OrderStatus.PLACED)).toBe('new');
      expect(laneFor(OrderStatus.ACCEPTED)).toBe('preparing');
      expect(laneFor(OrderStatus.PACKING)).toBe('preparing');
      expect(laneFor(OrderStatus.READY_FOR_PICKUP)).toBe('ready');
      expect(laneFor(OrderStatus.ASSIGNED)).toBe('assigned');
      expect(laneFor(OrderStatus.PICKED_UP)).toBe('assigned');
      expect(laneFor(OrderStatus.OUT_FOR_DELIVERY)).toBe('in_transit');
    });

    it('puts no terminal status on the board', () => {
      expect(laneFor(OrderStatus.DELIVERED)).toBeNull();
      expect(laneFor(OrderStatus.CANCELLED)).toBeNull();
      expect(laneFor(OrderStatus.REJECTED)).toBeNull();
      // DELIVERY_FAILED has its own needs-action tile; it is not work in
      // progress and must not sit in a lane pretending to move.
      expect(laneFor(OrderStatus.DELIVERY_FAILED)).toBeNull();
    });

    it('never lists a status in two lanes', () => {
      const seen = OPS_LANES.flatMap((lane) => [...lane.statuses]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('caps a lane at a size a browser can actually render', () => {
      expect(LANE_CARD_CAP).toBe(50);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Geometry and day boundaries
  // ══════════════════════════════════════════════════════════════════

  describe('haversineKm', () => {
    it('is zero for the same point', () => {
      expect(haversineKm([77.5946, 12.9716], [77.5946, 12.9716])).toBe(0);
    });

    it('measures a short city hop to two decimals', () => {
      // Roughly 1.1 km north of the first point.
      const distance = haversineKm([77.5946, 12.9716], [77.5946, 12.9816]);
      expect(distance).not.toBeNull();
      expect(distance as number).toBeGreaterThan(1);
      expect(distance as number).toBeLessThan(1.2);
    });

    it('returns null rather than NaN when a point is missing or malformed', () => {
      expect(haversineKm(null, [77.5946, 12.9716])).toBeNull();
      expect(haversineKm([77.5946, 12.9716], null)).toBeNull();
      expect(haversineKm([Number.NaN, 12.9716], [77.5946, 12.9716])).toBeNull();
    });
  });

  describe('startOfUtcDay', () => {
    it('returns midnight UTC of the containing day', () => {
      expect(startOfUtcDay(at('2026-09-24T18:43:11.500Z')).toISOString()).toBe(
        '2026-09-24T00:00:00.000Z',
      );
    });

    it('is idempotent on a timestamp that is already midnight', () => {
      const midnight = at('2026-09-24T00:00:00.000Z');
      expect(startOfUtcDay(midnight).getTime()).toBe(midnight.getTime());
    });
  });
});
