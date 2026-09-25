/**
 * Maps, and life without them.
 *
 * ── THE SITUATION ───────────────────────────────────────────────────────────
 * `NEXT_PUBLIC_MAPS_BROWSER_KEY` now HAS a value, but billing is not enabled
 * on that Google Cloud project, so the Maps JS API answers `REQUEST_DENIED`
 * and the shared `<MandiMap>` renders nothing useful. A rider app that becomes
 * unusable in that state is not shippable, so the no-map path here is the
 * DESIGNED path, not a degradation:
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

import { pointOf, type LatLng, type Waypoint } from './types';

/**
 * Turn-by-turn to a coordinate. Preferred: a lat/lng cannot be misparsed and
 * needs no geocode on Google's side.
 */
export function directionsUrl(point: LatLng): string {
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

/**
 * The one call site the UI needs: a nav link for a waypoint, pin or not.
 *
 * `pointOf` refuses a half-pair, so an address that has a latitude and a null
 * longitude falls through to the text form rather than navigating a rider into
 * the Gulf of Guinea.
 */
export function navUrlFor(waypoint: Waypoint): string {
  const point = pointOf(waypoint);
  if (point !== null) return directionsUrl(point);
  const text = `${waypoint.label} ${waypoint.address}`.trim();
  return directionsUrlForAddress(text === '' ? waypoint.label : text);
}
