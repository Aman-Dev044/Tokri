'use client';

/**
 * ★ WHO IS LOOKING AT THIS CONSOLE — and therefore what it draws.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERYTHING IN THIS FILE IS UX, NOT SECURITY.                             │
 * │                                                                          │
 * │ It decides which links appear in a sidebar, which landing page renders,  │
 * │ and which buttons exist. It decides nothing else. The access decision is │
 * │ made by the API guard chain (plan §4.2):                                 │
 * │   ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →        │
 * │   ValidationPipe → ResourceOwnerGuard                                    │
 * │ Anyone can skip this file entirely with one curl command. Every          │
 * │ `/admin/*` endpoint must be safe against that, on its own.               │
 * │                                                                          │
 * │ Never move an authorisation decision here, and never let a hidden nav    │
 * │ item stand in for a role check on the server.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHERE THE ROLE COMES FROM ───────────────────────────────────────────────
 * `GET /auth/me`, which returns the API's own spelling: `'super_admin'` or
 * `'admin'` (plus the three non-platform roles). That endpoint is the single
 * source of truth, for two reasons:
 *
 *   1. `POST /auth/refresh` returns ONLY an access token — no user — so after
 *      a page reload the in-memory session has a token and no identity. Asking
 *      `/auth/me` is what turns that token back into a person.
 *   2. The role has to survive a reload without being persisted anywhere a
 *      script could read or edit it.
 *
 * ── LEAST PRIVILEGE ─────────────────────────────────────────────────────────
 * An unknown, unparseable or missing role resolves to `ADMIN`, the lower tier.
 * Defaulting the other way would mean a misconfigured token silently drawing
 * the highest-privilege console — the same failure shape as
 * `process.env.SECRET || 'dev'`. A wrongly-hidden link is a support question;
 * a wrongly-shown one is a support ticket.
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
import { useAuth, type SessionUser } from '@/components/auth/AuthProvider';
import { ApiError, api, getAccessToken } from '@/lib/api-client';
import type { AdminLevel } from './types';

/* ================================================================== */
/* Parsing                                                             */
/* ================================================================== */

/** Exactly what `GET /auth/me` returns. */
export interface MeResponse {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** the API's spelling: 'super_admin' | 'admin' | 'vendor' | 'customer' | 'delivery' */
  role: string;
  status: string;
  vendorId: string | null;
}

/**
 * API role string -> console level, or `null` when the caller is not platform
 * staff at all.
 *
 * Both spellings are accepted for each tier because the API enum
 * (`super_admin`) and the console's own type (`SUPER_ADMIN`) disagree on case,
 * and a role that fails to parse on a capitalisation difference would silently
 * demote a super admin.
 */
export function parseAdminRole(role: string | null | undefined): AdminLevel | null {
  if (typeof role !== 'string') return null;
  const normalised = role.trim().toLowerCase();
  if (normalised === 'super_admin' || normalised === 'superadmin') return 'SUPER_ADMIN';
  if (normalised === 'admin') return 'ADMIN';
  return null;
}

/**
 * The level of a session user held in memory.
 *
 * `SessionUser.role` is typed as the four customer-facing roles and has no
 * `super_admin` member, so the field is read as a string rather than compared
 * against the union — a `===` against a literal outside the union is a compile
 * error, and widening `SessionUser` would push admin tiers into an interface
 * shared with three surfaces that have no business knowing about them.
 *
 * An optional `adminLevel` claim still wins when the API attaches one.
 */
export function adminLevelOf(user: SessionUser | null): AdminLevel | null {
  if (!user) return null;

  const bag = user as unknown as Record<string, unknown>;
  const claim = bag['adminLevel'];
  if (claim === 'SUPER_ADMIN' || claim === 'ADMIN') return claim;
  if (bag['isSuperAdmin'] === true) return 'SUPER_ADMIN';

  return parseAdminRole(typeof bag['role'] === 'string' ? bag['role'] : null);
}

export function isSuperAdmin(level: AdminLevel | null): boolean {
  return level === 'SUPER_ADMIN';
}

export const ADMIN_LEVEL_LABEL: Record<AdminLevel, string> = {
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
};

/** The short form, for the pill in the user menu and the rail. */
export const ADMIN_LEVEL_PILL: Record<AdminLevel, string> = {
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER ADMIN',
};

/* ================================================================== */
/* Session state                                                       */
/* ================================================================== */

export type AdminSessionStatus =
  /** `/auth/me` has not settled yet */
  | 'checking'
  /** platform staff — `level` is meaningful */
  | 'ready'
  /** a real session, but not an admin one */
  | 'forbidden'
  /**
   * No session could be established — almost always because the API is not
   * running. The console renders in preview mode against labelled fixtures,
   * which is the only way this surface is reviewable before the endpoints land.
   * Nothing real is exposed: the API refuses every request anyway.
   */
  | 'anonymous';

export interface AdminRoleState {
  /** THE role, least-privilege by default. Never `null` — see the header. */
  role: AdminLevel;
  isSuperAdmin: boolean;
  /** true for a PLAIN admin — the operations tier, not the governance tier */
  isAdmin: boolean;
  /** false while `/auth/me` is in flight or unreachable; `role` is a guess then */
  known: boolean;
  status: AdminSessionStatus;
  /** still resolving — render a skeleton rather than guessing a landing page */
  loading: boolean;
  name: string;
  /** email, or the phone when there is no email */
  contact: string;
  /** the raw role the API returned, for the "you are signed in as X" copy */
  apiRole: string | null;
  /**
   * PREVIEW MODE ONLY. Lets a reviewer with no API see both sides of the
   * super-admin split without two accounts. Ignored entirely once a real
   * session exists, and it grants nothing either way: with no token, every
   * request 401s.
   */
  canPreviewSwitch: boolean;
  setPreviewRole: (role: AdminLevel) => void;
  refresh: () => void;
}

const FALLBACK: AdminRoleState = {
  role: 'ADMIN',
  isSuperAdmin: false,
  isAdmin: true,
  known: false,
  status: 'checking',
  loading: true,
  name: '',
  contact: '',
  apiRole: null,
  canPreviewSwitch: false,
  setPreviewRole: () => undefined,
  refresh: () => undefined,
};

const AdminRoleContext = createContext<AdminRoleState | null>(null);

/* ================================================================== */
/* Provider                                                            */
/* ================================================================== */

interface Resolved {
  status: AdminSessionStatus;
  level: AdminLevel | null;
  name: string;
  contact: string;
  apiRole: string | null;
}

const UNRESOLVED: Resolved = {
  status: 'checking',
  level: null,
  name: '',
  contact: '',
  apiRole: null,
};

/**
 * Resolves the session once, high in the tree, so the shell and every page
 * below it agree about who is looking. Two components asking independently is
 * how a sidebar ends up showing one role's menu over another role's dashboard.
 */
export function AdminRoleProvider({ children }: { children: ReactNode }): ReactNode {
  const { user, restore } = useAuth();
  const [resolved, setResolved] = useState<Resolved>(UNRESOLVED);
  const [previewRole, setPreviewRole] = useState<AdminLevel>('SUPER_ADMIN');
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // The user id, not the object: AuthProvider hands back a new object on every
  // render, and depending on it would re-run this on every keystroke anywhere.
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
        const level = parseAdminRole(me.role);
        setResolved({
          status: level === null ? 'forbidden' : 'ready',
          level,
          name: me.name,
          contact: me.email ?? me.phone ?? '',
          apiRole: me.role,
        });
      } catch (cause) {
        if (!live) return;
        // A 403 from /auth/me would be odd (it is authenticated-only, not
        // role-gated) but it still means "signed in, not for you".
        const forbidden = cause instanceof ApiError && cause.status === 403;
        setResolved({
          ...UNRESOLVED,
          status: forbidden ? 'forbidden' : 'anonymous',
          apiRole: null,
        });
      }
    })();

    return () => {
      live = false;
    };
  }, [restore, userId, nonce]);

  const value = useMemo<AdminRoleState>(() => {
    const ready = resolved.status === 'ready' && resolved.level !== null;
    const anonymous = resolved.status === 'anonymous';

    // Least privilege: anything not positively known to be a super admin is a
    // plain ADMIN. The preview override applies ONLY with no session at all.
    const role: AdminLevel = ready
      ? (resolved.level ?? 'ADMIN')
      : anonymous
        ? previewRole
        : 'ADMIN';

    return {
      role,
      isSuperAdmin: role === 'SUPER_ADMIN',
      isAdmin: role === 'ADMIN',
      known: ready,
      status: resolved.status,
      loading: resolved.status === 'checking',
      name: resolved.name,
      contact: resolved.contact,
      apiRole: resolved.apiRole,
      canPreviewSwitch: anonymous,
      setPreviewRole,
      refresh,
    };
  }, [resolved, previewRole, refresh]);

  // `createElement` rather than JSX so this stays a .ts file alongside the rest
  // of lib/admin — the provider is session plumbing, not a component library.
  return createElement(AdminRoleContext.Provider, { value }, children);
}

/* ================================================================== */
/* Hook                                                                */
/* ================================================================== */

/**
 * `const { role, isSuperAdmin, isAdmin } = useAdminRole();`
 *
 * Outside the provider it returns the least-privilege fallback rather than
 * throwing: a component rendered in isolation (a test, a storybook page)
 * should draw the safer console, not crash.
 */
export function useAdminRole(): AdminRoleState {
  return useContext(AdminRoleContext) ?? FALLBACK;
}
