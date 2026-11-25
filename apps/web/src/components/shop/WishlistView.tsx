'use client';

/**
 * The wishlist page.
 *
 * Saved products that can still be bought render as ordinary product cards
 * — same heart, same Add, same basket rules — because a saved product is
 * just a product you have not bought yet. The ones that cannot are kept on
 * the page, greyed and labelled with the reason the API gave, with a
 * Remove button: a product that silently vanished from somebody's list
 * reads as the app losing their data.
 */

import Link from 'next/link';
import { useCallback } from 'react';
import { useShopQuery } from '@/hooks/useShopQuery';
import { readWishlist, type WishlistRow, type WishlistUnavailableReason } from '@/lib/shop/engagement';
import { ErrorNotice } from './notices';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { useWishlist } from './WishlistProvider';

const REASON: Record<WishlistUnavailableReason, string> = {
  deleted: 'No longer sold',
  inactive: 'Withdrawn by the store',
  store_unavailable: 'Store not taking orders',
};

export function WishlistView() {
  const query = useShopQuery<WishlistRow[]>('/wishlist', undefined, {
    read: useCallback((raw: unknown) => readWishlist(raw), []),
  });
  const wishlist = useWishlist();

  const rows = query.data ?? [];
  const live = rows.filter((row) => row.available && row.product !== null && row.store !== null);
  const gone = rows.filter((row) => !live.includes(row));

  return (
    <div className="shell shop-page">
      <header className="shop-page__head">
        <p className="eyebrow">Your account</p>
        <h1 className="shop-page__title">Wishlist</h1>
        {rows.length > 0 ? (
          <p className="shop-page__scope">
            {rows.length} saved {rows.length === 1 ? 'product' : 'products'} · prices and stock
            are live
          </p>
        ) : null}
      </header>

      {query.error !== null ? (
        <ErrorNotice error={query.error} onRetry={query.refetch} what="your wishlist" />
      ) : null}

      {query.loading && !query.hasLoadedOnce ? (
        <div className="tkr-grid">
          {[0, 1, 2, 3].map((i) => (
            <ProductCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : rows.length === 0 && query.error === null ? (
        <p className="shop-empty">
          Nothing saved yet. Tap the heart on any product to keep it here.{' '}
          <Link href="/shop">Browse the market</Link>.
        </p>
      ) : (
        <>
          {live.length > 0 ? (
            <div className="tkr-grid">
              {live.map((row, index) =>
                row.product !== null && row.store !== null ? (
                  <ProductCard
                    key={row.productId}
                    product={row.product}
                    store={{
                      vendorId: row.store.id,
                      storeName: row.store.storeName,
                      storeSlug: row.store.slug,
                    }}
                    priority={index < 4}
                  />
                ) : null,
              )}
            </div>
          ) : null}

          {gone.length > 0 ? (
            <section className="shop-wish__gone tkr-reveal" aria-labelledby="wish-gone">
              <h2 className="shop-wish__gone-title" id="wish-gone">
                No longer available
              </h2>
              <ul className="shop-wish__list">
                {gone.map((row) => (
                  <li key={row.productId} className="shop-wish__row">
                    <div>
                      <p className="shop-wish__name">{row.name}</p>
                      <p className="shop-wish__why">
                        {row.unavailableReason !== null
                          ? REASON[row.unavailableReason]
                          : 'Not available'}
                        {row.store !== null ? ` · ${row.store.storeName}` : ''}
                      </p>
                    </div>
                    {wishlist !== null ? (
                      <button
                        type="button"
                        className="mnd-btn mnd-btn--ghost mnd-btn--sm"
                        disabled={wishlist.isPending(row.productId)}
                        onClick={() => {
                          wishlist.toggle(row.productId, row.name);
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
