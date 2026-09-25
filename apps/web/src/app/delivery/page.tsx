import type { Metadata } from 'next';
import { HomeView } from '@/components/delivery/HomeView';

export const metadata: Metadata = { title: 'Today' };

/**
 * Where a rider lands. Online state, today's numbers, and either the job in
 * progress or a calm resting state. See `HomeView` for the reasoning.
 */
export default function DeliveryHomePage() {
  return <HomeView />;
}
