'use client';

/**
 * ADMIN vs SUPER_ADMIN, for the UI only.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS UX, NOT SECURITY.                                                │
 * │                                                                          │
 * │ Hiding "Generate settlements" or locking the settings form is a courtesy │
 * │ so a plain admin is not offered a button that will 403. It stops nobody: │
 * │ the request can be made with curl, and React state can be edited in a    │
 * │ debugger.                                                                │
 * │                                                                          │
 * │ The real enforcement is the API guard chain (plan §4.2):                 │
 * │   ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →        │
 * │   ValidationPipe → ResourceOwnerGuard                                    │
 * │                                                                          │
 * │ Never move an authorisation decision into this file.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The session user carries `role: 'admin'` and nothing finer, so the elevated
 * tier is read from an OPTIONAL field the API may attach. When it is absent we
 * assume the lower privilege — least privilege is the only safe default for a
 * guess, and a wrongly-hidden button is recoverable where a wrongly-shown one
 * is a support ticket.
 */

import { useMemo } from 'react';
import { useAuth, type SessionUser } from '@/components/auth/AuthProvider';
import type { AdminLevel } from '@/lib/admin/types';

/** Re-exported under the console's own name. `AdminLevel` is the shared type. */
export type AdminTier = AdminLevel;

/** Narrowing read of a field that is not on the declared `SessionUser` type. */
function readTier(user: SessionUser | null): AdminTier {
  if (user === null) return 'ADMIN';
  // `as unknown as` because SessionUser is a closed interface with no index
  // signature; a direct assignment is a compile error under strict mode.
  const bag = user as unknown as Record<string, unknown>;

  const explicit = bag['adminLevel'] ?? bag['adminTier'];
  if (explicit === 'SUPER_ADMIN' || explicit === 'ADMIN') return explicit;

  // Tolerate the two other spellings the API might land on.
  if (bag['isSuperAdmin'] === true) return 'SUPER_ADMIN';
  const scopes = bag['scopes'];
  if (Array.isArray(scopes) && scopes.includes('super_admin')) return 'SUPER_ADMIN';

  return 'ADMIN';
}

export interface AdminRole {
  tier: AdminTier;
  isSuperAdmin: boolean;
  /** Copy for the read-only notice, so every page words it the same way. */
  restrictedNote: string;
}

export function useAdminRole(): AdminRole {
  const { user } = useAuth();
  return useMemo<AdminRole>(() => {
    const tier = readTier(user);
    return {
      tier,
      isSuperAdmin: tier === 'SUPER_ADMIN',
      restrictedNote:
        'Read-only — this section is restricted to super-admins. The API enforces this; what you see here just keeps the buttons honest.',
    };
  }, [user]);
}
