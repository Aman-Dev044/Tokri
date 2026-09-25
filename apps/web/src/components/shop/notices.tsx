'use client';

/**
 * The honesty layer.
 *
 * Four small components, all of which exist so the shop never shows something
 * it cannot stand behind:
 *
 *   FixtureBanner   — "this is sample data", named endpoint, impossible to miss
 *   ErrorNotice     — a real failure, in plain words, with the way out
 *   ConnectionBanner— live / reconnecting / last seen 2m ago
 *   StaleFlagChips  — the cart's price_changed / out_of_stock / reduced_qty /
 *                     unavailable
 *
 * None of them are modals. A modal is dismissed before it is read, and then the
 * screen looks correct while it is not.
 */

import { useEffect, useState } from 'react';
import { formatPaise } from '@mandi/design-system';
import type { ApiError } from '@/lib/api-client';
import type { ConnectionState } from '@/hooks/useSocket';
import { formatAgo } from '@/lib/shop/format';
import type { CartLine, CartLineFlag } from '@/lib/shop/types';

/* ───────────────────────────── fixture banner ───────────────────────────── */

export function FixtureBanner({ endpoint }: { endpoint: string }) {
  return (
    <div className="shop-notice shop-notice--fixture" role="status">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path
          d="M10 3 L18 17 H2 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M10 8.5 v3.4 M10 14.2 v0.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <p>
        <strong>Sample data.</strong> <code>{endpoint}</code> did not answer, so this screen is
        showing placeholder products, prices and times from the build fixtures. Nothing here is
        a real listing.
      </p>
    </div>
  );
}

/* ───────────────────────────── error notice ─────────────────────────────── */

export function ErrorNotice({
  error,
  onRetry,
  what = 'this page',
}: {
  error: ApiError;
  onRetry?: () => void;
  what?: string;
}) {
  return (
    <div className="shop-notice shop-notice--error" role="alert">
      <div>
        <p className="shop-notice__title">We could not load {what}.</p>
        <p className="shop-notice__body">
          {error.friendlyMessage}
          {error.status > 0 ? <span className="shop-notice__code"> · HTTP {error.status}</span> : null}
        </p>
      </div>
      {onRetry ? (
        <button type="button" className="mnd-btn mnd-btn--outline mnd-btn--sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── connection banner ──────────────────────────── */

const STATE_COPY: Record<ConnectionState, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'good' },
  connecting: { label: 'Connecting', tone: 'warn' },
  reconnecting: { label: 'Reconnecting', tone: 'warn' },
  offline: { label: 'You are offline', tone: 'crit' },
  'signed-out': { label: 'Waiting for your session', tone: 'warn' },
  disabled: { label: 'Not live', tone: 'muted' },
};

export function ConnectionBanner({
  state,
  detail,
  lastEventAt,
  onRetry,
}: {
  state: ConnectionState;
  detail: string | null;
  lastEventAt: number | null;
  onRetry?: () => void;
}) {
  // "2m ago" has to keep counting while the page sits open, or a stale reading
  // freezes at the moment of the last render and reads as fresh.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      tick((n) => n + 1);
    }, 15_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const copy = STATE_COPY[state];
  const seen = lastEventAt === null ? null : formatAgo(new Date(lastEventAt).toISOString());

  return (
    <div className="shop-conn" data-tone={copy.tone} role="status" aria-live="polite">
      <span className="shop-conn__dot" aria-hidden="true" />
      <span className="shop-conn__label">{copy.label}</span>
      {seen !== null ? <span className="shop-conn__seen">last update {seen}</span> : null}
      {detail !== null ? <span className="shop-conn__detail">{detail}</span> : null}
      {state !== 'live' && onRetry ? (
        <button type="button" className="shop-conn__retry" onClick={onRetry}>
          Retry now
        </button>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── stale line flags ───────────────────────────── */

/**
 * The API sends `flags` as a FLAT ARRAY OF CODES on each cart line — no detail
 * object, no from/to pair. The numbers behind a chip live on the line itself:
 * `price` (what it cost when it went in) against `currentPrice` (what it costs
 * now), and `qty` against `availableQty`.
 *
 * The old version expected `[{ code, fromPaise, toPaise, … }]` and a
 * three-value union. Against the real payload every chip fell through to its
 * bare label, and a `unavailable` flag — missing from the union entirely —
 * rendered as nothing at all, so a delisted item looked perfectly fine in a
 * basket that could not be checked out.
 */
function flagCopy(flag: CartLineFlag, line: CartLine): { label: string; tone: 'warn' | 'crit' } {
  switch (flag) {
    case 'price_changed': {
      const up = line.currentPrice > line.price;
      return {
        label: `Price ${up ? 'up' : 'down'} — was ${formatPaise(line.price)}, now ${formatPaise(line.currentPrice)}`,
        tone: 'warn',
      };
    }
    case 'out_of_stock':
      return { label: 'Out of stock — remove it to check out', tone: 'crit' };
    case 'reduced_qty':
      return {
        label: `Only ${line.availableQty} left — you asked for ${line.qty}`,
        tone: 'warn',
      };
    case 'unavailable':
      return {
        label: 'No longer sold by this store — remove it to check out',
        tone: 'crit',
      };
  }
}

/** The two flags that genuinely block a checkout, per `CheckoutService`. */
export function blocksCheckout(flag: CartLineFlag): boolean {
  return flag === 'out_of_stock' || flag === 'unavailable';
}

/**
 * Inline on the line they belong to. A chip carries an icon and a full sentence
 * — never a bare colour, never a bare exclamation mark.
 */
export function StaleFlagChips({ line }: { line: CartLine }) {
  if (line.flags.length === 0) return null;
  return (
    <ul className="shop-flags">
      {line.flags.map((flag) => {
        const { label, tone } = flagCopy(flag, line);
        return (
          <li key={flag} className="shop-flag" data-tone={tone}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              {tone === 'crit' ? (
                <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M8 3.4 v5.2 M8 11.4 v0.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
