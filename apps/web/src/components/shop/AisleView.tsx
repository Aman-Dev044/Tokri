'use client';

/**
 * The aisle body.
 *
 * Commits the chromatic tint through `AisleProvider` (covering client-side
 * navigation, which the server's inline stamp cannot), then draws the shelf:
 * two-across on mobile, never three, with skeletons cut to the real card's
 * shape so nothing jumps when the data lands.
 *
 * ── WHERE THE PRODUCTS COME FROM, AND WHERE THEY CANNOT ─────────────────────
 * With a basket open at a store, this shows THAT store's shelf for the aisle:
 * `GET /stores/:id/products?aisleKey=` — one vendor per basket (decision #1),
 * so browsing another store's fruit while holding a half-full basket is a trap.
 *
 * With NO basket there is nothing to show. The catalogue API has no
 * market-wide product listing: this view used to call `GET /products?aisle=…`,
 * which answers `404 Cannot GET /api/v1/products` — and the old fixture
 * fallback dressed that 404 up as a shelf full of sample groceries. So the page
 * now says plainly that an aisle is something you walk into inside a shop, and
 * sends you to pick one. No invented endpoint, no sample shelf.
 *   TODO(api): add `GET /products?aisleKey=&lat=&lng=` for a market-wide aisle,
 *   and this branch becomes a real shelf.
 *
 * Note the parameter name: `aisleKey`, not `aisle`. `BrowseProductsQueryDto`
 * whitelists `category`, `aisleKey`, `q`, `page`, `limit` and `sort`, and the
 * API runs `forbidNonWhitelisted` — `?aisle=` was a hard 400.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo } from 'react';
import { getAisle, useAisle, type AisleKey } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { readPaged, readProduct, type Paged, type Product } from '@/lib/shop/types';
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

  const path = store === null ? null : `/stores/${encodeURIComponent(store.vendorId)}/products`;

  const products = useShopQuery<Paged<Product>>(
    path,
    useMemo(() => ({ aisleKey, limit: 24 }), [aisleKey]),
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readPaged(raw, readProduct), []),
    },
  );

  const rows = products.data?.data ?? [];

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
        /* No basket ⇒ no store ⇒ no shelf. Say so, and offer the way in. */
        <section className="shop-section">
          <p className="shop-page__scope" role="status">
            An aisle belongs to a shop. Pick a store and its {aisle.name.toLowerCase()} shelf
            opens here, in this colour.
          </p>
          <p className="shop-cart__cta">
            <Link href="/stores" className="mnd-btn mnd-btn--solid mnd-btn--md">
              Find a store near you
            </Link>
          </p>
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
