'use client';

/**
 * "Live · updated 4s ago" — the honesty line on every polling screen.
 *
 * A board that stops refreshing looks identical to a quiet evening. This is
 * what tells the two apart, in words:
 *
 *   updated 4s ago       the poll is running
 *   paused — tab hidden  polling stopped on purpose; it resumes on focus
 *   STALE · 2m ago       the poll should have fired and did not. Reload.
 *
 * The manual refresh sits beside it because the useful response to "stale" is
 * to try again without losing the filters you set.
 */

import type { Freshness } from '@/hooks';
import { IconPause, IconRefresh } from '../icons';

export interface LiveMetaProps {
  freshness: Freshness;
  /** how often the underlying query polls, for the "every Ns" copy */
  intervalMs: number;
  onRefresh: () => void;
  loading?: boolean;
  className?: string;
}

function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function LiveMeta({
  freshness,
  intervalMs,
  onRefresh,
  loading = false,
  className,
}: LiveMetaProps) {
  const { secondsAgo, stale, visible } = freshness;

  const state = stale ? 'stale' : !visible ? 'paused' : 'live';
  const seconds = Math.round(intervalMs / 1000);

  return (
    <span className={['adm-live', className].filter(Boolean).join(' ')} data-state={state}>
      <span className="adm-live__dot" aria-hidden="true" />

      <span className="adm-live__text" aria-live="polite">
        {state === 'paused' ? (
          <>
            <IconPause className="adm-live__glyph" />
            Paused — tab in the background
          </>
        ) : state === 'stale' ? (
          <>
            <strong>Stale</strong>
            {secondsAgo === null ? null : ` · last updated ${ago(secondsAgo)}`}
          </>
        ) : secondsAgo === null ? (
          `Live · every ${seconds}s`
        ) : (
          `Live · updated ${ago(secondsAgo)}`
        )}
      </span>

      <button
        type="button"
        className="adm-btn adm-btn--sm adm-btn--ghost"
        onClick={onRefresh}
        disabled={loading}
      >
        <IconRefresh style={{ width: 14, height: 14 }} />
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </span>
  );
}
