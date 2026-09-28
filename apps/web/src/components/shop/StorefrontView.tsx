'use client';

/**
 * One store, its aisles, its shelves.
 *
 * Picking an aisle tab here tints the interface exactly as the `/aisle/[key]`
 * route does — the chromatic system is a property of where you are standing,
 * not of which URL you took to get there.
 *
 * ── THREE ENDPOINTS, EACH FOR WHAT IT ACTUALLY RETURNS ──────────────────────
 *   GET /stores/:slug            → StoreDetail: address, hours, delivery fee,
 *                                  free-delivery threshold, productCount
 *   GET /stores/:id/categories   → AisleGroup[]: which of the eight aisles this
 *                                  store really stocks. The tabs come from
 *                                  here. They used to come from `store.aisles`,
 *                                  a field the API has never returned, so the
 *                                  fallback showed all eight and half of them
 *                                  led to an empty shelf.
 *   GET /stores/:id/products     → ProductRow[]. The aisle filter is
 *                                  `?aisleKey=`, NOT `?aisle=` — the API runs
 *                                  `forbidNonWhitelisted`, so `?aisle=fruits`
 *                                  was a flat 400 and every tab press blanked
 *                                  the shelf.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAisle, useAisle, type AisleKey } from '@mandi/design-system';
import { APP_NAME } from '@/config/brand';
import { useShopQuery } from '@/hooks/useShopQuery';
import { formatDistance } from '@/lib/shop/format';
import {
  readAisleGroups,
  readPaged,
  readProduct,
  readStoreDetail,
  type AisleGroup,
  type Paged,
  type Product,
  type StoreDetail,
} from '@/lib/shop/types';
import type { BasketStore } from './BasketProvider';
import { ErrorNotice, FixtureBanner } from './notices';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

export function StorefrontView({ slug }: { slug: string }) {
  const { setAisle } = useAisle();
  const [aisleKey, setAisleKey] = useState<AisleKey | null>(null);

  const store = useShopQuery<StoreDetail | null>(
    `/stores/${encodeURIComponent(slug)}`,
    undefined,
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readStoreDetail(raw), []),
    },
  );

  const vendorId = store.data?.id ?? null;

  const categories = useShopQuery<AisleGroup[]>(
    vendorId === null ? null : `/stores/${encodeURIComponent(vendorId)}/categories`,
    undefined,
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readAisleGroups(raw), []),
    },
  );

  const products = useShopQuery<Paged<Product>>(
    vendorId === null ? null : `/stores/${encodeURIComponent(vendorId)}/products`,
    useMemo(() => ({ aisleKey: aisleKey ?? undefined, limit: 24 }), [aisleKey]),
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

  if (store.loading && !store.hasLoadedOnce) {
    return (
      <div className="shell shop-page">
        <span className="shop-skel shop-skel--line" style={{ width: '40%', height: '2.4rem' }} />
        <div className="tkr-grid">
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

  const shop = store.data;
  if (shop === null) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Store not found</h1>
        <p className="lede">
          That shop is not on {APP_NAME}, or its listing was taken down.{' '}
          <Link href="/stores">See the stores near you</Link>.
        </p>
      </div>
    );
  }

  /* The basket needs a vendor and a name; a product row does not carry one. */
  const basketStore: BasketStore = {
    vendorId: shop.id,
    storeName: shop.storeName,
    storeSlug: shop.slug,
  };

  const distance = formatDistance(shop.distanceKm);
  const stocked = categories.data ?? [];
  const productRows = products.data?.data ?? [];

  return (
    <div className="shell shop-page">
      {store.isFixture ? <FixtureBanner endpoint={`GET /stores/${slug}`} /> : null}

      <header className="shop-page__head">
        <p className="eyebrow">
          <Link href="/stores">Stores</Link> · {shop.address.city || shop.city || 'Nearby'}
        </p>
        <h1 className="shop-page__title">{shop.storeName}</h1>
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
          <div>
            <dt>Delivers within</dt>
            <dd className="mono">{shop.serviceRadiusKm} km</dd>
          </div>
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
      {stocked.length > 0 ? (
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
          {stocked.map((group) => {
            const aisle = getAisle(group.aisleKey);
            return (
              <button
                key={group.aisleKey}
                type="button"
                className="shop-tab"
                data-active={aisleKey === group.aisleKey ? 'true' : undefined}
                onClick={() => {
                  setAisleKey(group.aisleKey);
                }}
              >
                <span className="shop-tab__swatch" data-key={aisle.key} aria-hidden="true" />
                {aisle.name}
                <span className="mono"> {group.productCount}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {products.isFixture ? (
        <FixtureBanner endpoint={`GET /stores/${vendorId ?? slug}/products`} />
      ) : null}
      {products.error !== null ? (
        <ErrorNotice error={products.error} onRetry={products.refetch} what="this store's shelves" />
      ) : null}

      {products.loading && !products.hasLoadedOnce ? (
        <div className="tkr-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ProductCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : productRows.length > 0 ? (
        <div className="tkr-grid">
          {productRows.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              store={basketStore}
              aisleKey={aisleKey}
              priority={index < 2}
            />
          ))}
        </div>
      ) : products.error === null ? (
        /* An empty catalogue is the normal state for a store that has just been
           approved. It is not an error and must not read like one. */
        <p className="shop-empty">
          {aisleKey !== null ? (
            <>
              Nothing listed in {getAisle(aisleKey).name.toLowerCase()} yet.{' '}
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
            </>
          ) : (
            <>
              {shop.storeName} has not listed any products yet. The shop is on {APP_NAME} and
              approved — the shelves are simply still being filled.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
