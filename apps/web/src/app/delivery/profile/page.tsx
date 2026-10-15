import type { Metadata } from 'next';
import { KycView } from '@/components/delivery/KycView';

export const metadata: Metadata = { title: 'Verification' };

/**
 * Identity verification — the gate on accepting any order at all.
 *
 * The three numbers are posted and never held; everything this screen reads
 * back is masked. The countdown runs against the deadline the API stamped on
 * the submission, so the promise shown is the promise that was made.
 */
export default function DeliveryProfilePage() {
  return <KycView />;
}
