'use client';

/**
 * `GET /admin/ops/summary` — the one read that feeds both the sidebar badges
 * and the operations dashboard.
 *
 * It is a thin wrapper over `useAdminQuery` rather than a new fetcher, so it
 * inherits the whole contract: in-memory token, abort on unmount, refetch on
 * `invalidateAdmin('/admin/ops')`, polling that pauses while the tab is hidden,
 * and the LABELLED fixture fallback with `isFixture` set.
 *
 * ── THE BADGE HONESTY RULE ──────────────────────────────────────────────────
 * When the summary came from a fixture, the counts are invented. A number in a
 * sidebar has no room for a banner next to it, so `opsBadges` carries the
 * `isFixture` flag through and the rail renders the badge visibly derated with
 * a title that says so. An invented "9 issues waiting" that looks real is worse
 * than no badge at all.
 */

import { useAdminQuery, type AdminQueryResult } from './useAdminQuery';
import type { NavBadgeKey } from '@/lib/admin/nav';
import type { OpsSummary } from '@/lib/admin/types';

export const OPS_SUMMARY_PATH = '/admin/ops/summary';

export interface UseOpsSummaryOptions {
  /** poll interval in ms; polling pauses while the tab is hidden */
  refreshMs?: number;
  enabled?: boolean;
}

export function useOpsSummary(options: UseOpsSummaryOptions = {}): AdminQueryResult<OpsSummary> {
  const { refreshMs, enabled = true } = options;
  return useAdminQuery<OpsSummary>(OPS_SUMMARY_PATH, undefined, { refreshMs, enabled });
}

export interface OpsBadge {
  count: number;
  /** the count is sample data and must not be presented as real */
  isFixture: boolean;
}

export type OpsBadges = Partial<Record<NavBadgeKey, OpsBadge>>;

/**
 * Summary -> the three sidebar badges.
 *
 * Approvals is deliberately vendors AND riders in one number: the sidebar entry
 * is one queue to a human, and splitting it into two badges on one row is how
 * you get an operator who stops reading either of them.
 */
export function opsBadges(summary: OpsSummary | null, isFixture: boolean): OpsBadges {
  if (summary === null) return {};
  const queues = summary.needsAction;

  const badge = (count: number): OpsBadge | undefined =>
    // Zero is not a badge. "Nothing waiting" is the absence of a number, not a
    // grey 0 that the eye still has to check every time it passes.
    count > 0 ? { count, isFixture } : undefined;

  return {
    approvals: badge(queues.pendingVendors + queues.pendingRiders),
    issues: badge(queues.openIssues),
    stock: badge(queues.lowStockItems + queues.outOfStockItems),
  };
}
