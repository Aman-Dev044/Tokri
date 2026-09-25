'use client';

/**
 * One column of the live board.
 *
 * ── THE TRUNCATION NOTICE ───────────────────────────────────────────────────
 * The server caps each lane at 50 cards and sets `truncated`. A lane that says
 * "Preparing 61" and shows 50 cards, with nothing saying why, quietly lies
 * about the size of the backlog. So the header count is always the SERVER'S
 * `total`, and a capped lane says so in words at the bottom of the column with
 * a way through to the full list.
 *
 * ── THE LABEL IS THE SERVER'S ───────────────────────────────────────────────
 * Each lane carries its own `label`. Using it rather than a local map means a
 * lane renamed in the API is renamed here the same day, with no deploy of this
 * file and no window where the two disagree.
 *
 * ── SCROLLING ───────────────────────────────────────────────────────────────
 * Each lane scrolls inside itself; the board scrolls sideways inside its own
 * container. The page body never scrolls sideways — that is the house rule
 * that keeps a board from dragging the whole console off-screen.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OpsBoardLane, OpsOrderCard } from '@/lib/admin/types';
import { BoardCardView } from './BoardCard';

export interface BoardLaneProps {
  lane: OpsBoardLane;
  /** ids that changed lane since the last poll */
  moved: ReadonlySet<string>;
  onOpen: (card: OpsOrderCard) => void;
  /** where "see all" goes for a truncated lane */
  moreHref: string;
  loading?: boolean;
  empty?: ReactNode;
}

export function BoardLaneView({
  lane,
  moved,
  onOpen,
  moreHref,
  loading = false,
  empty,
}: BoardLaneProps) {
  const breached = lane.orders.filter((card) => card.sla.state === 'breached').length;

  return (
    <section className="adm-lane" aria-label={`${lane.label}, ${lane.total} orders`}>
      <header className="adm-lane__head">
        <h2 className="adm-lane__title">{lane.label}</h2>
        <span className="adm-lane__count adm-num">{lane.total}</span>
        {breached > 0 ? (
          <span className="adm-lane__breach" title={`${breached} past their promise`}>
            {breached} late
          </span>
        ) : null}
      </header>

      <div className="adm-lane__body">
        {loading && lane.orders.length === 0
          ? Array.from({ length: 3 }, (_unused, i) => (
              <div className="adm-card adm-card--skel" key={i} aria-hidden="true">
                <div className="adm-skel adm-skel--line" style={{ width: '58%' }} />
                <div className="adm-skel adm-skel--line" style={{ width: '80%' }} />
                <div className="adm-skel adm-skel--line" style={{ width: '45%' }} />
              </div>
            ))
          : null}

        {!loading && lane.orders.length === 0 ? (
          <p className="adm-lane__empty">{empty ?? 'Nothing in this lane.'}</p>
        ) : null}

        {lane.orders.map((card, index) => (
          <BoardCardView
            key={card.id}
            card={card}
            index={index}
            justMoved={moved.has(card.id)}
            onOpen={onOpen}
          />
        ))}

        {lane.truncated ? (
          <p className="adm-lane__more">
            Showing {lane.orders.length} of {lane.total}.{' '}
            <Link href={moreHref}>Open the full list</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
