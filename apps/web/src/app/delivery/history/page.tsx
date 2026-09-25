import type { Metadata } from 'next';
import { HistoryView } from '@/components/delivery/HistoryView';

export const metadata: Metadata = { title: 'History' };

export default function DeliveryHistoryPage() {
  return <HistoryView />;
}
