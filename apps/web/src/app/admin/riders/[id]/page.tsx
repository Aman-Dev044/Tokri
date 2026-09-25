import type { Metadata } from 'next';

import { RiderDetailView } from '@/components/admin/riders/RiderDetailView';

export const metadata: Metadata = {
  title: 'Rider',
  robots: { index: false, follow: false },
};

/** Next 15 hands route params in as a promise. */
export default async function AdminRiderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RiderDetailView riderId={id} />;
}
