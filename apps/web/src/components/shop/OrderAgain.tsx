'use client';

/**
 * "Order again" on a delivered order.
 *
 * ── WHY IT ASKS THE SERVER FIRST ────────────────────────────────────────────
 * The order carries what was paid THEN. Rebuilding the basket from it would
 * put last month's prices on screen and products that are no longer sold into
 * the basket. So the button reads `GET /orders/:id/reorder-preview`, which
 * re-reads every line against the live catalogue, and the basket is filled
 * from the LIVE product rows it returns — today's price, capped at today's
 * stock — through `BasketProvider.addMany`, i.e. the same one-store rules and
 * the same park-and-ask switch as a tap on Add.
 *
 * ── THEN IT SAYS WHAT DID NOT MAKE IT ───────────────────────────────────────
 * Nothing is dropped silently: every line that is unavailable, out of stock or
 * reduced is listed by name, with the quantity that did go in.
 */

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { readReorderPreview, type ReorderLine, type ReorderPreview } from '@/lib/shop/types';
import { useBasket } from './BasketProvider';

type Outcome = 'added' | 'pending' | 'nothing' | 'closed' | 'unavailable';

interface Done {
  preview: ReorderPreview;
  outcome: Outcome;
}

function shortfall(line: ReorderLine): string | null {
  switch (line.status) {
    case 'unavailable':
      return 'no longer sold';
    case 'out_of_stock':
      return 'out of stock right now';
    case 'reduced':
      return `only ${line.qty} of ${line.orderedQty} added`;
    default:
      return null;
  }
}

const HEADLINE: Record<Outcome, (storeName: string) => string> = {
  added: () => 'Added to your basket',
  pending: (store) => `Switch to ${store} to add them`,
  nothing: () => 'Nothing new to add',
  closed: (store) => `${store} is closed right now`,
  unavailable: (store) => `${store} is not taking orders`,
};

const DETAIL: Record<Outcome, string> = {
  added: 'At today’s prices, not the ones on this order.',
  pending:
    'Your basket holds another store’s items. Confirm the switch and it is parked, not deleted.',
  nothing:
    'Everything that is still available is already in your basket, or nothing on this order can be bought today.',
  closed: 'Nothing was added. Try again once the store opens.',
  unavailable: 'Nothing was added — the store is no longer selling on the platform.',
};

export function OrderAgain({ orderId }: { orderId: string }) {
  const { addMany } = useBasket();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const raw = await api.get<unknown>(`/orders/${encodeURIComponent(orderId)}/reorder-preview`);
      const preview = readReorderPreview(raw);
      if (preview === null) throw new Error('unreadable');

      let outcome: Outcome;
      if (preview.store.availability !== 'open') {
        outcome = preview.store.availability;
      } else {
        const items = preview.lines.flatMap((line) =>
          line.product !== null && line.qty > 0 ? [{ product: line.product, qty: line.qty }] : [],
        );
        outcome = addMany(items, {
          vendorId: preview.store.id,
          storeName: preview.store.storeName,
          storeSlug: preview.store.slug,
        });
      }
      setDone({ preview, outcome });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.friendlyMessage
          : 'We could not read this order again. Please try once more.',
      );
    } finally {
      setBusy(false);
    }
  };

  const missing = done === null ? [] : done.preview.lines.filter((line) => shortfall(line) !== null);
  // Only meaningful when the store is open — a closed store's lines are all
  // "unavailable" because of the store, not because of the products.
  const listMissing = done !== null && (done.outcome === 'added' || done.outcome === 'pending' || done.outcome === 'nothing');

  return (
    <>
      <button
        type="button"
        className="mnd-btn mnd-btn--outline mnd-btn--sm"
        onClick={() => {
          void run();
        }}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Checking the shelf…' : 'Order again'}
      </button>

      {error !== null ? (
        <p className="shop-reorder shop-reorder--error" role="alert">
          {error}
        </p>
      ) : null}

      {done !== null ? (
        <div className="shop-reorder" role="status">
          <p className="shop-reorder__title">
            {HEADLINE[done.outcome](done.preview.store.storeName)}
          </p>
          <p className="shop-reorder__detail">{DETAIL[done.outcome]}</p>

          {listMissing && missing.length > 0 ? (
            <>
              <p className="eyebrow">Could not add everything</p>
              <ul className="shop-reorder__list">
                {missing.map((line) => (
                  <li key={line.productId} data-status={line.status}>
                    <span className="shop-reorder__name">{line.name}</span>
                    <span className="shop-reorder__why">{shortfall(line)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {done.outcome === 'added' ? (
            <Link href="/cart" className="mnd-btn mnd-btn--solid mnd-btn--sm shop-reorder__go">
              Review the basket
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
