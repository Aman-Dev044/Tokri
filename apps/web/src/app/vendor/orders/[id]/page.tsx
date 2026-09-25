import type { Metadata } from 'next';
import { OrderDetailView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Order',
  robots: { index: false, follow: false },
};

/**
 * Next 15 hands `params` to a Server Component as a Promise. Awaiting it here
 * keeps the id-reading in one place and lets the whole detail screen stay a
 * plain client component that takes a string.
 */
export default async function VendorOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetailView orderId={id} />;
}
