'use client';

/**
 * One product, given room.
 *
 * Large photography, the price set in Azeret Mono with tabular figures, the
 * pack size stated plainly next to it, a stepper, and an Add that arcs the item
 * into the basket. The aisle the product belongs to tints the page while you
 * are on it — walking into a product is walking into its aisle.
 *
 * ── THE GALLERY ─────────────────────────────────────────────────────────────
 * `images` is an ARRAY on every product response and this page used to render
 * `images[0]` alone, stretched into one frame — so a store that photographed
 * its stock from four angles showed three of them nowhere. `ProductGallery`
 * below is a real gallery: a main stage plus a thumbnail strip, arrow-key
 * navigable, with the count stated so you can tell "one photo" from "the
 * others have not loaded".
 *
 * Every frame carries an EXPLICIT aspect ratio (the stage) or explicit
 * width/height (the thumbnails), so the page reserves its space before a
 * single byte of image arrives. Without that, a product page reflows under the
 * reader's thumb exactly as they reach for Add — the specific layout shift
 * that makes people tap the wrong control.
 *
 * ── AND WHEN THERE ARE NO IMAGES AT ALL ─────────────────────────────────────
 * Which is the live state today: the catalogue carries real products with
 * empty `images`. The gallery draws `ProductMedia`'s aisle-tinted plate and
 * says so in one line. A stock photo of someone else's mango would be a
 * fabrication, and a grey box with a broken-image glyph reads as a bug.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPaise, getAisle, useAisle } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { formatPackSize } from '@/lib/shop/format';
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
          <Link href="/shop">Back to the shop</Link>
        </p>
      </div>
    );
  }

  if (product === null) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Product not found</h1>
        <p className="lede">
          That item is no longer listed. <Link href="/shop">Browse the market</Link>.
        </p>
      </div>
    );
  }

  const inBasket = qtyOf(product.id);
  const aisle = aisleKey === null ? null : getAisle(aisleKey);
  const discount = product.mrp > product.price ? product.discountPct : null;
  const ceiling = Math.min(product.availableQty, MAX_QTY_PER_LINE);
  const packSize = formatPackSize(product.unit, product.unitValue);
  const basketStore: BasketStore = {
    vendorId: product.store.id,
    storeName: product.store.storeName,
    storeSlug: product.store.slug,
  };

  return (
    <div className="shell shop-page">
      {query.isFixture ? <FixtureBanner endpoint={`GET /products/${productId}`} /> : null}

      <nav className="eyebrow shop-product__crumbs" aria-label="Breadcrumb">
        {/* `/shop` first: that is the customer home now, and the crumb has
            to lead back to where they came from. The aisle crumb links into
            the same grid with the category applied, not to a second screen
            that shows the same products in a different shape. */}
        <Link href="/shop">Shop</Link>
        {aisle !== null ? (
          <>
            {' · '}
            <Link href={`/shop?aisleKey=${aisle.key}`}>{aisle.name}</Link>
          </>
        ) : null}
      </nav>

      <div className="shop-product">
        <ProductGallery product={product} discount={discount} />

        <div className="shop-product__body">
          <h1 className="shop-product__name">{product.name}</h1>

          <p className="shop-product__meta">
            {/* The PACK SIZE, not the bare unit. "kg" does not say whether
                you are buying one kilo or five — which is the number that
                decides whether this price is good. */}
            <span className="mono">{packSize}</span>
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
            <span className="shop-product__per">per {packSize}</span>
          </p>

          {discount !== null ? (
            <p className="shop-product__saving" role="status">
              You save <strong>{formatPaise(product.mrp - product.price)}</strong> — {discount}% off
              the MRP of {formatPaise(product.mrp)}.
            </p>
          ) : null}

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

          <dl className="shop-product__spec">
            <div>
              <dt>Pack size</dt>
              <dd className="mono">{packSize}</dd>
            </div>
            {product.category !== null ? (
              <div>
                <dt>Category</dt>
                <dd>
                  <Link href={`/shop?aisleKey=${product.category.aisleKey}`}>
                    {product.category.name}
                  </Link>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Sold by</dt>
              <dd>
                <Link href={`/stores/${encodeURIComponent(product.store.slug)}`}>
                  {product.store.storeName}
                </Link>
              </dd>
            </div>
            {product.sku !== '' ? (
              <div>
                <dt>SKU</dt>
                <dd className="mono">{product.sku}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ the gallery ════════════════════════════ */

/** Local images go through `next/image`; a remote host is not in `remotePatterns` yet. */
function isLocal(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//');
}

/**
 * A main stage plus a thumbnail strip — the product page's own media, not the
 * card's one-image treatment reused at four times the size.
 *
 * ── DIMENSIONS ARE EXPLICIT, EVERYWHERE ─────────────────────────────────────
 * The stage inherits a fixed `aspect-ratio` from `.shop-product__media`, and
 * every thumbnail carries literal `width`/`height`. Nothing here is sized by
 * its content, so the whole gallery's footprint is known at first paint and
 * images drop into space already reserved for them. A product page that
 * reflows as photos arrive moves the Add button out from under the reader's
 * thumb at precisely the wrong moment.
 *
 * ── THE STRIP IS BUTTONS, NOT A CAROUSEL ────────────────────────────────────
 * No auto-advance, no swipe-only affordance. Each thumbnail is a real button
 * with a real label, arrow keys move between them, and `aria-current` says
 * which one is showing — so this works on a keyboard and reads correctly to a
 * screen reader, which an image carousel almost never does.
 */
function ProductGallery({
  product,
  discount,
}: {
  product: ProductDetail;
  discount: number | null;
}) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement | null>(null);

  // A different product (client-side navigation between two detail pages)
  // must not keep the previous one's selected frame.
  useEffect(() => {
    setIndex(0);
  }, [product.id]);

  const images = product.images;
  const count = images.length;
  const current = Math.min(index, Math.max(count - 1, 0));
  const src = images[current];

  const move = (delta: number) => {
    if (count === 0) return;
    const next = (current + delta + count) % count;
    setIndex(next);
    // Follow the selection with focus, so arrow-keying does not leave the
    // ring behind on a thumbnail that is no longer the one being shown.
    const buttons = strip.current?.querySelectorAll('button');
    buttons?.[next]?.focus();
  };

  return (
    <div className="shop-product__gallery">
      <figure className="shop-product__media">
        {src !== undefined && isLocal(src) ? (
          <Image
            src={src}
            alt={`${product.name} — photo ${current + 1} of ${count}`}
            fill
            sizes="(min-width: 900px) 46vw, 92vw"
            priority
            className="shop-media__img"
          />
        ) : src !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote host not in next.config remotePatterns; see ProductCard
          <img
            src={src}
            alt={`${product.name} — photo ${current + 1} of ${count}`}
            width={1200}
            height={1200}
            decoding="async"
            className="shop-media__img"
          />
        ) : (
          // No photography at all. The drawn plate, in the aisle hue — see
          // `ProductMedia`. Honest, and different for every product.
          <ProductMedia product={product} sizes="(min-width: 900px) 46vw, 92vw" priority />
        )}

        {discount !== null ? (
          <figcaption className="shop-product__save">−{discount}%</figcaption>
        ) : null}
      </figure>

      {count > 1 ? (
        <div
          className="shop-gallery__strip tkr-scroll-x"
          ref={strip}
          role="group"
          aria-label={`${product.name}, ${count} photos`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          {images.map((image, i) => (
            <button
              key={image}
              type="button"
              className="shop-gallery__thumb"
              data-active={i === current ? 'true' : 'false'}
              aria-current={i === current ? 'true' : undefined}
              onClick={() => {
                setIndex(i);
              }}
            >
              {isLocal(image) ? (
                <Image src={image} alt="" width={72} height={72} className="shop-gallery__img" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- as above
                <img
                  src={image}
                  alt=""
                  width={72}
                  height={72}
                  loading="lazy"
                  decoding="async"
                  className="shop-gallery__img"
                />
              )}
              <span className="mnd-visually-hidden">
                Show photo {i + 1} of {count}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <p className="shop-gallery__note">
        {count === 0
          ? 'This store has not photographed this item yet — the mark above is drawn, not a stock photo of something else.'
          : count === 1
            ? 'One photo from this store.'
            : `Photo ${current + 1} of ${count}, from this store.`}
      </p>
    </div>
  );
}
