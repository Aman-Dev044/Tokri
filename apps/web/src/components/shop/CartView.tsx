'use client';

/**
 * The basket, in full — and the honest version of what is in it.
 *
 * ── THE STALE FLAGS ─────────────────────────────────────────────────────────
 * `/cart` and `/checkout/validate` return per-line flags: `price_changed`,
 * `out_of_stock`, `reduced_qty` (plan §6.2, decision #9). They are rendered as
 * inline chips ON the line, never as a modal. A modal gets dismissed before it
 * is read, and then the basket looks correct while it is not — which is how a
 * customer ends up surprised at the door.
 *
 * Checkout is blocked only by `out_of_stock`, because that is the one the
 * customer must actually act on. A price change is information, not a barrier:
 * the new price is shown, it is what will be charged, and they can decide.
 *
 * ── SERVER TRUTH vs LOCAL BASKET ────────────────────────────────────────────
 * When `/cart` answers, it is the truth — it is the only side that knows about
 * a price change. When it does not, the local basket is shown instead and the
 * screen says so. Neither is quietly substituted for the other.
 */

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { formatPaise } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { readCart, type Cart, type CartLine } from '@/lib/shop/types';
import { useBasket, type BasketLine } from './BasketProvider';
import { ErrorNotice, FixtureBanner, StaleFlagChips } from './notices';
import { QuantityStepper } from './QuantityStepper';

function fromLocal(line: BasketLine): CartLine {
  return {
    productId: line.productId,
    name: line.name,
    image: line.image,
    unit: line.unit,
    pricePaise: line.pricePaise,
    qty: line.qty,
    lineTotalPaise: line.pricePaise * line.qty,
    maxQty: line.maxQty,
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

  const lines: CartLine[] =
    serverCart !== null
      ? serverCart.lines
      : basket.lines.length > 0
        ? basket.lines.map(fromLocal)
        : (cart.data?.lines ?? []);

  const subtotal =
    serverCart !== null
      ? serverCart.pricing.itemsSubtotalPaise
      : lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const deliveryFee = serverCart !== null ? serverCart.pricing.deliveryFeePaise : null;
  const grandTotal = serverCart !== null ? serverCart.pricing.grandTotalPaise : subtotal;

  const blocked = lines.some((line) => line.flags.some((flag) => flag.code === 'out_of_stock'));
  const storeName = basket.store?.storeName ?? cart.data?.storeName ?? null;

  if (lines.length === 0) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Your basket is empty</h1>
        <p className="lede">
          Nothing in it yet. Pick an aisle and have a look around — the whole app changes colour
          as you walk through it.
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
      </div>
    );
  }

  return (
    <div className="shell shop-page shop-cart">
      <header className="shop-page__head">
        <p className="eyebrow">Basket</p>
        <h1 className="shop-page__title">
          {storeName !== null ? storeName : 'Your basket'}
        </h1>
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
            <strong>Saved on this device only.</strong> The cart service is not answering, so
            price and stock have not been re-checked. Anything here may have changed at the
            store.
          </p>
        </div>
      ) : null}

      <div className="shop-cart__grid">
        <ul className="shop-cart__lines">
          {lines.map((line) => (
            <li key={line.productId} className="shop-line">
              <div className="shop-line__main">
                <Link href={`/product/${encodeURIComponent(line.productId)}`} className="shop-line__name">
                  {line.name}
                </Link>
                <p className="shop-line__meta">
                  {line.unit !== null ? <span className="mono">{line.unit}</span> : null}
                  {line.unit !== null ? ' · ' : null}
                  <span className="price">{formatPaise(line.pricePaise)}</span> each
                </p>
                <StaleFlagChips flags={line.flags} />
              </div>

              <div className="shop-line__controls">
                <QuantityStepper
                  value={line.qty}
                  max={line.maxQty}
                  label={line.name}
                  size="sm"
                  onChange={(next) => {
                    basket.setQty(line.productId, next);
                  }}
                />
                <p className="shop-line__total price">{formatPaise(line.lineTotalPaise)}</p>
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
            {deliveryFee !== null ? (
              <div>
                <dt>Delivery</dt>
                <dd className="price">{formatPaise(deliveryFee)}</dd>
              </div>
            ) : (
              <div>
                <dt>Delivery</dt>
                <dd className="shop-summary__pending">calculated at checkout</dd>
              </div>
            )}
            <div className="shop-summary__total">
              <dt>Total</dt>
              <dd className="price">{formatPaise(grandTotal)}</dd>
            </div>
          </dl>

          {blocked ? (
            <p className="shop-notice shop-notice--error" role="alert">
              One item is out of stock. Remove it and you can check out — the rest of your
              basket is fine.
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
