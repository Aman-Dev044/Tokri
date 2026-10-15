import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShopView } from '@/components/shop/ShopView';
import { APP_NAME } from '@/config/brand';

/**
 * `/shop` — where a signed-in customer lands (`HOME_FOR_ROLE.customer`).
 *
 * A server-rendered shell around a client body, like every other catalogue
 * route here: the page itself is public and indexable, while the grid is live
 * (price, stock, distance) and personal (the basket).
 *
 * `ShopView` reads `useSearchParams`, so it needs its own Suspense boundary or
 * the whole `(shop)` segment opts out of static rendering at build time.
 */
export const metadata: Metadata = {
  title: 'Shop',
  description: `Every category, every open store near you — one grid. Order groceries on ${APP_NAME}.`,
};

export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopView />
    </Suspense>
  );
}
