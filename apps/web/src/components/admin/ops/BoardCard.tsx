'use client';

/**
 * One live order, as it appears on the board.
 *
 * ── WHAT IS ON IT, AND WHY IN THIS ORDER ────────────────────────────────────
 * Order number first (it is what gets read out on a phone call), then the SLA,
 * then who is involved, then the money. A dispatcher scans the left edge of a
 * lane looking for trouble; trouble has to be on the first line.
 *
 * ── NULLABLE NAMES ──────────────────────────────────────────────────────────
 * `vendorName`, `customerName` and `riderName` are nullable on the wire: the
 * lookup is a separate collection, and an unresolvable reference must not take
 * a live order off the board. Each gets a word, never an empty gap — a blank
 * where a store name belongs reads as a rendering bug.
 *
 * ── MOTION ──────────────────────────────────────────────────────────────────
 * `justMoved` is set for one poll cycle when the order changed lane. The card
 * arrives with a short slide and a one-shot ring, which is the only way a
 * change is visible on a screen nobody is staring at. It is not a loop, and it
 * is off entirely under `prefers-reduced-motion`.
 */

import { Money } from '../primitives';
import { IconRiders } from '../icons';
import { SlaIndicator } from './SlaIndicator';
import type { OpsOrderCard } from '@/lib/admin/types';

export interface BoardCardProps {
  card: OpsOrderCard;
  /** changed lane since the last poll */
  justMoved?: boolean;
  /** stagger index within the lane */
  index?: number;
  onOpen: (card: OpsOrderCard) => void;
}

export function BoardCardView({ card, justMoved = false, index = 0, onOpen }: BoardCardProps) {
  return (
    <button
      type="button"
      className="adm-card"
      data-sla={card.sla.state}
      data-moved={justMoved ? 'true' : undefined}
      style={{ ['--adm-i' as string]: String(Math.min(index, 14)) }}
      onClick={() => onOpen(card)}
      aria-label={`Order ${card.orderNo}, ${card.vendorName ?? 'unknown store'}, ${card.minutesInStatus} minutes in this status`}
    >
      <span className="adm-card__top">
        <span className="adm-card__no adm-num">{card.orderNo}</span>
        <SlaIndicator sla={card.sla} pulseKey={`${card.id}:${card.sla.state}`} />
      </span>

      <span className="adm-card__vendor">{card.vendorName ?? 'Store not resolved'}</span>

      <span className="adm-card__line">
        <span className="adm-card__customer">{card.customerName ?? 'Customer not resolved'}</span>
        <span className="adm-card__sep" aria-hidden="true">
          ·
        </span>
        <span className="adm-dim">
          {card.itemCount} {card.itemCount === 1 ? 'item' : 'items'}
        </span>
      </span>

      <span className="adm-card__foot">
        {/* INTEGER PAISE straight from the API. Nothing divides by 100 here. */}
        <Money value={card.grandTotal} className="adm-card__total" />
        <span className="adm-card__mins adm-num" title="Minutes in this status">
          {card.minutesInStatus}m
        </span>
      </span>

      <span className="adm-card__rider">
        {card.riderId === null ? (
          <span className="adm-dim">No rider yet</span>
        ) : (
          <>
            <IconRiders className="adm-card__ridericon" />
            {card.riderName ?? 'Rider not resolved'}
          </>
        )}
      </span>
    </button>
  );
}
