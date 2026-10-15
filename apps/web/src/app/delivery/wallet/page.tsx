import type { Metadata } from 'next';
import { WalletView } from '@/components/delivery/WalletView';

export const metadata: Metadata = { title: 'Wallet' };

/**
 * The balance a pick fee comes out of, the lifetime totals, the top-up and
 * the ledger. Everything is INTEGER PAISE on the wire and formatted once, at
 * the edge.
 */
export default function DeliveryWalletPage() {
  return <WalletView />;
}
