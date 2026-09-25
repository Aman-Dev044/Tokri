/**
 * Maps, and life without them.
 *
 * ── THE SITUATION ───────────────────────────────────────────────────────────
 * `NEXT_PUBLIC_MAPS_BROWSER_KEY` is EMPTY. No key has been supplied, so the
 * shared `<MandiMap>` reports `available: false` and renders nothing useful.
 * A rider app that becomes unusable in that state is not shippable, so the
 * no-map path here is the DESIGNED path, not a degradation:
 *
 *   · the address is set large and high-contrast, and is the primary artefact
 *   · "Open in Google Maps" hands navigation to the app the rider already has
 *   · a placeholder occupies the map's slot so the layout never jumps when a
 *     key does arrive
 *
 * ── WHY THE DEEP LINK NEEDS NO KEY ──────────────────────────────────────────
 * `https://www.google.com/maps/dir/?api=1&destination=…` is a plain public URL
 * in Google's documented Maps URLs scheme. It is not an API call, it is not
 * billed, and it carries no credential. It works on a phone with the Maps app
 * installed and in any browser without one. Which is exactly why it is the
 * right primitive for this surface.
 *
 * NEVER add `|| 'some-key'` anywhere in this file (plan §4.1, ESLint-enforced).
 */

import type { GeoPoint, Place } from './types';

/**
 * Turn-by-turn to a coordinate. Preferred: a lat/lng cannot be misparsed and
 * needs no geocode on Google's side.
 */
export function directionsUrl(point: GeoPoint): string {
  const destination = `${point.lat},${point.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/**
 * Fallback for an address that was never geocoded (plan §8.7 #11 says geocode
 * once at address creation and store it — but a legacy or hand-typed address
 * may still arrive without a point). Google resolves the text itself.
 */
export function directionsUrlForAddress(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

/** The one call site the UI needs: a nav link for a Place, point or not. */
export function navUrlFor(place: Place): string {
  return place.point === null
    ? directionsUrlForAddress(`${place.label} ${place.address}`.trim())
    : directionsUrl(place.point);
}

/**
 * Straight-line metres between two points (haversine).
 *
 * Used ONLY to fill a gap when the API omitted `distanceMeters`, and labelled
 * "straight line" wherever it is shown. Plan §8.7 (#11) bans a Distance Matrix
 * call for this: it costs money per request and the stored 2dsphere point is
 * already good enough to tell a rider whether a job is near or far.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
