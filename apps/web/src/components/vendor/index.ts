/**
 * ★ THE VENDOR COMPONENT CONTRACT
 *
 * Everything the vendor panel is built from, exported from one place. Route
 * files import from `@/components/vendor` and never reach into a file under it.
 *
 * ── SELF-CONTAINED, ON PURPOSE ───────────────────────────────────────────────
 * This surface used to borrow the admin console's component layer wholesale.
 * That stopped being the right call: the two surfaces answer different
 * questions, are rebuilt on different timelines by different people, and
 * sharing a component layer means neither can be tuned for its reader
 * without risking the other. So everything below is local to the vendor
 * panel and pulls only tokens and the `<Tilt3D>`/`<Depth>` depth engine from
 * `@mandi/design-system`.
 *
 * ── HOUSE RULES THESE COMPONENTS ENCODE ─────────────────────────────────────
 *   · Money is INTEGER PAISE. Pass paise to <Money/>. Never divide by 100.
 *   · Stock is ADJUSTED by a delta, never SET to a total.
 *   · The chromatic-aisle palette appears only as ORDER-STATUS encoding
 *     (lib/vendor/orders → STATUS_AISLE) and inside <ProductPreviewCard/>,
 *     which is a quotation of the customer app. Nowhere else.
 *   · The new-order alert pulses ONCE and then holds.
 *   · Tables stay tables and never tilt; depth (lift + tilt) is reserved for
 *     the KPI tile and the order-board card.
 *   · Every animation is off under `prefers-reduced-motion: reduce`, and every
 *     screen is complete and readable at rest.
 */

/* ── shell ──────────────────────────────────────────────────────────────── */
export { VendorShell } from './VendorShell';
export { VendorAlertProvider, useVendorAlerts, ORDER_POLL_MS } from './VendorAlertProvider';
export type { VendorAlertState } from './VendorAlertProvider';

/* ── page frame ─────────────────────────────────────────────────────────── */
export { VenPage, VenSection } from './Page';
export type { VenPageProps, VenSectionProps, Crumb } from './Page';

/* ── atoms ──────────────────────────────────────────────────────────────── */
export {
  Money,
  Num,
  RelativeTime,
  Pill,
  OrderStatusPill,
  SettlementStatusPill,
  PartnerStatusPill,
  Btn,
  IconBtn,
  Stat,
  KpiCell,
  ChartPanel,
  FreshLine,
  Segmented,
  Field,
  RupeeInput,
  EmptyState,
  EndpointError,
  WriteFailure,
  SkelLine,
  SkelStat,
  SkelChart,
} from './primitives';
export type {
  MoneyProps,
  RelativeTimeProps,
  PillTone,
  PillProps,
  BtnVariant,
  BtnSize,
  BtnProps,
  StatProps,
  KpiTone,
  KpiCellProps,
  ChartPanelProps,
  FreshLineProps,
  SegmentedProps,
  SegmentedOption,
  FieldProps,
  RupeeInputProps,
  EmptyStateProps,
  EndpointErrorProps,
} from './primitives';

/* ── icons ──────────────────────────────────────────────────────────────── */
export * from './icons';

/* ── tables ─────────────────────────────────────────────────────────────── */
export { VenTable, Toolbar, ToolbarSpacer, SearchBox, SelectBox } from './table';
export type { Column, VenTableProps, SelectOption } from './table';

/* ── overlays ───────────────────────────────────────────────────────────── */
export { Drawer, ConfirmDialog } from './overlay';
export type { DrawerProps, ConfirmDialogProps } from './overlay';

/* ── charts ─────────────────────────────────────────────────────────────── */
export { BarChart, AreaChart, Sparkline, RankedBars } from './charts';
export type { BarDatum } from './charts';

/* ── cards ──────────────────────────────────────────────────────────────── */
export { OrderCard, OrderCardSkeleton } from './OrderCard';
export type { OrderCardProps } from './OrderCard';

export { ProductPreviewCard } from './ProductPreviewCard';
export type { ProductPreviewCardProps } from './ProductPreviewCard';

/* ── formatting ─────────────────────────────────────────────────────────── */
export {
  formatPaise,
  formatPaiseCompact,
  formatCompact,
  formatCount,
  formatPct,
  formatDate,
  formatRelative,
  humanise,
} from './format';
export type { DateStyle } from './format';

/* ── screens ────────────────────────────────────────────────────────────── */
export { DashboardView } from './dashboard/DashboardView';
export { OrdersView } from './orders/OrdersView';
export { OrderDetailView } from './orders/OrderDetailView';
export { ProductsView } from './products/ProductsView';
export { InventoryView } from './inventory/InventoryView';
export { PartnersView } from './partners/PartnersView';
export { EarningsView } from './earnings/EarningsView';
export { SettingsView } from './settings/SettingsView';
export { StaffView } from './staff/StaffView';
export { PosView } from './pos/PosView';
export { PosInvoiceView } from './pos/PosInvoiceView';
