import type { Metadata } from 'next';
import { InventoryView } from '@/components/vendor';

export const metadata: Metadata = {
  title: 'Inventory',
  robots: { index: false, follow: false },
};

/**
 * `?lowStock=true` is how the dashboard's "products low" card lands straight on
 * the filtered view. Read here rather than with `useSearchParams` so the filter
 * is correct on the very first paint instead of snapping in after hydration.
 */
export default async function VendorInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return <InventoryView initialLowStock={query['lowStock'] === 'true'} />;
}
