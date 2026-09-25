import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductView } from '@/components/shop/ProductView';

/**
 * A product page. Server-rendered shell (plan §3.3 — product pages need SEO and
 * fresh price/stock) around a client body that owns the stepper and the basket.
 *
 * TODO(worker-b): once GET /products/:id is live, fetch it in generateMetadata
 * for a real title, description, price and OG image, plus a Product JSON-LD
 * block. Awaiting a missing endpoint here would block the route entirely, so
 * for now the metadata is generic and the body loads client-side.
 */

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: 'Product',
  description: 'Price, unit and live stock from the store nearest you.',
};

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ProductView productId={id} />
    </Suspense>
  );
}
