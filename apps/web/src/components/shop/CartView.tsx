'use client';

/**
 * The basket, in full — and the honest version of what is in it.
 *
 * ── THE STALE FLAGS ─────────────────────────────────────────────────────────
 * `GET /cart` re-reads every line against the live product and inventory and
 * returns per-line `flags`: `price_changed`, `out_of_stock`, `reduced_qty`,
 * `unavailable`. They are rendered as inline chips ON the line, never as a
 * modal. A modal gets dismissed before it is read, and then the basket looks
 * correct while it is not — which is how a customer ends up surprised at the
 * door.
 *
 * Checkout is blocked by `out_of_stock` and `unavailable`, the two the customer
 * must actually act on. A price change is information, not a barrier: the new
 * price is shown, it is what will be charged, and they can decide.
 *
 * ── SERVER TRUTH vs LOCAL BASKET ────────────────────────────────────────────
 * When `/cart` answers, it is the truth — it is the only side that knows about
 * a price change. When the API is unreachable, the local basket is shown
 * instead and the screen says so. Neither is quietly substituted for the other.
 *
 * ── WHAT THE CART RESPONSE REALLY CONTAINS ──────────────────────────────────
 *   { id, vendorId, store{id,slug,storeName,isOpen}, status, items[],
 *     itemCount, pricing{itemsSubtotal,deliveryFee,taxes,grandTotal},
 *     hasIssues, parkedCarts[] }
 *
 * There is no `storeName` at the top level, no `couponCode` (a coupon only
 * exists at checkout) and no `discount` in cart pricing — this screen used to
 * read all three. `parkedCarts` is the SERVER's list of baskets set aside at
 * other stores, and it is shown alongside the local one.
 */

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { formatPaise } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { readCart, type Cart, type CartLine } from '@/lib/shop/types';
import { MAX_QTY_PER_LINE, useBasket, type BasketLine } from './BasketProvider';
import { blocksCheckout, ErrorNotice, FixtureBanner, StaleFlagChips } from './notices';
import { QuantityStepper } from './QuantityStepper';

/** A local line, shaped as a cart line so one renderer draws both. */
function fromLocal(line: BasketLine): CartLine {
  return {
    productId: line.productId,
    name: line.name,
    image: line.image,
    price: line.pricePaise,
    currentPrice: line.pricePaise,
    qty: line.qty,
    lineTotal: line.pricePaise * line.qty,
    availableQty: line.maxQty ?? MAX_QTY_PER_LINE,
    flags: [],
  };
}

export function CartView() {
  const basket = useBasket();

  const cart = useShopQuery<Cart | null>(
    basket.store === null ? null : '/cart',
    useMemo(
      () => (basket.store === null ? {} : { vendorId: basket.store.vendorId }),
      [basket.store],
    ),
    { read: useCallback((raw: unknown) => readCart(raw), []) },
  );

  /* Which set of lines is on screen, and whether it is the server's.
     `serverCart` is non-null ONLY when the API genuinely answered — not a
     fixture, not an error. That distinction is the whole point of this screen. */
  const serverCart =
    cart.data !== null && !cart.isFixture && cart.error === null ? cart.data : null;

  const usingServer = serverCart !== null && serverCart.items.length > 0;

  const lines: CartLine[] = usingServer
    ? serverCart.items
    : basket.lines.length > 0
      ? basket.lines.map(fromLocal)
      : (cart.data?.items ?? []);

  const subtotal = usingServer
    ? serverCart.pricing.itemsSubtotal
    : lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const deliveryFee = usingServer ? serverCart.pricing.deliveryFee : null;
  const taxes = usingServer ? serverCart.pricing.taxes : null;
  const grandTotal = usingServer ? serverCart.pricing.grandTotal : subtotal;

  const blocked = lines.some((line) => line.flags.some(blocksCheckout));
  const storeName = serverCart?.store?.storeName ?? basket.store?.storeName ?? null;
  const storeClosed = serverCart?.store?.isOpen === false;
  const parkedOnServer = serverCart?.parkedCarts ?? [];

  if (lines.length === 0) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Your basket is empty</h1>
        <p className="lede">
          Nothing in it yet. Pick a store and have a look around — the whole app changes colour
          as you walk through its aisles.
        </p>
        <p className="shop-cart__cta">
          <Link href="/stores" className="mnd-btn mnd-btn--solid mnd-btn--md">
            Find a store near you
          </Link>
        </p>

        {basket.parked !== null ? (
          <section className="shop-parked shop-parked--page">
            <div>
              <p className="shop-parked__title">Your {basket.parked.storeName} basket is parked</p>
              <p className="shop-parked__body">
                {basket.parked.lines.length}{' '}
                {basket.parked.lines.length === 1 ? 'item' : 'items'}, saved when you switched
                store. Nothing was thrown away.
              </p>
            </div>
            <div className="shop-parked__actions">
              <button type="button" className="mnd-btn mnd-btn--outline mnd-btn--sm" onClick={basket.restoreParked}>
                Restore it
              </button>
              <button type="button" className="mnd-btn mnd-btn--ghost mnd-btn--sm" onClick={basket.discardParked}>
                Discard
              </button>
            </div>
          </section>
        ) : null}

        {parkedOnServer.map((parked) => (
          <section className="shop-parked shop-parked--page" key={parked.id}>
            <div>
              <p className="shop-parked__title">{parked.storeName} basket, parked</p>
              <p className="shop-parked__body">
                {parked.itemCount} {parked.itemCount === 1 ? 'item' : 'items'}, saved on your
                account. Adding anything from that store brings it back.
              </p>
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="shell shop-page shop-cart">
      <header className="shop-page__head">
        <p className="eyebrow">Basket</p>
        <h1 className="shop-page__title">{storeName ?? 'Your basket'}</h1>
        <p className="lede">
          One store per basket, so this is one pickup and one rider. Switching store parks this
          basket rather than deleting it.
        </p>
      </header>

      {cart.isFixture ? <FixtureBanner endpoint="GET /cart" /> : null}
      {cart.error !== null ? (
        <ErrorNotice error={cart.error} onRetry={cart.refetch} what="the saved basket" />
      ) : null}
      {basket.isLocalOnly ? (
        <div className="shop-notice shop-notice--warn" role="status">
          <p>
            <strong>Saved on this device only.</strong> We could not reach the cart service, so
            price and stock have not been re-checked. Anything here may have changed at the
            store.
          </p>
        </div>
      ) : null}
      {storeClosed ? (
        <div className="shop-notice shop-notice--warn" role="status">
          <p>
            <strong>{storeName} is closed right now.</strong> Your basket is safe; the order
            can go in once they open.
          </p>
        </div>
      ) : null}

      <div className="shop-split">
        <ul className="shop-lines">
          {lines.map((line) => (
            <li key={line.productId} className="shop-line">
              <div className="shop-line__main">
                <Link href={`/product/${encodeURIComponent(line.productId)}`} className="shop-line__name">
                  {line.name}
                </Link>
                <p className="shop-line__meta">
                  <span className="price">{formatPaise(line.currentPrice)}</span> each
                </p>
                <StaleFlagChips line={line} />
              </div>

              <div className="shop-line__controls">
                <QuantityStepper
                  value={line.qty}
                  max={Math.min(line.availableQty, MAX_QTY_PER_LINE)}
                  label={line.name}
                  size="sm"
                  onChange={(next) => {
                    basket.setQty(line.productId, next);
                  }}
                />
                <p className="shop-line__total price">{formatPaise(line.lineTotal)}</p>
                <button
                  type="button"
                  className="shop-line__remove"
                  onClick={() => {
                    basket.remove(line.productId);
                  }}
                >
                  Remove
                  <span className="mnd-visually-hidden"> {line.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>

        <aside className="shop-summary" aria-label="Order summary">
          <h2 className="shop-summary__title">Summary</h2>
          <dl className="shop-summary__rows">
            <div>
              <dt>Items</dt>
              <dd className="price">{formatPaise(subtotal)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              {deliveryFee !== null ? (
                <dd className="price">{formatPaise(deliveryFee)}</dd>
              ) : (
                <dd className="shop-summary__pending">calculated at checkout</dd>
              )}
            </div>
            {taxes !== null && taxes > 0 ? (
              <div>
                <dt>Taxes</dt>
                <dd className="price">{formatPaise(taxes)}</dd>
              </div>
            ) : null}
            <div className="shop-summary__total">
              <dt>Total</dt>
              <dd className="price">{formatPaise(grandTotal)}</dd>
            </div>
          </dl>

          {blocked ? (
            <p className="shop-notice shop-notice--error" role="alert">
              One item cannot be sold right now. Remove it and you can check out — the rest of
              your basket is fine.
            </p>
          ) : null}

          <Link
            href="/checkout"
            className="mnd-btn mnd-btn--solid mnd-btn--lg mnd-btn--block"
            aria-disabled={blocked ? 'true' : undefined}
            onClick={(event) => {
              if (blocked) event.preventDefault();
            }}
          >
            Checkout
          </Link>

          <p className="shop-summary__note">
            Prices and stock are re-checked once more when you place the order. If something has
            moved, you will see it before you pay — never after.
          </p>
        </aside>
      </div>
    </div>
  );
}
