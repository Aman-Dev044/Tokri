'use client';

/**
 * Light / dark / system.
 *
 * "system" means: remove `data-theme` entirely and get the default, which in
 * "Forest Gold" is the dark forest theme on every machine. An explicit choice
 * stamps `data-theme="light"` or `data-theme="dark"`; only light restates
 * values in tokens.css, because dark IS the default.
 *
 * Persistence is localStorage, wrapped in try/catch: private windows, blocked
 * site data and thumbnail capture contexts all throw on access, and a theme
 * toggle must never be the thing that white-screens the app.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'mandi.theme';

function readStored(): ThemeChoice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null;
  } catch {
    return null;
  }
}

function writeStored(value: ThemeChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable - the choice simply does not survive the reload */
  }
}

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  /** cycles system -> light -> dark -> system */
  cycleTheme: () => void;
  /** what is actually on screen right now; null before the client effect runs */
  resolved: 'light' | 'dark' | null;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Always start at "system" so server and first client render agree.
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = readStored();
    if (stored) setThemeState(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    setResolved(theme === 'light' ? 'light' : 'dark');
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    writeStored(t);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeChoice =
        prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system';
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, cycleTheme, resolved }),
    [theme, setTheme, cycleTheme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
