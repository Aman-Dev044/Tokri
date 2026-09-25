'use client';

/**
 * ★ A "NEEDS ACTION" TILE — a queue, its size, and a way into it.
 *
 * ── WHY THESE ARE LINKS AND NOT KPI TILES ───────────────────────────────────
 * A KPI tile reports. This asks for something. Every one of these is an
 * anchor with a large hit area, because the dashboard's whole job is to be the
 * shortest path from "something is waiting" to the screen where it stops
 * waiting — and because half the people reading it are on a tablet in a
 * warehouse, not a mouse at a desk.
 *
 * ── ZERO IS NOT A PROBLEM ───────────────────────────────────────────────────
 * An empty queue renders CALM: a tick, the word "Clear", ordinary ink. Not a
 * red 0, not an alarm-coloured tile with nothing in it.
 *
 * A dashboard that is loud when everything is fine has taught its reader to
 * ignore it by Wednesday. Severity is earned by having work in it; the
 * alarming states are reserved for the tiles that actually have a number.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatCount } from '@/lib/admin/format';
import { IconCheck, IconChevronRight } from '../icons';

export type QueueTone = 'crit' | 'warn' | 'neutral';

export interface QueueTileProps {
  label: string;
  count: number;
  href: string;
  /** severity WHEN THERE IS WORK. Ignored at zero — see the header. */
  tone: QueueTone;
  /** what the number means, one short line */
  hint: string;
  /** the calm line for an empty queue. Defaults to a plain "Nothing waiting." */
  clearHint?: string;
  icon?: ReactNode;
  loading?: boolean;
  /** the count is sample data */
  isFixture?: boolean;
  /** stagger index, so the row arrives as a wave */
  index?: number;
}

export function QueueTile({
  label,
  count,
  href,
  tone,
  hint,
  clearHint = 'Nothing waiting.',
  icon,
  loading = false,
  isFixture = false,
  index = 0,
}: QueueTileProps) {
  if (loading) {
    return (
      <div className="adm-q adm-q--loading" aria-busy="true">
        <div className="adm-skel adm-skel--line" style={{ width: '60%' }} />
        <div className="adm-skel adm-skel--line" style={{ height: 30, width: '40%' }} />
        <div className="adm-skel adm-skel--line" style={{ width: '80%' }} />
        <span className="adm-sr">Loading {label}</span>
      </div>
    );
  }

  const clear = count === 0;

  return (
    <Link
      href={href}
      className="adm-q"
      data-tone={clear ? 'clear' : tone}
      data-fixture={isFixture ? 'true' : undefined}
      style={{ ['--adm-i' as string]: String(index) }}
    >
      <span className="adm-q__head">
        {icon ? (
          <span className="adm-q__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="adm-q__label">{label}</span>
        <IconChevronRight className="adm-q__chev" />
      </span>

      <span className="adm-q__value">
        {clear ? (
          <>
            <IconCheck className="adm-q__tick" />
            <span className="adm-q__clear">Clear</span>
          </>
        ) : (
          <span className="adm-q__count adm-num">{formatCount(count)}</span>
        )}
      </span>

      <span className="adm-q__hint">{clear ? clearHint : hint}</span>

      {isFixture ? (
        <span className="adm-q__sample" title="Sample data — the API is not reachable">
          SAMPLE
        </span>
      ) : null}
    </Link>
  );
}
