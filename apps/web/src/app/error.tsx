'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@mandi/design-system';

/**
 * The route-level error boundary.
 *
 * It never prints `error.message` to the user. A thrown message can carry an
 * internal path, a query, or a fragment of a token, and this component renders
 * on a page anyone can reach. The digest is a stable, non-sensitive id that
 * Next generates for server errors - that is what makes a support conversation
 * possible without leaking anything.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(ops): forward to Sentry once NEXT_PUBLIC_SENTRY_DSN is configured.
    // Until then the browser console is the only sink, which is honest.
    console.error('[mandi] route error', error.digest ?? error.name);
  }, [error]);

  return (
    <main id="main" className="status-page">
      <p className="eyebrow">Something broke</p>
      <h1 className="status-page__title">
        The shutter came down
        <br />
        <span className="status-page__accent">mid-sentence.</span>
      </h1>
      <p className="status-page__body">
        This page failed to load. It is on our side, not yours — try it again, and if it
        keeps happening, the reference below tells us exactly which one it was.
      </p>

      {error.digest ? (
        <p className="status-page__digest mono">reference · {error.digest}</p>
      ) : null}

      <div className="status-page__cta">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Link href="/" className="mnd-btn mnd-btn--ghost mnd-btn--lg">
          Back to the market
        </Link>
      </div>
    </main>
  );
}
