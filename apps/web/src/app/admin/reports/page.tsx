import type { Metadata } from 'next';

import { ReportsView } from '@/components/admin/reports/ReportsView';

export const metadata: Metadata = {
  title: 'Reports',
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  return <ReportsView />;
}
