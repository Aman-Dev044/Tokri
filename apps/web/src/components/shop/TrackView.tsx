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
 * ── TWO ENDPOINTS, BECAUSE THEY RETURN DIFFERENT THINGS ─────────────────────
 *   GET /orders/:id/track  → TrackView: orderId, orderNo, status,
 *                            statusHistory, eta{minutes,at,basis},
 *                            vendor{id,name,location}, drop{…}, rider{…}
 *   GET /orders/:id        → OrderDetail: items, pricing, address, canCancel
 *
 * A `TrackView` is NOT an order. It has no items, no pricing, no address and no
 * aisle key — this screen used to read all of those off the track payload and
 * rendered an empty basket with a ₹0.00 total beside a live ribbon. The order
 * panel now comes from `GET /orders/:id`, which is what actually returns it.
 *
 * ── HONESTY RULES ON THIS SCREEN ────────────────────────────────────────────
 * 1. A stale position is labelled stale. The API reports the rider's fix
 *    exactly as last received, with `lastSeenAt` and `ageSeconds`, and never
 *    interpolates it. Neither do we: no extrapolation, no animating onwards on
 *    a dead feed, no confident dot over a socket that has stopped speaking.
 * 2. The connection state is always on screen: live / reconnecting / offline.
 * 3. `eta.basis` says where the time came from (`sla` — the promise, not a live
 *    estimate). It is never dressed up as a live countdown.
 * 4. Status changes arrive over the socket AND are re-fetched, because a socket
 *    that dropped between two events would otherwise leave the ribbon stuck one
 *    stamp behind forever.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MandiMap } from '@mandi/design-system/map';
import { JourneyRibbon } from '@mandi/design-system/journey-ribbon';
import { formatPaise } from '@mandi/design-system';
import type { MapMarker } from '@mandi/design-system/map';
import { useShopQuery } from '@/hooks/useShopQuery';
import { useSocket, type DeliveryLocationUpdated, type OrderStatusChanged } from '@/hooks/useSocket';
import { buildJourney, isLiveOrder, ORDER_STATUS_LABEL } from '@/lib/shop/journey';
import { formatAgo, formatEta, isStale } from '@/lib/shop/format';
import {
  isOrderStatus,
  readOrderDetail,
  readTrack,
  type LatLng,
  type OrderDetail,
  type OrderStatus,
  type Track,
} from '@/lib/shop/types';
import { ConnectionBanner, ErrorNotice, FixtureBanner } from './notices';

interface RiderFix {
  position: LatLng;
  at: string;
}

export function TrackView({ orderId }: { orderId: string }) {
  const [liveStatus, setLiveStatus] = useState<OrderStatus | null>(null);
  const [liveRider, setLiveRider] = useState<RiderFix | null>(null);
  const [liveEta, setLiveEta] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // Re-render on a timer so "last seen 2m ago" keeps counting while the page
  // sits open. A staleness label frozen at render time reads as fresh.
  const [, tick] = useState(0);

  const track = useShopQuery<Track | null>(
    `/orders/${encodeURIComponent(orderId)}/track`,
    undefined,
    {
      read: useCallback((raw: unknown) => readTrack(raw), []),
      // Belt and braces behind the socket: if the socket is down this is what
      // keeps the ribbon moving, and it costs one request a minute.
      refreshMs: 60_000,
    },
  );

  /* The items, the money and the address — none of which are on the track
     response. A failure here dims the side panel; it never blanks the ribbon. */
  const detail = useShopQuery<OrderDetail | null>(
    `/orders/${encodeURIComponent(orderId)}`,
    undefined,
    { read: useCallback((raw: unknown) => readOrderDetail(raw), []) },
  );

  const snapshot = track.data;
  const order = detail.data;
  const status: OrderStatus | null = liveStatus ?? snapshot?.status ?? order?.status ?? null;
  const live = status !== null && isLiveOrder(status);

  useEffect(() => {
    const id = window.setInterval(() => {
      tick((n) => n + 1);
    }, 10_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const refetchTrack = track.refetch;
  const refetchDetail = detail.refetch;

  const onOrderStatus = useCallback(
    (payload: OrderStatusChanged) => {
      if (payload.orderId !== orderId) return;
      if (isOrderStatus(payload.to)) setLiveStatus(payload.to);
      // Pull the authoritative records too: the event carries the transition,
      // not the timestamps, items or pricing the rest of this page renders.
      refetchTrack();
      refetchDetail();
    },
    [orderId, refetchTrack, refetchDetail],
  );

  const onRiderLocation = useCallback(
    (payload: DeliveryLocationUpdated) => {
      if (payload.orderId !== orderId) return;
      setLiveRider({ position: { lat: payload.lat, lng: payload.lng }, at: payload.at });
      setLiveEta(payload.etaMinutes);
    },
    [orderId],
  );

  const socket = useSocket({ enabled: live, orderId, onOrderStatus, onRiderLocation });

  /* The socket wins when it has spoken; otherwise the last fetched snapshot.
     Memoised because it feeds the marker list, and a fresh object literal every
     render would rebuild the markers and restart the rider's glide. */
  const snapshotRider = snapshot?.rider ?? null;
  const rider = useMemo<RiderFix | null>(() => {
    if (liveRider !== null) return liveRider;
    if (snapshotRider === null || snapshotRider.location === null) return null;
    return {
      position: snapshotRider.location,
      // `lastSeenAt` is the rider's own clock. With no fix reported the API
      // sends null, and a null must NOT become "now" — that would turn "we
      // have never heard from this rider" into "seen just now".
      at: snapshotRider.lastSeenAt ?? '',
    };
  }, [liveRider, snapshotRider]);

  const riderStale = rider === null ? true : isStale(rider.at);

  const vendorLocation = snapshot?.vendor?.location ?? null;
  const dropLocation = snapshot?.drop?.location ?? null;
  const vendorName = snapshot?.vendor?.name ?? order?.store?.storeName ?? 'Store';

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    if (vendorLocation !== null) {
      out.push({ id: 'store', position: vendorLocation, kind: 'store', label: vendorName });
    }
    if (dropLocation !== null) {
      out.push({ id: 'drop', position: dropLocation, kind: 'drop', label: 'Your address' });
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
  }, [vendorLocation, vendorName, dropLocation, rider, riderStale]);

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

  if (snapshot === null || status === null) {
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

  const journey = buildJourney({
    status,
    statusHistory: snapshot.statusHistory,
    // The track payload has no `placedAt`; its history always opens with the
    // PLACED transition, so the ribbon reads the stamp from there.
    placedAt: order?.placedAt ?? null,
  });

  const etaMinutes = liveEta ?? snapshot.eta.minutes;
  const eta = live && snapshot.eta.basis === 'sla' ? formatEta(etaMinutes) : null;
  const mapCenter = rider?.position ?? dropLocation ?? vendorLocation;

  return (
    <div className="shell shop-page shop-track">
      {track.isFixture ? <FixtureBanner endpoint={`GET /orders/${orderId}/track`} /> : null}

      <header className="shop-page__head">
        <p className="eyebrow">
          <Link href="/orders">Orders</Link> · {vendorName}
        </p>
        <h1 className="shop-page__title">{ORDER_STATUS_LABEL[status]}</h1>
      </header>

      <div className="shop-track__grid">
        <div className="shop-track__ribbon">
          <JourneyRibbon
            milestones={journey.milestones}
            progress={journey.progress}
            orderNo={snapshot.orderNo}
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

          {/* The promise, named as a promise. `basis: 'sla'` is the delivery
              window this store committed to — not a live estimate off the
              rider's position, and the copy must not imply otherwise. */}
          {live && eta !== null ? (
            <p className="shop-track__closed">
              {eta} is the window this store promised, not a live estimate from the rider’s
              position.
            </p>
          ) : null}

          {/* The rider, stated honestly. */}
          {live ? (
            <section className="shop-rider" aria-label="Rider">
              <div>
                <p className="shop-rider__name">
                  {snapshot.rider?.name ?? 'No rider assigned yet'}
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
              {snapshot.rider !== null && snapshot.rider.phone !== '' ? (
                <a className="shop-rider__phone mono" href={`tel:${snapshot.rider.phone}`}>
                  {snapshot.rider.phone}
                </a>
              ) : null}
            </section>
          ) : null}

          {/* ── the map: secondary, desaturated, collapsed ─────────────── */}
          <section className="shop-track__map">
            <button
              type="button"
              className="shop-track__maptoggle"
              aria-expanded={mapOpen}
              disabled={mapCenter === null}
              onClick={() => {
                setMapOpen((open) => !open);
              }}
            >
              <span>
                {mapCenter === null
                  ? 'No positions to map yet'
                  : mapOpen
                    ? 'Hide the map'
                    : 'Show the map'}
              </span>
              <span className="shop-track__mapnote">
                The ribbon above is the full story — the map is only context.
              </span>
            </button>

            {mapOpen && mapCenter !== null ? (
              <div className="shop-track__mapbody" data-stale={riderStale ? 'true' : undefined}>
                {/* No `polyline`: the API does not return a route and drawing a
                    straight line between two pins would be a road we invented. */}
                <MandiMap
                  center={mapCenter}
                  markers={markers}
                  fitBounds={markers.length > 1}
                  height={320}
                  interactive
                  ariaLabel="The store, your address and the rider's last position"
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

        {/* ── the order itself, from GET /orders/:id ────────────────────── */}
        <aside className="shop-summary" aria-label="Order detail">
          <h2 className="shop-summary__title">{snapshot.orderNo}</h2>

          {detail.error !== null ? (
            <ErrorNotice
              error={detail.error}
              onRetry={detail.refetch}
              what="the items on this order"
            />
          ) : order === null ? (
            <p className="shop-summary__note">Loading the items on this order…</p>
          ) : (
            <>
              <ul className="shop-summary__items">
                {order.items.map((item) => (
                  <li key={item.productId} data-unfulfilled={item.fulfilled ? undefined : 'true'}>
                    <span>
                      {item.name} <span className="mono">× {item.qty}</span>
                      {!item.fulfilled ? (
                        <span className="shop-summary__missing"> · not available, refunded</span>
                      ) : null}
                    </span>
                    <span className="price">{formatPaise(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>

              <dl className="shop-summary__rows">
                <div>
                  <dt>Items</dt>
                  <dd className="price">{formatPaise(order.pricing.itemsSubtotal)}</dd>
                </div>
                {order.pricing.discount > 0 ? (
                  <div>
                    <dt>Discount</dt>
                    <dd className="price">−{formatPaise(order.pricing.discount)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Delivery</dt>
                  <dd className="price">{formatPaise(order.pricing.deliveryFee)}</dd>
                </div>
                {order.pricing.taxes > 0 ? (
                  <div>
                    <dt>Taxes</dt>
                    <dd className="price">{formatPaise(order.pricing.taxes)}</dd>
                  </div>
                ) : null}
                <div className="shop-summary__total">
                  <dt>
                    {order.payment.method === 'cod'
                      ? order.payment.status === 'paid'
                        ? 'Paid on delivery'
                        : 'Pay on delivery'
                      : order.payment.status === 'paid'
                        ? 'Paid'
                        : 'Total'}
                  </dt>
                  <dd className="price">{formatPaise(order.pricing.grandTotal)}</dd>
                </div>
              </dl>

              {order.address !== null ? (
                <div className="shop-summary__addr">
                  <h3>Delivering to</h3>
                  <p>
                    {order.address.label !== null ? (
                      <>
                        <strong>{order.address.label}</strong>
                        <br />
                      </>
                    ) : null}
                    {[
                      order.address.line1,
                      order.address.line2,
                      order.address.city,
                      order.address.pincode,
                    ]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(', ')}
                  </p>
                </div>
              ) : null}

              {/* The 4-digit proof-of-delivery code is returned by
                  `POST /checkout` EXACTLY ONCE and only its hash is stored, so
                  `GET /orders/:id` cannot return it and this panel does not
                  invent one.
                  TODO(api): a customer-only `GET /orders/:id/delivery-otp`, or
                  the SMS delivery noted in `CheckoutService.PlacedOrder`, so a
                  customer who closed the confirmation screen can still find it. */}
              {live ? (
                <p className="shop-summary__note">
                  The rider will ask for the 4-digit code from your order confirmation. We
                  cannot show it again here — only its hash is stored.
                </p>
              ) : null}

              {order.canCancel ? (
                <p className="shop-summary__note">
                  Cancelling is free until the store accepts. After that it needs approval from
                  the store or an admin.
                </p>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
