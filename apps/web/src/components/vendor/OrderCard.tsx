'use client';

/**
 * One order, as a card on the board.
 *
 * ── WHAT IS ON IT, AND WHY ──────────────────────────────────────────────────
 * Order number, customer, the lines, the total, and — the one a shop owner
 * actually reads first — how many minutes this has been waiting. Everything
 * else was cut. A card that shows the address, the payment id and the coupon
 * code is a card nobody can scan during a rush.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 * The left rule carries the aisle hue of the order's STATUS (lib/vendor/orders
 * → STATUS_AISLE). That is the vendor surface's one sanctioned use of the
 * chromatic palette (plan §2.4). The status word and its pill glyph are beside
 * it, always, because colour never carries meaning alone (plan §2.6).
 *
 * ── THE WAIT CLOCK ──────────────────────────────────────────────────────────
 * `now` is passed in rather than read here: one interval in the parent, not one
 * per card, and nothing non-deterministic during render. Before mount it is
 * null and the card shows a dash rather than a number that would differ between
 * the server's clock and the browser's.
 */

import Link from 'next/link';
import { Money, StatusPill } from '@/components/admin';
import { STATUS_AISLE, minutesWaiting, urgencyOf } from '@/lib/vendor/orders';
import type { VendorOrder } from '@/lib/vendor/types';

export interface OrderCardProps {
  order: VendorOrder;
  /** epoch ms, or null before mount */
  now: number | null;
  /** stagger index inside its lane */
  index: number;
  /** arrived since this session started — pulses ONCE, then holds */
  fresh?: boolean;
  /** the primary and secondary actions for this lane */
  actions?: React.ReactNode;
}

export function OrderCard({ order, now, index, fresh = false, actions }: OrderCardProps) {
  const minutes = minutesWaiting(order, now);
  const urgency = urgencyOf(order.status, minutes);

  return (
    <article
      className="ven-card"
      data-aisle={STATUS_AISLE[order.status]}
      data-urgency={urgency}
      data-fresh={fresh ? 'true' : undefined}
      style={{ ['--ven-i' as string]: String(Math.min(index, 12)) }}
    >
      <div className="ven-card__top">
        <Link className="ven-card__no" href={`/vendor/orders/${order.id}`}>
          {order.orderNo}
        </Link>
        <span className="ven-card__wait">
          {minutes === null ? '—' : `${minutes}m`}
          <span className="adm-sr">
            {minutes === null
              ? ''
              : ` waiting${urgency === 'late' ? ', overdue' : urgency === 'warn' ? ', getting late' : ''}`}
          </span>
        </span>
      </div>

      <p className="ven-card__customer">{order.customerName}</p>

      <ul className="ven-card__items">
        {order.preview.slice(0, 4).map((line, i) => (
          <li key={`${line.name}-${i}`}>
            <span className="ven-card__qty">{line.qty}×</span>
            <span className="ven-card__line">{line.name}</span>
          </li>
        ))}
        {order.preview.length > 4 ? (
          <li>
            <span className="ven-card__qty" aria-hidden="true">
              +
            </span>
            <span className="ven-card__line">
              {order.preview.length - 4} more {order.preview.length - 4 === 1 ? 'line' : 'lines'}
            </span>
          </li>
        ) : null}
      </ul>

      <div className="ven-card__foot">
        <StatusPill status={order.status} kind="order" />
        <span className="ven-paytag" data-method={order.paymentMethod}>
          {order.paymentMethod === 'cod' ? 'COD' : 'PAID'}
        </span>
        <span className="ven-card__total">
          <Money value={order.total} />
        </span>
      </div>

      {actions ? <div className="ven-card__actions">{actions}</div> : null}
    </article>
  );
}

/** The card-shaped skeleton. Same height as the real thing, so nothing jumps. */
export function OrderCardSkeleton({ index }: { index: number }) {
  return (
    <div className="ven-card" aria-hidden="true" style={{ ['--ven-i' as string]: String(index) }}>
      <div className="adm-skel adm-skel--line" style={{ width: '48%' }} />
      <div className="adm-skel adm-skel--line" style={{ width: '64%', marginTop: 10 }} />
      <div className="adm-skel adm-skel--line" style={{ width: '90%', marginTop: 14 }} />
      <div className="adm-skel adm-skel--line" style={{ width: '82%', marginTop: 6 }} />
      <div className="adm-skel adm-skel--line" style={{ width: '40%', marginTop: 14, height: 18 }} />
    </div>
  );
}
