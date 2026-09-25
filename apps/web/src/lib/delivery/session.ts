'use client';

/**
 * Who is looking at the rider app — resolved ONCE, high in the tree.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS UX, NOT SECURITY.                                                │
 * │                                                                          │
 * │ Showing a "not authorised" card to a customer who typed /delivery stops  │
 * │ nobody. The React state can be edited in a debugger, and every one of    │
 * │ these endpoints can be hit with curl regardless of what this file        │
 * │ decides.                                                                 │
 * │                                                                          │
 * │ The real enforcement is the API guard chain (plan §4.2):                 │
 * │   ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →        │
 * │   ValidationPipe → ResourceOwnerGuard                                    │
 * │ plus `@Roles('delivery')` on the whole DELIVERY block in §6.2. That runs │
 * │ whether or not this file ran, and it is the layer that matters.          │
 * │                                                                          │
 * │ `middleware.ts` is layer 1 and only checks that a refresh cookie exists. │
 * │ This is layer 2. Never move an authorisation decision into either.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY A RESTORE HAPPENS HERE ──────────────────────────────────────────────
 * The 15-minute access token lives in memory only (plan §4.3), so a reload —
 * or a PWA cold start, which is the normal way a rider opens this app — begins
 * with none. The httpOnly `mandi_rt` cookie is traded for a fresh one before
 * anything else is attempted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/components/auth/AuthProvider';

export type RiderSessionStatus =
  /** The restore / `/auth/me` round trip is in flight. */
  | 'checking'
  /** No session at all — middleware will normally have redirected first. */
  | 'anonymous'
  /** Signed in, but not as a delivery partner. */
  | 'forbidden'
  | 'ready';

interface MeResponse {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
}

export interface RiderSession {
  status: RiderSessionStatus;
  name: string;
  /** Whatever the API called the role, verbatim — useful in the gate copy. */
  apiRole: string | null;
  /** Re-run the check, for the "Try again" button. */
  recheck: () => void;
}

/** The API may spell it `delivery`, `DELIVERY` or `delivery_partner`. */
function isRiderRole(role: string): boolean {
  const normalised = role.trim().toLowerCase();
  return (
    normalised === 'delivery' ||
    normalised === 'delivery_partner' ||
    normalised === 'rider'
  );
}

export function useRiderSession(): RiderSession {
  const { user, restore } = useAuth();
  const [status, setStatus] = useState<RiderSessionStatus>('checking');
  const [name, setName] = useState('');
  const [apiRole, setApiRole] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const recheck = useCallback(() => {
    setStatus('checking');
    setNonce((n) => n + 1);
  }, []);

  // The id, not the object: AuthProvider hands back a fresh object each render.
  const userId = user?.id ?? null;

  useEffect(() => {
    let live = true;

    void (async () => {
      if (getAccessToken() === null) {
        const ok = await restore();
        if (!live) return;
        if (!ok) {
          setStatus('anonymous');
          setApiRole(null);
          return;
        }
      }

      try {
        const me = await api.get<MeResponse>('/auth/me');
        if (!live) return;
        setName(me.name);
        setApiRole(me.role);
        setStatus(isRiderRole(me.role) ? 'ready' : 'forbidden');
      } catch (cause) {
        if (!live) return;
        const forbidden = cause instanceof ApiError && cause.status === 403;
        setApiRole(null);
        setStatus(forbidden ? 'forbidden' : 'anonymous');
      }
    })();

    return () => {
      live = false;
    };
  }, [restore, userId, nonce]);

  return useMemo<RiderSession>(
    () => ({ status, name, apiRole, recheck }),
    [status, name, apiRole, recheck],
  );
}
