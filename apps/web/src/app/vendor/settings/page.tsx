import type { Metadata } from 'next';
import { SettingsView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Store settings',
  robots: { index: false, follow: false },
};

export default function VendorSettingsPage() {
  return <SettingsView />;
}
