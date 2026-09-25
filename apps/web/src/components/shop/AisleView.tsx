'use client';

/**
 * The aisle body.
 *
 * Commits the chromatic tint through `AisleProvider` (covering client-side
 * navigation, which the server's inline stamp cannot), then draws the shelf:
 * two-across on mobile, never three, with skeletons cut to the real card's
 * shape so nothing jumps when the data lands.
 *
 * ── WHERE THE PRODUCTS COME FROM ────────────────────────────────────────────
 * If there is a basket open at a store, the aisle shows THAT store's shelf —
 * one vendor per basket (plan decision #1), so browsing another store's fruit
 * while holding a half-full basket is a trap. With no basket, it asks for a
 * market-wide aisle listing.
 *   TODO(worker-b): GET /products?aisle=&lat=&lng= — plan §6.2 currently only
 *   specs product listing scoped to one store. Until it exists this path falls
 *   through to the labelled fixture.
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

  const scopedToStore = store !== null;
  const path = scopedToStore
    ? `/stores/${encodeURIComponent(store.vendorId)}/products`
    : '/products';

  const products = useShopQuery<Paged<Product>>(
    path,
    useMemo(() => ({ aisle: aisleKey, limit: 24 }), [aisleKey]),
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readPaged(raw, readProduct), []),
    },
  );

  return (
    <div className="shell shop-page shop-aisle">
      <header className="shop-aisle__head">
        <p className="eyebrow">Aisle</p>
        <h1 className="shop-aisle__title">
          {aisle.name}
          <span className="shop-aisle__hindi" aria-hidden="true">
            {aisle.hindi}
          </span>
        </h1>
        <p className="lede">{aisle.blurb}</p>
        <p className="shop-aisle__hue">
          The colour of this aisle is taken from {aisle.source}. Everything on screen — the
          buttons, the rules, the basket — is wearing it right now.
        </p>
      </header>

      {scopedToStore ? (
        <p className="shop-page__scope" role="status">
          Showing <strong>{store.storeName}</strong> only — one store per basket keeps your order
          to one pickup.{' '}
          <Link href="/stores" className="shop-linkish">
            Browse other stores
          </Link>
        </p>
      ) : null}

      {products.isFixture ? (
        <FixtureBanner endpoint={`GET ${path}?aisle=${aisleKey}`} />
      ) : null}
      {products.error !== null ? (
        <ErrorNotice error={products.error} onRetry={products.refetch} what="this aisle" />
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
          No {aisle.name.toLowerCase()} listed near you yet.{' '}
          <Link href="/stores">See which stores reach you</Link>.
        </p>
      ) : null}
    </div>
  );
}
