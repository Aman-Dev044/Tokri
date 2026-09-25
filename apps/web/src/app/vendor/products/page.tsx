import type { Metadata } from 'next';
import { ProductsView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Products',
  robots: { index: false, follow: false },
};

export default function VendorProductsPage() {
  return <ProductsView />;
}
