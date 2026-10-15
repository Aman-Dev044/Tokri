'use client';

/**
 * PILLAR 5 — EDITORIAL PRODUCT CARDS.
 *
 * Magazine, not spreadsheet. Large photography, generous air, hairline rules
 * instead of boxes inside boxes, the price set in Azeret Mono with tabular
 * figures, and the aisle hue on the edge rather than smeared across the tile.
 *
 * TWO-ACROSS ON MOBILE, NOT THREE (plan §2.2). Fewer products visible, each one
 * desirable. That is the whole argument against the competitor grid and it is
 * enforced in `shop.css`, not here.
 *
 * ── IMAGES ──────────────────────────────────────────────────────────────────
 * `next/image` is used for anything served from this origin. Product
 * photography will land in S3, and until that bucket host is added to
 * `next.config.mjs → images.remotePatterns` the Image component refuses the URL
 * outright — so a remote URL falls back to a plain lazy <img> rather than
 * throwing a render error on a catalogue page.
 *   TODO(deploy): add the S3 bucket to remotePatterns, then drop the fallback.
 *
 * With no image at all — which is every product until the catalogue is seeded —
 * the card draws a produce plate in the aisle colour. An honest placeholder,
 * not a grey box with a broken-image glyph.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useRef } from 'react';
import { Depth, formatPaise, Tilt3D, type AisleKey } from '@mandi/design-system';
import { useBasket, type BasketStore } from './BasketProvider';
import { QuantityStepper } from './QuantityStepper';
import type { Product } from '@/lib/shop/types';

/* ───────────────────────────────── media ───────────────────────────────── */

function isLocal(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//');
}

export function ProductMedia({
  product,
  sizes,
  priority = false,
}: {
  product: Pick<Product, 'name' | 'images' | 'aisleKey'>;
  sizes: string;
  priority?: boolean;
}) {
  const src = product.images[0];

  if (src !== undefined && isLocal(src)) {
    return (
      <Image
        src={src}
        alt={product.name}
        fill
        sizes={sizes}
        priority={priority}
        className="shop-media__img"
      />
    );
  }
  if (src !== undefined) {
    // eslint-disable-next-line @next/next/no-img-element -- remote host not yet in remotePatterns; see header
    return <img src={src} alt={product.name} loading="lazy" decoding="async" className="shop-media__img" />;
  }

  /* The drawn plate. Initial + aisle wash — reads as deliberate, and it is
     different for every product rather than one repeated grey rectangle. */
  const initial = product.name.trim().charAt(0).toUpperCase() || '·';
  return (
    <span className="shop-media__plate" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="shop-media__plate-art">
        <circle cx="60" cy="60" r="38" fill="var(--card-wash)" />
        <circle cx="60" cy="60" r="38" fill="none" stroke="var(--card-edge)" strokeWidth="1.5" />
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          className="shop-media__plate-letter"
        >
          {initial}
        </text>
      </svg>
    </span>
  );
}

/* ──────────────────────────────── the card ─────────────────────────────── */

export interface ProductCardProps {
  product: Product;
  /**
   * Which store this shelf belongs to.
   *
   * A `ProductRow` carries NO `vendorId` — the caller already knows which store
   * it asked for its catalogue. The basket needs one (one vendor per cart), so
   * the shelf that fetched the row hands it down rather than reading a field
   * that is not in the response.
   */
  store: BasketStore;
  /** overrides the product's own aisle — used inside an aisle route */
  aisleKey?: AisleKey | null;
  priority?: boolean;
}

export function ProductCard({ product, store, aisleKey, priority = false }: ProductCardProps) {
  const { add, setQty, qtyOf } = useBasket();
  const addRef = useRef<HTMLButtonElement | null>(null);
  const qty = qtyOf(product.id);

  // `discountPct` is computed server-side; the MRP comparison is only a guard
  // against a catalogue row where the two prices are equal.
  const discount = product.mrp > product.price ? product.discountPct : null;

  /* The card's own aisle hue, read straight into inline custom properties —
     never through a `data-*` selector, since `Tilt3D`'s props are strictly
     typed and take no arbitrary attributes. Falls back to the page's current
     `--aisle` (the mint default, or whatever aisle you are standing in). */
  const hue = aisleKey ?? product.aisleKey;
  const hueVar = hue ? `var(--aisle-${hue})` : 'var(--aisle)';
  const hueInkVar = hue ? `var(--aisle-${hue}-ink)` : 'var(--aisle-ink)';

  return (
    <Tilt3D
      as="article"
      className={['shop-card', product.inStock ? '' : 'shop-card--out'].filter(Boolean).join(' ')}
      style={{ ['--card-hue' as string]: hueVar, ['--card-hue-ink' as string]: hueInkVar }}
      max={7}
      lift={12}
      scale={1.018}
    >
      <Link href={`/product/${encodeURIComponent(product.id)}`} className="shop-card__media">
        {/* PILLAR 5 — the photo sits nearer than the card face, so it
            visibly parallaxes as the card tilts toward the cursor. */}
        <Depth depth={3} className="shop-card__media-depth">
          <ProductMedia
            product={product}
            sizes="(min-width: 1100px) 260px, (min-width: 700px) 30vw, 46vw"
            priority={priority}
          />
        </Depth>
        {discount !== null ? (
          <Depth depth={4} className="shop-card__save">
            −{discount}%
          </Depth>
        ) : null}
        {!product.inStock ? <span className="shop-card__out">Out of stock</span> : null}
      </Link>

      <div className="shop-card__body">
        <h3 className="shop-card__name">
          <Link href={`/product/${encodeURIComponent(product.id)}`}>{product.name}</Link>
        </h3>
        <p className="shop-card__unit">
          {product.unit}
          {product.brand !== null ? <span className="shop-card__brand"> · {product.brand}</span> : null}
        </p>

        <div className="shop-card__foot">
          <p className="shop-card__price">
            <span className="price">{formatPaise(product.price)}</span>
            {product.mrp > product.price ? (
              <s className="shop-card__mrp">{formatPaise(product.mrp)}</s>
            ) : null}
          </p>

          {!product.inStock ? (
            <span className="shop-card__disabled">Unavailable</span>
          ) : qty === 0 ? (
            <button
              ref={addRef}
              type="button"
              className="shop-card__add"
              onClick={() => {
                add(product, store, 1, addRef.current);
              }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M8 3.5 V12.5 M3.5 8 H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Add
              <span className="mnd-visually-hidden"> {product.name} to basket</span>
            </button>
          ) : (
            <QuantityStepper
              value={qty}
              max={product.availableQty}
              label={product.name}
              size="sm"
              onChange={(next) => {
                setQty(product.id, next);
              }}
            />
          )}
        </div>
      </div>
    </Tilt3D>
  );
}

/* ──────────────────────────── the skeleton ─────────────────────────────── */

/**
 * Matched to the real card's shape — same media ratio, same three text rows,
 * same footer height. A skeleton that does not match is a layout shift with
 * extra steps.
 */
export function ProductCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <article className="shop-card shop-card--skeleton" aria-hidden="true" style={{ ['--i' as string]: String(index) }}>
      <span className="shop-card__media shop-skel" />
      <div className="shop-card__body">
        <span className="shop-skel shop-skel--line" style={{ width: '78%' }} />
        <span className="shop-skel shop-skel--line shop-skel--small" style={{ width: '42%' }} />
        <div className="shop-card__foot">
          <span className="shop-skel shop-skel--line" style={{ width: '4.5rem' }} />
          <span className="shop-skel shop-skel--pill" />
        </div>
      </div>
    </article>
  );
}
