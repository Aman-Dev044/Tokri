import type { Metadata } from 'next';
import { EarningsView } from '@/components/delivery/EarningsView';

export const metadata: Metadata = { title: 'Earnings' };

export default function DeliveryEarningsPage() {
  return <EarningsView />;
}
