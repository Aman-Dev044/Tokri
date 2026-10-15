'use client';

/**
 * The aisle body.
 *
 * Commits the chromatic tint through `AisleProvider` (covering client-side
 * navigation, which the server's inline stamp cannot), then draws the shelf:
 * two-across on mobile, never three, with skeletons cut to the real card's
 * shape so nothing jumps when the data lands.
 *
 * ── WHERE THE PRODUCTS COME FROM ─────────────────────────────────────────────
 * With a basket open at a store, this shows THAT store's shelf for the aisle:
 * `GET /stores/:id/products?aisleKey=` — one vendor per basket (decision #1),
 * so browsing another store's fruit while holding a half-full basket is a trap.
 *
 * With NO basket, the shelf is market-wide instead:
 * `GET /products?aisleKey=&lat=&lng=` — every store's fruit-and-veg on one
 * page, each row carrying which store it belongs to. Adding one starts a
 * basket at that store, same as anywhere else.
 *
 * Note the parameter name: `aisleKey`, not `aisle`. `BrowseProductsQueryDto`
 * whitelists `category`, `aisleKey`, `q`, `page`, `limit` and `sort`, and the
 * API runs `forbidNonWhitelisted` — `?aisle=` was a hard 400.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo } from 'react';
import { getAisle, useAisle, type AisleKey } from '@mandi/design-system';
import { APP_NAME } from '@/config/brand';
import { useGeolocation, marketLocationQuery } from '@/hooks/useGeolocation';
import { useShopQuery } from '@/hooks/useShopQuery';
import {
  readMarketProduct,
  readPaged,
  readProduct,
  type MarketProduct,
  type Paged,
  type Product,
} from '@/lib/shop/types';
import { useBasket } from './BasketProvider';
import { ErrorNotice, FixtureBanner } from './notices';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

export function AisleView({ aisleKey }: { aisleKey: AisleKey }) {
  const aisle = getAisle(aisleKey);
  const { setAisle } = useAisle();
  const { store } = useBasket();

  useEffect(() => {
    setAisle(aisleKey);

    /* Why the microtask.
       Effects flush child-first, so this runs BEFORE `AisleProvider`'s own
       effect — which, on the very first commit, still has `aisle === null` and
       therefore removes the `data-aisle` the server's inline script stamped.
       The state update above fixes it on the next render, but that leaves a
       window in which the page could paint in the default moss green and then
       animate to the aisle hue: the signature move, playing backwards.
       A microtask lands after the whole effect flush and before paint, so the
       attribute is correct for the first frame either way. The later
       state-driven write is identical, so this is idempotent, not a fight. */
    queueMicrotask(() => {
      document.documentElement.setAttribute('data-aisle', aisleKey);
    });

    // Hand the tint back when we leave, so /cart does not inherit a colour it
    // was never given.
    return () => {
      setAisle(null);
    };
  }, [aisleKey, setAisle]);

  const geo = useGeolocation();

  const path = store === null ? null : `/stores/${encodeURIComponent(store.vendorId)}/products`;

  const products = useShopQuery<Paged<Product>>(
    path,
    useMemo(() => ({ aisleKey, limit: 24 }), [aisleKey]),
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readPaged(raw, readProduct), []),
    },
  );

  /* `marketLocationQuery`, not `locationQuery`: `GET /products` does not
     whitelist `radius`, and with `forbidNonWhitelisted` on, sending it was
     a hard 400 for every customer who had ever set a location. */
  const marketParams = useMemo(
    () => ({ aisleKey, ...marketLocationQuery(geo.location), limit: 24 }),
    [aisleKey, geo.location],
  );
  const marketProducts = useShopQuery<Paged<MarketProduct>>(
    store === null ? '/products' : null,
    marketParams,
    {
      anonymous: true,
      enabled: store === null && geo.ready,
      read: useCallback((raw: unknown) => readPaged(raw, readMarketProduct), []),
    },
  );

  const rows = products.data?.data ?? [];
  const marketRows = marketProducts.data?.data ?? [];

  return (
    <div className="shell shop-page">
      {/* PILLAR 1 — the chromatic band. The largest colour area on the page,
          deliberately, because that is what makes the aisle tint land as an
          event rather than a detail. */}
      <header className="shop-band">
        <p className="eyebrow">Aisle</p>
        <h1 className="shop-band__title">
          {aisle.name}
          <span className="shop-band__hindi" aria-hidden="true">
            {aisle.hindi}
          </span>
        </h1>
        <p className="lede">{aisle.blurb}</p>
        <p className="shop-band__hue">
          <span className="shop-band__chip" aria-hidden="true" />
          The colour of this aisle is taken from {aisle.source}. Everything on screen — the
          buttons, the rules, the basket — is wearing it right now.
        </p>
      </header>

      {store === null ? (
        /* No basket ⇒ market-wide: every store's shelf for this aisle. */
        <section className="shop-section">
          <p className="shop-page__scope" role="status">
            Every store on {APP_NAME}&rsquo;s {aisle.name.toLowerCase()} shelf, in
            one place. Add something and its store becomes your basket.
          </p>

          {marketProducts.isFixture ? (
            <FixtureBanner endpoint={`GET /products?aisleKey=${aisleKey}`} />
          ) : null}
          {marketProducts.error !== null ? (
            <ErrorNotice error={marketProducts.error} onRetry={marketProducts.refetch} what="this aisle" />
          ) : null}

          {marketProducts.loading && !marketProducts.hasLoadedOnce ? (
            <div className="tkr-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <ProductCardSkeleton key={i} index={i} />
              ))}
            </div>
          ) : marketRows.length > 0 ? (
            <div className="tkr-grid">
              {marketRows.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  store={{
                    vendorId: product.store.id,
                    storeName: product.store.storeName,
                    storeSlug: product.store.slug,
                  }}
                  aisleKey={aisleKey}
                  priority={index < 2}
                />
              ))}
            </div>
          ) : marketProducts.error === null ? (
            <p className="shop-empty">
              Nobody on {APP_NAME} stocks {aisle.name.toLowerCase()} yet.{' '}
              <Link href="/stores">Browse every store</Link>.
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <p className="shop-page__scope" role="status">
            Showing <strong>{store.storeName}</strong> only — one store per basket keeps your
            order to one pickup.{' '}
            <Link href="/stores" className="shop-linkish">
              Browse other stores
            </Link>
          </p>

          {products.isFixture && path !== null ? (
            <FixtureBanner endpoint={`GET ${path}?aisleKey=${aisleKey}`} />
          ) : null}
          {products.error !== null ? (
            <ErrorNotice error={products.error} onRetry={products.refetch} what="this aisle" />
          ) : null}

          {products.loading && !products.hasLoadedOnce ? (
            <div className="tkr-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <ProductCardSkeleton key={i} index={i} />
              ))}
            </div>
          ) : rows.length > 0 ? (
            <div className="tkr-grid">
              {rows.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  store={store}
                  aisleKey={aisleKey}
                  priority={index < 2}
                />
              ))}
            </div>
          ) : products.error === null ? (
            <p className="shop-empty">
              {store.storeName} does not stock {aisle.name.toLowerCase()} yet.{' '}
              <Link href={store.storeSlug === null ? '/stores' : `/stores/${store.storeSlug}`}>
                See everything they do stock
              </Link>
              .
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
