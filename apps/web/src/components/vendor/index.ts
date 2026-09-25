/**
 * ★ THE VENDOR COMPONENT CONTRACT
 *
 * Everything the vendor panel is built from, exported from one place. Route
 * files import from `@/components/vendor` and never reach into a file under it.
 *
 * ── WHAT IS NOT HERE, ON PURPOSE ────────────────────────────────────────────
 * There is no vendor DataTable, no vendor StatusPill, no vendor Money. Those
 * live in `@/components/admin` and are imported from there unchanged. Two
 * implementations of "render a rupee" is how two surfaces end up disagreeing
 * about what a rupee looks like, and the rupee is the thing a shop owner is
 * most likely to notice.
 *
 * ── HOUSE RULES THESE COMPONENTS ENCODE ─────────────────────────────────────
 *   · Money is INTEGER PAISE. Pass paise to <Money/>. Never divide by 100.
 *   · Stock is ADJUSTED by a delta, never SET to a total.
 *   · The chromatic-aisle palette appears only as ORDER-STATUS encoding
 *     (lib/vendor/orders → STATUS_AISLE) and inside <ProductPreviewCard/>,
 *     which is a quotation of the customer app. Nowhere else.
 *   · The new-order alert pulses ONCE and then holds.
 *   · Every animation is off under `prefers-reduced-motion: reduce`, and every
 *     screen is complete and readable at rest.
 */

/* ── shell ──────────────────────────────────────────────────────────────── */
export { VendorShell } from './VendorShell';
export { VendorAlertProvider, useVendorAlerts, ORDER_POLL_MS } from './VendorAlertProvider';
export type { VendorAlertState } from './VendorAlertProvider';

/* ── vendor-only atoms ──────────────────────────────────────────────────── */
export { FreshLine, Segmented, Field, RupeeInput, EndpointError } from './primitives';
export type {
  FreshLineProps,
  SegmentedProps,
  SegmentedOption,
  FieldProps,
  RupeeInputProps,
  EndpointErrorProps,
} from './primitives';

export { OrderCard, OrderCardSkeleton } from './OrderCard';
export type { OrderCardProps } from './OrderCard';

export { ProductPreviewCard } from './ProductPreviewCard';
export type { ProductPreviewCardProps } from './ProductPreviewCard';

/* ── screens ────────────────────────────────────────────────────────────── */
export { DashboardView } from './dashboard/DashboardView';
export { OrdersView } from './orders/OrdersView';
export { OrderDetailView } from './orders/OrderDetailView';
export { ProductsView } from './products/ProductsView';
export { InventoryView } from './inventory/InventoryView';
export { PartnersView } from './partners/PartnersView';
export { EarningsView } from './earnings/EarningsView';
export { SettingsView } from './settings/SettingsView';
