import type { Metadata } from 'next';
import { TrackView } from '@/components/shop/TrackView';

export const metadata: Metadata = {
  title: 'Tracking',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackPage({ params }: PageProps) {
  const { id } = await params;
  return <TrackView orderId={id} />;
}
