'use client';

/**
 * Order history.
 *
 * Live orders sit at the top with a Track link; everything else is a plain,
 * scannable record. Status is a word and a shape, never a colour on its own.
 */

import Link from 'next/link';
import { useCallback } from 'react';
import { formatPaise } from '@mandi/design-system';
import { useShopQuery } from '@/hooks/useShopQuery';
import { formatDateTime } from '@/lib/shop/format';
import { ORDER_STATUS_LABEL, isLiveOrder } from '@/lib/shop/journey';
import { readOrder, readPaged, type Order, type Paged } from '@/lib/shop/types';
import { ErrorNotice, FixtureBanner } from './notices';

function StatusPill({ order }: { order: Order }) {
  const live = isLiveOrder(order.status);
  const bad =
    order.status === 'CANCELLED' ||
    order.status === 'REJECTED' ||
    order.status === 'DELIVERY_FAILED';

  return (
    <span className="shop-pill" data-tone={bad ? 'crit' : live ? 'live' : 'done'}>
      <span className="shop-pill__dot" aria-hidden="true" />
      {ORDER_STATUS_LABEL[order.status]}
    </span>
  );
}

export function OrdersView() {
  const orders = useShopQuery<Paged<Order>>(
    '/orders',
    undefined,
    {
      read: useCallback((raw: unknown) => readPaged(raw, readOrder), []),
      // A live order on this screen should not need a reload to move on. The
      // socket is only opened on the track page; a slow poll is enough here.
      refreshMs: 60_000,
    },
  );

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
                  <StatusPill order={order} />
                </div>

                <p className="shop-order__store">
                  {order.storeName ?? 'Store'}
                  {placed !== null ? <span className="shop-order__when"> · {placed}</span> : null}
                </p>

                <p className="shop-order__items">
                  {order.items
                    .slice(0, 3)
                    .map((item) => `${item.name} × ${item.qty}`)
                    .join(', ')}
                  {order.items.length > 3 ? ` and ${order.items.length - 3} more` : ''}
                </p>

                <div className="shop-order__foot">
                  <span className="price">{formatPaise(order.pricing.grandTotalPaise)}</span>
                  <span className="shop-order__pay">
                    {order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}
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
