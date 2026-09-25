'use client';

/**
 * A shop, as a card.
 *
 * Distance, rating and open/closed, each with a word beside the colour. A
 * closed store is still shown — knowing the dairy shuts at nine is information,
 * and hiding it just makes the list change shape every evening for no stated
 * reason. It is simply not presented as "order from here".
 *
 * ── WHAT A STORE ROW ACTUALLY CARRIES ───────────────────────────────────────
 * `GET /stores` returns `StoreRow`: id, slug, storeName, description, logo,
 * banner, city, location, isOpen, rating, serviceRadiusKm, codEnabled and
 * distanceKm. That is all of it.
 *
 * This card used to also render `etaMinutes`, a `productCount` and a strip of
 * aisle chips from `store.aisles`. None of the three exist on a row — the
 * delivery estimate is computed at checkout, the count only appears on
 * `GET /stores/:slug`, and the aisles a store stocks come from
 * `GET /stores/:id/categories`. They have been removed rather than defaulted:
 * a fact with a fabricated value is worse than an absent one. The storefront
 * shows all three, from the endpoints that really return them.
 */

import Link from 'next/link';
import { formatDistance } from '@/lib/shop/format';
import type { Store } from '@/lib/shop/types';

export function StoreCard({ store }: { store: Store }) {
  const distance = formatDistance(store.distanceKm);

  return (
    <article className="shop-store" data-closed={store.isOpen ? undefined : 'true'}>
      <Link href={`/stores/${encodeURIComponent(store.slug)}`} className="shop-store__hit">
        <header className="shop-store__head">
          <h3 className="shop-store__name">{store.storeName}</h3>
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
          {/* A brand-new store has rating 0 and has simply not been rated yet.
              Printing "0.0" reads as a bad shop rather than a new one. */}
          {store.rating > 0 ? (
            <div>
              <dt>Rating</dt>
              <dd className="mono">{store.rating.toFixed(1)}</dd>
            </div>
          ) : null}
          {store.serviceRadiusKm > 0 ? (
            <div>
              <dt>Delivers within</dt>
              <dd className="mono">{store.serviceRadiusKm} km</dd>
            </div>
          ) : null}
        </dl>
      </Link>

      <footer className="shop-store__foot">
        <span className="shop-store__addr">{store.city}</span>
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
