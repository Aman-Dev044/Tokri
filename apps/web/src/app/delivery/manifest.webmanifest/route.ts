import type { MetadataRoute } from 'next';

import { APP_NAME } from '@/config/brand';

/**
 * The rider PWA manifest — served at `/delivery/manifest.webmanifest`.
 *
 * ── WHY A ROUTE HANDLER AND NOT `manifest.ts` ───────────────────────────────
 * Next's `manifest` metadata convention is ROOT-ONLY: `app/manifest.ts` maps
 * to `/manifest.webmanifest` and a copy in a nested segment is simply not
 * picked up (it 404s, which is exactly what happened on the first attempt).
 * A route handler at this path is the supported way to scope a manifest to a
 * sub-app, and it also lets the content type be set explicitly.
 *
 * ── WHY IT IS SCOPED TO /delivery ───────────────────────────────────────────
 * `scope: '/delivery'` is the point. Mandi is four apps on one origin, and a
 * rider who installs this must get the rider app — not a standalone window
 * that swallows the shopping site the moment they tap a product link. A
 * root-scoped manifest would do exactly that.
 *
 * ── ONE HONEST NOTE ON `display: standalone` ────────────────────────────────
 * Standalone removes the URL bar, which is right: this is a tool, not a page.
 * It does NOT make the app native. It cannot run in the background, cannot
 * take a reliable background location fix, and cannot receive push while
 * closed (plan §8.7, #16). Those limits are designed around in the UI rather
 * than hidden — see `lib/delivery/tracking.ts` and `sw.js/route.ts`.
 *
 * This path sits under `/delivery`, so `middleware.ts` covers it like every
 * other rider route: a signed-out request is redirected to /login. That is
 * correct — an installed rider app has a session by definition — but it does
 * mean the manifest is not fetchable anonymously, and an install prompt will
 * not appear until the rider has signed in. Deliberate, and worth knowing.
 */

const manifest: MetadataRoute.Manifest = {
  id: '/delivery',
  name: `${APP_NAME} Rider`,
  short_name: 'Rider',
  description:
    'Take delivery offers, run the job step by step, and confirm with the customer code.',
  start_url: '/delivery',
  scope: '/delivery',
  display: 'standalone',
  orientation: 'portrait',
  // `theme_color`/`background_color` are read by the OS before any stylesheet
  // loads, so they cannot reference a custom property — kept in lockstep with
  // "Forest Gold"'s `--ground` (#0b1d13) by hand. Only one value is possible
  // here (the manifest has no media-query form), and dark forest is the
  // theme's default for everyone anyway.
  background_color: '#0b1d13',
  theme_color: '#0b1d13',
  categories: ['business', 'productivity'],
  dir: 'ltr',
  lang: 'en-IN',
  icons: [
    { src: '/icons/rider-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/rider-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      // Content pulled into the 80% safe zone so a circular or squircle crop
      // does not slice the mark.
      src: '/icons/rider-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
    { src: '/icons/rider.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    {
      name: 'Current delivery',
      short_name: 'Delivery',
      url: '/delivery',
      icons: [{ src: '/icons/rider-192.png', sizes: '192x192', type: 'image/png' }],
    },
    {
      name: 'Earnings',
      short_name: 'Earnings',
      url: '/delivery/earnings',
      icons: [{ src: '/icons/rider-192.png', sizes: '192x192', type: 'image/png' }],
    },
  ],
};

export function GET(): Response {
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
