'use client';

/**
 * The session, held in memory.
 *
 * ── THE RULE (plan section 4.3) ─────────────────────────────────────────────
 * The 15-minute access token lives in React state and in one module variable
 * inside api-client. It is NEVER written to localStorage or sessionStorage.
 * Both are readable by any script on the origin, so a single XSS turns a stored
 * bearer token into an account takeover. Memory dies with the tab; that is the
 * whole point, and the 7-day httpOnly refresh cookie is what makes losing it on
 * reload acceptable.
 *
 * If you are ever tempted to "just persist it so refresh works" - the correct
 * fix is to call /auth/refresh on mount, which is exactly what `restore()`
 * below is for.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, refreshAccessToken, setAccessToken } from '@/lib/api-client';

// `super_admin` is a real role the API returns — it is NOT a flag on `admin`.
// Leaving it out made every super admin fall through role checks as "unknown".
// `staff` is a store employee — same panel as the owner, narrower permissions.
export type Role = 'super_admin' | 'admin' | 'vendor' | 'staff' | 'customer' | 'delivery';

/**
 * Where each role belongs after signing in.
 *
 * Without this, login fell back to `/` and dropped an admin straight back
 * onto the marketing page, which reads exactly like a failed login.
 */
export const HOME_FOR_ROLE: Record<Role, string> = {
  super_admin: '/admin',
  admin: '/admin',
  vendor: '/vendor',
  // Store staff work in the owner's panel; it draws only what their
  // permissions allow (and the API enforces the same on every request).
  staff: '/vendor',
  delivery: '/delivery',
  // `/shop`, not `/` and no longer `/stores`.
  //
  // Not `/`: the root route is the marketing landing page, so sending a
  // signed-in customer there drops them back on the page they just signed
  // in from — indistinguishable from the login having failed.
  //
  // Not `/stores` either: that is a list of SHOPS, and it asks a customer
  // who wants milk to first pick a merchant. Every app this one competes
  // with opens on PRODUCTS across every category and treats the store as
  // an implementation detail of the item. `/shop` is that page. `/stores`
  // is still reachable and still linked — it is the right screen when you
  // actually want to browse a particular kirana — it is just not where a
  // login lands any more.
  customer: '/shop',
};

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  email?: string;
  phone?: string;
  vendorId?: string;
}

/** Shape returned by POST /auth/login. */
export interface LoginResponse {
  accessToken: string;
  user: SessionUser;
}

interface AuthContextValue {
  user: SessionUser | null;
  /** true once a token is held in memory */
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<SessionUser>;
  /**
   * The last step of the customer signup flow — `POST /auth/register`, once
   * the phone is OTP-verified. Same shape as `login`: sets the in-memory
   * token and the session, and hands back the user so the caller can route
   * by role.
   */
  register: (input: {
    registrationToken: string;
    name: string;
    password: string;
    email?: string;
  }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  /** silently re-acquire an access token from the refresh cookie */
  restore: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);

  const login = useCallback(async (identifier: string, password: string) => {
    // The API accepts email OR phone in a single `identifier` field.
    const res = await api.post<LoginResponse>(
      '/auth/login',
      { identifier, password },
      { anonymous: true },
    );

    setAccessToken(res.accessToken); // memory only
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(
    async (input: {
      registrationToken: string;
      name: string;
      password: string;
      email?: string;
    }) => {
      const res = await api.post<LoginResponse>('/auth/register', input, { anonymous: true });
      setAccessToken(res.accessToken); // memory only
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      // Revokes the whole refresh-token family server-side.
      await api.post<void>('/auth/logout');
    } catch {
      // A failed logout call must still clear the client. The refresh cookie
      // expires on its own; leaving a stale token in memory is worse.
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const restore = useCallback(async () => {
    try {
      // POST /auth/refresh returns `{ accessToken }` and nothing else — it
      // rotates the token, it does not describe the account. Reading
      // `res.user` here set `user` to undefined, and because the old
      // `isAuthenticated` test was `user !== null`, undefined passed it:
      // the app believed it was signed in while every `user.role` read
      // threw. The account comes from /auth/me, which is the one endpoint
      // that reports it, and which re-checks status on every call.
      //
      // Through the SHARED refresh: a request that hit 401 may be
      // refreshing at this very moment, and a second POST with the same
      // cookie would trip reuse detection and end the session.
      const accessToken = await refreshAccessToken();
      if (!accessToken) throw new Error('No session to restore');

      const me = await api.get<SessionUser>('/auth/me');
      setUser(me);
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      return false;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    // Truthiness, not `!== null`: a half-restored session that left `user`
    // undefined used to read as authenticated.
    () => ({ user, isAuthenticated: Boolean(user), login, register, logout, restore }),
    [user, login, register, logout, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
