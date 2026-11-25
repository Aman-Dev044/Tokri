'use client';

/**
 * Stores near you — and the store search, when there is a query.
 *
 * ── LOCATION IS NEVER A WALL ────────────────────────────────────────────────
 * The list loads before a location is chosen. Picking one re-sorts it by
 * distance; refusing the prompt swaps in the PIN-code path. There is no screen
 * in this flow that says "enable location to continue", because that is a dead
 * end dressed as a feature.
 *
 * ── WHAT `q` SEARCHES ────────────────────────────────────────────────────────
 * `GET /stores?q=` matches STORE NAMES (`BrowseStoresQueryDto.q`). Alongside
 * it, `GET /products?q=&lat=&lng=` now searches ITEMS across every store on
 * {APP_NAME} — this view fires both and shows them as two separate sections,
 * because "stores named X" and "products named X" are different questions
 * with different answers.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { APP_NAME } from '@/config/brand';
import {
  useGeolocation,
  locationQuery,
  marketLocationQuery,
  isLocationFiltered,
} from '@/hooks/useGeolocation';
import { useShopQuery } from '@/hooks/useShopQuery';
import {
  readMarketProduct,
  readPaged,
  readStore,
  type MarketProduct,
  type Paged,
  type Store,
} from '@/lib/shop/types';
import { FixtureBanner, ErrorNotice } from './notices';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { StoreCard, StoreCardSkeleton } from './StoreCard';

export function StoresView() {
  const params = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const geo = useGeolocation();
  const [pincode, setPincode] = useState('');

  /* Only parameters `BrowseStoresQueryDto` declares. The API runs
     `forbidNonWhitelisted`, so one extra key here is a 400 for the whole page. */
  const storeParams = useMemo(
    () => ({ ...locationQuery(geo.location), q: query === '' ? undefined : query, limit: 20 }),
    [geo.location, query],
  );

  const stores = useShopQuery<Paged<Store>>('/stores', storeParams, {
    anonymous: true,
    enabled: geo.ready,
    read: useCallback((raw: unknown) => readPaged(raw, readStore), []),
  });

  /* Market-wide item search — `GET /products?q=&lat=&lng=`. Only fired when
     there is a query: an empty `q` here would ask for "every product on
     {APP_NAME}", which is not what an empty search box means.

     `marketLocationQuery`, NOT `locationQuery`: `/products` does not
     whitelist `radius`, so the store-shaped query was a hard 400 here. */
  const productParams = useMemo(
    () => (query === '' ? undefined : { ...marketLocationQuery(geo.location), q: query, limit: 24 }),
    [geo.location, query],
  );
  const products = useShopQuery<Paged<MarketProduct>>(
    query === '' ? null : '/products',
    productParams,
    {
      anonymous: true,
      enabled: geo.ready && query !== '',
      read: useCallback((raw: unknown) => readPaged(raw, readMarketProduct), []),
    },
  );

  const needsLocation = geo.ready && geo.location === null;
  const rows = stores.data?.data ?? [];
  const productRows = products.data?.data ?? [];

  return (
    <div className="shell shop-page">
      <header className="shop-page__head">
        <p className="eyebrow">The market near you</p>
        <h1 className="shop-page__title">
          {query === '' ? 'Stores' : <>Stores matching “{query}”</>}
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
                ? 'No problem — you can still browse every store below and order from any of them. Sharing a position is only what lets us sort them by how far away they are.'
                : 'Share your location and the list is sorted by distance and filtered to the shops that can actually reach you. Neither is required to browse.'}
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
                Remember this PIN
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
          Showing stores near PIN <strong className="mono">{geo.location.pincode}</strong>.{' '}
          <button type="button" className="shop-linkish" onClick={geo.request}>
            Use my location instead
          </button>{' '}
          ·{' '}
          <button type="button" className="shop-linkish" onClick={geo.clear}>
            Clear
          </button>
        </p>
      ) : null}

      {/* ── market-wide product search ──────────────────────────────────── */}
      {query !== '' ? (
        <section className="shop-section" aria-labelledby="shop-products-title">
          <h2 id="shop-products-title" className="shop-section__title tkr-reveal">
            Products matching “{query}”
          </h2>

          {products.isFixture ? <FixtureBanner endpoint="GET /products" /> : null}
          {products.error !== null ? (
            <ErrorNotice error={products.error} onRetry={products.refetch} what="matching products" />
          ) : null}

          {products.loading && !products.hasLoadedOnce ? (
            <div className="tkr-grid">
              {[0, 1, 2, 3].map((i) => (
                <ProductCardSkeleton key={i} index={i} />
              ))}
            </div>
          ) : productRows.length > 0 ? (
            <div className="tkr-grid">
              {productRows.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  store={{
                    vendorId: product.store.id,
                    storeName: product.store.storeName,
                    storeSlug: product.store.slug,
                  }}
                  priority={index < 2}
                />
              ))}
            </div>
          ) : products.error === null ? (
            <p className="shop-empty">
              No product matched “{query}” across any store on {APP_NAME}.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── the stores ───────────────────────────────────────────────────── */}
      <section className="shop-section" aria-labelledby="shop-stores-title">
        <h2 id="shop-stores-title" className="shop-section__title tkr-reveal">
          {isLocationFiltered(geo.location) ? 'Stores that reach you' : `Stores on ${APP_NAME}`}
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
        ) : rows.length > 0 ? (
          <div className="shop-stores">
            {rows.map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        ) : stores.error === null ? (
          <p className="shop-empty">
            {query !== '' ? (
              <>
                No store matched “{query}”. <Link href="/stores">See every store</Link>.
              </>
            ) : isLocationFiltered(geo.location) ? (
              <>
                No store on {APP_NAME} reaches this address yet. We are onboarding vendors daily —{' '}
                <Link href="/#vendors">know a shop that should be here?</Link>
              </>
            ) : (
              <>
                No stores are listed yet. We are onboarding vendors daily —{' '}
                <Link href="/#vendors">know a shop that should be here?</Link>
              </>
            )}
          </p>
        ) : null}
      </section>
    </div>
  );
}
