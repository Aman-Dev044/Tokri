import type { Metadata } from 'next';

import { IssuesView } from '@/components/admin/issues/IssuesView';

export const metadata: Metadata = {
  title: 'Support queue',
  robots: { index: false, follow: false },
};

export default function AdminIssuesPage() {
  return <IssuesView />;
}
