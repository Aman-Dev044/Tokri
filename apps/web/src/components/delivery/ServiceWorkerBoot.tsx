'use client';

/**
 * Registers the rider service worker — and, in development, makes sure one is
 * NOT registered.
 *
 * ── WHY PRODUCTION ONLY ─────────────────────────────────────────────────────
 * The worker caches `/_next/static/*` cache-first, which is correct in a
 * production build where those filenames are content-hashed and immutable. In
 * `next dev` they are not: a chunk can change behind the same URL, and a
 * cache-first worker will happily serve yesterday's chunk into today's HTML
 * until someone clears storage by hand. So in development this component
 * actively UNREGISTERS any worker it finds — which also rescues a developer
 * who ran a production build once and has been chasing a ghost ever since.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * `/delivery/sw.js` with `scope: '/delivery/'`. The worker cannot reach the
 * shop, the vendor console or the admin console even if it wanted to; a
 * service worker's authority is bounded by its own URL's directory.
 *
 * ── WHAT REGISTRATION DOES NOT BUY ──────────────────────────────────────────
 * Not background location, not background push, not a guaranteed queue flush.
 * See the long note at the top of `app/delivery/sw.js/route.ts`. This gets the
 * app to OPEN offline. Nothing more is promised anywhere in the UI.
 */

import { useEffect } from 'react';

export function ServiceWorkerBoot() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // A service worker needs a secure context. localhost counts; a LAN IP over
    // plain http does not, and registration would throw.
    if (!window.isSecureContext) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          if (registration.scope.includes('/delivery')) void registration.unregister();
        }
      });
      return;
    }

    void navigator.serviceWorker
      .register('/delivery/sw.js', { scope: '/delivery/' })
      .then((registration) => {
        // A rider mid-shift should not be stranded on a stale build.
        registration.addEventListener('updatefound', () => {
          const next = registration.installing;
          if (next === null) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller !== null) {
              next.postMessage('skip-waiting');
            }
          });
        });
      })
      .catch(() => {
        // Registration failing is survivable: the app works online, it just
        // will not open offline. Not worth interrupting a rider over.
      });
  }, []);

  return null;
}
