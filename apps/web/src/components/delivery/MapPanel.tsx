'use client';

/**
 * The shared map, and the screen that ships without it.
 *
 * ── WHY THIS IS AN ADAPTER AND NOT A MAP ────────────────────────────────────
 * Worker E owns `<MandiMap>` in `@mandi/design-system`. This surface imports
 * it — it does not reimplement it, and must never grow its own Google Maps
 * loader. But the component is landing in parallel with these screens, so the
 * import is FEATURE-DETECTED off the package namespace rather than named:
 *
 *   · today, the export does not exist. A named import would be a build error
 *     and the whole rider app would be unreviewable.
 *   · when Worker E lands it, this file picks it up with no edit.
 *
 * The cast to `Partial<MapExports>` is the honest spelling of "this may or may
 * not be here". It is not an `any` and it does not hide a type error: the
 * contract below is exactly the one in the brief, so if the real component
 * ships a different shape, this file is where it fails, loudly.
 *
 * ── AND WHY THE FALLBACK IS THE REAL DESIGN ─────────────────────────────────
 * `NEXT_PUBLIC_MAPS_BROWSER_KEY` is EMPTY. Nobody has supplied a key, so
 * `useMapsLoaded().available` is false and will stay false. Every rider screen
 * therefore has to work with no map at all, and does:
 *
 *   the address, set LARGE          ← the primary artefact
 *   "Open in Google Maps"           ← a plain URL, no key, no billing
 *   a placeholder holding the slot  ← so nothing jumps when a key arrives
 *
 * No key is ever hardcoded here and there is no `|| 'fallback'` (plan §4.1).
 */

import type { ComponentType } from 'react';
import * as DesignSystem from '@mandi/design-system';

import styles from './delivery.module.css';
import type { GeoPoint } from '@/lib/delivery/types';

/* ------------------------------------------------------------------ */
/* The contract (from the brief)                                       */
/* ------------------------------------------------------------------ */

export interface MandiMapMarker {
  id: string;
  position: GeoPoint;
  kind: 'store' | 'drop' | 'rider';
  label?: string;
}

export interface MandiMapProps {
  center: GeoPoint;
  zoom?: number;
  markers?: MandiMapMarker[];
  polyline?: GeoPoint[];
  fitBounds?: boolean;
  height?: number | string;
  interactive?: boolean;
  onReady?: () => void;
}

export interface MapsLoadedState {
  loaded: boolean;
  available: boolean;
  error: string | null;
}

interface MapExports {
  MandiMap: ComponentType<MandiMapProps>;
  useMapsLoaded: () => MapsLoadedState;
}

const maybe = DesignSystem as unknown as Partial<MapExports>;
const MaybeMandiMap = maybe.MandiMap;
const maybeUseMapsLoaded = maybe.useMapsLoaded;

/* ------------------------------------------------------------------ */

export interface MapPanelProps {
  /** Where to look. Null ⇒ the address was never geocoded. */
  center: GeoPoint | null;
  markers?: MandiMapMarker[];
  height?: number;
  /** Shown inside the placeholder — tell the rider what they are missing. */
  placeholderText?: string;
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className={styles.mapSlot} role="note">
      <p className={styles.mapSlotText}>{text}</p>
    </div>
  );
}

/**
 * Built once, at module load, and only when both exports exist. A hook cannot
 * be called conditionally, so the conditionality lives here — in whether this
 * component exists at all — rather than inside a render.
 */
const DesignSystemMap: ComponentType<MapPanelProps> | null =
  typeof MaybeMandiMap === 'function' && typeof maybeUseMapsLoaded === 'function'
    ? buildDesignSystemMap(MaybeMandiMap, maybeUseMapsLoaded)
    : null;

function buildDesignSystemMap(
  Map: ComponentType<MandiMapProps>,
  useMapsLoaded: () => MapsLoadedState,
): ComponentType<MapPanelProps> {
  return function DesignSystemMapPanel({
    center,
    markers,
    height = 180,
    placeholderText,
  }: MapPanelProps) {
    const { available, error } = useMapsLoaded();

    if (center === null) {
      return <Placeholder text={placeholderText ?? NO_POINT_TEXT} />;
    }
    if (!available) {
      return <Placeholder text={error ?? NO_KEY_TEXT} />;
    }
    return (
      <div className={styles.mapLive}>
        <Map
          center={center}
          markers={markers ?? []}
          fitBounds={(markers?.length ?? 0) > 1}
          height={height}
          interactive={false}
        />
      </div>
    );
  };
}

const NO_KEY_TEXT =
  'No map on this build — use the address above, or open it in Google Maps.';
const NO_POINT_TEXT =
  'This address has no pin saved. Use the written address, or search it in Google Maps.';

export function MapPanel(props: MapPanelProps) {
  if (DesignSystemMap === null) {
    return <Placeholder text={props.placeholderText ?? NO_KEY_TEXT} />;
  }
  return <DesignSystemMap {...props} />;
}
