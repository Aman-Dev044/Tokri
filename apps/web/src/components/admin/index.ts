/**
 * ★ THE ADMIN COMPONENT CONTRACT
 *
 * Everything the admin surface is built from, exported from one place. Pages
 * import from `@/components/admin` and never reach into a file under it —
 * that is what lets a component be split, renamed or rewritten without a
 * fourteen-file diff across screens somebody else owns.
 *
 * The props of each component are a contract other work depends on. Add
 * optional props freely; never rename or remove one that is already here.
 *
 * ── HOUSE RULES THESE COMPONENTS ENCODE ─────────────────────────────────────
 *   · Money is INTEGER PAISE. Pass paise to <Money/>. Never divide by 100.
 *   · A table scrolls inside its own container. The page body never scrolls
 *     sideways.
 *   · Colour never carries meaning alone — every pill, dot and tone has a word
 *     or a title beside it.
 *   · The chromatic-aisle palette appears only in <AisleDot/> and in charts
 *     that break data down BY AISLE. Nowhere else on this surface.
 *   · Every animation is switched off under `prefers-reduced-motion: reduce`,
 *     and every screen is complete and readable at rest.
 */

/* ── layout ─────────────────────────────────────────────────────────────── */
export { AdminPage, AdminSection } from './AdminPage';
export type { AdminPageProps, AdminSectionProps, Breadcrumb } from './AdminPage';

export { AdminShell } from './AdminShell';
export { CommandPalette } from './CommandPalette';
export type { CommandPaletteProps } from './CommandPalette';

/* ── data display ───────────────────────────────────────────────────────── */
export { KpiTile } from './KpiTile';
export type { KpiTileProps, KpiTone } from './KpiTile';

export { DataTable } from './DataTable';
export type { Column, ColumnAlign, DataTableProps, SortState } from './DataTable';

export {
  Money,
  RelativeTime,
  AisleDot,
  StatusPill,
  Toolbar,
  EmptyState,
  FixtureBanner,
  AISLE_SERIES_COLOR,
} from './primitives';
export type {
  MoneyProps,
  RelativeTimeProps,
  AisleDotProps,
  StatusPillProps,
  StatusKind,
  PillTone,
  ToolbarProps,
  EmptyStateProps,
  FixtureBannerProps,
} from './primitives';

export { Sparkline } from './Sparkline';
export type { SparklineProps, SparkTone } from './Sparkline';

/* ── charts — inline SVG, no chart library ──────────────────────────────── */
export { LineChart, BarChart, DonutChart } from './charts';
export type {
  LineChartProps,
  BarChartProps,
  DonutChartProps,
  DonutDatum,
  ChartRow,
  ChartSeries,
} from './charts';

/* ── interaction ────────────────────────────────────────────────────────── */
export { FilterBar } from './FilterBar';
export type { FilterBarProps, FilterDef, FilterOption, FilterType, FilterValues } from './FilterBar';

export { DetailDrawer, ConfirmDialog } from './overlays';
export type { DetailDrawerProps, ConfirmDialogProps } from './overlays';

/* ── icons ──────────────────────────────────────────────────────────────── */
export * from './icons';
