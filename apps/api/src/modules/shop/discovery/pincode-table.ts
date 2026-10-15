/**
 * ════════════════════════════════════════════════════════════════════════
 *  PIN CODE → CENTRE, a small static table
 * ════════════════════════════════════════════════════════════════════════
 *
 * `GET /stores?pincode=560102` is the fallback for a customer who denied
 * geolocation permission (`useGeolocation.ts` on the web app). It does
 * NOT call a paid geocoding API — `GeoService.geocode` already exists for
 * an ADDRESS, on write, once (§8.7 cost control), and calling it again
 * here, on every read of a public unauthenticated route, would be the
 * exact per-request billing exposure that decision was made to avoid.
 *
 * Instead: a hand-maintained table of PIN → an approximate centre, for
 * the cities this platform actually serves. It resolves a PIN to
 * roughly the right neighbourhood, which is all `browseStores`'
 * `$geoNear` + `serviceRadiusKm` check needs — the same tolerance a
 * customer's own imprecise GPS fix already has.
 *
 * An unlisted PIN is a clean `BadRequestException` (400), not a 500 and
 * not a silently-empty result: the caller gets to say "we don't serve
 * that PIN yet" rather than "no stores near you" for a market that was
 * never on the map.
 *
 * Coordinates are `[lat, lng]` here (matching every OTHER lat/lng pair in
 * this API's query strings) and converted to GeoJSON `[lng, lat]` only at
 * the `$geoNear` call site — see `point()` in `geo-point.ts`.
 */
export interface PincodeCentre {
  lat: number;
  lng: number;
  city: string;
}

const PINCODE_TABLE: Readonly<Record<string, PincodeCentre>> = {
  // Bengaluru
  '560001': { lat: 12.9716, lng: 77.5946, city: 'Bengaluru' },
  '560034': { lat: 12.9352, lng: 77.6101, city: 'Bengaluru' },
  '560102': { lat: 12.9121, lng: 77.6446, city: 'Bengaluru' },
  '560103': { lat: 12.9279, lng: 77.6271, city: 'Bengaluru' },
  // Mumbai
  '400001': { lat: 18.9388, lng: 72.8354, city: 'Mumbai' },
  '400050': { lat: 19.0596, lng: 72.8295, city: 'Mumbai' },
  // Delhi
  '110001': { lat: 28.6304, lng: 77.2177, city: 'New Delhi' },
  '110016': { lat: 28.5494, lng: 77.1925, city: 'New Delhi' },
  // Hyderabad
  '500001': { lat: 17.3871, lng: 78.4739, city: 'Hyderabad' },
  // Chennai
  '600001': { lat: 13.0898, lng: 80.2839, city: 'Chennai' },
  // Pune
  '411001': { lat: 18.5196, lng: 73.8553, city: 'Pune' },
  // Kolkata
  '700001': { lat: 22.5697, lng: 88.3697, city: 'Kolkata' },
  // Ahmedabad
  '380001': { lat: 23.0258, lng: 72.5873, city: 'Ahmedabad' },
};

/** `null` for anything not in the table — the caller turns that into a 400. */
export function resolvePincode(pincode: string): PincodeCentre | null {
  return PINCODE_TABLE[pincode] ?? null;
}

/**
 * Every PIN this platform can resolve, grouped by city, for the 400 body.
 *
 * "That PIN is not serviceable" is only half an answer — the other half is
 * "here is what IS", and the customer app has no business keeping its own
 * copy of this table to say so. Shipping the list inside the refusal keeps
 * one source of truth: add a city here and the UI's hint updates with it.
 */
export function serviceablePincodes(): { city: string; pincodes: string[] }[] {
  const byCity = new Map<string, string[]>();
  for (const [pincode, centre] of Object.entries(PINCODE_TABLE)) {
    const list = byCity.get(centre.city);
    if (list) list.push(pincode);
    else byCity.set(centre.city, [pincode]);
  }
  return [...byCity.entries()].map(([city, pincodes]) => ({ city, pincodes }));
}
