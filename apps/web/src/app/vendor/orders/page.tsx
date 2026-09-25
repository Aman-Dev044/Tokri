import type { Metadata } from 'next';
import { OrdersView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

export default function VendorOrdersPage() {
  return <OrdersView />;
}
