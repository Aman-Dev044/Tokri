'use client';

/**
 * Stores near you — and the search results, when there is a query.
 *
 * ── LOCATION IS NEVER A WALL ────────────────────────────────────────────────
 * The list loads before a location is chosen. Picking one re-sorts it by
 * distance; refusing the prompt swaps in the PIN-code path. There is no screen
 * in this flow that says "enable location to continue", because that is a dead
 * end dressed as a feature.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { useGeolocation, locationQuery } from '@/hooks/useGeolocation';
import { useShopQuery } from '@/hooks/useShopQuery';
import { readPaged, readProduct, readStore, type Paged, type Product, type Store } from '@/lib/shop/types';
import { FixtureBanner, ErrorNotice } from './notices';
import { StoreCard, StoreCardSkeleton } from './StoreCard';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

export function StoresView() {
  const params = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const geo = useGeolocation();
  const [pincode, setPincode] = useState('');

  const storeParams = useMemo(
    () => ({ ...locationQuery(geo.location), limit: 20 }),
    [geo.location],
  );

  const stores = useShopQuery<Paged<Store>>('/stores', storeParams, {
    anonymous: true,
    enabled: geo.ready,
    read: useCallback((raw: unknown) => readPaged(raw, readStore), []),
  });

  /* Cross-store search. `GET /products?q=` is a PROPOSED endpoint — plan §6.2
     only specs search scoped to one store (`/stores/:id/products?q=`). Until
     Worker B adds it this falls through to the fixture, clearly labelled.
     TODO(worker-b): GET /products?q=&lat=&lng= for market-wide search. */
  const results = useShopQuery<Paged<Product>>(
    query === '' ? null : '/products',
    useMemo(() => ({ q: query, limit: 12 }), [query]),
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readPaged(raw, readProduct), []),
    },
  );

  const needsLocation = geo.ready && geo.location === null;

  return (
    <div className="shell shop-page">
      <header className="shop-page__head">
        <p className="eyebrow">The market near you</p>
        <h1 className="shop-page__title">
          {query === '' ? 'Stores' : <>Results for “{query}”</>}
        </h1>
        <p className="lede">
          Every shop here is a real vendor with its own stock and its own hours. One store per
          basket, so an order is one pickup and one rider — which is the only way a delivery
          estimate means anything.
        </p>
      </header>

      {/* ── location ─────────────────────────────────────────────────────── */}
      {needsLocation || geo.status === 'denied' || geo.status === 'error' ? (
        <section className="shop-locate" aria-labelledby="shop-locate-title">
          <div>
            <h2 id="shop-locate-title" className="shop-locate__title">
              {geo.status === 'denied'
                ? 'Location is blocked for this site'
                : 'Where should we deliver?'}
            </h2>
            <p className="shop-locate__body">
              {geo.status === 'denied'
                ? 'No problem — a PIN code does the same job. We only ever use it to work out which shops can reach you.'
                : 'Share your location for distances and delivery times, or type a PIN code. Either works; neither is required to browse.'}
            </p>
          </div>

          <div className="shop-locate__actions">
            {geo.status !== 'denied' && geo.status !== 'unsupported' ? (
              <button
                type="button"
                className="mnd-btn mnd-btn--solid mnd-btn--md"
                onClick={geo.request}
                disabled={geo.status === 'locating'}
              >
                {geo.status === 'locating' ? 'Finding you…' : 'Use my location'}
              </button>
            ) : null}

            <form
              className="shop-locate__pin"
              onSubmit={(event) => {
                event.preventDefault();
                geo.setPincode(pincode);
              }}
            >
              <label htmlFor="stores-pincode" className="mnd-visually-hidden">
                PIN code
              </label>
              <input
                id="stores-pincode"
                className="mnd-field__input"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                placeholder="PIN code"
                value={pincode}
                onChange={(event) => {
                  setPincode(event.target.value.replace(/[^0-9]/g, ''));
                }}
              />
              <button type="submit" className="mnd-btn mnd-btn--outline mnd-btn--md">
                Use this PIN
              </button>
            </form>
          </div>

          {geo.error !== null ? (
            <p className="shop-locate__error" role="status">
              {geo.error}
            </p>
          ) : null}
        </section>
      ) : null}

      {geo.location?.source === 'pincode' ? (
        <p className="shop-page__scope" role="status">
          Showing stores for PIN <strong className="mono">{geo.location.pincode}</strong>.{' '}
          <button type="button" className="shop-linkish" onClick={geo.clear}>
            Change
          </button>
        </p>
      ) : null}

      {/* ── search results ───────────────────────────────────────────────── */}
      {query !== '' ? (
        <section className="shop-section" aria-labelledby="shop-results-title">
          <h2 id="shop-results-title" className="shop-section__title">
            Items matching “{query}”
          </h2>

          {results.isFixture ? <FixtureBanner endpoint="GET /products?q=" /> : null}
          {results.error !== null ? (
            <ErrorNotice error={results.error} onRetry={results.refetch} what="the search results" />
          ) : null}

          {results.loading && !results.hasLoadedOnce ? (
            <div className="shop-grid">
              {[0, 1, 2, 3].map((i) => (
                <ProductCardSkeleton key={i} index={i} />
              ))}
            </div>
          ) : results.data !== null && results.data.data.length > 0 ? (
            <div className="shop-grid">
              {results.data.data.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={index < 2} />
              ))}
            </div>
          ) : results.error === null ? (
            <p className="shop-empty">
              Nothing matched “{query}”. Try a shorter word — “atta” finds more than “aashirvaad
              atta 5kg”.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── the stores ───────────────────────────────────────────────────── */}
      <section className="shop-section" aria-labelledby="shop-stores-title">
        <h2 id="shop-stores-title" className="shop-section__title">
          {geo.location !== null ? 'Stores that reach you' : 'Stores on Mandi'}
        </h2>

        {stores.isFixture ? <FixtureBanner endpoint="GET /stores" /> : null}
        {stores.error !== null ? (
          <ErrorNotice error={stores.error} onRetry={stores.refetch} what="the store list" />
        ) : null}

        {stores.loading && !stores.hasLoadedOnce ? (
          <div className="shop-stores">
            {[0, 1, 2].map((i) => (
              <StoreCardSkeleton key={i} index={i} />
            ))}
          </div>
        ) : stores.data !== null && stores.data.data.length > 0 ? (
          <div className="shop-stores">
            {stores.data.data.map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        ) : stores.error === null ? (
          <p className="shop-empty">
            No store on Mandi reaches this address yet. We are onboarding vendors daily —{' '}
            <Link href="/for-vendors">know a shop that should be here?</Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
