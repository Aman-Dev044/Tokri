'use client';

/**
 * A shop, as a card.
 *
 * Distance, ETA and open/closed, each with a word beside the colour. A closed
 * store is still shown — knowing the dairy shuts at nine is information, and
 * hiding it just makes the list change shape every evening for no stated
 * reason. It is simply not linked to as "order from here".
 */

import Link from 'next/link';
import { getAisle } from '@mandi/design-system';
import { formatDistance, formatEta } from '@/lib/shop/format';
import type { Store } from '@/lib/shop/types';

export function StoreCard({ store }: { store: Store }) {
  const distance = formatDistance(store.distanceKm);
  const eta = formatEta(store.etaMinutes);

  return (
    <article className="shop-store" data-closed={store.isOpen ? undefined : 'true'}>
      <Link href={`/stores/${encodeURIComponent(store.slug)}`} className="shop-store__hit">
        <header className="shop-store__head">
          <h3 className="shop-store__name">{store.name}</h3>
          <span className="shop-store__state" data-open={store.isOpen ? 'true' : 'false'}>
            <span className="shop-store__dot" aria-hidden="true" />
            {store.isOpen ? 'Open now' : 'Closed'}
          </span>
        </header>

        {store.description !== null ? (
          <p className="shop-store__blurb">{store.description}</p>
        ) : null}

        <dl className="shop-store__facts">
          {distance !== null ? (
            <div>
              <dt>Distance</dt>
              <dd className="mono">{distance}</dd>
            </div>
          ) : null}
          {eta !== null ? (
            <div>
              <dt>Typical delivery</dt>
              <dd className="mono">{eta}</dd>
            </div>
          ) : null}
          {store.rating !== null ? (
            <div>
              <dt>Rating</dt>
              <dd className="mono">{store.rating.toFixed(1)}</dd>
            </div>
          ) : null}
          {store.productCount !== null ? (
            <div>
              <dt>Listed</dt>
              <dd className="mono">{store.productCount}</dd>
            </div>
          ) : null}
        </dl>
      </Link>

      {store.aisles.length > 0 ? (
        <ul className="shop-store__aisles">
          {store.aisles.map((key) => {
            const aisle = getAisle(key);
            return (
              <li key={key}>
                <Link href={`/aisle/${key}`} className="shop-store__aisle">
                  <span
                    className="shop-store__swatch"
                    style={{ background: aisle.swatch }}
                    aria-hidden="true"
                  />
                  {aisle.name}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer className="shop-store__foot">
        <span className="shop-store__addr">
          {[store.address.line1, store.address.city, store.address.pincode]
            .filter((part) => part !== '')
            .join(' · ')}
        </span>
        {store.codEnabled ? <span className="shop-store__cod">Cash on delivery</span> : null}
      </footer>
    </article>
  );
}

export function StoreCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <article className="shop-store shop-store--skeleton" aria-hidden="true" style={{ ['--i' as string]: String(index) }}>
      <span className="shop-skel shop-skel--line" style={{ width: '58%', height: '1.6rem' }} />
      <span className="shop-skel shop-skel--line shop-skel--small" style={{ width: '88%' }} />
      <span className="shop-skel shop-skel--line shop-skel--small" style={{ width: '64%' }} />
      <span className="shop-skel shop-skel--block" />
    </article>
  );
}
