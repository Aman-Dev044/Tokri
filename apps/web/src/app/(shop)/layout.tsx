import type { Metadata } from 'next';
import { Suspense } from 'react';
import '@/styles/shop.css';

import { BasketProvider } from '@/components/shop/BasketProvider';
import { BasketDock } from '@/components/shop/BasketDock';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { APP_NAME } from '@/config/brand';

/**
 * THE CUSTOMER SHOP.
 *
 * This is the surface the whole design language exists for. The landing page
 * promises "a market that changes colour as you walk through it" — everything
 * below this layout is that promise, made good:
 *
 *   Pillar 1  chromatic aisles    /aisle/[aisleKey] stamps data-aisle on <html>
 *                                 and the entire interface re-tints over 480ms
 *   Pillar 2  circadian ground    already wired at the root layout
 *   Pillar 3  the basket          a physical object docked bottom-right that
 *                                 fills as a rising mass and catches items
 *   Pillar 4  the journey ribbon  /orders/[id]/track
 *   Pillar 5  editorial cards     two-across on mobile, never three
 *   Pillar 6  ink & paper         the grain plate from the root layout
 *
 * ── RENDERING (plan §3.3) ───────────────────────────────────────────────────
 * Store and product pages are server-rendered shells around client views: they
 * need real metadata for SEO, while price, stock and the basket are live and
 * personal. Cart, checkout and tracking are client-only — personal, live,
 * never cached.
 *
 * ── PROTECTION ──────────────────────────────────────────────────────────────
 * `/cart`, `/checkout` and `/orders` are matched by `middleware.ts` and bounce
 * to `/login` without a session cookie. Browsing (`/stores`, `/aisle`,
 * `/product`) is deliberately public — plan §4.2 lists those endpoints as the
 * only public ones for exactly this reason: you can look before you sign in.
 * As always, the frontend guard is UX; the API guard chain is the security.
 */

export const metadata: Metadata = {
  title: {
    default: 'Shop',
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Order from the kirana, the dairy and the bakery actually near you. Nine aisles, nine colours, one market.',
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <BasketProvider>
      <div className="shop">
        {/* useSearchParams inside the header needs a boundary, or the whole
            shop opts out of static rendering at build time. */}
        <Suspense fallback={<div className="shop-head shop-head--placeholder" />}>
          <ShopHeader />
        </Suspense>

        <main id="main" className="shop-main">
          {children}
        </main>

        <ShopFooter />
        <BasketDock />
      </div>
    </BasketProvider>
  );
}
