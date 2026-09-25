'use client';

/**
 * One product, given room.
 *
 * Large photography, the price set in Azeret Mono with tabular figures, the
 * unit stated plainly next to it, a stepper, and an Add that arcs the item into
 * the basket. The aisle the product belongs to tints the page while you are on
 * it — walking into a product is walking into its aisle.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPaise, getAisle, useAisle } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { readProductDetail, type ProductDetail } from '@/lib/shop/types';
import { MAX_QTY_PER_LINE, useBasket, type BasketStore } from './BasketProvider';
import { ErrorNotice, FixtureBanner } from './notices';
import { ProductMedia } from './ProductCard';
import { QuantityStepper } from './QuantityStepper';

export function ProductView({ productId }: { productId: string }) {
  const { setAisle } = useAisle();
  const { add, qtyOf, setQty } = useBasket();
  const [draftQty, setDraftQty] = useState(1);
  const addRef = useRef<HTMLButtonElement | null>(null);

  /* `GET /products/:id` → ProductDetail: the ONLY product response that
     carries its store. That store is what the basket is keyed on. */
  const query = useShopQuery<ProductDetail | null>(
    `/products/${encodeURIComponent(productId)}`,
    undefined,
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readProductDetail(raw), []),
    },
  );

  const product = query.data;
  const aisleKey = product?.aisleKey ?? null;

  useEffect(() => {
    setAisle(aisleKey);
    return () => {
      setAisle(null);
    };
  }, [aisleKey, setAisle]);

  if (query.loading && !query.hasLoadedOnce) {
    return (
      <div className="shell shop-page shop-product">
        <span className="shop-skel shop-skel--block shop-product__media" />
        <div className="shop-product__body">
          <span className="shop-skel shop-skel--line" style={{ width: '70%', height: '2.2rem' }} />
          <span className="shop-skel shop-skel--line shop-skel--small" style={{ width: '35%' }} />
          <span className="shop-skel shop-skel--line" style={{ width: '45%', height: '1.8rem' }} />
        </div>
      </div>
    );
  }

  if (query.error !== null) {
    return (
      <div className="shell shop-page">
        <ErrorNotice error={query.error} onRetry={query.refetch} what="this product" />
        <p className="shop-empty">
          <Link href="/stores">Back to the stores near you</Link>
        </p>
      </div>
    );
  }

  if (product === null) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Product not found</h1>
        <p className="lede">
          That item is no longer listed. <Link href="/stores">Browse the market</Link>.
        </p>
      </div>
    );
  }

  const inBasket = qtyOf(product.id);
  const aisle = aisleKey === null ? null : getAisle(aisleKey);
  const discount = product.mrp > product.price ? product.discountPct : null;
  const ceiling = Math.min(product.availableQty, MAX_QTY_PER_LINE);
  const basketStore: BasketStore = {
    vendorId: product.store.id,
    storeName: product.store.storeName,
    storeSlug: product.store.slug,
  };

  return (
    <div className="shell shop-page">
      {query.isFixture ? <FixtureBanner endpoint={`GET /products/${productId}`} /> : null}

      <nav className="eyebrow shop-product__crumbs" aria-label="Breadcrumb">
        <Link href="/stores">Stores</Link>
        {aisle !== null ? (
          <>
            {' · '}
            <Link href={`/aisle/${aisle.key}`}>{aisle.name}</Link>
          </>
        ) : null}
      </nav>

      <div className="shop-product">
        <figure className="shop-product__media">
          <ProductMedia product={product} sizes="(min-width: 900px) 46vw, 92vw" priority />
          {discount !== null ? <figcaption className="shop-product__save">−{discount}%</figcaption> : null}
        </figure>

        <div className="shop-product__body">
          <h1 className="shop-product__name">{product.name}</h1>

          <p className="shop-product__meta">
            <span className="mono">{product.unit}</span>
            {product.brand !== null ? <> · {product.brand}</> : null}
            {' · from '}
            <Link href={`/stores/${encodeURIComponent(product.store.slug)}`}>
              <strong>{product.store.storeName}</strong>
            </Link>
            {!product.store.isOpen ? <> · closed right now</> : null}
          </p>

          <p className="shop-product__price">
            <span className="price">{formatPaise(product.price)}</span>
            {product.mrp > product.price ? (
              <s className="shop-product__mrp">{formatPaise(product.mrp)}</s>
            ) : null}
            <span className="shop-product__per">per {product.unit}</span>
          </p>

          <p className="shop-product__stock" data-in={product.inStock ? 'true' : 'false'}>
            <span className="shop-store__dot" aria-hidden="true" />
            {product.inStock
              ? product.availableQty > 0 && product.availableQty <= 5
                ? `Only ${product.availableQty} left at this store`
                : 'In stock at this store'
              : 'Out of stock right now'}
          </p>

          {product.inStock ? (
            <div className="shop-product__buy">
              <QuantityStepper
                value={draftQty}
                min={1}
                max={ceiling}
                label={product.name}
                onChange={setDraftQty}
              />
              <button
                ref={addRef}
                type="button"
                className="mnd-btn mnd-btn--solid mnd-btn--lg"
                onClick={() => {
                  add(product, basketStore, draftQty, addRef.current);
                }}
              >
                Add {draftQty > 1 ? `${draftQty} ` : ''}to basket
              </button>
            </div>
          ) : (
            <p className="shop-notice shop-notice--warn" role="status">
              This one is out of stock. The store updates its count as it packs, so it may
              come back today.
            </p>
          )}

          {inBasket > 0 ? (
            <p className="shop-product__inbasket" role="status">
              {inBasket} already in your basket.{' '}
              <button
                type="button"
                className="shop-linkish"
                onClick={() => {
                  setQty(product.id, 0);
                }}
              >
                Remove
              </button>{' '}
              · <Link href="/cart">Go to basket</Link>
            </p>
          ) : null}

          {product.description !== null ? (
            <div className="shop-product__desc">
              <h2 className="shop-product__desc-title">About this</h2>
              <p>{product.description}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
