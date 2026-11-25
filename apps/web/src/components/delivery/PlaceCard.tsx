'use client';

/**
 * An address, treated as the primary artefact rather than a caption under a
 * map — because today there IS no working map (the Maps key has no billing
 * behind it), and because in the rain the written address is what a rider
 * actually reads.
 *
 * ── WHAT A WAYPOINT ACTUALLY CARRIES ────────────────────────────────────────
 * The API's waypoint is FLAT — `{ label, address, lat, lng }` — and that is
 * all. There is no phone and no delivery note on it. The customer's number
 * lives on the order (`customerPhone`), so the caller passes it in explicitly
 * rather than this component hunting for one that was never sent.
 *
 * Nothing here is decorative: the name, the address, one navigation link and
 * one phone link. Both links are 64px tall and both are SECONDARY — the
 * screen's primary action stays in the bottom dock, alone.
 */

import type { MapMarker } from '@mandi/design-system/map';

import styles from './delivery.module.css';
import { IconNavigate, IconPhone, IconPin, IconStore } from './icons';
import { MapPanel } from './MapPanel';
import { navUrlFor } from '@/lib/delivery/maps';
import { telHref } from '@/lib/delivery/format';
import { pointOf, type Waypoint } from '@/lib/delivery/types';

export function PlaceCard({
  kind,
  place,
  showMap = false,
  phone,
  phoneLabel,
}: {
  kind: 'pickup' | 'drop';
  place: Waypoint;
  /** Only the screen the rider is currently navigating to draws a map slot. */
  showMap?: boolean;
  /** The number to dial. Comes off the ORDER, not off the waypoint. */
  phone?: string | null;
  /** "Call customer" / "Call store". Omitted ⇒ no phone row. */
  phoneLabel?: string;
}) {
  const tel = telHref(phone);
  const isPickup = kind === 'pickup';
  const point = pointOf(place);

  const markers: MapMarker[] =
    point === null
      ? []
      : [
          {
            id: kind,
            position: point,
            kind: isPickup ? 'store' : 'drop',
            label: place.label,
          },
        ];

  return (
    <section className={styles.panel} aria-label={isPickup ? 'Pickup' : 'Drop-off'}>
      <div className={styles.place}>
        <span
          className={`${styles.placeKind} ${
            isPickup ? styles.placeKindPickup : styles.placeKindDrop
          }`}
        >
          {isPickup ? <IconStore size={14} /> : <IconPin size={14} />}
          {isPickup ? ' Pick up from' : ' Deliver to'}
        </span>
        <h2 className={styles.placeLabel}>{place.label}</h2>
        {place.address === '' ? (
          <p className={`${styles.placeAddress} ${styles.placeAddressMissing}`}>
            No address on this order — call before you set off.
          </p>
        ) : (
          <p className={styles.placeAddress}>{place.address}</p>
        )}
      </div>

      {showMap ? (
        <div style={{ marginTop: '0.75rem' }}>
          <MapPanel center={point} markers={markers} />
        </div>
      ) : null}

      <div className={styles.linkRow}>
        {/*
          A plain Google Maps URL. No API key, no billing, no SDK — it opens
          the Maps app the rider already has. See lib/delivery/maps.ts.
        */}
        <a
          className={styles.linkBtn}
          href={navUrlFor(place)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconNavigate size={20} />
          Open in Google Maps
        </a>
        {tel === null || phoneLabel === undefined ? null : (
          <a className={styles.linkBtn} href={tel}>
            <IconPhone size={20} />
            {phoneLabel}
          </a>
        )}
      </div>
    </section>
  );
}
