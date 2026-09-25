import type { Metadata } from 'next';

import { CatalogView } from '@/components/admin/catalog/CatalogView';

export const metadata: Metadata = {
  title: 'Catalog',
  robots: { index: false, follow: false },
};

export default function AdminCatalogPage() {
  return <CatalogView />;
}
