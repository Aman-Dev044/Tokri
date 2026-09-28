/**
 * @mandi/design-system
 *
 * The design system exists before the first screen, or every screen drifts.
 *
 * Two stylesheets ship alongside this barrel and must both be imported once,
 * from the root layout of the consuming app:
 *
 *   import '@mandi/design-system/tokens.css';   // tokens, aisles, circadian
 *   import '@mandi/design-system/styles.css';   // primitive + loader styles
 */

/* ── tokens, as data ─────────────────────────────────────────────────────── */
export {
  AISLES,
  AISLE_KEYS,
  getAisle,
  isAisleKey,
  formatPaise,
} from './aisles';
export type { Aisle, AisleKey } from './aisles';

/* ── providers ───────────────────────────────────────────────────────────── */
export {
  AisleProvider,
  useAisle,
  CircadianProvider,
  useCircadian,
  timeOfDayFor,
  TIME_OF_DAY_LABEL,
  ThemeProvider,
  useTheme,
  THEME_INIT_SCRIPT,
} from './providers';
export type {
  AisleProviderProps,
  CircadianProviderProps,
  TimeOfDay,
  ThemeProviderProps,
  ThemeChoice,
} from './providers';

/* ── primitives ──────────────────────────────────────────────────────────── */
export {
  Button,
  Input,
  Label,
  Checkbox,
  Sheet,
  Toast,
  ToastProvider,
  useToast,
  Skeleton,
  Spinner,
} from './primitives';
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  InputProps,
  LabelProps,
  CheckboxProps,
  SheetProps,
  SheetSide,
  ToastOptions,
  ToastTone,
  SkeletonProps,
  SpinnerProps,
} from './primitives';

/* ── the signature loader ────────────────────────────────────────────────── */
/* `GroceryLoader` is the server-safe namespace object (see grocery-loader.ts
   for why it cannot be assembled inside the 'use client' file). The three
   variants are also exported individually, for client components that would
   rather import just the one they use. */
export { GroceryLoader } from './components/grocery-loader';
export {
  GroceryLoaderPage,
  GroceryLoaderInline,
  GroceryLoaderSkeleton,
} from './components/GroceryLoader';
export type {
  GroceryLoaderProps,
  InlineLoaderProps,
  SkeletonLoaderProps,
} from './components/GroceryLoader';

/* ── bento layout primitives (Bento Pop) ─────────────────────────────────── */
export { BentoGrid, BentoCard, BentoHead } from './components/Bento';
export type {
  BentoGridProps,
  BentoCardProps,
  BentoHeadProps,
  BentoSpan,
  BentoTone,
} from './components/Bento';

/* ── 3D depth engine (Neon Orchard) ──────────────────────────────────────── */
export { Tilt3D, Depth } from './components/Tilt3D';
export type { Tilt3DProps } from './components/Tilt3D';
