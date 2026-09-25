/**
 * MANDI — map primitive, public types.
 *
 * This file is the contract. Worker F (rider panel) and the customer shop both
 * code against exactly these shapes, so a change here breaks the build in both
 * places rather than breaking one of them silently at runtime.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Three kinds, three meanings. Colour alone never carries the meaning — each
 * marker also renders a distinct glyph and an accessible label, per plan §2.6.
 */
export type MapMarkerKind = 'store' | 'drop' | 'rider';

export interface MapMarker {
  /** stable identity — the rider marker is matched across renders by this */
  id: string;
  position: LatLng;
  kind: MapMarkerKind;
  /** shown in the marker title / screen-reader list */
  label?: string;
}

/**
 * The handle handed to `onReady`.
 *
 * Deliberately structural rather than `google.maps.Map`: `@types/google.maps`
 * is not a dependency of this monorepo, and adding a types package purely so a
 * callback can be typed would put a build-time dependency on an API that may
 * never be configured. Everything the callers actually use is here; anything
 * beyond it is reachable through `raw`.
 */
export interface MandiMapHandle {
  /** pan/zoom to a position */
  panTo: (position: LatLng) => void;
  setZoom: (zoom: number) => void;
  /** frame every marker and the polyline */
  fit: () => void;
  /** the underlying google.maps.Map, typed as unknown on purpose */
  raw: unknown;
}

export interface MandiMapProps {
  /** where the map opens. Required — a map with no centre is a grey square. */
  center: LatLng;
  /** 1 (world) … 21 (building). Ignored when `fitBounds` frames the content. */
  zoom?: number;
  markers?: readonly MapMarker[];
  /** the route, drawn desaturated so it never competes with the ribbon */
  polyline?: readonly LatLng[];
  /** frame all markers + the polyline instead of honouring `center`/`zoom` */
  fitBounds?: boolean;
  /** any CSS length, or a number of px. Default 280. */
  height?: number | string;
  /** false → gestures off, controls hidden. Use for a secondary/context map. */
  interactive?: boolean;
  onReady?: (map: MandiMapHandle) => void;
  /**
   * Not part of the shared contract, additive and optional: when supplied the
   * map becomes a pin picker and calls back with every click / drag-end.
   * Used by checkout to drop a delivery pin.
   */
  onPick?: (position: LatLng) => void;
  /** extra class on the outer frame */
  className?: string;
  /** accessible name for the map region */
  ariaLabel?: string;
}

export interface MapsLoadState {
  /** the Maps JS API has finished loading and `window.google.maps` is usable */
  loaded: boolean;
  /**
   * false when NEXT_PUBLIC_MAPS_BROWSER_KEY is empty — i.e. no key has been
   * supplied yet. Callers render their own designed placeholder; nothing in
   * Mandi may depend on a map being available.
   */
  available: boolean;
  error: string | null;
}
