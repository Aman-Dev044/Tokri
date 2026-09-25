import type { Metadata, Viewport } from 'next';

import { RiderShell } from '@/components/delivery/RiderShell';
import { ServiceWorkerBoot } from '@/components/delivery/ServiceWorkerBoot';

/**
 * The delivery surface — a PWA scoped to `/delivery`.
 *
 * Stays a Server Component so the metadata below is static. Everything
 * interactive lives inside `<RiderShell>`, which is the one client boundary
 * for the whole rider app.
 *
 * ── RENDERING (plan §3.3) ───────────────────────────────────────────────────
 * CSR. The 15-minute access token lives in memory on the client (§4.3), so the
 * server cannot read it and SSR would buy a rider on a scooter nothing.
 *
 * ── PROTECTION ──────────────────────────────────────────────────────────────
 * Layer 1 is `middleware.ts` — it only checks that a refresh cookie exists.
 * Layer 2 is the role gate inside `<RiderShell>`. BOTH ARE UX ONLY. Layer 3,
 * the API guard chain in plan §4.2 with `@Roles('delivery')` on the whole
 * DELIVERY block, is what actually stops anybody, and it runs whether or not
 * either of the first two did.
 *
 * ── PWA SCOPE ───────────────────────────────────────────────────────────────
 * The manifest (`./manifest.ts`) and the service worker (`./sw.js/route.ts`)
 * are both served FROM this path so the install scope is `/delivery` and the
 * shopping app is never swallowed by the rider's installed icon. They sit
 * inside `app/delivery/` for exactly that reason — a worker served from
 * `/public` could not claim this scope without an extra response header.
 */

export const metadata: Metadata = {
  title: {
    default: 'Rider',
    template: '%s · Mandi Rider',
  },
  description: 'Mandi delivery partner app.',
  manifest: '/delivery/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Mandi Rider',
    // The rider ground is near-black; a light status bar over it looks broken.
    statusBarStyle: 'black-translucent',
  },
  // A rider app has no business in a search index.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The dock sits against the bottom edge; `cover` is what lets it reach the
  // home-indicator area instead of leaving a grey strip under it.
  viewportFit: 'cover',
  // Deliberately NOT user-scalable:false. Plan §2.6 requires this panel to be
  // usable at 200% zoom, and blocking pinch-zoom on the one surface read in
  // bright sun is exactly the wrong call.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#070805' },
  ],
};

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerBoot />
      <RiderShell>{children}</RiderShell>
    </>
  );
}
