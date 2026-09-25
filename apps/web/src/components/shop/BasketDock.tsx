'use client';

/**
 * PILLAR 3 — the dock.
 *
 * A basket you can see the contents of. The mass inside rises with what is in
 * it, so fullness is legible before the number is read; the rim flexes when it
 * catches something; the whole object is tinted by the aisle you are standing
 * in. Not a badge with a number.
 *
 * Also the honest home for two things that must never be silent:
 *   · the PARKED basket from a store switch, with a restore action;
 *   · "saved on this device only", when `/cart` is not answering.
 */

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { formatPaise } from '@mandi/design-system';
import { useBasket } from './BasketProvider';

export function BasketDock() {
  const {
    lines,
    count,
    subtotalPaise,
    fullness,
    store,
    isLocalOnly,
    hydrated,
    parked,
    restoreParked,
    discardParked,
    pendingSwitch,
    confirmSwitch,
    cancelSwitch,
    registerDock,
  } = useBasket();

  const dockRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    registerDock(dockRef.current);
    return () => {
      registerDock(null);
    };
  }, [registerDock]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pendingSwitch !== null) dialogRef.current?.focus();
  }, [pendingSwitch]);

  /* Rendered even when empty, so the object is a fixture of the shop rather
     than something that pops into existence. It stays visually quiet. */
  const empty = count === 0;

  return (
    <>
      <div className="shop-dock-region">
        {parked !== null && hydrated ? (
          <div className="shop-parked" role="status">
            <div>
              <p className="shop-parked__title">
                {parked.storeName} basket is parked
              </p>
              <p className="shop-parked__body">
                {parked.lines.length} {parked.lines.length === 1 ? 'item' : 'items'}, kept for
                you. One basket per store keeps an order to one pickup.
              </p>
            </div>
            <div className="shop-parked__actions">
              <button type="button" className="mnd-btn mnd-btn--outline mnd-btn--sm" onClick={restoreParked}>
                Restore it
              </button>
              <button type="button" className="mnd-btn mnd-btn--ghost mnd-btn--sm" onClick={discardParked}>
                Discard
              </button>
            </div>
          </div>
        ) : null}

        <div
          ref={dockRef}
          className="shop-dock"
          data-empty={empty ? 'true' : undefined}
          suppressHydrationWarning
        >
          <Link href="/cart" className="shop-dock__link" aria-label={
            empty ? 'Basket, empty' : `Basket, ${count} ${count === 1 ? 'item' : 'items'}, ${formatPaise(subtotalPaise)}`
          }>
            <span className="shop-dock__vessel" aria-hidden="true">
              {/* The mass. `--shop-fill` is the only thing that animates; the
                  basket body is static so the contents are what you read. */}
              <span
                className="shop-dock__mass"
                style={{ ['--shop-fill' as string]: `${(fullness * 100).toFixed(1)}%` }}
              />
              <svg viewBox="0 0 48 44" className="shop-dock__basket">
                <path
                  className="shop-dock__rim"
                  d="M4 14 H44 L39.5 39 A3 3 0 0 1 36.6 41.5 H11.4 A3 3 0 0 1 8.5 39 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinejoin="round"
                />
                <path
                  d="M16 14 C16 6.5 20 3 24 3 C28 3 32 6.5 32 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <path
                  d="M18 20 L20 35 M28 20 L26 35"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  opacity="0.55"
                />
              </svg>
            </span>

            <span className="shop-dock__text">
              <span className="shop-dock__count">
                {empty ? 'Basket' : `${count} ${count === 1 ? 'item' : 'items'}`}
              </span>
              <span className="shop-dock__total">
                {empty ? (store?.storeName ?? 'Nothing in it yet') : formatPaise(subtotalPaise)}
              </span>
            </span>
          </Link>

          {isLocalOnly && !empty ? (
            <p className="shop-dock__warn" role="status">
              Saved on this device only — the cart service is not answering.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── the store switch ─────────────────────────────────────────────── */}
      {pendingSwitch !== null ? (
        <div className="shop-switch" role="presentation">
          <div className="shop-switch__scrim" onClick={cancelSwitch} aria-hidden="true" />
          <div
            ref={dialogRef}
            className="shop-switch__panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="shop-switch-title"
            aria-describedby="shop-switch-body"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelSwitch();
            }}
          >
            <p className="eyebrow">One store per basket</p>
            <h2 id="shop-switch-title" className="shop-switch__title">
              Start a basket at {pendingSwitch.to.storeName}?
            </h2>
            <p id="shop-switch-body" className="shop-switch__body">
              Your {pendingSwitch.from.storeName} basket ({lines.length}{' '}
              {lines.length === 1 ? 'item' : 'items'}) will be <strong>parked</strong>, not
              deleted. You can restore it from the basket whenever you like.
              <br />
              <span className="shop-switch__why">
                One vendor per order is what makes it one pickup and one rider — which is
                the only way the delivery estimate means anything.
              </span>
            </p>
            <div className="shop-switch__actions">
              <button type="button" className="mnd-btn mnd-btn--solid mnd-btn--md" onClick={confirmSwitch}>
                Park it and switch
              </button>
              <button type="button" className="mnd-btn mnd-btn--ghost mnd-btn--md" onClick={cancelSwitch}>
                Keep shopping here
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
