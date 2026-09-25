import type { Metadata } from 'next';

import { SettlementsView } from '@/components/admin/settlements/SettlementsView';

export const metadata: Metadata = {
  title: 'Settlements',
  robots: { index: false, follow: false },
};

export default function AdminSettlementsPage() {
  return <SettlementsView />;
}
