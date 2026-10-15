'use client';

/**
 * ★ /shop — THE CUSTOMER HOME.
 *
 * After login a customer used to land on `/stores`: a list of SHOPS. That asks
 * someone who wants milk to first choose a merchant, which is a question they
 * have no way to answer and no reason to care about. Every app this one
 * competes with opens on PRODUCTS across every category and treats the store
 * as an implementation detail of the item. This page is that.
 *
 * `/stores` is not deleted and is still linked from here — it is the right
 * screen when you actually want to browse one kirana — it is just no longer
 * where a login lands (`HOME_FOR_ROLE.customer` in `AuthProvider`).
 *
 * ── WHERE THE PRODUCTS COME FROM ────────────────────────────────────────────
 * `GET /products?q=&aisleKey=&lat=&lng=&pincode=&page=&limit=` — market-wide,
 * every APPROVED and OPEN vendor, each row carrying its own `store`. That is
 * what lets one grid mix vendors: adding an item starts (or switches) the
 * basket at ITS store, which `BasketProvider` already handles.
 *
 * Note `marketLocationQuery`, NOT `locationQuery`. `GET /stores` whitelists
 * `radius`; `GET /products` does not, and the API runs `forbidNonWhitelisted`,
 * so the store-shaped query was a hard 400 here.
 *
 * ── STATE LIVES IN THE URL ──────────────────────────────────────────────────
 * The aisle and the search term are `?aisleKey=` and `?q=`, not `useState`.
 * A category you cannot link to, cannot come back to with the back button and
 * cannot send to someone else is a filter that only half exists.
 *
 * ── AN EMPTY AISLE IS A REAL ANSWER ─────────────────────────────────────────
 * `electronics` exists as an aisle and as a category and has NO products in
 * it, deliberately — the demo catalogue was wiped and inventing rows would put
 * fake products back in front of the user. So "nothing listed here yet" is a
 * first-class state on this page, phrased as a fact about the catalogue rather
 * than as a failure of the search.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AISLES, getAisle, isAisleKey, type AisleKey } from '@mandi/design-system';
import { APP_NAME } from '@/config/brand';
import { useGeolocation, marketLocationQuery } from '@/hooks/useGeolocation';
import { useShopQuery } from '@/hooks/useShopQuery';
import {
  readMarketProduct,
  readPaged,
  readPincodeRefusal,
  type MarketProduct,
  type Paged,
} from '@/lib/shop/types';
import { ErrorNotice, FixtureBanner } from './notices';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

/** One screenful. Deep paging on a catalogue browse is a scroll, not a page. */
const PAGE_SIZE = 24;

export function ShopView() {
  const router = useRouter();
  const params = useSearchParams();
  const geo = useGeolocation();

  const rawAisle = params.get('aisleKey');
  const aisleKey: AisleKey | null =
    rawAisle !== null && isAisleKey(rawAisle) ? rawAisle : null;
  const query = (params.get('q') ?? '').trim();

  /* `page` is local, not in the URL: it only ever grows (this is a "show
     more" button, not a pager), so putting it in history would make Back
     walk the customer up through their own scroll position one step at a
     time instead of out of the page. */
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [aisleKey, query, geo.location]);

  const productParams = useMemo(
    () => ({
      aisleKey: aisleKey ?? undefined,
      q: query === '' ? undefined : query,
      ...marketLocationQuery(geo.location),
      limit: PAGE_SIZE * page,
    }),
    [aisleKey, query, geo.location, page],
  );

  const products = useShopQuery<Paged<MarketProduct>>('/products', productParams, {
    anonymous: true,
    // Waiting for `geo.ready` avoids firing once without the stored
    // location and again with it — two requests and a visible reshuffle.
    enabled: geo.ready,
    read: useCallback((raw: unknown) => readPaged(raw, readMarketProduct), []),
  });

  const rows = products.data?.data ?? [];
  const meta = products.data?.meta ?? null;
  const hasMore = meta !== null && rows.length < meta.total;

  /* A PIN the API cannot resolve is a 400 that CARRIES the serviceable list
     (see `readPincodeRefusal`). It is the one error on this page with a
     concrete fix, so it gets its own panel rather than the generic notice. */
  const refusal = products.error === null ? null : readPincodeRefusal(products.error.problem);

  const setParam = useCallback(
    (key: 'aisleKey' | 'q', value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      const search = next.toString();
      router.replace(search === '' ? '/shop' : `/shop?${search}`, { scroll: false });
    },
    [params, router],
  );

  const aisle = aisleKey === null ? null : getAisle(aisleKey);

  return (
    <div className="shell shop-page">
      <header className="shop-page__head">
        <p className="eyebrow">Shop</p>
        <h1 className="shop-page__title">
          {query !== ''
            ? `“${query}”`
            : aisle !== null
              ? aisle.name
              : `Everything on ${APP_NAME}`}
        </h1>
        <p className="lede">
          {query !== '' ? (
            <>
              Every store&rsquo;s shelf, searched at once. Adding something starts your
              basket at its store.
            </>
          ) : aisle !== null ? (
            aisle.blurb
          ) : (
            <>
              Every category, every open store near you, one grid. Pick a category to
              narrow it, or{' '}
              <Link href="/stores" className="shop-linkish">
                browse store by store
              </Link>{' '}
              instead.
            </>
          )}
        </p>
      </header>

      {/* ── the category rail ────────────────────────────────────────────
          All nine aisles, always — including the ones with nothing in them.
          Hiding an empty category would make the catalogue look complete
          when it is not, and a customer cannot ask for electronics from a
          rail that does not admit the aisle exists. */}
      <nav className="shop-tabs tkr-scroll-x" aria-label="Categories">
        <button
          type="button"
          className="shop-tab"
          data-active={aisleKey === null ? 'true' : 'false'}
          aria-pressed={aisleKey === null}
          onClick={() => {
            setParam('aisleKey', null);
          }}
        >
          All categories
        </button>
        {AISLES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="shop-tab"
            data-active={aisleKey === entry.key ? 'true' : 'false'}
            aria-pressed={aisleKey === entry.key}
            onClick={() => {
              setParam('aisleKey', aisleKey === entry.key ? null : entry.key);
            }}
          >
            <span className="shop-tab__swatch" data-key={entry.key} aria-hidden="true" />
            {entry.name}
          </button>
        ))}
      </nav>

      <LocationLine />

      {query !== '' ? (
        <p className="shop-page__scope" role="status">
          Searching every store for <strong>{query}</strong>.{' '}
          <button
            type="button"
            className="shop-linkish"
            onClick={() => {
              setParam('q', null);
            }}
          >
            Clear search
          </button>
        </p>
      ) : null}

      {products.isFixture ? <FixtureBanner endpoint="GET /products" /> : null}

      {refusal !== null ? (
        <div className="shop-notice shop-notice--warn" role="alert">
          <div>
            <p className="shop-notice__title">
              {refusal.pincode ?? 'That PIN code'} is not serviceable yet.
            </p>
            <p className="shop-notice__body">
              {APP_NAME} delivers in these PIN codes today:{' '}
              {refusal.serviceable.map((city, index) => (
                <span key={city.city}>
                  {index > 0 ? '; ' : ''}
                  <strong>{city.city}</strong> <span className="mono">{city.pincodes.join(', ')}</span>
                </span>
              ))}
              . Pick one of those, or share your exact location instead.
            </p>
          </div>
          <button type="button" className="mnd-btn mnd-btn--outline mnd-btn--sm" onClick={geo.clear}>
            Clear my PIN code
          </button>
        </div>
      ) : products.error !== null ? (
        <ErrorNotice error={products.error} onRetry={products.refetch} what="the catalogue" />
      ) : null}

      {products.loading && !products.hasLoadedOnce ? (
        <div className="tkr-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <ProductCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <>
          <div className="tkr-grid">
            {rows.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                store={{
                  vendorId: product.store.id,
                  storeName: product.store.storeName,
                  storeSlug: product.store.slug,
                }}
                priority={index < 4}
              />
            ))}
          </div>

          <p className="shop-page__count" role="status">
            Showing {rows.length} of {meta?.total ?? rows.length}
            {aisle !== null ? ` in ${aisle.name.toLowerCase()}` : ''}.
          </p>

          {hasMore ? (
            <div className="shop-page__more">
              <button
                type="button"
                className="mnd-btn mnd-btn--outline mnd-btn--lg"
                disabled={products.loading}
                onClick={() => {
                  setPage((n) => n + 1);
                }}
              >
                {products.loading ? 'Loading…' : 'Show more'}
              </button>
            </div>
          ) : null}
        </>
      ) : products.error === null ? (
        <EmptyShelf aisle={aisle} query={query} onClearAisle={() => { setParam('aisleKey', null); }} />
      ) : null}
    </div>
  );
}

/* ═══════════════════════════ the empty shelf ════════════════════════════ */

/**
 * Three different nothings, said three different ways.
 *
 * A search with no hits, an aisle nobody stocks yet, and a catalogue with
 * nothing in it at all are not the same event, and one shared "No results"
 * makes the first two look like the third — which is how a working app gets
 * mistaken for a broken one.
 */
function EmptyShelf({
  aisle,
  query,
  onClearAisle,
}: {
  aisle: { key: AisleKey; name: string } | null;
  query: string;
  onClearAisle: () => void;
}) {
  if (query !== '') {
    return (
      <div className="shop-empty">
        <p className="shop-empty__title">Nothing matched “{query}”.</p>
        <p className="shop-empty__body">
          No open store on {APP_NAME} lists an item by that name right now. Try a shorter
          term — &ldquo;milk&rdquo; rather than &ldquo;full cream milk 500ml&rdquo;.
        </p>
      </div>
    );
  }

  if (aisle !== null) {
    return (
      <div className="shop-empty">
        <p className="shop-empty__title">No products in {aisle.name.toLowerCase()} yet.</p>
        <p className="shop-empty__body">
          The category exists and is open for vendors to stock — nothing has been listed in
          it so far. We would rather show you an empty shelf than invent one.
        </p>
        <div className="shop-empty__actions">
          <button type="button" className="mnd-btn mnd-btn--outline" onClick={onClearAisle}>
            See every category
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shop-empty">
      <p className="shop-empty__title">No store near you is open right now.</p>
      <p className="shop-empty__body">
        This grid only shows products from stores that are both approved and currently
        open. Try again shortly, or look through every store to see their hours.
      </p>
      <div className="shop-empty__actions">
        <Link href="/stores" className="mnd-btn mnd-btn--outline">
          Browse every store
        </Link>
      </div>
    </div>
  );
}

/* ════════════════════════════ the location line ═════════════════════════ */

/**
 * Where we are delivering, stated once, near the products it affects.
 *
 * The header already owns the location CONTROL; this is the reminder, because
 * "why am I seeing these prices" is a question about this grid and the answer
 * should not be hidden behind a popover two rows up.
 *
 * A refused prompt is never an error banner here — `useGeolocation` treats
 * denial as a fork, not a wall, and a message the customer has to dismiss for
 * exercising a legitimate browser permission is exactly the pattern this app
 * set out not to copy. Distance is a nicety on this page: nothing is filtered
 * by it, so with no location the grid is still completely usable.
 */
function LocationLine() {
  const geo = useGeolocation();

  if (!geo.ready) return null;

  if (geo.location === null) {
    return (
      <p className="shop-page__scope" role="status">
        Showing every open store. Set a location in the header and each item will say how
        far its store is — nothing is hidden either way.
      </p>
    );
  }

  return (
    <p className="shop-page__scope" role="status">
      Distances measured from <strong>{geo.location.label}</strong>
      {geo.location.source === 'pincode' ? ' (PIN code)' : ''}. Every open store is listed
      either way — this grid is not filtered by distance.
    </p>
  );
}
