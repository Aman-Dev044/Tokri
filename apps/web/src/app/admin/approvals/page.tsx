import type { Metadata } from 'next';

import { ApprovalsView } from '@/components/admin/approvals/ApprovalsView';

export const metadata: Metadata = {
  title: 'Approvals',
  robots: { index: false, follow: false },
};

export default function AdminApprovalsPage() {
  return <ApprovalsView />;
}
