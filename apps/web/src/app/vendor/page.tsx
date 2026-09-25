import type { Metadata } from 'next';
import { DashboardView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function VendorDashboardPage() {
  return <DashboardView />;
}
