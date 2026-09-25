'use client';

/**
 * An address, treated as the primary artefact rather than a caption under a
 * map — because today there IS no map (no browser Maps key), and because in
 * the rain the written address is what a rider actually reads.
 *
 * Nothing here is decorative: the name, the address, the note the customer
 * left, one navigation link and one phone link. Both links are 64px tall and
 * both are SECONDARY — the screen's primary action stays in the bottom dock,
 * alone (plan §2.4).
 */

import styles from './delivery.module.css';
import { IconNavigate, IconPhone, IconPin, IconStore } from './icons';
import { MapPanel } from './MapPanel';
import { navUrlFor } from '@/lib/delivery/maps';
import { telHref } from '@/lib/delivery/format';
import type { Place } from '@/lib/delivery/types';

export function PlaceCard({
  kind,
  place,
  showMap = false,
  phoneLabel,
}: {
  kind: 'pickup' | 'drop';
  place: Place;
  /** Only the screen the rider is currently navigating to draws a map slot. */
  showMap?: boolean;
  /** "Call customer" / "Call store". Omitted ⇒ no phone row. */
  phoneLabel?: string;
}) {
  const tel = telHref(place.phone);
  const isPickup = kind === 'pickup';

  return (
    <section className={styles.panel} aria-label={isPickup ? 'Pickup' : 'Drop-off'}>
      <div className={styles.place}>
        <span className={styles.placeKind}>
          {isPickup ? <IconStore size={14} /> : <IconPin size={14} />}
          {isPickup ? ' Pick up from' : ' Deliver to'}
        </span>
        <h2 className={styles.placeLabel}>{place.label}</h2>
        {place.address === '' ? (
          <p className={styles.placeAddress}>
            No address on this order — call before you set off.
          </p>
        ) : (
          <p className={styles.placeAddress}>{place.address}</p>
        )}
        {place.note === undefined ? null : (
          <p className={styles.placeNote}>Note: {place.note}</p>
        )}
      </div>

      {showMap ? (
        <div style={{ marginTop: '0.75rem' }}>
          <MapPanel
            center={place.point}
            markers={
              place.point === null
                ? []
                : [
                    {
                      id: kind,
                      position: place.point,
                      kind: isPickup ? 'store' : 'drop',
                      label: place.label,
                    },
                  ]
            }
          />
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
