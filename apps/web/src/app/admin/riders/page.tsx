import type { Metadata } from 'next';

import { RidersView } from '@/components/admin/riders/RidersView';

export const metadata: Metadata = {
  title: 'Riders',
  robots: { index: false, follow: false },
};

export default function AdminRidersPage() {
  return <RidersView />;
}
