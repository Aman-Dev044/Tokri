/**
 * MANDI — shared map primitive.
 *
 *   import { MandiMap, useMapsLoaded } from '@mandi/design-system/map';
 *
 * THE CONTRACT (stable — the rider panel and the shop both build on it):
 *
 *   <MandiMap
 *      center={{ lat, lng }}
 *      zoom?        number, default 14
 *      markers?     { id, position:{lat,lng}, kind:'store'|'drop'|'rider', label? }[]
 *      polyline?    {lat,lng}[]      — drawn desaturated
 *      fitBounds?   boolean          — frame markers + polyline instead of center/zoom
 *      height?      number | string  — default 280px
 *      interactive? boolean          — default true
 *      onReady?     (map: MandiMapHandle) => void
 *      onPick?      (position: {lat,lng}) => void   — additive; turns it into a pin picker
 *   />
 *
 *   useMapsLoaded(): { loaded: boolean; available: boolean; error: string | null }
 *     available === false  →  NEXT_PUBLIC_MAPS_BROWSER_KEY is empty.
 *                             Callers render their OWN placeholder; MandiMap
 *                             already renders a designed one.
 *
 * The rider marker interpolates between updates, so it glides rather than
 * teleporting every 10 seconds. See MandiMap.tsx for why that matters.
 */

export { MandiMap } from './MandiMap';
export { useMapsLoaded, MAPS_BROWSER_KEY } from './useMapsLoaded';
export type { UseMapsLoadedOptions } from './useMapsLoaded';
export type {
  LatLng,
  MapMarker,
  MapMarkerKind,
  MandiMapProps,
  MandiMapHandle,
  MapsLoadState,
} from './types';
