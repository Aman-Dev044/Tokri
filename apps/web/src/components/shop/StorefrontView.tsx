'use client';

/**
 * One store, its aisles, its shelves.
 *
 * Picking an aisle tab here tints the interface exactly as the `/aisle/[key]`
 * route does — the chromatic system is a property of where you are standing,
 * not of which URL you took to get there.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AISLES, getAisle, useAisle, type AisleKey } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { formatDistance, formatEta } from '@/lib/shop/format';
import { readPaged, readProduct, readStore, type Paged, type Product, type Store } from '@/lib/shop/types';
import { ErrorNotice, FixtureBanner } from './notices';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

export function StorefrontView({ slug }: { slug: string }) {
  const { setAisle } = useAisle();
  const [aisleKey, setAisleKey] = useState<AisleKey | null>(null);

  const store = useShopQuery<Store | null>(
    `/stores/${encodeURIComponent(slug)}`,
    undefined,
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readStore(raw), []),
    },
  );

  const vendorId = store.data?.id ?? null;

  const products = useShopQuery<Paged<Product>>(
    vendorId === null ? null : `/stores/${encodeURIComponent(vendorId)}/products`,
    useMemo(() => ({ aisle: aisleKey ?? undefined, limit: 24 }), [aisleKey]),
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readPaged(raw, readProduct), []),
    },
  );

  /* Commit the tint for the chosen aisle, and hand it back on the way out so
     the next screen does not inherit a colour it never asked for. */
  useEffect(() => {
    setAisle(aisleKey);
    return () => {
      setAisle(null);
    };
  }, [aisleKey, setAisle]);

  const available: readonly AisleKey[] =
    store.data !== null && store.data.aisles.length > 0
      ? store.data.aisles
      : AISLES.map((a) => a.key);

  if (store.loading && !store.hasLoadedOnce) {
    return (
      <div className="shell shop-page">
        <span className="shop-skel shop-skel--line" style={{ width: '40%', height: '2.4rem' }} />
        <div className="shop-grid">
          {[0, 1, 2, 3].map((i) => (
            <ProductCardSkeleton key={i} index={i} />
          ))}
        </div>
      </div>
    );
  }

  if (store.error !== null) {
    return (
      <div className="shell shop-page">
        <ErrorNotice error={store.error} onRetry={store.refetch} what="this store" />
        <p className="shop-empty">
          <Link href="/stores">Back to all stores</Link>
        </p>
      </div>
    );
  }

  if (store.data === null) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Store not found</h1>
        <p className="lede">
          That shop is not on Mandi, or its listing was taken down.{' '}
          <Link href="/stores">See the stores near you</Link>.
        </p>
      </div>
    );
  }

  const shop = store.data;
  const distance = formatDistance(shop.distanceKm);
  const eta = formatEta(shop.etaMinutes);

  return (
    <div className="shell shop-page">
      {store.isFixture ? <FixtureBanner endpoint={`GET /stores/${slug}`} /> : null}

      <header className="shop-front__head">
        <p className="eyebrow">
          <Link href="/stores">Stores</Link> · {shop.address.city || 'Mandi'}
        </p>
        <h1 className="shop-page__title">{shop.name}</h1>
        {shop.description !== null ? <p className="lede">{shop.description}</p> : null}

        <dl className="shop-front__facts">
          <div>
            <dt>Status</dt>
            <dd data-open={shop.isOpen ? 'true' : 'false'}>
              <span className="shop-store__dot" aria-hidden="true" />
              {shop.isOpen ? 'Open now' : 'Closed right now'}
            </dd>
          </div>
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
          <div>
            <dt>Payment</dt>
            <dd>{shop.codEnabled ? 'Card, UPI or cash' : 'Card or UPI'}</dd>
          </div>
        </dl>

        {!shop.isOpen ? (
          <p className="shop-notice shop-notice--warn" role="status">
            This store is closed at the moment. You can still look around; orders will be
            declined until it opens.
          </p>
        ) : null}
      </header>

      {/* ── aisle tabs — the tint follows the tab ────────────────────────── */}
      <nav className="shop-tabs scroll-x" aria-label="Aisles in this store">
        <button
          type="button"
          className="shop-tab"
          data-active={aisleKey === null ? 'true' : undefined}
          onClick={() => {
            setAisleKey(null);
          }}
        >
          Everything
        </button>
        {available.map((key) => {
          const aisle = getAisle(key);
          return (
            <button
              key={key}
              type="button"
              className="shop-tab"
              data-active={aisleKey === key ? 'true' : undefined}
              onClick={() => {
                setAisleKey(key);
              }}
            >
              <span className="shop-tab__swatch" style={{ background: aisle.swatch }} aria-hidden="true" />
              {aisle.name}
            </button>
          );
        })}
      </nav>

      {products.isFixture ? (
        <FixtureBanner endpoint={`GET /stores/${vendorId ?? slug}/products`} />
      ) : null}
      {products.error !== null ? (
        <ErrorNotice error={products.error} onRetry={products.refetch} what="this store's shelves" />
      ) : null}

      {products.loading && !products.hasLoadedOnce ? (
        <div className="shop-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ProductCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : products.data !== null && products.data.data.length > 0 ? (
        <div className="shop-grid">
          {products.data.data.map((product, index) => (
            <ProductCard key={product.id} product={product} aisleKey={aisleKey} priority={index < 2} />
          ))}
        </div>
      ) : products.error === null ? (
        <p className="shop-empty">
          Nothing listed in this aisle yet.{' '}
          <button
            type="button"
            className="shop-linkish"
            onClick={() => {
              setAisleKey(null);
            }}
          >
            See everything this store stocks
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
