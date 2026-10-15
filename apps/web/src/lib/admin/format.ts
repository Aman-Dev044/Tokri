/**
 * Formatting for the admin console.
 *
 * Every number the console shows passes through one of these four functions, so
 * a rupee is a rupee everywhere and a percentage never picks up a stray decimal
 * on one screen and not another.
 *
 * ── LOCALE AND TIME ZONE ARE PINNED ─────────────────────────────────────────
 * `en-IN` and `Asia/Kolkata` are hard-coded on purpose. These are not user
 * preferences; they are the currency and the operating time zone of the
 * business. Pinning them also makes every one of these functions deterministic,
 * which is what keeps a client component's server-rendered HTML and its first
 * client render identical — an unpinned `toLocaleString()` is the classic
 * source of a hydration mismatch that only shows up on someone else's laptop.
 */

const LOCALE = 'en-IN';
const TZ = 'Asia/Kolkata';

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

const rupeeFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * INTEGER PAISE in, a rupee string out: `18425000` -> `₹1,84,250.00`.
 *
 * Two decimal places, always. A settlement table where some rows show paise and
 * some do not is unreadable, and the missing digits are exactly where the
 * off-by-a-few-paise bugs hide.
 *
 * This is the ONLY division by 100 in the admin surface. Pages pass paise.
 */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return '—';
  return rupeeFormatter.format(paise / 100);
}

/** Paise -> a compact rupee string for axis ticks: `18425000` -> `₹1.8L`. */
export function formatPaiseCompact(paise: number): string {
  if (!Number.isFinite(paise)) return '—';
  return `₹${formatCompact(paise / 100)}`;
}

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

const compactFormatter = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const plainFormatter = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
});

/**
 * `1240` -> `1.2K`, `184250` -> `1.8L`, `24500000` -> `2.5Cr`.
 *
 * Indian grouping, so large numbers read in lakh and crore rather than in
 * millions — the people operating this console do not think in millions.
 * Anything under 1000 is left alone: `847` is shorter than `0.8K` and clearer.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return plainFormatter.format(value);
  return compactFormatter.format(value);
}

/** Full grouping, no decimals: `184250` -> `1,84,250`. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return plainFormatter.format(value);
}

/* ------------------------------------------------------------------ */
/* Percentages                                                         */
/* ------------------------------------------------------------------ */

/**
 * A percentage that is already a percentage: `12.4` -> `12.4%`.
 *
 * Pass `signed` for a delta, where the `+` carries as much meaning as the
 * number: `+12.4%` / `−3.1%`. The minus is U+2212 MINUS SIGN, not a hyphen, so
 * it aligns with the digits in the mono face instead of sitting half a pixel
 * high and slightly too short.
 */
export function formatPct(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  const body = `${Math.abs(rounded).toFixed(1)}%`;
  if (!signed) return `${rounded.toFixed(1)}%`;
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
  day: new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    timeZone: TZ,
  }),
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
  // Nullish is handled before `new Date()`, not after. This used to take
  // only `string | Date`, so a field the API turned out not to send arrived
  // as `undefined`, reached `date.getTime()` and threw — taking the whole
  // admin overview down to an error boundary. A formatter has no business
  // being the thing that crashes a page: a missing date renders as the same
  // em dash an unparseable one does.
  if (value === null || value === undefined) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const formatter = dateFormatters[style];
  return formatter.format(date);
}

/**
 * "2 hours ago". `now` is injected rather than read from the clock so the
 * caller controls when it is allowed to be non-deterministic — <RelativeTime/>
 * passes `null` until after mount for exactly that reason.
 */
export function formatRelative(value: string | Date, now: number): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const deltaSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(deltaSeconds);

  if (abs < 45) return deltaSeconds >= 0 ? 'in a moment' : 'just now';

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
    if (Math.abs(amount) < step) {
      return relativeFormatter.format(Math.round(amount), unit);
    }
    amount /= step;
  }
  return relativeFormatter.format(Math.round(amount), 'year');
}

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** `READY_FOR_PICKUP` -> `Ready for pickup`. */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
