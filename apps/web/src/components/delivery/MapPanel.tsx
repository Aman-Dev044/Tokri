'use client';

/**
 * The shared map, and the screen that ships without it.
 *
 * ── THIS IS AN ADAPTER, NOT A MAP ───────────────────────────────────────────
 * `<MandiMap>` and `useMapsLoaded` live in `@mandi/design-system/map` and are
 * imported by name. This surface must never grow its own Google Maps loader:
 * two loaders on one page means two `<script>` tags, two billing meters and a
 * race over `window.google`.
 *
 * ── AND WHY THE FALLBACK IS THE REAL DESIGN ─────────────────────────────────
 * `NEXT_PUBLIC_MAPS_BROWSER_KEY` now has a value, but BILLING IS NOT ENABLED
 * on that Google Cloud project, so the Maps JS API answers `REQUEST_DENIED`
 * and no tile will ever draw. Every rider screen therefore has to work with no
 * map at all, and does:
 *
 *   the address, set LARGE          ← the primary artefact
 *   "Open in Google Maps"           ← a plain URL, no key, no billing
 *   a placeholder holding the slot  ← so nothing jumps if billing is turned on
 *
 * `useMapsLoaded()` reports `available: false` only for an EMPTY key, so a
 * denied key reports `available: true` and then fails at load. Both paths land
 * on the same placeholder here: the map is shown only once `loaded` is true
 * and no `error` came back.
 *
 * No key is ever hardcoded here and there is no `|| 'fallback'`.
 */

import { MandiMap, useMapsLoaded, type MapMarker } from '@mandi/design-system/map';

import styles from './delivery.module.css';
import type { LatLng } from '@/lib/delivery/types';

export interface MapPanelProps {
  /** Where to look. Null ⇒ the address was never geocoded. */
  center: LatLng | null;
  markers?: readonly MapMarker[];
  height?: number;
  /** Shown inside the placeholder — tell the rider what they are missing. */
  placeholderText?: string;
}

const NO_KEY_TEXT =
  'No map on this build — use the address above, or open it in Google Maps.';
const NO_POINT_TEXT =
  'This address has no pin saved. Use the written address, or search it in Google Maps.';

function Placeholder({ text }: { text: string }) {
  return (
    <div className={styles.mapSlot} role="note">
      <p className={styles.mapSlotText}>{text}</p>
    </div>
  );
}

export function MapPanel({
  center,
  markers,
  height = 180,
  placeholderText,
}: MapPanelProps) {
  const { loaded, available, error } = useMapsLoaded();

  if (center === null) {
    return <Placeholder text={placeholderText ?? NO_POINT_TEXT} />;
  }
  // `available: false` is an empty key; `error` is a key that was refused
  // (REQUEST_DENIED, no billing). A rider does not care which — both mean
  // "read the address".
  if (!available || error !== null || !loaded) {
    return <Placeholder text={placeholderText ?? NO_KEY_TEXT} />;
  }

  return (
    <div className={styles.mapLive}>
      <MandiMap
        center={center}
        markers={markers ?? []}
        fitBounds={(markers?.length ?? 0) > 1}
        height={height}
        interactive={false}
      />
    </div>
  );
}
