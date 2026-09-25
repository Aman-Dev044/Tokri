import type { Metadata } from 'next';
import { ActiveJobView } from '@/components/delivery/ActiveJobView';

export const metadata: Metadata = { title: 'Delivery' };

/**
 * The job in progress: Go to store → Picked up → Out for delivery → Deliver.
 *
 * In Next 15 `params` is a Promise, so this stays an async Server Component
 * and hands the id down to the client view. The id is only a lookup key — the
 * job itself comes from `GET /delivery/orders/active`, which the API scopes to
 * the signed-in rider. Typing someone else's order id into this URL returns
 * their own job, not the other rider's (plan §4.2).
 */
export default async function ActiveDeliveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ActiveJobView orderId={id} />;
}
