import type { Metadata } from 'next';

import { CustomersView } from '@/components/admin/customers/CustomersView';

export const metadata: Metadata = {
  title: 'Customers',
  robots: { index: false, follow: false },
};

export default function AdminCustomersPage() {
  return <CustomersView />;
}
