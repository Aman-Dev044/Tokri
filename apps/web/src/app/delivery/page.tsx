import type { Metadata } from 'next';
import { DashboardView } from '@/components/delivery/DashboardView';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Where a rider lands — and now a real dashboard, like every other role has.
 *
 * What used to be here (the online state and the offer queue) moved to
 * `/delivery/offers`, which is where an offer belongs; the toggle itself never
 * left the shell header, so it is still above the fold on every screen. See
 * `DashboardView` for what this answers and where each number comes from.
 */
export default function DeliveryHomePage() {
  return <DashboardView />;
}
