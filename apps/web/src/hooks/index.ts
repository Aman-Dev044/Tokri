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

/* ── vendor panel ───────────────────────────────────────────────────────── */
export { useVendorQuery, invalidateVendor } from './useVendorQuery';
export type { VendorQueryOptions, VendorQueryResult } from './useVendorQuery';

export { useVendorMutation } from './useVendorMutation';
export type {
  VendorMutateOptions,
  VendorMutationMethod,
  VendorMutationResult,
} from './useVendorMutation';

/* ── customer shop (Worker E) ──────────────────────────────────────────── */

export { useShopQuery, invalidateShop } from './useShopQuery';
export type { ShopQueryOptions, ShopQueryResult } from './useShopQuery';

export { useGeolocation, locationQuery } from './useGeolocation';
export type { GeoStatus, GeolocationState, ShopLocation, UseGeolocation } from './useGeolocation';

export { useSocket } from './useSocket';
export type {
  ConnectionState,
  SocketConnection,
  UseSocketOptions,
  OrderStatusChanged,
  DeliveryLocationUpdated,
} from './useSocket';
