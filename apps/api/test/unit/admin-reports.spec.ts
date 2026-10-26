import 'reflect-metadata';

import {
  ALL_GROUPINGS,
  REPORT_GROUPINGS,
  REPORT_KEYS,
  bucketOf,
  reportEnvelope,
  reportWindow,
  slabLabel,
} from '../../src/modules/admin/reports/report.util';
import { inclusiveTo } from '../../src/modules/admin/common/dto';

/**
 * The pure half of `/admin/reports` and `/admin/payments`.
 *
 * Pinned here because each of these is a place a report goes quietly
 * wrong rather than loudly: a `to` that drops its own last day, a week
 * that starts on Sunday on one screen and Monday on another, an empty
 * result whose envelope claims a page that does not exist.
 */
describe('admin reports maths', () => {
  describe('inclusiveTo', () => {
    it('widens a bare date to the last millisecond of that UTC day', () => {
      // The date pickers send exactly this. As a plain `new Date()` it is
      // midnight, and "up to the 24th" would exclude the whole 24th.
      expect(inclusiveTo('2026-09-24').toISOString()).toBe(
        '2026-09-24T23:59:59.999Z',
      );
    });

    it('takes a full timestamp exactly as given', () => {
      expect(inclusiveTo('2026-09-24T10:30:00.000Z').toISOString()).toBe(
        '2026-09-24T10:30:00.000Z',
      );
    });
  });

  describe('reportWindow', () => {
    it('covers both whole days of a date-only pair', () => {
      const window = reportWindow('2026-09-18', '2026-09-24');
      expect(window.from.toISOString()).toBe('2026-09-18T00:00:00.000Z');
      expect(window.to.toISOString()).toBe('2026-09-24T23:59:59.999Z');
    });

    it('defaults to the trailing thirty days when the page has not sent a window yet', () => {
      const now = new Date('2026-10-26T12:00:00.000Z');
      const window = reportWindow(undefined, undefined, now);
      expect(window.to.toISOString()).toBe(now.toISOString());
      expect(window.to.getTime() - window.from.getTime()).toBe(30 * 86_400_000);
    });

    it('swaps a reversed pair rather than matching nothing', () => {
      const window = reportWindow('2026-09-24', '2026-09-18');
      expect(window.from.getTime()).toBeLessThan(window.to.getTime());
    });
  });

  describe('bucketOf', () => {
    it('keeps a day as itself', () => {
      expect(bucketOf('2026-09-24', 'day')).toBe('2026-09-24');
    });

    it('labels a week by its Monday, including when the day IS Sunday', () => {
      // 2026-09-24 is a Thursday; 2026-09-27 a Sunday — still the week
      // that began on Monday the 21st, not the start of the next one.
      expect(bucketOf('2026-09-24', 'week')).toBe('2026-09-21');
      expect(bucketOf('2026-09-27', 'week')).toBe('2026-09-21');
      expect(bucketOf('2026-09-28', 'week')).toBe('2026-09-28');
    });

    it('labels a month by its first day', () => {
      expect(bucketOf('2026-09-24', 'month')).toBe('2026-09-01');
      expect(bucketOf('2026-12-31', 'month')).toBe('2026-12-01');
    });
  });

  describe('slabLabel', () => {
    it('names the rate actually charged', () => {
      expect(slabLabel(5)).toBe('5%');
      expect(slabLabel(0)).toBe('0%');
    });

    it('does not invent a rate for an order with no taxable value', () => {
      expect(slabLabel(null)).toBe('No taxable value');
    });
  });

  describe('reportEnvelope', () => {
    it('answers an empty report with zero pages, not a phantom page one', () => {
      expect(reportEnvelope([])).toEqual({
        data: [],
        meta: { page: 1, limit: 0, total: 0, pages: 0 },
      });
    });

    it('answers a non-empty report as one page holding every row', () => {
      const rows = [{ date: '2026-09-24', orders: 3 }];
      expect(reportEnvelope(rows).meta).toEqual({
        page: 1,
        limit: 1,
        total: 1,
        pages: 1,
      });
    });
  });

  describe('groupings', () => {
    it('gives every report at least one grouping, its default first', () => {
      for (const key of REPORT_KEYS) {
        expect(REPORT_GROUPINGS[key].length).toBeGreaterThan(0);
      }
      expect(REPORT_GROUPINGS.sales[0]).toBe('day');
    });

    it('allows exactly the union of the per-report groupings', () => {
      expect([...ALL_GROUPINGS].sort()).toEqual(
        ['aisle', 'day', 'month', 'slab', 'vendor', 'week'].sort(),
      );
    });
  });
});
