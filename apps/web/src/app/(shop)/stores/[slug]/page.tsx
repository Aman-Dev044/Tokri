import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StorefrontView } from '@/components/shop/StorefrontView';

/**
 * A storefront. Server shell, client body (plan §3.3): the page needs a real
 * title and description for search, while price, stock and the basket are live
 * and personal.
 *
 * The metadata is built from the slug rather than from a fetch, deliberately —
 * the catalogue API is still landing, and a `generateMetadata` that awaits a
 * 404 would block the whole route on an endpoint that does not exist yet.
 *   TODO(worker-b): once GET /stores/:slug is live, fetch here for a real
 *   title, description and OG image.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const name = titleFromSlug(slug);
  return {
    title: name,
    description: `Order from ${name} on Mandi — live stock, real distance and an honest delivery estimate.`,
  };
}

export default async function StorePage({ params }: PageProps) {
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <StorefrontView slug={slug} />
    </Suspense>
  );
}
