/**
 * The smallest honest typing of the Google Maps JS API that Mandi actually uses.
 *
 * WHY THIS FILE EXISTS
 * `@types/google.maps` is not installed, and `any` is banned repo-wide. Rather
 * than reach for an escape hatch, the handful of members we touch are declared
 * structurally here. `window.google` is read once, through `getMapsApi()`,
 * which is the single place an `unknown` is narrowed. If Google changes a
 * signature, exactly one file needs editing.
 *
 * Nothing here is a runtime import — the API arrives via a <script> tag.
 */

export interface GLatLngLiteral {
  lat: number;
  lng: number;
}

export interface GLatLng {
  lat: () => number;
  lng: () => number;
}

export interface GLatLngBounds {
  extend: (point: GLatLngLiteral) => GLatLngBounds;
  isEmpty: () => boolean;
}

export interface GMapMouseEvent {
  latLng: GLatLng | null;
}

export interface GMapOptions {
  center: GLatLngLiteral;
  zoom: number;
  disableDefaultUI?: boolean;
  gestureHandling?: 'auto' | 'cooperative' | 'greedy' | 'none';
  keyboardShortcuts?: boolean;
  clickableIcons?: boolean;
  zoomControl?: boolean;
  fullscreenControl?: boolean;
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  backgroundColor?: string;
  styles?: ReadonlyArray<Record<string, unknown>>;
}

export interface GMap {
  setCenter: (position: GLatLngLiteral) => void;
  panTo: (position: GLatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: GLatLngBounds, padding?: number) => void;
  addListener: (event: string, handler: (e: GMapMouseEvent) => void) => GListener;
}

export interface GListener {
  remove: () => void;
}

export interface GMarkerOptions {
  position: GLatLngLiteral;
  map: GMap | null;
  title?: string;
  zIndex?: number;
  optimized?: boolean;
  icon?: {
    url: string;
    scaledSize?: GSize;
    anchor?: GPoint;
  };
}

export interface GMarker {
  setPosition: (position: GLatLngLiteral) => void;
  setMap: (map: GMap | null) => void;
  setTitle: (title: string) => void;
}

export interface GPolylineOptions {
  path: GLatLngLiteral[];
  map: GMap | null;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  clickable?: boolean;
  zIndex?: number;
}

export interface GPolyline {
  setPath: (path: GLatLngLiteral[]) => void;
  setMap: (map: GMap | null) => void;
}

export interface GSize {
  width: number;
  height: number;
}
export interface GPoint {
  x: number;
  y: number;
}

/** Only the constructors we call. */
export interface MapsApi {
  Map: new (el: HTMLElement, options: GMapOptions) => GMap;
  Marker: new (options: GMarkerOptions) => GMarker;
  Polyline: new (options: GPolylineOptions) => GPolyline;
  LatLngBounds: new () => GLatLngBounds;
  Size: new (width: number, height: number) => GSize;
  Point: new (x: number, y: number) => GPoint;
}

interface MapsWindow {
  google?: { maps?: unknown };
}

function looksLikeMapsApi(value: unknown): value is MapsApi {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof MapsApi, unknown>>;
  return (
    typeof candidate.Map === 'function' &&
    typeof candidate.Marker === 'function' &&
    typeof candidate.LatLngBounds === 'function'
  );
}

/**
 * The one narrowing point. Returns null when the API has not loaded — callers
 * must handle that, because on a build with no browser key it never will.
 */
export function getMapsApi(): MapsApi | null {
  if (typeof window === 'undefined') return null;
  const maps = (window as unknown as MapsWindow).google?.maps;
  return looksLikeMapsApi(maps) ? maps : null;
}
