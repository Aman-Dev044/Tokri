import type { Metadata } from 'next';
import { CartView } from '@/components/shop/CartView';

/**
 * The basket, in full.
 *
 * CSR (plan §3.3): personal, live, never cached. `middleware.ts` matches
 * `/cart` and bounces to `/login` without a session cookie — UX only; the API
 * guard chain is what actually protects the data.
 */

export const metadata: Metadata = {
  title: 'Your basket',
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return <CartView />;
}
