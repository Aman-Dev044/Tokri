import 'reflect-metadata';

import {
  DEFAULT_WINDOW_DAYS,
  aov,
  bucketStart,
  deltaPct,
  fillSeries,
  kpi,
  previousPeriod,
  ratePct,
  resolveRange,
  round1,
  utcDay,
} from '../../src/modules/admin/analytics/kpi.util';

const MS_PER_DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);

/**
 * The KPI arithmetic is the one part of the admin API that is pure, and
 * it is also the part a reviewer trusts without checking — a dashboard
 * number is believed precisely because nobody re-derives it by hand.
 *
 * So the edge cases are pinned here: division by zero, a period with no
 * predecessor, a reversed range, and the rounding of money in paise.
 */
describe('analytics KPI maths', () => {
  describe('deltaPct', () => {
    it('computes a plain percentage change to one decimal place', () => {
      expect(deltaPct(150, 100)).toBe(50);
      expect(deltaPct(50, 100)).toBe(-50);
      expect(deltaPct(133, 100)).toBe(33);
      expect(deltaPct(1005, 1000)).toBe(0.5);
    });

    it('returns null when the previous period was zero and this one is not', () => {
      // "+Infinity%" and "+100%" are both lies: going from no orders to
      // seven orders is not a percentage change, it is a start. The UI
      // renders null as a dash, which is the honest answer.
      expect(deltaPct(7, 0)).toBeNull();
      expect(deltaPct(1_000_000, 0)).toBeNull();
    });

    it('returns 0 when both periods are zero', () => {
      // Nothing happened, twice. That is a real answer, not a gap.
      expect(deltaPct(0, 0)).toBe(0);
    });

    it('handles a drop to zero as -100%', () => {
      expect(deltaPct(0, 400)).toBe(-100);
    });

    it('never produces NaN or Infinity for any finite pair', () => {
      const values = [0, 1, 7, 100, 999_999];
      for (const current of values) {
        for (const previous of values) {
          const result = deltaPct(current, previous);
          if (result === null) continue;
          expect(Number.isFinite(result)).toBe(true);
        }
      }
    });
  });

  describe('aov', () => {
    it('is an INTEGER number of paise', () => {
      // 100000 paise over 3 orders is 33333.33..., and a fractional paisa
      // in a report is how settlement figures end up off by a few paise.
      const value = aov(100_000, 3);
      expect(value).toBe(33_333);
      expect(Number.isInteger(value)).toBe(true);
    });

    it('is zero rather than NaN when there are no orders', () => {
      expect(aov(0, 0)).toBe(0);
      expect(aov(50_000, 0)).toBe(0);
    });

    it('rounds half up, consistently', () => {
      expect(aov(5, 2)).toBe(3);
      expect(aov(7, 2)).toBe(4);
    });
  });

  describe('ratePct', () => {
    it('expresses a share as a percentage to one decimal', () => {
      expect(ratePct(8, 100)).toBe(8);
      expect(ratePct(1, 3)).toBe(33.3);
    });

    it('is zero for an empty denominator', () => {
      expect(ratePct(0, 0)).toBe(0);
      expect(ratePct(5, 0)).toBe(0);
    });
  });

  describe('round1', () => {
    it('rounds to a single decimal place', () => {
      expect(round1(33.333)).toBe(33.3);
      expect(round1(33.35)).toBe(33.4);
      expect(round1(-12.26)).toBe(-12.3);
    });
  });

  describe('resolveRange', () => {
    const now = at('2026-09-24T12:00:00.000Z');

    it('defaults to the last 30 days ending now', () => {
      const range = resolveRange(undefined, undefined, now);
      expect(range.to.toISOString()).toBe(now.toISOString());
      expect(range.to.getTime() - range.from.getTime()).toBe(
        DEFAULT_WINDOW_DAYS * MS_PER_DAY,
      );
    });

    it('honours an explicit pair', () => {
      const range = resolveRange(
        '2026-09-01T00:00:00.000Z',
        '2026-09-07T23:59:59.999Z',
        now,
      );
      expect(range.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-09-07T23:59:59.999Z');
    });

    it('runs `from` to now when only `from` is supplied', () => {
      const range = resolveRange('2026-09-01T00:00:00.000Z', undefined, now);
      expect(range.to.toISOString()).toBe(now.toISOString());
    });

    it('swaps a reversed pair instead of matching nothing', () => {
      // A reversed range produces `$gte: later, $lte: earlier`, which
      // matches zero documents — an empty dashboard that reads as
      // "no sales" rather than "bad input".
      const range = resolveRange(
        '2026-09-30T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z',
        now,
      );
      expect(range.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });

    it('falls back to the default window for an unparseable date', () => {
      const range = resolveRange('not-a-date', undefined, now);
      expect(range.to.getTime() - range.from.getTime()).toBe(
        DEFAULT_WINDOW_DAYS * MS_PER_DAY,
      );
    });
  });

  describe('previousPeriod', () => {
    it('is the same length, immediately before, and never overlapping', () => {
      const range = {
        from: at('2026-09-01T00:00:00.000Z'),
        to: at('2026-09-30T23:59:59.999Z'),
      };
      const previous = previousPeriod(range);

      expect(previous.to.getTime()).toBe(range.from.getTime() - 1);
      expect(previous.to.getTime() - previous.from.getTime()).toBe(
        range.to.getTime() - range.from.getTime(),
      );
      // Both windows are inclusive at each end, so an order sitting
      // exactly on the boundary must land in one of them, never in both.
      expect(previous.to.getTime()).toBeLessThan(range.from.getTime());
    });

    it('handles a single-instant range without inverting', () => {
      const instant = at('2026-09-24T00:00:00.000Z');
      const previous = previousPeriod({ from: instant, to: instant });
      expect(previous.from.getTime()).toBeLessThanOrEqual(
        previous.to.getTime(),
      );
    });
  });

  describe('kpi', () => {
    it('packs value, previous and the derived delta', () => {
      expect(kpi(120, 100)).toEqual({
        value: 120,
        previous: 100,
        deltaPct: 20,
      });
      expect(kpi(120, 0)).toEqual({
        value: 120,
        previous: 0,
        deltaPct: null,
      });
    });
  });

  describe('bucketStart', () => {
    it('truncates to midnight UTC for a day bucket', () => {
      expect(
        utcDay(bucketStart(at('2026-09-24T18:43:11.000Z'), 'day')),
      ).toBe('2026-09-24');
    });

    it('snaps back to Monday for a week bucket', () => {
      // 2026-09-24 is a Thursday; its ISO week starts Monday the 21st.
      expect(
        utcDay(bucketStart(at('2026-09-24T18:43:11.000Z'), 'week')),
      ).toBe('2026-09-21');
      // A Sunday belongs to the week that STARTED six days earlier, not
      // to the one beginning the next day.
      expect(
        utcDay(bucketStart(at('2026-09-27T23:59:59.000Z'), 'week')),
      ).toBe('2026-09-21');
    });

    it('snaps to the first of the month for a month bucket', () => {
      expect(
        utcDay(bucketStart(at('2026-09-24T18:43:11.000Z'), 'month')),
      ).toBe('2026-09-01');
    });
  });

  describe('fillSeries', () => {
    const range = {
      from: at('2026-09-01T00:00:00.000Z'),
      to: at('2026-09-05T23:59:59.999Z'),
    };

    it('returns every bucket in the range, in order', () => {
      const series = fillSeries(
        [
          { date: '2026-09-02', value: 500 },
          { date: '2026-09-04', value: 900 },
        ],
        range,
        'day',
      );

      expect(series.map((point) => point.date)).toEqual([
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
      ]);
    });

    it('zero-fills the gaps rather than omitting them', () => {
      // A chart fed only the buckets that have data draws a continuous
      // line straight through a three-day outage, which reads as steady
      // trade instead of "we were down".
      const series = fillSeries(
        [{ date: '2026-09-03', value: 700 }],
        range,
        'day',
      );
      expect(series.map((point) => point.value)).toEqual([0, 0, 700, 0, 0]);
    });

    it('produces an all-zero series when there is no data at all', () => {
      const series = fillSeries([], range, 'day');
      expect(series).toHaveLength(5);
      expect(series.every((point) => point.value === 0)).toBe(true);
    });

    it('ignores rows outside the range instead of appending them', () => {
      const series = fillSeries(
        [
          { date: '2026-08-31', value: 100 },
          { date: '2026-09-02', value: 200 },
        ],
        range,
        'day',
      );
      expect(series).toHaveLength(5);
      expect(series.find((point) => point.date === '2026-08-31')).toBeUndefined();
    });

    it('is bounded — a pathological range cannot spin forever', () => {
      const series = fillSeries(
        [],
        { from: at('1990-01-01T00:00:00.000Z'), to: at('2090-01-01T00:00:00.000Z') },
        'day',
      );
      expect(series.length).toBeLessThanOrEqual(1200);
    });
  });
});
