'use client';

/**
 * ★ WHO IS RUNNING THIS SHOP — and therefore what the panel draws.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERYTHING IN THIS FILE IS UX, NOT SECURITY.                             │
 * │                                                                          │
 * │ It decides whether to render the panel or a "not authorised" card. It    │
 * │ decides nothing else. The access decision is made by the API guard chain │
 * │ (plan §4.2):                                                             │
 * │   ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →        │
 * │   ValidationPipe → ResourceOwnerGuard                                    │
 * │                                                                          │
 * │ ★ VendorScopeGuard is the one that matters here. It pins every query to  │
 * │   the caller's OWN vendorId, server-side. That — not this file — is why  │
 * │   editing an id in a URL cannot reach another shop's orders (plan §8.1). │
 * │                                                                          │
 * │ Anyone can skip this component entirely with one curl command. Every     │
 * │ `/vendor/*` endpoint must be safe against that, on its own.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHERE THE ROLE COMES FROM ───────────────────────────────────────────────
 * `GET /auth/me`. Two reasons it is the source of truth rather than the login
 * response:
 *
 *   1. `POST /auth/refresh` returns only an access token — no user — so after a
 *      reload the in-memory session has a token and no identity.
 *   2. The role has to survive a reload without being persisted anywhere a
 *      script could read or edit it (plan §4.3).
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ApiError, api, getAccessToken } from '@/lib/api-client';
import type { StaffRole, StorePermission, VendorMe } from '@/lib/vendor/types';

/**
 * Every permission, for the owner and for the offline preview. Mirrors
 * `ALL_PERMISSIONS` in the API's permissions.ts.
 */
export const ALL_STORE_PERMISSIONS: readonly StorePermission[] = [
  'orders.view',
  'orders.update',
  'products.view',
  'products.manage',
  'inventory.adjust',
  'billing.view',
  'billing.create',
  'billing.void',
  'staff.manage',
  'riders.manage',
  'earnings.view',
  'store.manage',
];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  MANAGER: 'Manager',
  BILLER: 'Biller',
  ORDERS: 'Orders',
  INVENTORY: 'Inventory',
  SUPERVISOR: 'Supervisor',
  CUSTOM: 'Custom',
};

/** Exactly what `GET /auth/me` returns. */
export interface MeResponse {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** 'super_admin' | 'admin' | 'vendor' | 'staff' | 'customer' | 'delivery' */
  role: string;
  status: string;
  vendorId: string | null;
}

export type VendorSessionStatus =
  /** `/auth/me` has not settled yet */
  | 'checking'
  /** a store account (owner or staff) — the panel renders */
  | 'ready'
  /** a real session, but not a vendor one */
  | 'forbidden'
  /**
   * No session could be established — almost always because the API is not
   * running. The panel renders in preview mode against labelled fixtures,
   * which is the only way this surface is reviewable before the endpoints
   * land. Nothing real is exposed: the API refuses every request anyway.
   */
  | 'anonymous';

export interface VendorSessionState {
  status: VendorSessionStatus;
  loading: boolean;
  /** true only for a confirmed vendor session */
  known: boolean;
  name: string;
  /** email, or the phone when there is no email */
  contact: string;
  /** the raw role the API returned, for the "you are signed in as X" copy */
  apiRole: string | null;
  /**
   * The shop this user belongs to. Display only — every request is scoped
   * to it server-side regardless of what this holds.
   */
  vendorId: string | null;
  /** the signed-in user's id, from `/vendor/me` */
  userId: string | null;
  /** true for the store's owner; false for staff */
  isOwner: boolean;
  /** the staff member's job title, or null for the owner */
  staffRole: StaffRole | null;
  shiftLabel: string | null;
  /** "Owner", "Manager", "Biller"… — what the header prints */
  roleLabel: string;
  storeName: string | null;
  storeOpen: boolean | null;
  /**
   * What the panel may DRAW. Read from `GET /vendor/me`, which reports the
   * set the API guard resolved for that very request. UX only — the guard
   * re-checks every call, so hiding a button here protects nothing.
   */
  permissions: ReadonlySet<StorePermission>;
  can: (permission: StorePermission) => boolean;
  refresh: () => void;
}

const NONE: ReadonlySet<StorePermission> = new Set();

const FALLBACK: VendorSessionState = {
  status: 'checking',
  loading: true,
  known: false,
  name: '',
  contact: '',
  apiRole: null,
  vendorId: null,
  userId: null,
  isOwner: false,
  staffRole: null,
  shiftLabel: null,
  roleLabel: '',
  storeName: null,
  storeOpen: null,
  permissions: NONE,
  can: () => false,
  refresh: () => undefined,
};

const VendorSessionContext = createContext<VendorSessionState | null>(null);

interface Resolved {
  status: VendorSessionStatus;
  name: string;
  contact: string;
  apiRole: string | null;
  vendorId: string | null;
  me: VendorMe | null;
}

const UNRESOLVED: Resolved = {
  status: 'checking',
  name: '',
  contact: '',
  apiRole: null,
  vendorId: null,
  me: null,
};

/** The owner and the store's staff both work in this panel. */
export function isVendorRole(role: string | null | undefined): boolean {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return value === 'vendor' || value === 'staff';
}

/**
 * Resolves the session once, above the shell, so the shell and every page below
 * agree about who is looking. Two components asking independently is how a
 * sidebar ends up rendering over someone else's store name.
 */
export function VendorSessionProvider({ children }: { children: ReactNode }): ReactNode {
  const { user, restore } = useAuth();
  const [resolved, setResolved] = useState<Resolved>(UNRESOLVED);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // The id, not the object: AuthProvider hands back a new object every render.
  const userId = user?.id ?? null;

  useEffect(() => {
    let live = true;

    void (async () => {
      // The access token lives in memory only (plan §4.3), so a reload starts
      // with none. Trade the httpOnly refresh cookie for a fresh one first.
      if (getAccessToken() === null) {
        const ok = await restore();
        if (!live) return;
        if (!ok) {
          setResolved({ ...UNRESOLVED, status: 'anonymous' });
          return;
        }
      }

      try {
        const me = await api.get<MeResponse>('/auth/me');
        if (!live) return;
        if (!isVendorRole(me.role)) {
          setResolved({
            status: 'forbidden',
            name: me.name,
            contact: me.email ?? me.phone ?? '',
            apiRole: me.role,
            vendorId: me.vendorId,
            me: null,
          });
          return;
        }

        // The store-side identity: role in the store and what it may do.
        const store = await api.get<VendorMe>('/vendor/me');
        if (!live) return;
        setResolved({
          status: 'ready',
          name: store.name,
          contact: store.email ?? store.phone ?? '',
          apiRole: me.role,
          vendorId: me.vendorId,
          me: store,
        });
      } catch (cause) {
        if (!live) return;
        const forbidden = cause instanceof ApiError && cause.status === 403;
        setResolved({
          ...UNRESOLVED,
          status: forbidden ? 'forbidden' : 'anonymous',
        });
      }
    })();

    return () => {
      live = false;
    };
  }, [restore, userId, nonce]);

  const value = useMemo<VendorSessionState>(() => {
    const me = resolved.me;
    // The offline preview draws everything against labelled fixtures; a
    // real session draws exactly what `/vendor/me` reported.
    const permissions: ReadonlySet<StorePermission> =
      resolved.status === 'anonymous'
        ? new Set(ALL_STORE_PERMISSIONS)
        : new Set(me?.permissions ?? []);

    return {
      status: resolved.status,
      loading: resolved.status === 'checking',
      known: resolved.status === 'ready',
      name: resolved.name,
      contact: resolved.contact,
      apiRole: resolved.apiRole,
      vendorId: resolved.vendorId,
      userId: me?.id ?? null,
      isOwner: me?.isOwner ?? resolved.status === 'anonymous',
      staffRole: me?.staffRole ?? null,
      shiftLabel: me?.shiftLabel ?? null,
      roleLabel: me
        ? me.isOwner
          ? 'Owner'
          : me.staffRole
            ? STAFF_ROLE_LABEL[me.staffRole]
            : 'Staff'
        : '',
      storeName: me?.store.name ?? null,
      storeOpen: me?.store.isOpen ?? null,
      permissions,
      can: (permission) => permissions.has(permission),
      refresh,
    };
  }, [resolved, refresh]);

  // `createElement` rather than JSX so this stays a .ts file alongside the rest
  // of lib/vendor — session plumbing, not a component library.
  return createElement(VendorSessionContext.Provider, { value }, children);
}

/**
 * Outside the provider this returns the checking-state fallback rather than
 * throwing: a component rendered in isolation should draw a skeleton, not
 * crash.
 */
export function useVendorSession(): VendorSessionState {
  return useContext(VendorSessionContext) ?? FALLBACK;
}
