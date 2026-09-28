import type { Metadata } from 'next';

/*
  The vendor panel is self-contained ("Bento Pop"): it draws on the shared
  design-system tokens and Bento primitives (imported globally by the root
  layout) and nothing else from another surface. vendor.css is the panel's own
  stylesheet — the shell, the board, the lanes, the order cards, the new-order
  alert, the stock board, the earnings equation, and every local component's
  class names.
*/
import './vendor.css';

import { VendorShell, VendorAlertProvider } from '@/components/vendor';
import { VendorSessionProvider } from '@/lib/vendor/session';
import { APP_NAME } from '@/config/brand';

/**
 * The vendor surface.
 *
 * Stays a Server Component so the metadata below is static; every interactive
 * part lives inside the two providers and the shell, which together are the one
 * client boundary for the whole panel.
 *
 * ── RENDERING (plan §3.3) ───────────────────────────────────────────────────
 * CSR. This is an auth-gated operations tool: SSR buys nothing a shop owner
 * would notice and complicates token handling, because the 15-minute access
 * token lives in memory on the client and the server cannot read it.
 *
 * ── PROTECTION ──────────────────────────────────────────────────────────────
 * Layer 1 is `middleware.ts`, which checks a refresh cookie exists and that its
 * role claim is `vendor` (plan §4.4). Layer 2 is the role gate inside
 * <VendorShell>. Both are UX. Layer 3 — the API guard chain of §4.2, and
 * VendorScopeGuard in particular — is the one that actually stops anybody, and
 * it runs whether or not either of the first two did.
 *
 * ── WHY THE ALERT PROVIDER IS HERE AND NOT ON THE BOARD ─────────────────────
 * The new-order poll has to keep running while the vendor is on the products
 * screen, or the whole point of an alert is lost. It sits above the shell so the
 * top bar, the rail badge and the board all read one answer.
 */

export const metadata: Metadata = {
  title: {
    default: 'Store',
    template: '%s · Mandi Store',
  },
  description: `Run your shop on ${APP_NAME} — orders, stock, riders and earnings.`,
  // A shop's operations panel has no business in a search index.
  robots: { index: false, follow: false, nocache: true },
};

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <VendorSessionProvider>
      <VendorAlertProvider>
        <VendorShell>{children}</VendorShell>
      </VendorAlertProvider>
    </VendorSessionProvider>
  );
}
