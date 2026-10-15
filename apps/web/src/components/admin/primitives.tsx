'use client';

/**
 * The small data atoms. Each one exists because the same decision was about to
 * be made in fifteen different places, and it has to come out the same way
 * every time — a rupee that renders differently on two screens is a bug report.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { AisleKey } from '@mandi/design-system';
import { formatDate, formatPaise, formatRelative, humanise } from '@/lib/admin/format';
import { IconAlert } from './icons';

/* ================================================================== */
/* Money                                                               */
/* ================================================================== */

export interface MoneyProps {
  /** INTEGER PAISE. Never rupees, never a float. */
  value: number;
  /** dim a zero, so an empty column reads as empty at a glance */
  dimZero?: boolean;
  className?: string;
}

/**
 * `<Money value={18425000} />` -> `₹1,84,250.00`, mono, tabular.
 *
 * This is the only component in the admin surface that knows there are 100
 * paise in a rupee. A page that divides by 100 before passing a value here is
 * a page that will eventually be off by a factor of 100 on one screen — and
 * the whole reason money is stored as an integer (plan §5.2) is to make that
 * class of bug impossible.
 */
export function Money({ value, dimZero = true, className }: MoneyProps) {
  const negative = value < 0;
  return (
    <span
      className={['adm-money adm-num', className].filter(Boolean).join(' ')}
      data-zero={dimZero && value === 0 ? 'true' : undefined}
      data-negative={negative ? 'true' : undefined}
    >
      {formatPaise(value)}
    </span>
  );
}

/* ================================================================== */
/* RelativeTime                                                        */
/* ================================================================== */

export interface RelativeTimeProps {
  /** ISO 8601 string */
  value: string;
  /** stop ticking — for a long table where 40 live timers buy nothing */
  live?: boolean;
  className?: string;
}

/**
 * `"2 hours ago"`, with the absolute timestamp in the `title`.
 *
 * ── THE HYDRATION TRAP ──────────────────────────────────────────────────────
 * "N minutes ago" is computed from `Date.now()`, and the server's now is not
 * the browser's now. Rendering it directly is the textbook hydration mismatch:
 * React re-renders the subtree and logs an error, on every row of every table.
 *
 * So the first render — server AND client — is the pinned absolute string from
 * `formatDate`, which is deterministic. The relative form swaps in inside an
 * effect, after hydration has already matched. The user sees the right thing
 * either way; the only difference is one frame.
 */
export function RelativeTime({ value, live = true, className }: RelativeTimeProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    // A minute is the finest granularity this component ever shows, so a
    // 30s tick is as often as it can usefully change.
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [live]);

  const absolute = formatDate(value, 'full');

  return (
    <time className={['adm-time', className].filter(Boolean).join(' ')} dateTime={value} title={absolute}>
      {now === null ? formatDate(value, 'short') : formatRelative(value, now)}
    </time>
  );
}

/* ================================================================== */
/* AisleDot                                                            */
/* ================================================================== */

const AISLE_NAMES: Record<AisleKey, string> = {
  fruits: 'Fruits',
  vegetables: 'Vegetables',
  dairy: 'Dairy & Eggs',
  bakery: 'Bakery',
  beverages: 'Beverages',
  snacks: 'Snacks',
  staples: 'Staples & Grains',
  frozen: 'Frozen',
  electronics: 'Electronics',
};

interface AisleDotBase {
  /** print the aisle name beside the swatch */
  withLabel?: boolean;
  className?: string;
}

/**
 * `aisleKey` is the contract spelling. `aisle` is accepted as an alias because
 * several call sites landed on it while this component was being written in
 * parallel; the union keeps exactly one of the two required, so neither
 * spelling can be given without a value and both cannot be given at once.
 * Prefer `aisleKey` in new code.
 */
export type AisleDotProps = AisleDotBase &
  ({ aisleKey: AisleKey; aisle?: never } | { aisle: AisleKey; aisleKey?: never });

/**
 * A swatch in the aisle's own hue.
 *
 * This and the by-aisle charts are the ONLY places the chromatic-aisle palette
 * appears in the admin console (plan §2.4). Here the hue IS the data: it says
 * which aisle a row belongs to, and it matches the colour of that aisle's bar
 * in the sales chart two panels up. It is never an accent.
 *
 * The name always travels with it — as a `title`, or as visible text — because
 * eight hues at 8px is not something anyone can decode, and colour must never
 * carry meaning alone (plan §2.6).
 */
export function AisleDot(props: AisleDotProps) {
  const { withLabel = false, className } = props;
  const aisleKey: AisleKey = 'aisleKey' in props && props.aisleKey ? props.aisleKey : props.aisle;
  const name = AISLE_NAMES[aisleKey];
  if (!withLabel) {
    return (
      <span
        className={['adm-dot', className].filter(Boolean).join(' ')}
        data-aisle={aisleKey}
        title={name}
        role="img"
        aria-label={name}
      />
    );
  }
  return (
    <span className="adm-row" style={{ gap: 6 }}>
      <span className="adm-dot" data-aisle={aisleKey} aria-hidden="true" />
      <span className={className}>{name}</span>
    </span>
  );
}

/** The literal hues, for chart series. Keep in step with admin.css. */
export const AISLE_SERIES_COLOR: Record<AisleKey, string> = {
  fruits: 'var(--adm-aisle-fruits)',
  vegetables: 'var(--adm-aisle-vegetables)',
  dairy: 'var(--adm-aisle-dairy)',
  bakery: 'var(--adm-aisle-bakery)',
  beverages: 'var(--adm-aisle-beverages)',
  snacks: 'var(--adm-aisle-snacks)',
  staples: 'var(--adm-aisle-staples)',
  frozen: 'var(--adm-aisle-frozen)',
  electronics: 'var(--adm-aisle-electronics)',
};

/* ================================================================== */
/* StatusPill                                                          */
/* ================================================================== */

export type PillTone = 'good' | 'warn' | 'crit' | 'neutral' | 'info';
export type StatusKind = 'order' | 'vendor' | 'user' | 'payment' | 'settlement';

/**
 * Status -> semantic tone, per domain.
 *
 * The same word means different things in different places: a `pending`
 * settlement is normal (the cycle has not run), a `pending` vendor is a queue
 * someone has to clear. So the map is keyed by kind, and an unknown status
 * falls back to neutral rather than guessing.
 */
const TONES: Record<StatusKind, Record<string, PillTone>> = {
  order: {
    PLACED: 'info',
    ACCEPTED: 'info',
    PACKING: 'info',
    READY_FOR_PICKUP: 'info',
    ASSIGNED: 'info',
    PICKED_UP: 'info',
    OUT_FOR_DELIVERY: 'warn',
    DELIVERED: 'good',
    DELIVERY_FAILED: 'crit',
    REJECTED: 'crit',
    CANCELLED: 'neutral',
  },
  vendor: {
    approved: 'good',
    pending: 'warn',
    suspended: 'crit',
  },
  user: {
    active: 'good',
    pending: 'warn',
    suspended: 'crit',
  },
  payment: {
    paid: 'good',
    authorized: 'info',
    pending: 'warn',
    failed: 'crit',
    refunded: 'neutral',
    partially_refunded: 'warn',
  },
  settlement: {
    paid: 'good',
    processing: 'info',
    pending: 'neutral',
    failed: 'crit',
  },
};

export interface StatusPillProps {
  status: string;
  kind?: StatusKind;
  className?: string;
}

/** `<StatusPill status="OUT_FOR_DELIVERY" kind="order" />` */
export function StatusPill({ status, kind = 'order', className }: StatusPillProps) {
  const tone: PillTone = TONES[kind][status] ?? 'neutral';
  return (
    <span
      className={['adm-pill', className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-status={status}
    >
      <span className="adm-pill__glyph" aria-hidden="true" />
      {humanise(status)}
    </span>
  );
}

/* ================================================================== */
/* Toolbar                                                             */
/* ================================================================== */

export interface ToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * A row of controls above a table. `<Toolbar.Spacer/>` pushes what follows to
 * the right, which is the only layout decision a toolbar ever needs to make.
 */
export function Toolbar({ children, className }: ToolbarProps) {
  return <div className={['adm-toolbar', className].filter(Boolean).join(' ')}>{children}</div>;
}

function ToolbarSpacer() {
  return <span className="adm-toolbar__spacer" />;
}

Toolbar.Spacer = ToolbarSpacer;

/* ================================================================== */
/* EmptyState                                                          */
/* ================================================================== */

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * Nothing here — and why, and what to do about it.
 *
 * An empty table with no explanation is indistinguishable from a broken one.
 * The body should say which of the two it is.
 */
export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div className={['adm-empty', className].filter(Boolean).join(' ')}>
      <span className="adm-empty__icon">{icon ?? <IconAlert />}</span>
      <p className="adm-empty__title">{title}</p>
      {body ? <p className="adm-empty__body">{body}</p> : null}
      {action ? <div style={{ marginTop: 'var(--s-2)' }}>{action}</div> : null}
    </div>
  );
}

/* ================================================================== */
/* FixtureBanner                                                       */
/* ================================================================== */

export interface FixtureBannerProps {
  /** which endpoints fell back, so the reader knows exactly what is fake */
  paths?: readonly string[];
}

/**
 * ★ The honesty banner.
 *
 * Rendered whenever ANY query on the page fell back to `lib/admin/fixtures`.
 * It is the thing that makes shipping a fixture fallback defensible: nothing on
 * this screen can be mistaken for a real number while this is on it.
 *
 * Do not make it dismissible, do not shrink it to an icon, and do not render
 * the page without it when `isFixture` is true.
 */
export function FixtureBanner({ paths }: FixtureBannerProps) {
  return (
    <div className="adm-fixture" role="status">
      <IconAlert />
      <div>
        <p className="adm-fixture__title">Sample data — the API is not reachable</p>
        <p className="adm-fixture__body">
          Every number on this screen is generated from a local fixture so the layout can be
          reviewed before the endpoints land. None of it is real.
          {paths?.length ? ` Affected: ${paths.join(', ')}.` : null}
        </p>
      </div>
    </div>
  );
}
