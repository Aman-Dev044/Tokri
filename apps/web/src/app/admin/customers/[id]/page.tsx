import type { Metadata } from 'next';

import { CustomerDetailView } from '@/components/admin/customers/CustomerDetailView';

export const metadata: Metadata = {
  title: 'Customer',
  robots: { index: false, follow: false },
};

/** Next 15 hands route params in as a promise. */
export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerDetailView customerId={id} />;
}
