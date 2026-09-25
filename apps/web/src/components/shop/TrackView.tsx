'use client';

/**
 * ★ PILLAR 4 — THE JOURNEY RIBBON.
 *
 * Tracking is the emotional peak of a delivery app and every competitor wastes
 * it on a grey map with a scooter crawling across it. Here the ribbon is the
 * hero: a vertical route down the page that fills with the aisle colour, each
 * milestone landing as a franked stamp. The map is secondary, desaturated and
 * COLLAPSED by default — and with no Maps key it is a designed placeholder and
 * nothing on this screen is worse off.
 *
 * ── HONESTY RULES ON THIS SCREEN ────────────────────────────────────────────
 * 1. A stale position is labelled stale. If the last `delivery.location_updated`
 *    is older than 30s the rider marker is marked "last seen 2m ago" and the
 *    banner stops claiming to be live. We never extrapolate a position, never
 *    animate the rider onwards on a dead feed, and never show a confident dot
 *    over a socket that has stopped speaking.
 * 2. The connection state is always on screen: live / reconnecting / offline.
 * 3. Status changes arrive over the socket AND are re-fetched, because a socket
 *    that dropped between two events would otherwise leave the ribbon stuck one
 *    stamp behind forever.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MandiMap } from '@mandi/design-system/map';
import { JourneyRibbon } from '@mandi/design-system/journey-ribbon';
import { formatPaise, useAisle } from '@mandi/design-system';
import type { MapMarker } from '@mandi/design-system/map';
import { useShopQuery } from '@/hooks/useShopQuery';
import { useSocket, type DeliveryLocationUpdated, type OrderStatusChanged } from '@/hooks/useSocket';
import { buildJourney, isLiveOrder, ORDER_STATUS_LABEL } from '@/lib/shop/journey';
import { formatAgo, formatEta, isStale } from '@/lib/shop/format';
import { isOrderStatus, readTrack, type LatLng, type OrderStatus, type TrackSnapshot } from '@/lib/shop/types';
import { ConnectionBanner, ErrorNotice, FixtureBanner } from './notices';

interface RiderFix {
  position: LatLng;
  at: string;
  etaMinutes: number | null;
}

export function TrackView({ orderId }: { orderId: string }) {
  const { setAisle } = useAisle();
  const [liveStatus, setLiveStatus] = useState<OrderStatus | null>(null);
  const [liveRider, setLiveRider] = useState<RiderFix | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // Re-render on a timer so "last seen 2m ago" keeps counting while the page
  // sits open. A staleness label frozen at render time reads as fresh.
  const [, tick] = useState(0);

  const track = useShopQuery<TrackSnapshot | null>(
    `/orders/${encodeURIComponent(orderId)}/track`,
    undefined,
    {
      read: useCallback((raw: unknown) => readTrack(raw), []),
      // Belt and braces behind the socket: if the socket is down this is what
      // keeps the ribbon moving, and it costs one request a minute.
      refreshMs: 60_000,
    },
  );

  const order = track.data?.order ?? null;
  const status: OrderStatus | null = liveStatus ?? order?.status ?? null;
  const live = status !== null && isLiveOrder(status);

  /* The order wears its own aisle colour for the whole journey. */
  const aisleKey = order?.aisleKey ?? null;
  useEffect(() => {
    setAisle(aisleKey);
    return () => {
      setAisle(null);
    };
  }, [aisleKey, setAisle]);

  useEffect(() => {
    const id = window.setInterval(() => {
      tick((n) => n + 1);
    }, 10_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const onOrderStatus = useCallback(
    (payload: OrderStatusChanged) => {
      if (payload.orderId !== orderId) return;
      if (isOrderStatus(payload.to)) setLiveStatus(payload.to);
      // Pull the authoritative record too: the event carries the transition,
      // not the timestamps, items or pricing the rest of this page renders.
      track.refetch();
    },
    [orderId, track],
  );

  const onRiderLocation = useCallback(
    (payload: DeliveryLocationUpdated) => {
      if (payload.orderId !== orderId) return;
      setLiveRider({
        position: { lat: payload.lat, lng: payload.lng },
        at: payload.at,
        etaMinutes: payload.etaMinutes,
      });
    },
    [orderId],
  );

  const socket = useSocket({
    enabled: live,
    orderId,
    onOrderStatus,
    onRiderLocation,
  });

  /* The socket wins when it has spoken; otherwise the last fetched snapshot.
     Memoised because it feeds the marker list, and a fresh object literal every
     render would rebuild the markers and restart the rider's glide. */
  const snapshotRider = track.data?.rider ?? null;
  const rider = useMemo<RiderFix | null>(
    () =>
      liveRider ??
      (snapshotRider === null
        ? null
        : {
            position: snapshotRider.position,
            at: snapshotRider.at,
            etaMinutes: snapshotRider.etaMinutes,
          }),
    [liveRider, snapshotRider],
  );

  const riderStale = rider === null ? true : isStale(rider.at);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    if (order?.storeLocation) {
      out.push({
        id: 'store',
        position: order.storeLocation,
        kind: 'store',
        label: order.storeName ?? 'Store',
      });
    }
    if (order?.address?.location) {
      out.push({ id: 'drop', position: order.address.location, kind: 'drop', label: 'Your address' });
    }
    if (rider !== null) {
      out.push({
        id: 'rider',
        position: rider.position,
        kind: 'rider',
        label: riderStale
          ? `Rider — last seen ${formatAgo(rider.at) ?? 'a while ago'}`
          : 'Rider, moving now',
      });
    }
    return out;
  }, [order?.storeLocation, order?.storeName, order?.address?.location, rider, riderStale]);

  /* ── loading / failure ─────────────────────────────────────────────── */

  if (track.loading && !track.hasLoadedOnce) {
    return (
      <div className="shell shop-page">
        <span className="shop-skel shop-skel--line" style={{ width: '34%', height: '2rem' }} />
        <span className="shop-skel shop-skel--block" style={{ height: '22rem' }} />
      </div>
    );
  }

  if (track.error !== null) {
    return (
      <div className="shell shop-page">
        <ErrorNotice error={track.error} onRetry={track.refetch} what="this order" />
        <p className="shop-empty">
          <Link href="/orders">Back to your orders</Link>
        </p>
      </div>
    );
  }

  if (order === null || status === null) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Order not found</h1>
        <p className="lede">
          We could not find that order on your account.{' '}
          <Link href="/orders">See your orders</Link>.
        </p>
      </div>
    );
  }

  const journey = buildJourney({ ...order, status });
  const etaMinutes = rider?.etaMinutes ?? order.etaMinutes;
  const eta = live ? formatEta(etaMinutes) : null;

  return (
    <div className="shell shop-page shop-track">
      {track.isFixture ? <FixtureBanner endpoint={`GET /orders/${orderId}/track`} /> : null}

      <header className="shop-page__head">
        <p className="eyebrow">
          <Link href="/orders">Orders</Link> · {order.storeName ?? 'Store'}
        </p>
        <h1 className="shop-page__title">{ORDER_STATUS_LABEL[status]}</h1>
      </header>

      <div className="shop-track__grid">
        <div className="shop-track__ribbon">
          <JourneyRibbon
            milestones={journey.milestones}
            progress={journey.progress}
            orderNo={order.orderNo}
            eta={eta ?? undefined}
            cancelled={journey.cancelled}
            footer={
              live ? (
                <ConnectionBanner
                  state={socket.state}
                  detail={socket.detail}
                  lastEventAt={socket.lastEventAt}
                  onRetry={socket.reconnect}
                />
              ) : (
                <p className="shop-track__closed">
                  This order is finished, so there is nothing left to follow live.
                </p>
              )
            }
          />

          {/* The rider, stated honestly. */}
          {live ? (
            <section className="shop-rider" aria-label="Rider">
              <div>
                <p className="shop-rider__name">
                  {order.rider?.name ?? 'A rider is on this order'}
                </p>
                <p className="shop-rider__pos" data-stale={riderStale ? 'true' : undefined}>
                  {rider === null ? (
                    'No position reported yet. The ribbon above is still accurate.'
                  ) : riderStale ? (
                    <>
                      Last known position · {formatAgo(rider.at) ?? 'a while ago'}. We are not
                      guessing where they are now.
                    </>
                  ) : (
                    <>Moving now · updated {formatAgo(rider.at) ?? 'just now'}</>
                  )}
                </p>
              </div>
              {order.rider?.phoneMasked ? (
                <span className="shop-rider__phone mono">{order.rider.phoneMasked}</span>
              ) : null}
            </section>
          ) : null}

          {/* ── the map: secondary, desaturated, collapsed ─────────────── */}
          <section className="shop-track__map">
            <button
              type="button"
              className="shop-track__maptoggle"
              aria-expanded={mapOpen}
              onClick={() => {
                setMapOpen((open) => !open);
              }}
            >
              <span>{mapOpen ? 'Hide the map' : 'Show the map'}</span>
              <span className="shop-track__mapnote">
                The ribbon above is the full story — the map is only context.
              </span>
            </button>

            {mapOpen ? (
              <div className="shop-track__mapbody" data-stale={riderStale ? 'true' : undefined}>
                <MandiMap
                  center={
                    rider?.position ??
                    order.address?.location ??
                    order.storeLocation ?? { lat: 12.9716, lng: 77.5946 }
                  }
                  markers={markers}
                  polyline={track.data?.route}
                  fitBounds={markers.length > 1}
                  height={320}
                  interactive
                  ariaLabel="Route from the store to your address"
                />
                {riderStale && rider !== null ? (
                  <p className="shop-track__stale" role="status">
                    Showing the last position we received, {formatAgo(rider.at) ?? 'a while ago'}.
                    Not a live pin.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        {/* ── the order itself ──────────────────────────────────────────── */}
        <aside className="shop-summary" aria-label="Order detail">
          <h2 className="shop-summary__title">{order.orderNo}</h2>

          <ul className="shop-summary__items">
            {order.items.map((item) => (
              <li key={item.productId} data-unfulfilled={item.fulfilled ? undefined : 'true'}>
                <span>
                  {item.name} <span className="mono">× {item.qty}</span>
                  {!item.fulfilled ? (
                    <span className="shop-summary__missing"> · not available, refunded</span>
                  ) : null}
                </span>
                <span className="price">{formatPaise(item.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>

          <dl className="shop-summary__rows">
            <div>
              <dt>Items</dt>
              <dd className="price">{formatPaise(order.pricing.itemsSubtotalPaise)}</dd>
            </div>
            {order.pricing.discountPaise > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd className="price">−{formatPaise(order.pricing.discountPaise)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Delivery</dt>
              <dd className="price">{formatPaise(order.pricing.deliveryFeePaise)}</dd>
            </div>
            <div className="shop-summary__total">
              <dt>{order.paymentMethod === 'cod' ? 'Pay on delivery' : 'Paid'}</dt>
              <dd className="price">{formatPaise(order.pricing.grandTotalPaise)}</dd>
            </div>
          </dl>

          {order.address !== null ? (
            <div className="shop-summary__addr">
              <h3>Delivering to</h3>
              <p>
                <strong>{order.address.label}</strong>
                <br />
                {[order.address.line1, order.address.line2, order.address.city, order.address.pincode]
                  .filter((part) => part !== null && part !== '')
                  .join(', ')}
              </p>
            </div>
          ) : null}

          {/* TODO(worker-b): GET /orders/:id should return the plain 4-digit
              delivery OTP to the CUSTOMER only (the DB stores a hash — plan
              §5.1). Until it does, the ribbon tells them a code is needed and
              this panel does not invent one. */}

          {live && status === 'PLACED' ? (
            <p className="shop-summary__note">
              Cancelling is free until the store accepts. After that it needs approval from the
              store or an admin.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
