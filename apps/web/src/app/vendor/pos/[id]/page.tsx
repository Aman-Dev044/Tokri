import type { Metadata } from 'next';
import { PosInvoiceView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false },
};

/** `params` arrives as a Promise in Next 15 — see `orders/[id]/page.tsx`. */
export default async function VendorInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PosInvoiceView saleId={id} />;
}
