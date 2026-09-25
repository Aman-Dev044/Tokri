import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GeoPoint, point } from '../../database/schemas/geo-point';
import {
  AVERAGE_SPEED_KMPH,
  ETA_FIXED_MINUTES,
  PAYOUT_BASE_PAISE,
  PAYOUT_PER_KM_PAISE,
} from './delivery.constants';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends LatLng {
  formattedAddress: string;
  /** The provider's stable id for the place, worth storing alongside. */
  placeId: string | null;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  GEO
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two responsibilities with very different costs, deliberately kept in
 * one place so the cheap one is the obvious one to reach for.
 *
 * ── Distance: free ──────────────────────────────────────────────────────
 * Computed from the 2dsphere points already stored on the vendor and the
 * order address. No API call, no quota, no latency, no bill. §8.7 calls
 * out a Distance Matrix request per order as challenge #11 — this is the
 * answer to it. Straight-line distance is an underestimate of road
 * distance by roughly 20-30% in a city, which is why the ETA applies a
 * fixed allowance rather than pretending otherwise.
 *
 * ── Geocoding: billed, and therefore rationed ───────────────────────────
 * ONE call per address, at the moment the address is created, and the
 * result is stored. Never on render: a tracking screen that geocodes on
 * every poll turns one address into thousands of billed requests.
 *
 * `GOOGLE_MAPS_SERVER_KEY` is OPTIONAL by design. The API must boot
 * without it — geocoding is a feature, not a prerequisite — so the key's
 * absence refuses exactly one call and nothing else.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(private readonly config: ConfigService) {}

  // ──────────────────────────────────────────────────────────────────
  //  Free: the stored points
  // ──────────────────────────────────────────────────────────────────

  /** Great-circle kilometres between two GeoJSON points, 2dp. */
  distanceKm(from: GeoPoint | null, to: GeoPoint | null): number | null {
    const a = toLatLng(from);
    const b = toLatLng(to);
    if (!a || !b) return null;

    const R = 6371; // mean Earth radius, km
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;

    return round2(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  }

  /**
   * Minutes to cover a distance, or `null` when it is unknown.
   *
   * `null` is not zero and must not be rendered as "arriving now". A
   * missing coordinate is a missing estimate, and the UI says so.
   */
  etaMinutes(distanceKm: number | null): number | null {
    if (distanceKm === null) return null;
    return Math.max(
      1,
      Math.round((distanceKm / AVERAGE_SPEED_KMPH) * 60) + ETA_FIXED_MINUTES,
    );
  }

  /**
   * Rider payout for a trip, in INTEGER PAISE.
   *
   * Derived from distance rather than stored on the order, so the number
   * on the offer and the number in the earnings statement cannot drift
   * apart. An unknown distance still pays the base — the rider did the
   * job; a missing coordinate is the platform's problem, not theirs.
   */
  payoutPaise(distanceKm: number | null): number {
    if (distanceKm === null) return PAYOUT_BASE_PAISE;
    return Math.round(PAYOUT_BASE_PAISE + distanceKm * PAYOUT_PER_KM_PAISE);
  }

  /** `[lng, lat]` order, every time, through the shared builder. */
  toPoint(coords: LatLng): GeoPoint {
    return point(coords.lng, coords.lat);
  }

  toLatLng(geo: GeoPoint | null | undefined): LatLng | null {
    return toLatLng(geo ?? null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Billed: geocoding
  // ──────────────────────────────────────────────────────────────────

  /** True when `GOOGLE_MAPS_SERVER_KEY` is configured. */
  get isGeocodingConfigured(): boolean {
    return !!this.config.get<string>('maps.serverKey');
  }

  /**
   * Address text → coordinates. CALL THIS ONCE PER ADDRESS AND STORE THE
   * RESULT.
   *
   * Refuses rather than degrades when the key is absent: silently
   * returning `null` would let a caller store an address with no
   * coordinates, and an order that cannot be geocoded is an order no
   * rider can be found for. Failing loudly at the point of creation is
   * recoverable; a coordinate-less order is not.
   */
  async geocode(address: string): Promise<GeocodeResult> {
    const key = this.config.get<string>('maps.serverKey');
    if (!key) {
      throw new ServiceUnavailableException(
        'Maps are not configured: GOOGLE_MAPS_SERVER_KEY is not set on this ' +
          'deployment, so addresses cannot be geocoded.',
      );
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('region', 'in');
    url.searchParams.set('key', key);

    let body: GoogleGeocodeResponse;
    try {
      const response = await fetch(url, {
        // A geocode is on the critical path of saving an address. It does
        // not get to hang the request for a minute.
        signal: AbortSignal.timeout(5_000),
      });
      body = (await response.json()) as GoogleGeocodeResponse;
    } catch (error) {
      this.logger.error(
        `Geocoding request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Geocoding provider unreachable');
    }

    const first = body.results?.[0];
    if (body.status !== 'OK' || !first) {
      // The status is logged, never returned: it can carry quota and
      // billing detail that is nobody's business outside the server.
      this.logger.warn(`Geocoding returned ${body.status} for an address`);
      throw new ServiceUnavailableException('Address could not be located');
    }

    return {
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
      formattedAddress: first.formatted_address,
      placeId: first.place_id ?? null,
    };
  }
}

interface GoogleGeocodeResponse {
  status: string;
  results?: {
    formatted_address: string;
    place_id?: string;
    geometry: { location: { lat: number; lng: number } };
  }[];
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;
const round2 = (value: number): number => Math.round(value * 100) / 100;

const toLatLng = (geo: GeoPoint | null): LatLng | null => {
  const coords = geo?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return { lat, lng };
};
