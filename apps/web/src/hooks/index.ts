/**
 * Client hooks shared across the app.
 *
 * Import from `@/hooks`, not from the individual files — the barrel is what
 * lets a hook be split or renamed without touching every screen that uses it.
 */

export { useAdminQuery, invalidateAdmin } from './useAdminQuery';
export type { AdminQueryOptions, AdminQueryResult } from './useAdminQuery';

export { useAdminMutation } from './useAdminMutation';
export type {
  AdminMutateOptions,
  AdminMutationMethod,
  AdminMutationResult,
} from './useAdminMutation';

export { useDebounced } from './useDebounced';
export { useReducedMotion, useMediaQuery } from './useReducedMotion';
export { useCountUp } from './useCountUp';
export type { CountUpOptions } from './useCountUp';

export { useFreshness } from './useFreshness';
export type { Freshness } from './useFreshness';

export { useOpsSummary, opsBadges, OPS_SUMMARY_PATH } from './useOpsSummary';
export type { OpsBadge, OpsBadges, UseOpsSummaryOptions } from './useOpsSummary';
