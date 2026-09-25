import type { Metadata } from 'next';

import { StockView } from '@/components/admin/stock/StockView';

export const metadata: Metadata = {
  title: 'Stock alerts',
  robots: { index: false, follow: false },
};

export default function AdminStockPage() {
  return <StockView />;
}
