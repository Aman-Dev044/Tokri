/**
 * Formatting for the store panel.
 *
 * The vendor surface owns its own formatters rather than borrowing the admin
 * console's. Two reasons, and neither is duplication for its own sake:
 *
 *   1. This panel is styled in "Neon Orchard" while the console is rebuilt on
 *      its own track. A shared module is a shared blast radius, and a shop
 *      owner should not see a rupee change shape because somebody was
 *      editing a different surface.
 *   2. Every figure in this panel is mono and tabular by rule, so the string a
 *      formatter emits is part of a typographic contract that belongs here.
 *
 * ── LOCALE AND TIME ZONE ARE PINNED ─────────────────────────────────────────
 * `en-IN` and `Asia/Kolkata`, hard-coded. They are the currency and the
 * operating time zone of the business, not a user preference. Pinning them also
 * makes every function here deterministic — which is what keeps a client
 * component's server-rendered HTML identical to its first client render.
 *
 * ── PAISE ───────────────────────────────────────────────────────────────────
 * `formatPaise` is the ONLY division by 100 in the panel. Callers pass integer
 * paise, always.
 */

const LOCALE = 'en-IN';
const TZ = 'Asia/Kolkata';

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

const rupee = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `18425000` -> `₹1,84,250.00`. Two decimals, always. */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return '—';
  return rupee.format(paise / 100);
}

/** Paise -> a compact rupee string for an axis tick: `18425000` -> `₹1.8L`. */
export function formatPaiseCompact(paise: number): string {
  if (!Number.isFinite(paise)) return '—';
  return `₹${formatCompact(paise / 100)}`;
}

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

const compact = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const plain = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/**
 * `1240` -> `1.2K`, `184250` -> `1.8L`, `24500000` -> `2.5Cr`.
 *
 * Indian grouping: the people running this shop think in lakh and crore, not
 * in millions. Anything under a thousand is left alone — `847` is both shorter
 * and clearer than `0.8K`.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return plain.format(value);
  return compact.format(value);
}

/** Full grouping, no decimals: `184250` -> `1,84,250`. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return plain.format(value);
}

/** `12.4` -> `12.4%`. `signed` gives `+12.4%` / `−3.1%` with a real minus sign. */
export function formatPct(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (!signed) return `${rounded.toFixed(1)}%`;
  const body = `${Math.abs(rounded).toFixed(1)}%`;
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `−${body}`;
  return `±${body}`;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export type DateStyle = 'short' | 'long' | 'day' | 'time' | 'full';

const dateFormatters: Record<DateStyle, Intl.DateTimeFormat> = {
  /** 24 Sep, 18:40 */
  short: new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  }),
  /** 24 Sep 2026, 18:40 */
  long: new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  }),
  /** 24 Sep */
  day: new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', timeZone: TZ }),
  /** 18:40 */
  time: new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  }),
  /** Thu, 24 Sep 2026, 18:40:12 IST */
  full: new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TZ,
    timeZoneName: 'short',
  }),
};

/** ISO string (or Date) -> a pinned en-IN / IST string. */
export function formatDate(
  value: string | Date | null | undefined,
  style: DateStyle = 'short',
): string {
  // Nullish is handled before `new Date()`: a field the API did not send
  // arrives as `undefined`, and `undefined.getTime()` takes the whole page
  // down to an error boundary. A missing date is an em dash, like a bad one.
  if (value === null || value === undefined) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatters[style].format(date);
}

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/**
 * "2 hours ago".
 *
 * `now` is injected rather than read from the clock, so the caller decides when
 * this is allowed to be non-deterministic — `<RelativeTime/>` withholds it
 * until after mount for exactly that reason.
 */
export function formatRelative(
  value: string | Date | null | undefined,
  now: number,
): string {
  if (value === null || value === undefined) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const deltaSeconds = Math.round((date.getTime() - now) / 1000);
  if (Math.abs(deltaSeconds) < 45) return deltaSeconds >= 0 ? 'in a moment' : 'just now';

  const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  let amount = deltaSeconds;
  for (const [unit, step] of units) {
    if (Math.abs(amount) < step) return relative.format(Math.round(amount), unit);
    amount /= step;
  }
  return relative.format(Math.round(amount), 'year');
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** `READY_FOR_PICKUP` -> `Ready for pickup`. */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
