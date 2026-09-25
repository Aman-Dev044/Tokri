import type { Metadata } from 'next';

import { CouponsView } from '@/components/admin/coupons/CouponsView';

export const metadata: Metadata = {
  title: 'Coupons',
  robots: { index: false, follow: false },
};

export default function AdminCouponsPage() {
  return <CouponsView />;
}
