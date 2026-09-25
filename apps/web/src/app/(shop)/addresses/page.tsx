import type { Metadata } from 'next';
import { AddressBookView } from '@/components/shop/AddressBookView';

/**
 * Saved delivery addresses — the destination of the profile menu's
 * "Addresses" link.
 *
 * CSR: personal, live, never cached. Unlike `/cart`, `/checkout` and
 * `/orders`, this path is NOT in `middleware.ts`'s protected prefix list, so
 * the view itself handles the signed-out case in words. See the note in
 * `AddressBookView`.
 */

export const metadata: Metadata = {
  title: 'Your addresses',
  robots: { index: false, follow: false },
};

export default function AddressesPage() {
  return <AddressBookView />;
}
