import type { Metadata } from 'next';

import { IssueDetailView } from '@/components/admin/issues/IssueDetailView';

export const metadata: Metadata = {
  title: 'Issue',
  robots: { index: false, follow: false },
};

/** Next 15 hands route params in as a promise. */
export default async function AdminIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IssueDetailView issueId={id} />;
}
