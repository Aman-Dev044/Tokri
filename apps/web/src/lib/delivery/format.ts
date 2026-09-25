/**
 * Formatting for a screen read at arm's length, in sunlight, at 40km/h.
 *
 * Every number the rider acts on is mono + `tabular-nums` (plan §2.4). The
 * helpers here return STRINGS ONLY — no JSX, so they are usable from a server
 * component, a fixture and a test alike.
 */

import { formatPaise } from '@mandi/design-system';

/** "₹82" / "₹1,240.50". Takes integer paise. */
export function money(paise: number): string {
  return formatPaise(paise);
}

/**
 * Rupees with no symbol, for the huge COD readout where the ₹ is set
 * separately and at a different size.
 */
export function rupeesOnly(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** "800 m" under a kilometre, "2.4 km" above it. Never "0.8 km". */
export function distance(meters: number | undefined): string {
  if (meters === undefined || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * The big mono ETA. Minutes only under an hour — a rider does not need
 * "1h 04m" to decide anything, and two units at that size do not fit 360px.
 */
export function etaMinutes(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return '--';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return String(m);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
}

/** "M:SS" for the offer countdown. Never negative. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "just now" / "40s ago" / "4 min ago".
 *
 * Used by the location badge, which per plan §8.7 (#16) must be HONEST: a
 * browser PWA cannot guarantee a background fix, so the rider is told when the
 * last one actually left the device instead of being shown a fake live dot.
 */
export function ago(fromMs: number, nowMs: number): string {
  const delta = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  const mins = Math.round(delta / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

/** "14:32" — 24h, because a rider glancing at a timestamp wants no am/pm. */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "Thu 25 Sep". */
export function dayLabel(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

/** Today's YYYY-MM-DD in the rider's own timezone, not UTC. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Seconds left on an ISO deadline. The offer countdown is derived from the
 * SERVER's `expiresAt` on every tick rather than decremented locally, so a
 * backgrounded tab, a suspended timer or a slow render cannot make the rider
 * believe they still have time they do not.
 */
export function secondsUntil(iso: string, nowMs: number): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, (target - nowMs) / 1000);
}

/** `tel:` href with everything a dialler chokes on stripped out. */
export function telHref(phone: string | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned.length >= 6 ? `tel:${cleaned}` : null;
}
