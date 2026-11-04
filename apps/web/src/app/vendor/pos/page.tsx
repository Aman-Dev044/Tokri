import type { Metadata } from 'next';
import { PosView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Billing',
  robots: { index: false, follow: false },
};

export default function VendorPosPage() {
  return <PosView />;
}
