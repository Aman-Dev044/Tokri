'use client';

/**
 * Live tracking — the rider and the customer on one map.
 *
 * This is the Ola/Uber view, adapted to the one fact that shapes every map on
 * this surface: THERE IS NO WORKING MAP HERE. `NEXT_PUBLIC_MAPS_BROWSER_KEY`
 * has a value but billing is off on that Google Cloud project, so the Maps JS
 * API answers `REQUEST_DENIED` and no tile will ever draw.
 *
 * So the map is the enhancement and the READOUT is the design:
 *
 *   distance left + ETA, large and mono   ← the two numbers that matter
 *   both addresses, in full                ← what the rider actually reads
 *   the rider's own last fix, with its AGE ← honest about staleness
 *   "Open in Google Maps"                  ← a plain URL, no key, no billing
 *   the map slot, held open                ← so nothing jumps if billing lands
 *
 * `MapPanel` already detects the auth failure and falls through to its
 * placeholder; that path is deliberately left intact and is the path this
 * build actually takes. When a key with billing does arrive, the same markers
 * render over real tiles and nothing else changes.
 *
 * ── THE RIDER MARKER IS ONLY AS LIVE AS THE LAST PING ───────────────────────
 * `rider.at` is when the fix left the handset. A browser PWA cannot guarantee
 * a background position, so a dot drawn as "now" over a fix from four minutes
 * ago is a lie the customer's ETA is then built on. The age is printed beside
 * it, always.
 *
 * ── WHY `remainingKm` IS NOT THE PAYOUT DISTANCE ────────────────────────────
 * The payout is derived from pickup → drop and must stay that way so the offer
 * and the statement agree. What this screen shows is what is LEFT: rider →
 * pickup → drop before collection, rider → drop after it. They are different
 * numbers, and showing the payout distance to a rider at the door would say
 * "2.4 km" to somebody standing on the step.
 */

import { useEffect, useState } from 'react';

import type { MapMarker } from '@mandi/design-system/map';

import styles from './delivery.module.css';
import { MapPanel } from './MapPanel';
import { IconNavigate, IconPin, IconStore } from './icons';
import { ApiError } from '@/lib/api-client';
import { fetchTracking } from '@/lib/delivery/wallet-api';
import { ago, distanceKm, etaMinutes } from '@/lib/delivery/format';
import { navUrlFor } from '@/lib/delivery/maps';
import { pointOf, type DeliveryTracking } from '@/lib/delivery/types';
import { useTicker } from '@/lib/delivery/tracking';

/**
 * A slow refresh, and only a backstop.
 *
 * The rider's own position is already being posted by `useLocationTracking`
 * every few seconds, and `delivery.location_updated` moves the customer's
 * marker over the socket. This re-read exists for the case where the socket is
 * down; polling it fast would be a second, worse copy of a stream that already
 * exists.
 */
const REFRESH_MS = 30_000;

export function TrackingPanel({ orderId }: { orderId: string }) {
  const [tracking, setTracking] = useState<DeliveryTracking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useTicker(true);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    const read = async (): Promise<void> => {
      try {
        const next = await fetchTracking(orderId, controller.signal);
        if (live && next !== null) {
          setTracking(next);
          setProblem(null);
        }
      } catch (cause) {
        if (!live) return;
        // A 404 here means the order is no longer this rider's — the job
        // screen above will already be moving on, so this panel simply goes
        // quiet rather than shouting over it.
        if (cause instanceof ApiError && cause.status === 404) return;
        setProblem('Live position is not updating right now.');
      }
    };

    void read();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read();
    }, REFRESH_MS);

    return () => {
      live = false;
      controller.abort();
      window.clearInterval(id);
    };
  }, [orderId]);

  if (tracking === null) return null;

  const riderPoint =
    tracking.rider === null
      ? null
      : { lat: tracking.rider.lat, lng: tracking.rider.lng };
  const pickupPoint = pointOf(tracking.pickup);
  const dropPoint = pointOf(tracking.drop);

  /*
    Three markers, and only the ones that genuinely have coordinates. A
    half-pair is refused by `pointOf`, so a drop with a latitude and a null
    longitude is left off the map rather than pinned in the Gulf of Guinea.
  */
  const markers: MapMarker[] = [];
  if (pickupPoint !== null) {
    markers.push({
      id: 'pickup',
      position: pickupPoint,
      kind: 'store',
      label: tracking.pickup.label,
    });
  }
  if (dropPoint !== null) {
    markers.push({
      id: 'drop',
      position: dropPoint,
      kind: 'drop',
      label: tracking.drop.label,
    });
  }
  if (riderPoint !== null) {
    markers.push({
      id: 'rider',
      position: riderPoint,
      kind: 'rider',
      label: 'You',
    });
  }

  // Centre on the rider when we know where they are; otherwise on wherever
  // they are heading. Centring on a null point renders the placeholder.
  const center = riderPoint ?? dropPoint ?? pickupPoint;

  const fixAgeMs =
    tracking.rider === null ? null : now - new Date(tracking.rider.at).getTime();

  return (
    <section className={styles.panel} aria-label="Live tracking">
      <div className={styles.feeHead}>
        <IconNavigate size={20} />
        <h2 className={styles.h2}>Live tracking</h2>
      </div>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <div className={styles.factValue}>{distanceKm(tracking.remainingKm)}</div>
          <div className={styles.factLabel}>Left to ride</div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factValue}>{etaMinutes(tracking.etaMinutes)}</div>
          <div className={styles.factLabel}>Minutes</div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factValue}>{String(tracking.itemCount)}</div>
          <div className={styles.factLabel}>Items</div>
        </div>
      </div>

      <MapPanel
        center={center}
        markers={markers}
        height={220}
        placeholderText={
          'No map on this build — both addresses are below, and "Open in ' +
          'Google Maps" hands navigation to the app on your phone.'
        }
      />

      {/* The two ends, always readable whether or not a tile ever loads. */}
      <ul className={styles.trackLegend}>
        <li className={styles.trackLegendRow}>
          <IconStore size={16} />
          <div>
            <div className={styles.rowTitle}>{tracking.pickup.label}</div>
            <div className={styles.rowMeta}>
              {tracking.pickup.address === ''
                ? 'No address on this order'
                : tracking.pickup.address}
            </div>
          </div>
          <a
            className={styles.linkBtn}
            href={navUrlFor(tracking.pickup)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconNavigate size={18} />
          </a>
        </li>
        <li className={styles.trackLegendRow}>
          <IconPin size={16} />
          <div>
            <div className={styles.rowTitle}>
              {tracking.customerName ?? tracking.drop.label}
            </div>
            <div className={styles.rowMeta}>
              {tracking.drop.address === ''
                ? 'No address on this order'
                : tracking.drop.address}
            </div>
          </div>
          <a
            className={styles.linkBtn}
            href={navUrlFor(tracking.drop)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconNavigate size={18} />
          </a>
        </li>
      </ul>

      {/* Honest about the age of the fix the customer's map is built on. */}
      <p className={styles.lede}>
        {tracking.rider === null || fixAgeMs === null
          ? 'Your position has not been shared yet. It starts once the order is out for delivery.'
          : `Your position was last shared ${ago(now - fixAgeMs, now)}.`}
      </p>

      {problem === null ? null : <p className={styles.lede}>{problem}</p>}
    </section>
  );
}
