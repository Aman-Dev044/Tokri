'use client';

/**
 * ★ THE SLA INDICATOR — the one thing on the board that must never be missed.
 *
 * ── COLOUR, SHAPE AND WORD. ALWAYS ALL THREE. ───────────────────────────────
 * Roughly one man in twelve cannot separate the red from the amber reliably,
 * and a dispatcher reads this on a bright warehouse screen at an angle. So each
 * state carries:
 *
 *   ok        a CIRCLE   · "On time"        · --good
 *   warning   a TRIANGLE · "Due in 6m"      · --warn
 *   breached  a SQUARE   · "Late by 12m"    · --crit
 *
 * The glyph is a different SHAPE per state, not the same dot in three colours.
 * Print the board in greyscale and it still triages correctly. That is the
 * test (plan §2.6).
 *
 * ── THE PULSE ───────────────────────────────────────────────────────────────
 * A breach pulses ONCE on arrival and then holds. An indicator that pulses
 * forever is unreadable after twenty minutes of an eight-hour shift, and the
 * operator learns to filter out exactly the thing it was built to surface. The
 * animation is keyed off the order id by the caller, so a card that is still
 * late an hour later is not still flashing.
 */

import type { OpsSla, OpsSlaState } from '@/lib/admin/types';

const SHAPE: Record<OpsSlaState, string> = {
  // A circle — closed, settled, nothing to do.
  ok: 'M6 2.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z',
  // A triangle — the universal "watch this".
  warning: 'M6 1.6 11 10.4H1Z',
  // A square — blunt, heavy, and unmistakably not the other two.
  breached: 'M1.8 1.8h8.4v8.4H1.8Z',
};

const WORD: Record<OpsSlaState, string> = {
  ok: 'On time',
  warning: 'Due soon',
  breached: 'Late',
};

export interface SlaIndicatorProps {
  sla: OpsSla;
  /** hide the word and keep only the glyph + a title — for a dense table cell */
  compact?: boolean;
  /**
   * Pulse once when this changes to a breach. Pass the card id: a remount with
   * the same id must not re-fire, which is what keeps a stale breach quiet.
   */
  pulseKey?: string;
  className?: string;
}

/**
 * The words beside the glyph.
 *
 * The API sends `targetMinutes` and `elapsedMinutes`, never a deadline, so the
 * phrase is arithmetic on those two — and the STATE is always the server's.
 * Re-deriving `state` here from the same two numbers would look harmless and
 * would eventually disagree with the board by one minute at the boundary,
 * because the warning band opens at 80% and a breach is strictly past 100%.
 */
export function slaPhrase(sla: OpsSla): string {
  const left = sla.targetMinutes - sla.elapsedMinutes;
  if (sla.state === 'breached') return `Late by ${Math.max(1, -left)}m`;
  if (sla.state === 'warning') return `Due in ${Math.max(0, left)}m`;
  return `${Math.max(0, left)}m left`;
}

export function SlaIndicator({ sla, compact = false, pulseKey, className }: SlaIndicatorProps) {
  const phrase = slaPhrase(sla);
  const full = `${WORD[sla.state]} — ${phrase}`;

  return (
    <span
      key={pulseKey}
      className={['adm-sla', className].filter(Boolean).join(' ')}
      data-state={sla.state}
      title={full}
    >
      <svg className="adm-sla__glyph" viewBox="0 0 12 12" aria-hidden="true">
        <path d={SHAPE[sla.state]} />
      </svg>
      {compact ? <span className="adm-sr">{full}</span> : <span className="adm-sla__text">{phrase}</span>}
    </span>
  );
}
