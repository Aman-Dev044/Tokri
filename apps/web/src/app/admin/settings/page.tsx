import type { Metadata } from 'next';

import { SettingsView } from '@/components/admin/settings/SettingsView';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default function AdminSettingsPage() {
  return <SettingsView />;
}
