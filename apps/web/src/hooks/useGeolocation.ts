'use client';

/**
 * Where the customer is — and what to do when they will not say.
 *
 * ── THE RULE: NEVER A DEAD END ──────────────────────────────────────────────
 * Denying the location prompt is a completely reasonable thing to do, and a lot
 * of people have it denied permanently at the browser level without knowing it.
 * Every competitor treats that as an error screen. Here it is a fork: type a
 * 6-digit PIN code instead and the store list still loads.
 *
 * ── WHAT IS PERSISTED ───────────────────────────────────────────────────────
 * The last chosen location is kept in `localStorage` so a reload does not
 * re-prompt. That is a convenience, not a credential — no token, no identifier,
 * nothing that would matter if another script on the origin read it. (Tokens
 * live in memory; see `lib/api-client`.)
 *
 * ── PERMISSION, NOT PROMPT ──────────────────────────────────────────────────
 * The prompt is never fired on mount. A page that asks for your location before
 * you have asked it for anything is the reason people deny it by reflex. It
 * fires on an explicit "Use my location" press, and `permissions.query` is used
 * where available to show the right label before anything is asked.
 */

import { useCallback, useEffect, useState } from 'react';
import { isValidPincode } from '@/lib/shop/format';
import type { LatLng } from '@/lib/shop/types';

const STORAGE_KEY = 'mandi.location';

export type GeoStatus =
  | 'idle' // nothing chosen yet
  | 'locating' // prompt open / fix in progress
  | 'granted' // we have coordinates from the device
  | 'manual' // the customer typed a PIN code
  | 'denied' // permission refused — offer the PIN fallback
  | 'unsupported' // no geolocation API in this browser
  | 'error'; // timeout, no fix, position unavailable

export interface ShopLocation {
  coords: LatLng | null;
  pincode: string | null;
  /** what to show in the header, e.g. "Near you" or "560076" */
  label: string;
  source: 'device' | 'pincode';
  at: number;
}

export interface GeolocationState {
  status: GeoStatus;
  location: ShopLocation | null;
  error: string | null;
  /** true once the stored value has been read — avoids a hydration mismatch */
  ready: boolean;
}

export interface UseGeolocation extends GeolocationState {
  /** fires the browser prompt */
  request: () => void;
  /** the fallback path — returns false when the PIN is not a valid Indian code */
  setPincode: (pincode: string) => boolean;
  clear: () => void;
}

function readStored(): ShopLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const source = record['source'];
    const label = record['label'];
    if ((source !== 'device' && source !== 'pincode') || typeof label !== 'string') return null;

    const coordsRaw = record['coords'];
    let coords: LatLng | null = null;
    if (typeof coordsRaw === 'object' && coordsRaw !== null) {
      const c = coordsRaw as Record<string, unknown>;
      if (typeof c['lat'] === 'number' && typeof c['lng'] === 'number') {
        coords = { lat: c['lat'], lng: c['lng'] };
      }
    }
    const pincode = record['pincode'];

    return {
      coords,
      pincode: typeof pincode === 'string' ? pincode : null,
      label,
      source,
      at: typeof record['at'] === 'number' ? record['at'] : Date.now(),
    };
  } catch {
    return null;
  }
}

function store(location: ShopLocation | null): void {
  try {
    if (location === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Private mode, or storage full. A location we cannot remember is a small
    // annoyance; a crash here would be a broken header.
  }
}

export function useGeolocation(): UseGeolocation {
  const [state, setState] = useState<GeolocationState>({
    status: 'idle',
    location: null,
    error: null,
    ready: false,
  });

  /* Restore after mount only — reading localStorage during render would make
     the server and client markup disagree. */
  useEffect(() => {
    const saved = readStored();
    setState({
      status: saved === null ? 'idle' : saved.source === 'device' ? 'granted' : 'manual',
      location: saved,
      error: null,
      ready: true,
    });
  }, []);

  /* If permission was already refused at the browser level, say so up front
     rather than firing a prompt that silently never appears. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('permissions' in navigator)) return;
    let live = true;
    void navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (!live || result.state !== 'denied') return;
        setState((prev) =>
          prev.location !== null ? prev : { ...prev, status: 'denied', ready: true },
        );
      })
      .catch(() => {
        // Safari used to throw on an unknown permission name. Not fatal.
      });
    return () => {
      live = false;
    };
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState((prev) => ({
        ...prev,
        status: 'unsupported',
        error: 'This browser cannot share a location. Enter a PIN code instead.',
        ready: true,
      }));
      return;
    }

    setState((prev) => ({ ...prev, status: 'locating', error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: ShopLocation = {
          coords: { lat: position.coords.latitude, lng: position.coords.longitude },
          pincode: null,
          label: 'Near you',
          source: 'device',
          at: Date.now(),
        };
        store(next);
        setState({ status: 'granted', location: next, error: null, ready: true });
      },
      (failure) => {
        const denied = failure.code === failure.PERMISSION_DENIED;
        setState((prev) => ({
          ...prev,
          status: denied ? 'denied' : 'error',
          error: denied
            ? 'Location is blocked for this site. Enter a PIN code instead — it works just as well.'
            : 'We could not get a fix on your position. Enter a PIN code instead.',
          ready: true,
        }));
      },
      // 10s is long enough for a cold GPS fix and short enough that the button
      // does not appear to hang. A 2-minute-old cached fix is fine for "which
      // shops are near me".
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    );
  }, []);

  const setPincode = useCallback((pincode: string) => {
    const trimmed = pincode.trim();
    if (!isValidPincode(trimmed)) {
      setState((prev) => ({
        ...prev,
        error: 'That is not a 6-digit Indian PIN code.',
      }));
      return false;
    }
    const next: ShopLocation = {
      coords: null,
      pincode: trimmed,
      label: trimmed,
      source: 'pincode',
      at: Date.now(),
    };
    store(next);
    setState({ status: 'manual', location: next, error: null, ready: true });
    return true;
  }, []);

  const clear = useCallback(() => {
    store(null);
    setState({ status: 'idle', location: null, error: null, ready: true });
  }, []);

  return { ...state, request, setPincode, clear };
}

/**
 * The query the store list sends.
 *
 * `GET /stores` accepts `lat`, `lng`, `radius`, `pincode`, `q`, `page`,
 * `limit` and `sort` (`BrowseStoresQueryDto`). The API runs
 * `forbidNonWhitelisted`, so anything else is a hard 400 — this used to send
 * `?pincode=560076` before the DTO accepted it and every PIN-code search
 * answered `400 property pincode should not exist`.
 *
 * A device fix always wins when we have one (it is strictly more precise);
 * the PIN code is the fallback for when geolocation was denied or never
 * asked. Never both at once — the API resolves a PIN to a centre point
 * server-side, and sending `lat`/`lng` alongside it would be ambiguous about
 * which one to trust.
 */
export function locationQuery(
  location: ShopLocation | null,
): Record<string, string | number | undefined> {
  if (location === null) return {};
  if (location.coords !== null) {
    return { lat: location.coords.lat, lng: location.coords.lng, radius: 5 };
  }
  if (location.pincode !== null) return { pincode: location.pincode };
  return {};
}

/**
 * ★ The query the MARKET-WIDE product grid sends — `GET /products`.
 *
 * Same location object, a DIFFERENT whitelist, and that difference was a
 * live bug: `BrowseMarketProductsQueryDto` accepts `lat`, `lng`, `pincode`,
 * `q`, `aisleKey`, `page` and `limit` — and NOT `radius`. Sending
 * `locationQuery()` at `/products` therefore answered
 * `400 property radius should not exist` for every customer who had ever
 * shared their location, which is to say the aisle grid was broken for
 * exactly the people who had used the app before.
 *
 * `radius` is absent there on purpose rather than by oversight: on
 * `GET /stores` it FILTERS ("within 5 km"), while on `GET /products`
 * nothing filters by distance at all — a market-wide search is "does
 * anyone sell this", not "what is near me". Position is carried only so
 * each row can say how far its store is. Two endpoints, two honest
 * shapes, so this is a second function rather than a flag on the first.
 */
export function marketLocationQuery(
  location: ShopLocation | null,
): Record<string, string | number | undefined> {
  if (location === null) return {};
  if (location.coords !== null) {
    return { lat: location.coords.lat, lng: location.coords.lng };
  }
  if (location.pincode !== null) return { pincode: location.pincode };
  return {};
}

/** True when the chosen location actually narrows the server-side query. */
export function isLocationFiltered(location: ShopLocation | null): boolean {
  return location !== null && (location.coords !== null || location.pincode !== null);
}
