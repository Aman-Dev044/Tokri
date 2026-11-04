'use client';

/**
 * Order history.
 *
 * Live orders get a Track link; everything else is a plain, scannable record.
 * Status is a word and a shape, never a colour on its own.
 *
 * ── WHAT AN ORDER ROW ACTUALLY IS ───────────────────────────────────────────
 * `GET /orders` returns `OrderSummary`, which is deliberately thin:
 *
 *   { id, orderNo, status, placedAt, itemCount, grandTotal,
 *     payment{method,status}, store{id,storeName,slug}|null, preview[] }
 *
 * No `items[]`, no `pricing` object, no top-level `storeName`. This screen read
 * `order.items`, `order.pricing.grandTotalPaise` and `order.storeName` — so
 * every row rendered an empty item line and a total of ₹0.00 while the API was
 * answering perfectly. It now reads `preview` (the first few item NAMES),
 * `itemCount`, the flat `grandTotal` and `store.storeName`.
 *
 * ── ORDER AGAIN ─────────────────────────────────────────────────────────────
 * A DELIVERED row carries an "Order again" button. It never rebuilds the basket
 * from this row (which has no items and old prices); see `OrderAgain`.
 *
 * A PLACED row carries "Cancel order" — free until the store accepts; see
 * `CancelOrder` for the 409 once it has.
 */

import Link from 'next/link';
import { useCallback } from 'react';
import { formatPaise } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { formatDateTime } from '@/lib/shop/format';
import { ORDER_STATUS_LABEL, isLiveOrder } from '@/lib/shop/journey';
import { readOrderSummary, readPaged, type OrderSummary, type Paged } from '@/lib/shop/types';
import { ErrorNotice, FixtureBanner } from './notices';
import { OrderAgain } from './OrderAgain';
import { CancelOrder } from './CancelOrder';

function StatusPill({ status }: { status: OrderSummary['status'] }) {
  const live = isLiveOrder(status);
  const bad = status === 'CANCELLED' || status === 'REJECTED' || status === 'DELIVERY_FAILED';

  return (
    <span className="shop-pill" data-tone={bad ? 'crit' : live ? 'live' : 'done'}>
      <span className="shop-pill__dot" aria-hidden="true" />
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

/** "Tomatoes, Curd and 2 more" — built from `preview` plus `itemCount`. */
function previewLine(order: OrderSummary): string {
  if (order.preview.length === 0) {
    return `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`;
  }
  const shown = order.preview.join(', ');
  const rest = order.itemCount - order.preview.length;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

export function OrdersView() {
  const orders = useShopQuery<Paged<OrderSummary>>('/orders', undefined, {
    read: useCallback((raw: unknown) => readPaged(raw, readOrderSummary), []),
    // A live order on this screen should not need a reload to move on. The
    // socket is only opened on the track page; a slow poll is enough here.
    refreshMs: 60_000,
  });

  const rows = orders.data?.data ?? [];

  return (
    <div className="shell shop-page">
      <header className="shop-page__head">
        <p className="eyebrow">Your account</p>
        <h1 className="shop-page__title">Orders</h1>
      </header>

      {orders.isFixture ? <FixtureBanner endpoint="GET /orders" /> : null}
      {orders.error !== null ? (
        <ErrorNotice error={orders.error} onRetry={orders.refetch} what="your orders" />
      ) : null}

      {orders.loading && !orders.hasLoadedOnce ? (
        <ul className="shop-orders">
          {[0, 1, 2].map((i) => (
            <li key={i} className="shop-order shop-order--skeleton" aria-hidden="true">
              <span className="shop-skel shop-skel--line" style={{ width: '32%' }} />
              <span className="shop-skel shop-skel--line shop-skel--small" style={{ width: '58%' }} />
            </li>
          ))}
        </ul>
      ) : rows.length > 0 ? (
        <ul className="shop-orders">
          {rows.map((order) => {
            const live = isLiveOrder(order.status);
            const placed = formatDateTime(order.placedAt);
            return (
              <li key={order.id} className="shop-order" data-live={live ? 'true' : undefined}>
                <div className="shop-order__head">
                  <p className="shop-order__no mono">{order.orderNo}</p>
                  <StatusPill status={order.status} />
                </div>

                <p className="shop-order__store">
                  {order.store?.storeName ?? 'Store'}
                  {placed !== null ? <span className="shop-order__when"> · {placed}</span> : null}
                </p>

                <p className="shop-order__items">{previewLine(order)}</p>

                <div className="shop-order__foot">
                  <span className="price">{formatPaise(order.grandTotal)}</span>
                  <span className="shop-order__pay">
                    {order.payment.method === 'cod'
                      ? order.payment.status === 'paid'
                        ? 'Paid on delivery'
                        : 'Cash on delivery'
                      : order.payment.method === 'online'
                        ? order.payment.status === 'paid'
                          ? 'Paid online'
                          : 'Online payment pending'
                        : 'Payment method unknown'}
                  </span>
                  <Link
                    href={`/orders/${encodeURIComponent(order.id)}/track`}
                    className={
                      live
                        ? 'mnd-btn mnd-btn--solid mnd-btn--sm'
                        : 'mnd-btn mnd-btn--ghost mnd-btn--sm'
                    }
                  >
                    {live ? 'Track it' : 'See the journey'}
                  </Link>
                  {/* A fixture row has a made-up id the API would 404 on. */}
                  {order.status === 'DELIVERED' && !orders.isFixture ? (
                    <OrderAgain orderId={order.id} />
                  ) : null}
                  {order.status === 'PLACED' && !orders.isFixture ? (
                    <CancelOrder orderId={order.id} orderNo={order.orderNo} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : orders.error === null ? (
        <p className="shop-empty">
          No orders yet. <Link href="/stores">Have a look at the stores near you</Link>.
        </p>
      ) : null}
    </div>
  );
}
