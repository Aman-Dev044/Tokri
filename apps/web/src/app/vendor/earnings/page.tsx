import type { Metadata } from 'next';
import { EarningsView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Earnings',
  robots: { index: false, follow: false },
};

export default function VendorEarningsPage() {
  return <EarningsView />;
}
