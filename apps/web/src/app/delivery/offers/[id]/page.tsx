import type { Metadata } from 'next';
import { OfferConfirmView } from '@/components/delivery/OfferConfirmView';

export const metadata: Metadata = { title: 'Review offer' };

/**
 * The confirm screen — the last point at which taking this job is free.
 *
 * Accepting charges a pick fee drawn at random per order, so the item list,
 * both addresses, the payout, the fee range and the wallet balance are all
 * shown here BEFORE the money moves.
 *
 * In Next 15 `params` is a Promise, so this stays an async Server Component.
 * The id is only a lookup key: `GET /delivery/offers/:id` scopes the offer to
 * the signed-in rider's own partner row, so another rider's assignment id
 * answers 404 rather than rendering their job.
 */
export default async function OfferConfirmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OfferConfirmView assignmentId={id} />;
}
