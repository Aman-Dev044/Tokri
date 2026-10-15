/**
 * Small formatters shared across the shop.
 *
 * Money is NOT here — `formatPaise` lives in the design system and is the only
 * place paise becomes rupees (plan §5.2). Everything below is about time,
 * distance and the honest wording around both.
 */

/** "1.2 km" · "700 m" · null when the API did not compute a distance. */
export function formatDistance(km: number | null): string | null {
  if (km === null || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** "14 min" — the ETA, never a countdown. Nothing in Mandi screams a timer. */
export function formatEta(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * "just now" · "2m ago" · "3h ago" · "12 Sep".
 *
 * Used for "last seen" on a stale rider position. Deliberately coarse and
 * deliberately past-tense: a stale location must never read like a live one.
 */
export function formatAgo(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 15) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(then);
}

/** Absolute, for order history rows. */
export function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** A location older than this is shown as "last seen", never as live. */
export const STALE_LOCATION_MS = 30_000;

export function isStale(iso: string | null, now: number = Date.now()): boolean {
  if (!iso) return true;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return true;
  return now - then > STALE_LOCATION_MS;
}

/** Indian 6-digit PIN, first digit 1–9. */
export function isValidPincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value.trim());
}

/**
 * RFC 4122 v4 via the platform. Used for the `Idempotency-Key` that checkout
 * REQUIRES (plan §6.1) — the same key must survive a retry, so it is minted
 * once per checkout attempt and held, never regenerated on re-render.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Non-secure contexts have no randomUUID. This is an idempotency key, not a
  // credential, so a timestamp + random suffix is an acceptable fallback —
  // and it is NOT a secret with a hardcoded default (plan §4.1).
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The PACK SIZE — "1 kg", "500 g", "6 pc" — from the two fields the API
 * actually sends.
 *
 * `ProductRow` carries `unit` and `unitValue` as separate fields, and the
 * product page was rendering only `unit`. "kg" is not a pack size: it does not
 * say whether you are buying one kilo or five, which is the single most
 * important number next to a price on a grocery listing. This is the one place
 * the pair becomes a label, so the card, the detail page and the basket cannot
 * disagree about what a line actually is.
 *
 * `unitValue` of 0 or 1 collapses to the bare unit for the units where a
 * leading "1" reads as noise ("1 pack" → "pack"), and stays explicit for
 * weights and volumes, where "1 kg" is the real answer and "kg" is not.
 */
const BARE_UNITS = new Set(['pack', 'pc', 'piece', 'unit', 'bunch', 'dozen']);

export function formatPackSize(unit: string, unitValue: number): string {
  const label = unit.trim();
  if (label === '') return '';
  if (!Number.isFinite(unitValue) || unitValue <= 0) return label;
  if (unitValue === 1 && BARE_UNITS.has(label.toLowerCase())) return label;
  return `${unitValue} ${label}`;
}
