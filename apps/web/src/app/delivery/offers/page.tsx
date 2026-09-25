import type { Metadata } from 'next';
import { OffersView } from '@/components/delivery/OffersView';

export const metadata: Metadata = { title: 'Offers' };

/**
 * The incoming assignment, with its 45-second countdown. Arrives over the
 * `delivery.assigned` socket event (plan §6.3) and is also polled from
 * `GET /delivery/offers` whenever the socket is not live.
 */
export default function DeliveryOffersPage() {
  return <OffersView />;
}
