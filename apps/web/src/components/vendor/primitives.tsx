'use client';

/**
 * The store panel's atoms — "Bento Pop", built for a shop counter.
 *
 * ── WHY THE PANEL OWNS THESE ────────────────────────────────────────────────
 * This surface used to borrow the admin console's component layer wholesale.
 * That was the right call when both were one visual system; it is the wrong one
 * now. The two surfaces answer different questions — a console is read by
 * someone sitting down, a shop panel is read by someone standing up with a
 * crate of onions — and sharing a component layer means neither can be tuned
 * for its reader without breaking the other.
 *
 * So the vendor panel is self-contained: it imports tokens and the bento
 * primitives from `@mandi/design-system` and nothing else from another surface.
 *
 * ── THE RULES THESE ATOMS ENFORCE ───────────────────────────────────────────
 *   · Money is INTEGER PAISE. `<Money/>` is the only thing that divides by 100.
 *   · Every figure is in the mono face with `tabular-nums`, so a column of
 *     numbers can be scanned down rather than read across.
 *   · Colour never carries meaning alone. Every pill has a WORD; every aisle
 *     hue has the status spelled out beside it.
 *   · Nothing renders at `opacity: 0` waiting for an observer. Entrances are
 *     CSS animations with `backwards` fill from a visible resting state.
 */

import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { BentoCard, type BentoTone } from '@mandi/design-system';
import { useCountUp, type Freshness } from '@/hooks';
import type { OrderStatus, PartnerStatus, SettlementStatus } from '@/lib/vendor/types';
import { STATUS_AISLE } from '@/lib/vendor/orders';
import { Sparkline } from './charts';
import { formatDate, formatPaise, formatRelative, humanise } from './format';
import { IconInbox, IconRefresh } from './icons';

/* ================================================================== */
/* Money and numbers                                                   */
/* ================================================================== */

export interface MoneyProps {
  /** INTEGER PAISE. Never rupees, never a float. */
  value: number;
  /** dim a zero so an empty column reads as empty at a glance */
  dimZero?: boolean;
  className?: string;
}

/**
 * `<Money value={18425000} />` -> `₹1,84,250.00`.
 *
 * The one component in this panel that knows there are 100 paise in a rupee.
 * A screen that divides before it gets here is a screen that will eventually be
 * out by a factor of one hundred — which is the entire reason money is stored
 * as an integer.
 */
export function Money({ value, dimZero = true, className }: MoneyProps) {
  return (
    <span
      className={['ven-money', className].filter(Boolean).join(' ')}
      data-zero={dimZero && value === 0 ? 'true' : undefined}
      data-negative={value < 0 ? 'true' : undefined}
    >
      {formatPaise(value)}
    </span>
  );
}

/** Any bare figure. Mono, tabular — the house rule for every number here. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={['ven-num', className].filter(Boolean).join(' ')}>{children}</span>;
}

/* ================================================================== */
/* RelativeTime                                                        */
/* ================================================================== */

export interface RelativeTimeProps {
  /** ISO 8601 */
  value: string;
  /** stop ticking — forty live timers in a table buy nothing */
  live?: boolean;
  className?: string;
}

/**
 * "2 hours ago", with the absolute timestamp in the `title`.
 *
 * The first render — server AND client — is the pinned absolute string, which
 * is deterministic. The relative form swaps in inside an effect, after
 * hydration has already matched. Rendering "N minutes ago" directly is the
 * textbook hydration mismatch, on every row of every table.
 */
export function RelativeTime({ value, live = true, className }: RelativeTimeProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [live]);

  return (
    <time
      className={['ven-time', className].filter(Boolean).join(' ')}
      dateTime={value}
      title={formatDate(value, 'full')}
    >
      {now === null ? formatDate(value, 'short') : formatRelative(value, now)}
    </time>
  );
}

/* ================================================================== */
/* Pills                                                               */
/* ================================================================== */

export type PillTone = 'neutral' | 'good' | 'warn' | 'crit' | 'info';

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  title?: string;
  className?: string;
}

/** A word in a tinted capsule. The glyph is a shape cue, not the message. */
export function Pill({ children, tone = 'neutral', title, className }: PillProps) {
  return (
    <span
      className={['ven-pill', className].filter(Boolean).join(' ')}
      data-tone={tone}
      title={title}
    >
      <span className="ven-pill__glyph" aria-hidden="true" />
      {children}
    </span>
  );
}

const SETTLEMENT_TONE: Record<SettlementStatus, PillTone> = {
  pending: 'warn',
  processing: 'info',
  paid: 'good',
  failed: 'crit',
};

const PARTNER_TONE: Record<PartnerStatus, PillTone> = {
  active: 'good',
  pending: 'warn',
  suspended: 'crit',
};

/**
 * ★ An order's status — the panel's ONE use of the chromatic-aisle palette.
 *
 * The hue comes from `STATUS_AISLE`, and the status WORD is always printed
 * beside it. A shop owner reads the board's shape from across the counter by
 * colour and confirms it by word; neither alone is the message.
 */
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className="ven-status" data-aisle={STATUS_AISLE[status]}>
      <span className="ven-status__dot" aria-hidden="true" />
      {humanise(status)}
    </span>
  );
}

export function SettlementStatusPill({ status }: { status: SettlementStatus }) {
  return <Pill tone={SETTLEMENT_TONE[status]}>{humanise(status)}</Pill>;
}

export function PartnerStatusPill({
  status,
  reason,
}: {
  status: PartnerStatus;
  reason?: string | null;
}) {
  return (
    <Pill tone={PARTNER_TONE[status]} title={reason ?? undefined}>
      {humanise(status)}
    </Pill>
  );
}

/* ================================================================== */
/* Buttons                                                             */
/* ================================================================== */

export type BtnVariant = 'primary' | 'plain' | 'ghost' | 'danger';
export type BtnSize = 'sm' | 'md' | 'lg';

export interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'menu' | 'dialog' | true;
}

/**
 * The panel's button. Squash-stretch on press — the signature Bento Pop
 * feedback — lives in CSS, inside a reduced-motion guard, where it becomes an
 * instant background change rather than nothing at all. A control that appears
 * to do nothing is worse than one that moves too much.
 */
export function Btn({
  children,
  onClick,
  variant = 'plain',
  size = 'md',
  disabled = false,
  title,
  type = 'button',
  className,
  ...aria
}: BtnProps) {
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      className={['ven-btn', className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={aria['aria-pressed']}
      aria-expanded={aria['aria-expanded']}
      aria-haspopup={aria['aria-haspopup']}
    >
      {children}
    </button>
  );
}

/** A square icon-only control. Always carries a screen-reader label. */
export function IconBtn({
  children,
  label,
  onClick,
  title,
  pressed,
  className,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  title?: string;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={['ven-iconbtn', className].filter(Boolean).join(' ')}
      onClick={onClick}
      title={title ?? label}
      aria-pressed={pressed}
      data-on={pressed ? 'true' : undefined}
    >
      {children}
      <span className="ven-sr">{label}</span>
    </button>
  );
}

/* ================================================================== */
/* Stat — the big figure on a bento cell                               */
/* ================================================================== */

export interface StatProps {
  /** the raw number; for money this is INTEGER PAISE */
  value: number;
  /** how the number becomes the string on screen */
  format: (value: number) => string;
  /** stagger position, so a row of tiles arrives as a wave and not a slam */
  index?: number;
  className?: string;
}

/**
 * ★ The KPI count-up, done without the page ever being wrong.
 *
 * React renders the FINAL value — correct in the HTML, correct on first paint,
 * correct with JavaScript off. `useCountUp` then takes the node and rewrites
 * its text during the ramp, landing exactly back on the string React put there.
 * The animation decorates a correct page; it is never what makes it correct.
 */
export function Stat({ value, format, index = 0, className }: StatProps) {
  const ref = useCountUp(value, { format, delayMs: index * 45 });
  return (
    <span ref={ref} className={['ven-stat', className].filter(Boolean).join(' ')}>
      {format(value)}
    </span>
  );
}

/* ================================================================== */
/* KpiCell — the bento tile the dashboard and earnings are built from  */
/* ================================================================== */

export type KpiTone = 'plain' | 'good' | 'warn' | 'crit';

export interface KpiCellProps {
  label: string;
  /** the raw number — for money this is INTEGER PAISE */
  value: number;
  format: (value: number) => string;
  tone?: KpiTone;
  /** a trailing footnote — what the number means, or how it compares */
  note?: ReactNode;
  /** 7-point trend, drawn under the figure when there are at least two points */
  spark?: readonly number[];
  /** stagger position in the grid */
  index?: number;
  loading?: boolean;
}

const KPI_TONE: Record<KpiTone, BentoTone> = {
  plain: 'plain',
  good: 'good',
  warn: 'warn',
  crit: 'crit',
};

/**
 * ★ THE KPI TILE — the one shape the dashboard and earnings are built from.
 *
 * A `<BentoCard>` holding a label, the count-up figure, and optionally a
 * seven-point sparkline and a footnote. Nothing here is bespoke: the card's
 * entrance, hover and tone wash all come from the shared Bento primitive, so
 * this tile looks like the same product as every other bento surface.
 */
export function KpiCell({
  label,
  value,
  format,
  tone = 'plain',
  note,
  spark,
  index = 0,
  loading = false,
}: KpiCellProps) {
  return (
    <BentoCard span="quarter" tone={KPI_TONE[tone]} index={index}>
      <div className="ven-kpi">
        <span className="mnd-label">{label}</span>
        {loading ? (
          <SkelLine width="60%" height={30} />
        ) : (
          <Stat value={value} format={format} index={index} className="ven-kpi__value" />
        )}
        {!loading && spark && spark.length > 1 ? <Sparkline values={spark} /> : null}
        {note ? <span className="ven-kpi__note">{note}</span> : null}
      </div>
    </BentoCard>
  );
}

/* ================================================================== */
/* FreshLine                                                           */
/* ================================================================== */

export interface FreshLineProps {
  freshness: Freshness;
  /** the poll interval, so the line can say how often it should update */
  everyMs: number;
  onRefresh?: () => void;
}

/**
 * ★ "Updated 4s ago" — and whether that is still true.
 *
 * A board that silently stops polling looks exactly like a quiet evening. The
 * vendor keeps reading a frozen screen and concludes they have nothing to do.
 * That is the worst failure an operations surface has, and it is invisible
 * unless the page says out loud how old what you are looking at is.
 *
 * STALE is a WORD, not just a colour, and a paused tab gets its own sentence —
 * a backgrounded tab is deliberate, not broken, and the two deserve different
 * copy.
 */
export function FreshLine({ freshness, everyMs, onRefresh }: FreshLineProps) {
  const { secondsAgo, stale, visible } = freshness;
  const state = !visible ? 'paused' : stale ? 'stale' : 'live';

  const text =
    secondsAgo === null
      ? 'waiting for first data'
      : state === 'paused'
        ? `paused · last update ${secondsAgo}s ago`
        : state === 'stale'
          ? `STALE — no update for ${secondsAgo}s`
          : `updated ${secondsAgo}s ago`;

  return (
    <span className="ven-fresh" data-state={state} role="status">
      <span className="ven-fresh__dot" aria-hidden="true" />
      <span className="ven-fresh__text">{text}</span>
      <span className="ven-sr">. Refreshes every {Math.round(everyMs / 1000)} seconds.</span>
      {onRefresh ? (
        <button type="button" className="ven-fresh__btn" onClick={onRefresh}>
          <IconRefresh />
          <span className="ven-sr">Refresh now</span>
        </button>
      ) : null}
    </span>
  );
}

/* ================================================================== */
/* Segmented switch                                                    */
/* ================================================================== */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
}

/** Today / 7 days / 30 days. The selected pill slides rather than blinks. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="ven-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ven-seg__btn"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Form field                                                          */
/* ================================================================== */

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** rendered instead of an input when the control is something custom */
  children: (id: string) => ReactNode;
}

/**
 * Label, control, hint, error — wired together with one generated id.
 *
 * Generated rather than passed: a duplicated `htmlFor` across two drawers is
 * invisible on screen and completely breaks a screen reader, and hand-written
 * ids duplicate the moment a form is copied.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId().replace(/:/g, '');
  return (
    <div className="ven-field">
      <label className="ven-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? <span className="ven-field__hint">{hint}</span> : null}
      {error ? (
        <span className="ven-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Rupee input                                                         */
/* ================================================================== */

export interface RupeeInputProps {
  id: string;
  /** INTEGER PAISE */
  value: number;
  onChange: (paise: number) => void;
  disabled?: boolean;
}

/**
 * ★ The one place a human types rupees and an integer comes out.
 *
 * Nobody types `14950` for ₹149.50, so this converts — with `Math.round`, not a
 * bare multiply: `149.5 * 100` is `14949.999999999998` in IEEE 754, and
 * truncating that is how an order ends up a paisa short.
 */
export function RupeeInput({ id, value, onChange, disabled }: RupeeInputProps) {
  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(event.target.value);
    onChange(Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
  };

  return (
    <span className="ven-rupee">
      <span className="ven-rupee__sign" aria-hidden="true">
        ₹
      </span>
      <input
        id={id}
        className="ven-input ven-input--num"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={(value / 100).toFixed(2)}
        onChange={handle}
        disabled={disabled}
      />
    </span>
  );
}

/* ================================================================== */
/* Empty state                                                         */
/* ================================================================== */

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  /** ★ a real next action, not decoration — see the note below */
  action?: ReactNode;
  icon?: ReactNode;
  /** compact form, for inside a lane or a small cell */
  tight?: boolean;
}

/**
 * ★ The empty state is a screen, not an absence.
 *
 * A brand-new shop has no products, no orders, no riders and no earnings — so
 * for its first week this is the ONLY thing the owner sees. An empty state that
 * says "no data" and stops has taught them nothing and given them nowhere to
 * go. Every one in this panel therefore carries a next action, and the copy
 * says what will fill the space rather than reporting that it is currently
 * unfilled.
 */
export function EmptyState({ title, body, action, icon, tight = false }: EmptyStateProps) {
  return (
    <div className="ven-empty" data-tight={tight ? 'true' : undefined}>
      <span className="ven-empty__icon" aria-hidden="true">
        {icon ?? <IconInbox />}
      </span>
      <p className="ven-empty__title">{title}</p>
      {body ? <p className="ven-empty__body">{body}</p> : null}
      {action ? <div className="ven-empty__act">{action}</div> : null}
    </div>
  );
}

/* ================================================================== */
/* Error / not-built-yet panel                                         */
/* ================================================================== */

export interface EndpointErrorProps {
  path: string;
  message: string;
  /** the HTTP status, when there was one — 0 means nothing reached the server */
  status?: number;
  onRetry?: () => void;
}

/**
 * Shown whenever a query failed and no sample data was substituted — which
 * means every failure that reached the server at all.
 *
 * The path AND the status are on screen deliberately. "Something went wrong"
 * sends a vendor to support; `GET /vendor/earnings — 400` sends a developer
 * straight to the DTO that rejected the query, which is the difference between
 * a bug fixed this afternoon and one that lives for a week.
 */
export function EndpointError({ path, message, status, onRetry }: EndpointErrorProps) {
  return (
    <div className="ven-fail" role="alert">
      <p className="ven-fail__title">This screen could not load</p>
      <p className="ven-fail__body">{message}</p>
      <code className="ven-fail__path">
        {path}
        {status !== undefined && status > 0 ? ` — ${status}` : ''}
      </code>
      {onRetry ? (
        <div className="ven-fail__act">
          <Btn variant="primary" size="sm" onClick={onRetry}>
            Try again
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

/** The inline "that write did not go through" banner. */
export function WriteFailure({ message }: { message: string }) {
  return (
    <div className="ven-writefail" role="alert">
      <strong>That did not go through.</strong> {message}
    </div>
  );
}

/* ================================================================== */
/* Skeletons — shaped like the real thing                              */
/* ================================================================== */

/**
 * A skeleton is a promise about what is coming. A grey rectangle where a card
 * will be is a broken one: the layout jumps the moment real content lands. So
 * every skeleton here has the proportions of the thing it stands in for.
 */
export function SkelLine({ width = '100%', height = 12 }: { width?: string; height?: number }) {
  return <span className="ven-skel" style={{ width, height }} aria-hidden="true" />;
}

export function SkelStat({ index = 0 }: { index?: number }) {
  return (
    <div className="ven-skelstat" style={{ ['--i' as string]: index }} aria-hidden="true">
      <SkelLine width="52%" height={10} />
      <SkelLine width="74%" height={30} />
      <SkelLine width="40%" height={10} />
    </div>
  );
}

export function SkelChart() {
  return (
    <div className="ven-skelchart" aria-hidden="true">
      {[38, 62, 45, 80, 55, 72, 48].map((height, index) => (
        <span key={index} className="ven-skel" style={{ height: `${height}%`, width: '100%' }} />
      ))}
    </div>
  );
}
