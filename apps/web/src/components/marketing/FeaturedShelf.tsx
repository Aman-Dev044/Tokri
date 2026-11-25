import Image from 'next/image';
import Link from 'next/link';

import { API_URL } from '@/config/env';
import { formatPaise } from '@mandi/design-system';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  REAL FOOD, ON THE FRONT DOOR
 * ════════════════════════════════════════════════════════════════════════
 *
 * The landing page used to open onto an abstraction: tinted glyphs and a
 * sentence about colour. A grocery shop should open onto groceries, with
 * their photographs and their prices, the way the shop down the road opens
 * onto a crate of oranges.
 *
 * ── Why these rows are REAL ─────────────────────────────────────────────
 * They come from `GET /products`, which is public, so what a visitor sees
 * here is what is actually on the shelf right now — the same price, the
 * same discount, the same photograph as `/shop`. A hand-written "featured"
 * list would be a second catalogue to keep in sync, and it would be wrong
 * the first time a vendor changed a price.
 *
 * ── Why it is a SERVER component ────────────────────────────────────────
 * Rendered on the server with a five-minute revalidate, so the page stays
 * static and fast, a crawler sees the products in the HTML, and the prices
 * are never more than five minutes stale. Fetching on the client would
 * leave an empty grid in the markup and a flash of skeletons for everyone.
 *
 * ── Why there is no "Add" button here ───────────────────────────────────
 * The reference layout has one, and it is tempting. But a basket in this
 * app belongs to ONE vendor and needs a signed-in customer, so an Add here
 * would either silently pick a store on the visitor's behalf or bounce
 * them to a login they did not ask for. The card links into the shop,
 * where both of those facts are visible. A button that cannot honour its
 * own label is worse than a link that can.
 */

interface ApiProduct {
  id: string;
  name: string;
  brand: string | null;
  images: string[];
  unit: string;
  unitValue: number;
  mrp: number;
  price: number;
  discountPct: number;
  aisleKey: string;
}

/** How many make a shelf: enough to look stocked, few enough to scan. */
const COUNT = 8;

/**
 * The front door of a grocery opens onto FOOD.
 *
 * `GET /products` returns the catalogue in its own order, and that order
 * happens to lead with home and electronics — so the first thing a visitor
 * saw under "Simple. Fresh. Local." was a wall clock, a table fan and an
 * immersion rod. Accurate, and completely wrong for the sentence above it.
 *
 * These are the aisles a grocery leads with, best first. A product from a
 * later aisle still appears once the earlier ones run out, so the shelf
 * never goes short — it just starts with the mangoes.
 */
const SHELF_ORDER: readonly string[] = [
  'fruits',
  'vegetables',
  'dairy',
  'bakery',
  'staples',
  'beverages',
  'snacks',
  'frozen',
];

/** A photograph is the entire point of this section. */
const hasPhoto = (p: ApiProduct): boolean => (p.images[0] ?? '') !== '';

function pickShelf(all: ApiProduct[]): ApiProduct[] {
  const rank = (p: ApiProduct) => {
    const i = SHELF_ORDER.indexOf(p.aisleKey);
    return i === -1 ? SHELF_ORDER.length : i;
  };

  // One photograph per shelf. Several products legitimately share a picture
  // — every loaf maps to the same bread — and eight cards showing the same
  // loaf six times reads as a bug, not as a catalogue.
  const used = new Set<string>();
  const shelf: ApiProduct[] = [];
  for (const product of all.filter(hasPhoto).sort((a, b) => rank(a) - rank(b))) {
    const photo = product.images[0] as string;
    if (used.has(photo)) continue;
    used.add(photo);
    shelf.push(product);
    if (shelf.length === COUNT) break;
  }
  return shelf;
}

async function fetchShelf(): Promise<ApiProduct[]> {
  try {
    // The WHOLE catalogue, narrowed here: the endpoint cannot sort by
    // "appetising", and asking per aisle would be eight round trips for one
    // shelf. The page size matters — the list comes back newest-first, so a
    // short page cut off exactly the fruit and vegetables this section is
    // supposed to lead with, and the shelf filled up with bakery instead.
    const res = await fetch(`${API_URL}/products?limit=100`, {
      // Static page, refreshed in the background. The landing page must not
      // wait on the API to render, and must not serve a price from last week.
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const rows = (body as { data?: unknown })?.data;
    return Array.isArray(rows) ? pickShelf(rows as ApiProduct[]) : [];
  } catch {
    // The shelf is an invitation, not the product. If the API is down the
    // rest of the page still has to render — so this returns nothing and
    // the section removes itself rather than throwing the page away.
    return [];
  }
}

export async function FeaturedShelf() {
  const products = await fetchShelf();
  if (products.length === 0) return null;

  return (
    <section className="mk-sec" id="shelf">
      <div className="mk-shell">
        <header className="mk-sec__head tkr-reveal">
          <p className="mk-eyebrow">On the shelf today</p>
          <h2 className="mk-title">Simple. Fresh. Local.</h2>
          <p className="mk-lede">
            Everything below is live stock from a real shop, at the price you would
            pay right now. No sample data, no stand-in photographs.
          </p>
        </header>

        <ul className="mk-shelf tkr-reveal-kids">
          {products.map((product, i) => {
            const image = product.images[0];
            return (
              <li key={product.id} data-aisle={product.aisleKey}>
                <Link
                  className="mk-prod"
                  href={`/product/${encodeURIComponent(product.id)}`}
                  style={{ ['--i' as string]: i }}
                >
                  <span className="mk-prod__media">
                    {image !== undefined ? (
                      <Image
                        src={image}
                        alt={product.name}
                        width={320}
                        height={320}
                        className="mk-prod__img"
                        // The shelf sits just under the hero and is visible
                        // on the first scroll on every size, so none of it
                        // is worth deferring. Only the first row gets
                        // `priority` (a preload hint); the rest load eagerly
                        // but without competing for the LCP.
                        priority={i < 4}
                        loading="eager"
                        sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
                      />
                    ) : (
                      <span className="mk-prod__plate" aria-hidden="true">
                        {product.name.trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    {product.discountPct > 0 ? (
                      <span className="mk-prod__off">−{product.discountPct}%</span>
                    ) : null}
                  </span>

                  <span className="mk-prod__body">
                    <span className="mk-prod__name">{product.name}</span>
                    <span className="mk-prod__meta">
                      {product.unitValue} {product.unit}
                      {product.brand !== null ? ` · ${product.brand}` : ''}
                    </span>
                    <span className="mk-prod__price">
                      {formatPaise(product.price)}
                      {product.mrp > product.price ? (
                        <s className="mk-prod__mrp">{formatPaise(product.mrp)}</s>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mk-shelf__more tkr-reveal">
          <Link className="mk-link" href="/shop">
            Browse the whole shop →
          </Link>
        </p>
      </div>
    </section>
  );
}
