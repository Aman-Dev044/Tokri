import type { Metadata } from 'next';
import { StaffView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Staff',
  robots: { index: false, follow: false },
};

export default function VendorStaffPage() {
  return <StaffView />;
}
