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
import { api, setAccessToken } from '@/lib/api-client';

// `super_admin` is a real role the API returns — it is NOT a flag on `admin`.
// Leaving it out made every super admin fall through role checks as "unknown".
export type Role = 'super_admin' | 'admin' | 'vendor' | 'customer' | 'delivery';

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
  delivery: '/delivery',
  customer: '/',
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
      const res = await api.post<LoginResponse>('/auth/refresh', undefined, {
        anonymous: true,
      });
      setAccessToken(res.accessToken);
      setUser(res.user);
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      return false;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, login, logout, restore }),
    [user, login, logout, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
