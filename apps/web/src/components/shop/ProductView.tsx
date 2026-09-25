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
import { readProduct, type Product } from '@/lib/shop/types';
import { useBasket } from './BasketProvider';
import { ErrorNotice, FixtureBanner } from './notices';
import { ProductMedia } from './ProductCard';
import { QuantityStepper } from './QuantityStepper';

export function ProductView({ productId }: { productId: string }) {
  const { setAisle } = useAisle();
  const { add, qtyOf, setQty } = useBasket();
  const [draftQty, setDraftQty] = useState(1);
  const addRef = useRef<HTMLButtonElement | null>(null);

  const query = useShopQuery<Product | null>(
    `/products/${encodeURIComponent(productId)}`,
    undefined,
    {
      anonymous: true,
      read: useCallback((raw: unknown) => readProduct(raw), []),
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
  const discount =
    product.mrpPaise !== null && product.mrpPaise > product.pricePaise
      ? Math.round(((product.mrpPaise - product.pricePaise) / product.mrpPaise) * 100)
      : null;

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
            {product.storeName !== null ? (
              <>
                {' · from '}
                <strong>{product.storeName}</strong>
              </>
            ) : null}
          </p>

          <p className="shop-product__price">
            <span className="price">{formatPaise(product.pricePaise)}</span>
            {product.mrpPaise !== null ? (
              <s className="shop-product__mrp">{formatPaise(product.mrpPaise)}</s>
            ) : null}
            <span className="shop-product__per">per {product.unit}</span>
          </p>

          <p className="shop-product__stock" data-in={product.inStock ? 'true' : 'false'}>
            <span className="shop-store__dot" aria-hidden="true" />
            {product.inStock
              ? product.stock !== null && product.stock <= 5
                ? `Only ${product.stock} left at this store`
                : 'In stock at this store'
              : 'Out of stock right now'}
          </p>

          {product.inStock ? (
            <div className="shop-product__buy">
              <QuantityStepper
                value={draftQty}
                min={1}
                max={product.stock}
                label={product.name}
                onChange={setDraftQty}
              />
              <button
                ref={addRef}
                type="button"
                className="mnd-btn mnd-btn--solid mnd-btn--lg"
                onClick={() => {
                  add(product, draftQty, addRef.current);
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
