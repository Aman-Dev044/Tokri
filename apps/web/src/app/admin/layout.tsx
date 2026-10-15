import type { Metadata } from 'next';
import '@/styles/admin.css';
import { AdminShell } from '@/components/admin/AdminShell';
import { AdminRoleProvider } from '@/lib/admin/session';
import { APP_NAME } from '@/config/brand';

/**
 * The admin surface.
 *
 * Stays a Server Component so the metadata below is static; every interactive
 * part lives inside `<AdminRoleProvider>` and `<AdminShell>`, which together
 * are the one client boundary for the whole console.
 *
 * ── ROLE AWARENESS (the reason the provider is HERE) ────────────────────────
 * A plain ADMIN and a SUPER_ADMIN share this route tree. The menu, the landing
 * page and the ⌘K command set differ; the URLs do not. That split is decided
 * once, in `<AdminRoleProvider>`, and read by the shell AND by every page under
 * it — because a sidebar showing one role's menu over another role's dashboard
 * is exactly the bug two independent role lookups produce.
 *
 * The provider sits ABOVE the shell so a page can branch on the role without
 * the shell having to pass it down through `children`.
 *
 * ── RENDERING (plan §3.3) ───────────────────────────────────────────────────
 * CSR. These are auth-gated dashboards: SSR buys nothing a user would notice
 * and complicates token handling, because the 15-minute access token lives in
 * memory on the client and the server has no way to read it.
 *
 * ── PROTECTION ──────────────────────────────────────────────────────────────
 * Layer 1 is `middleware.ts`, which only checks that a refresh cookie exists.
 * Layer 2 is the role gate inside `<AdminShell>`. Both are UX. Layer 3 — the
 * API guard chain in plan §4.2 — is the one that actually stops anybody, and
 * it runs whether or not either of the first two did.
 */

export const metadata: Metadata = {
  title: {
    default: 'Console',
    template: `%s · ${APP_NAME} Console`,
  },
  description: `${APP_NAME} platform administration.`,
  // An admin console has no business in an index, and no OG card to render.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminRoleProvider>
      <AdminShell>{children}</AdminShell>
    </AdminRoleProvider>
  );
}
