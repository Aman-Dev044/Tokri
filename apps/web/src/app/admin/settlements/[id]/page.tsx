import type { Metadata } from 'next';

import { SettlementDetailView } from '@/components/admin/settlements/SettlementDetailView';

export const metadata: Metadata = {
  title: 'Settlement',
  robots: { index: false, follow: false },
};

/** Next 15 hands route params in as a promise. */
export default async function AdminSettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SettlementDetailView settlementId={id} />;
}
