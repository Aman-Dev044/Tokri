import { GeoPoint } from '../../../database/schemas/geo-point';

/** Mean Earth radius, metres. */
const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two GeoJSON points, in metres.
 *
 * Used for the serviceability check at checkout, where the store and the
 * drop address are both already on hand. Locked decision #11 and §8.7 are
 * explicit: distance comes from the stored `2dsphere` points, never from a
 * Distance Matrix call — a paid round trip per checkout would be both slow
 * and, at grocery volumes, expensive enough to notice.
 *
 * COORDINATE ORDER IS [lng, lat], matching GeoJSON and `point()`.
 */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const [lng1, lat1] = a.coordinates;
  const [lng2, lat2] = b.coordinates;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Metres → kilometres, one decimal place. Display only. */
export const toKm = (metres: number): number =>
  Math.round(metres / 100) / 10;

/**
 * Escapes regex metacharacters so a search term is matched literally.
 *
 * Without it `q=.*` returns the entire collection and `q=(a+)+$` is a
 * ReDoS pointed at the database process.
 */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
