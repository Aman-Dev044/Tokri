'use client';

/**
 * MANDI — the shared map primitive.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * The map is SECONDARY everywhere in Mandi. Tracking is the Journey Ribbon
 * (plan §2.2, Pillar 4); this is the desaturated context panel that sits under
 * it, collapsed by default. Nothing in the product may depend on it:
 *
 *   · no browser key configured  → a designed placeholder, and the surrounding
 *     screen keeps working in full;
 *   · script blocked / offline   → the same placeholder with the real reason;
 *   · rider position stale       → the CALLER says so. This component draws
 *     what it is given and never invents a fresher position.
 *
 * ── THE RIDER GLIDES, IT DOES NOT TELEPORT ──────────────────────────────────
 * `delivery.location_updated` arrives every ~10s (plan decision #11). Setting
 * the marker directly makes a scooter jump 400m every ten seconds, which reads
 * as a broken feed. The rider marker is therefore tweened from its previous
 * position to the new one over ~1.4s on rAF. Under `prefers-reduced-motion` it
 * snaps — a moving object is exactly what that setting is about.
 *
 * ── STYLING ─────────────────────────────────────────────────────────────────
 * The CSS ships inside the component as a React 19 hoisted <style href>, so
 * this primitive is a genuine drop-in: an importer adds no stylesheet, and two
 * mounted maps do not duplicate the rules. Everything reads design tokens, so
 * the frame re-tints with the aisle like the rest of the interface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLoaded } from './useMapsLoaded';
import { getMapsApi } from './google-maps-api';
import type { GMap, GMarker, GPolyline, GListener } from './google-maps-api';
import type { LatLng, MandiMapHandle, MandiMapProps, MapMarker, MapMarkerKind } from './types';

/* ───────────────────────────── marker art ───────────────────────────────── */

const MARKER_GLYPH: Record<MapMarkerKind, string> = {
  // A shop awning, a doorway, a scooter. Shape carries the meaning; colour is
  // only ever a second signal (plan §2.6).
  store: '<path d="M7 13h14v9H7z" fill="none" stroke="#fff" stroke-width="2"/><path d="M5 9h18l-2 4H7z" fill="#fff"/>',
  drop: '<path d="M9 22V11l5-4 5 4v11" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12 22v-5h4v5" fill="#fff"/>',
  rider:
    '<circle cx="10" cy="19" r="3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="20" cy="19" r="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M10 19l4-8h4l2 8" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>',
};

const MARKER_FALLBACK_FILL: Record<MapMarkerKind, string> = {
  store: '#2f6b3c',
  drop: '#14150f',
  rider: '#b5651d',
};

/** Reads the live --aisle token so pins re-tint with the rest of the app. */
function aisleColour(): string | null {
  if (typeof window === 'undefined') return null;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--aisle')
    .trim();
  return value === '' ? null : value;
}

function markerIconUrl(kind: MapMarkerKind, fill: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">` +
    `<path d="M14 35C14 35 26 21.5 26 13.5A12 12 0 1 0 2 13.5C2 21.5 14 35 14 35Z" fill="${fill}" stroke="rgba(0,0,0,.28)"/>` +
    `<g transform="translate(0,-2) scale(0.85) translate(2.5,2)">${MARKER_GLYPH[kind]}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/* ───────────────────── desaturated basemap styling ──────────────────────── */

/**
 * Greyed right down on purpose. The ribbon above it is the hero; a full-colour
 * Google basemap would out-shout it and we would be back to every competitor's
 * tracking screen.
 */
const DESATURATED: ReadonlyArray<Record<string, unknown>> = [
  { elementType: 'geometry', stylers: [{ saturation: -85 }, { lightness: 8 }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ saturation: -100 }, { lightness: -15 }] },
  { elementType: 'labels.text.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ saturation: -100 }] },
  { featureType: 'water', stylers: [{ saturation: -70 }, { lightness: 10 }] },
];

/* ─────────────────────────────── helpers ────────────────────────────────── */

function toCssLength(value: number | string | undefined): string {
  if (value === undefined) return '280px';
  return typeof value === 'number' ? `${value}px` : value;
}

function samePoint(a: LatLng | null, b: LatLng | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ──────────────────────────── placeholder ───────────────────────────────── */

function MapPlaceholder({
  height,
  reason,
  markers,
  className,
}: {
  height: string;
  reason: 'no-key' | 'loading' | 'error';
  markers: readonly MapMarker[];
  className?: string;
}) {
  return (
    <div
      className={['mnd-map', 'mnd-map--placeholder', className].filter(Boolean).join(' ')}
      style={{ height }}
      data-reason={reason}
    >
      <MapStyles />
      {/* A drawn route, not a screenshot. It is obviously a diagram, which is
          the honest thing to show when there is no real map. */}
      <svg className="mnd-map__ghost" viewBox="0 0 400 200" aria-hidden="true">
        <defs>
          <pattern id="mnd-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0v40" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="400" height="200" fill="url(#mnd-map-grid)" />
        <path
          d="M56 150 C 120 150, 130 70, 200 70 S 300 112, 344 58"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="9 8"
          strokeLinecap="round"
        />
        <circle cx="56" cy="150" r="7" fill="currentColor" />
        <rect x="337" y="51" width="14" height="14" fill="currentColor" />
      </svg>

      <div className="mnd-map__note">
        {reason === 'loading' ? (
          <p className="mnd-map__note-title">Loading map…</p>
        ) : reason === 'error' ? (
          <>
            <p className="mnd-map__note-title">Map unavailable</p>
            <p className="mnd-map__note-body">
              The Maps script did not load. Check that the browser key allows this
              origin as an HTTP referrer and that billing is enabled.
            </p>
          </>
        ) : (
          <>
            <p className="mnd-map__note-title">Map unavailable</p>
            <p className="mnd-map__note-body">
              Add <code className="mnd-map__code">NEXT_PUBLIC_MAPS_BROWSER_KEY</code> to{' '}
              <code className="mnd-map__code">apps/web/.env.local</code> to show the
              live map. Everything on this screen works without it.
            </p>
          </>
        )}

        {markers.length > 0 ? (
          <ul className="mnd-map__legend">
            {markers.map((m) => (
              <li key={m.id} data-kind={m.kind}>
                <span className="mnd-map__legend-dot" aria-hidden="true" />
                <span className="mnd-map__legend-label">
                  {m.label ?? KIND_LABEL[m.kind]}
                </span>
                <span className="mnd-map__legend-coords">
                  {m.position.lat.toFixed(4)}, {m.position.lng.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<MapMarkerKind, string> = {
  store: 'Store',
  drop: 'Delivery address',
  rider: 'Rider',
};

/* ──────────────────────────────── MandiMap ──────────────────────────────── */

export function MandiMap({
  center,
  zoom = 14,
  markers = [],
  polyline,
  fitBounds = false,
  height,
  interactive = true,
  onReady,
  onPick,
  className,
  ariaLabel = 'Map',
}: MandiMapProps) {
  const cssHeight = toCssLength(height);
  const { loaded, available, error } = useMapsLoaded();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markerRefs = useRef(new Map<string, GMarker>());
  const polylineRef = useRef<GPolyline | null>(null);
  const listenerRef = useRef<GListener | null>(null);
  const riderTween = useRef<{ frame: number; from: LatLng; to: LatLng; start: number } | null>(
    null,
  );
  const riderPos = useRef<LatLng | null>(null);
  const [ready, setReady] = useState(false);

  /* Latest callbacks, without making the map re-create itself on every render. */
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const fitToContent = useCallback(() => {
    const api = getMapsApi();
    const map = mapRef.current;
    if (!api || !map) return;
    const bounds = new api.LatLngBounds();
    let any = false;
    for (const m of markers) {
      bounds.extend(m.position);
      any = true;
    }
    for (const p of polyline ?? []) {
      bounds.extend(p);
      any = true;
    }
    if (!any) return;
    map.fitBounds(bounds, 48);
  }, [markers, polyline]);

  /* ---- create the map once the script is in ---- */
  useEffect(() => {
    if (!loaded || hostRef.current === null || mapRef.current !== null) return;
    const api = getMapsApi();
    if (!api) return;

    const map = new api.Map(hostRef.current, {
      center,
      zoom,
      disableDefaultUI: !interactive,
      gestureHandling: interactive ? 'cooperative' : 'none',
      keyboardShortcuts: interactive,
      clickableIcons: false,
      zoomControl: interactive,
      fullscreenControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      styles: DESATURATED,
    });
    mapRef.current = map;
    setReady(true);

    const handle: MandiMapHandle = {
      panTo: (position) => {
        map.panTo(position);
      },
      setZoom: (z) => {
        map.setZoom(z);
      },
      fit: fitToContent,
      raw: map,
    };
    onReadyRef.current?.(handle);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- create-once by design
  }, [loaded, interactive]);

  /* ---- pin picking (checkout) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || map === null) return;

    listenerRef.current?.remove();
    listenerRef.current = null;
    if (!onPick) return;

    listenerRef.current = map.addListener('click', (event) => {
      const point = event.latLng;
      if (!point) return;
      onPickRef.current?.({ lat: point.lat(), lng: point.lng() });
    });

    return () => {
      listenerRef.current?.remove();
      listenerRef.current = null;
    };
  }, [ready, onPick]);

  /* ---- centre / zoom ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || map === null) return;
    if (fitBounds) {
      fitToContent();
    } else {
      map.setCenter(center);
      map.setZoom(zoom);
    }
  }, [ready, center.lat, center.lng, zoom, fitBounds, fitToContent]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- markers, with the rider tweened ---- */
  useEffect(() => {
    const api = getMapsApi();
    const map = mapRef.current;
    if (!ready || !api || map === null) return;

    const tint = aisleColour();
    const live = new Set<string>();

    for (const marker of markers) {
      live.add(marker.id);
      const fill =
        marker.kind === 'rider' ? (tint ?? MARKER_FALLBACK_FILL.rider) : MARKER_FALLBACK_FILL[marker.kind];
      const existing = markerRefs.current.get(marker.id);

      if (!existing) {
        const created = new api.Marker({
          position: marker.position,
          map,
          title: marker.label ?? KIND_LABEL[marker.kind],
          zIndex: marker.kind === 'rider' ? 30 : marker.kind === 'drop' ? 20 : 10,
          optimized: false,
          icon: {
            url: markerIconUrl(marker.kind, fill),
            scaledSize: new api.Size(28, 36),
            anchor: new api.Point(14, 35),
          },
        });
        markerRefs.current.set(marker.id, created);
        if (marker.kind === 'rider') riderPos.current = marker.position;
        continue;
      }

      existing.setTitle(marker.label ?? KIND_LABEL[marker.kind]);

      if (marker.kind !== 'rider') {
        existing.setPosition(marker.position);
        continue;
      }

      /* the glide */
      const from = riderPos.current;
      if (from === null || samePoint(from, marker.position) || prefersReducedMotion()) {
        existing.setPosition(marker.position);
        riderPos.current = marker.position;
        continue;
      }

      if (riderTween.current) cancelAnimationFrame(riderTween.current.frame);
      const DURATION = 1400;
      const start = performance.now();
      const to = marker.position;

      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        // ease-out: fast off the mark, settling — how a scooter actually moves
        const e = 1 - Math.pow(1 - t, 3);
        const next: LatLng = {
          lat: from.lat + (to.lat - from.lat) * e,
          lng: from.lng + (to.lng - from.lng) * e,
        };
        existing.setPosition(next);
        riderPos.current = next;
        if (t < 1) {
          riderTween.current = { frame: requestAnimationFrame(step), from, to, start };
        } else {
          riderTween.current = null;
          riderPos.current = to;
        }
      };
      riderTween.current = { frame: requestAnimationFrame(step), from, to, start };
    }

    /* drop anything that disappeared */
    for (const [id, instance] of markerRefs.current) {
      if (live.has(id)) continue;
      instance.setMap(null);
      markerRefs.current.delete(id);
    }
  }, [ready, markers]);

  /* ---- polyline ---- */
  useEffect(() => {
    const api = getMapsApi();
    const map = mapRef.current;
    if (!ready || !api || map === null) return;

    const path = [...(polyline ?? [])];
    if (path.length < 2) {
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      return;
    }
    if (polylineRef.current === null) {
      polylineRef.current = new api.Polyline({
        path,
        map,
        // Desaturated ink, never the aisle hue — the route is context, the
        // ribbon is the story.
        strokeColor: '#6d7164',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        clickable: false,
        zIndex: 5,
      });
    } else {
      polylineRef.current.setPath(path);
    }
  }, [ready, polyline]);

  /* ---- teardown ---- */
  useEffect(
    () => () => {
      if (riderTween.current) cancelAnimationFrame(riderTween.current.frame);
      listenerRef.current?.remove();
      polylineRef.current?.setMap(null);
      markerRefs.current.forEach((m) => {
        m.setMap(null);
      });
      markerRefs.current.clear();
      mapRef.current = null;
    },
    [],
  );

  if (!available) {
    return (
      <MapPlaceholder height={cssHeight} reason="no-key" markers={markers} className={className} />
    );
  }
  if (error !== null) {
    return (
      <MapPlaceholder height={cssHeight} reason="error" markers={markers} className={className} />
    );
  }

  return (
    <div
      className={['mnd-map', className].filter(Boolean).join(' ')}
      style={{ height: cssHeight }}
      role="group"
      aria-label={ariaLabel}
    >
      <MapStyles />
      <div ref={hostRef} className="mnd-map__canvas" />
      {!loaded ? (
        <div className="mnd-map__loading" aria-live="polite">
          Loading map…
        </div>
      ) : null}
      {/* The map is a canvas of image tiles. This list is what a screen reader
          actually gets, and it is never empty when the map has content. */}
      <ul className="mnd-map__sr">
        {markers.map((m) => (
          <li key={m.id}>
            {m.label ?? KIND_LABEL[m.kind]}: {m.position.lat.toFixed(4)},{' '}
            {m.position.lng.toFixed(4)}
          </li>
        ))}
      </ul>
      {onPick ? <p className="mnd-map__hint">Tap the map to move the pin</p> : null}
    </div>
  );
}

/* ─────────────────────────────── styles ─────────────────────────────────── */

const MAP_CSS = `
.mnd-map {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--hairline);
  border-radius: var(--r-panel);
  background: var(--sunken);
  color: var(--ink);
  isolation: isolate;
}
.mnd-map__canvas { position: absolute; inset: 0; }
.mnd-map__canvas img { max-width: none; }
.mnd-map__loading,
.mnd-map__hint {
  position: absolute;
  left: var(--s-3);
  bottom: var(--s-3);
  z-index: 2;
  padding: 0.3rem 0.6rem;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  font-family: var(--data);
  font-size: var(--fs-micro);
  color: var(--muted);
}
.mnd-map__sr {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ── placeholder: designed, not a grey box ─────────────────────────────── */
.mnd-map--placeholder {
  display: grid;
  grid-template-rows: 1fr auto;
  background:
    linear-gradient(var(--aisle-wash), var(--aisle-wash)),
    var(--surface);
  min-height: 200px;
}
.mnd-map__ghost {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: var(--hairline-strong);
  opacity: 0.85;
}
.mnd-map__note {
  position: relative;
  z-index: 1;
  align-self: end;
  margin: var(--s-3);
  padding: var(--s-3) var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--aisle);
  border-radius: var(--r-soft);
  box-shadow: var(--lift-1);
}
.mnd-map__note-title {
  font-family: var(--display);
  font-weight: 600;
  font-size: var(--fs-small);
  letter-spacing: -0.01em;
}
.mnd-map__note-body {
  margin-top: 0.15rem;
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--muted);
  max-width: 52ch;
}
.mnd-map__code {
  font-family: var(--data);
  font-size: 0.95em;
  padding: 0.05em 0.3em;
  border-radius: var(--r-nub);
  background: var(--sunken);
  color: var(--ink);
  word-break: break-all;
}
.mnd-map__legend {
  list-style: none;
  margin: var(--s-2) 0 0;
  padding: var(--s-2) 0 0;
  border-top: 1px solid var(--hairline);
  display: grid;
  gap: 0.2rem;
  font-size: var(--fs-micro);
}
.mnd-map__legend li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--s-2);
}
.mnd-map__legend-dot {
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--muted);
}
.mnd-map__legend li[data-kind='rider'] .mnd-map__legend-dot { background: var(--aisle); }
.mnd-map__legend li[data-kind='drop'] .mnd-map__legend-dot {
  border-radius: var(--r-nub);
  background: var(--ink);
}
.mnd-map__legend-coords {
  font-family: var(--data);
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
`;

/**
 * React 19 hoists and de-duplicates a <style> carrying `href` + `precedence`,
 * so two maps on one page contribute one stylesheet. If a renderer ever stops
 * hoisting it, the tag still applies inline — duplicated identical rules are
 * harmless. Either way the primitive needs no stylesheet import, which is what
 * makes it genuinely droppable into the rider panel.
 */
function MapStyles() {
  return (
    <style href="mandi-map" precedence="default">
      {MAP_CSS}
    </style>
  );
}
