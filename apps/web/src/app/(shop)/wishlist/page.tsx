import type { Metadata } from 'next';
import { WishlistView } from '@/components/shop/WishlistView';

export const metadata: Metadata = {
  title: 'Your wishlist',
  robots: { index: false, follow: false },
};

export default function WishlistPage() {
  return <WishlistView />;
}
