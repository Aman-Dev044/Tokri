import type { Metadata } from 'next';
import { PartnersView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Delivery partners',
  robots: { index: false, follow: false },
};

export default function VendorPartnersPage() {
  return <PartnersView />;
}
