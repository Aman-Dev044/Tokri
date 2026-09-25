import type { Metadata } from 'next';

import { PaymentsView } from '@/components/admin/payments/PaymentsView';

export const metadata: Metadata = {
  title: 'Payments',
  robots: { index: false, follow: false },
};

export default function AdminPaymentsPage() {
  return <PaymentsView />;
}
