'use client';

/**
 * PILLAR 1 - CHROMATIC AISLES
 *
 * One attribute on <html> re-tints the entire interface. Every component reads
 * `var(--aisle)`; nothing hardcodes a colour. The 480ms interpolation is done
 * in CSS (tokens.css registers --aisle with @property so it can transition).
 *
 * `preview()` exists for the top-bar aisle menu: hovering an aisle shows the
 * tint live, and leaving restores whatever the committed aisle was.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AisleKey } from '../aisles';

interface AisleContextValue {
  /** the committed aisle, or null for the default moss accent */
  aisle: AisleKey | null;
  /** commit an aisle (route change, category pick) */
  setAisle: (key: AisleKey | null) => void;
  /** temporarily show an aisle without committing it (hover preview) */
  preview: (key: AisleKey | null) => void;
  /** drop the preview and fall back to the committed aisle */
  clearPreview: () => void;
}

const AisleContext = createContext<AisleContextValue | null>(null);

export interface AisleProviderProps {
  children: ReactNode;
  /** initial aisle, e.g. stamped by an /aisle/[aisleKey] route segment */
  initial?: AisleKey | null;
}

export function AisleProvider({ children, initial = null }: AisleProviderProps) {
  const [aisle, setAisleState] = useState<AisleKey | null>(initial);
  const [previewed, setPreviewed] = useState<AisleKey | null>(null);
  const committed = useRef<AisleKey | null>(initial);

  const effective = previewed ?? aisle;

  useEffect(() => {
    const root = document.documentElement;
    if (effective) root.setAttribute('data-aisle', effective);
    else root.removeAttribute('data-aisle');
  }, [effective]);

  const setAisle = useCallback((key: AisleKey | null) => {
    committed.current = key;
    setPreviewed(null);
    setAisleState(key);
  }, []);

  const preview = useCallback((key: AisleKey | null) => {
    setPreviewed(key);
  }, []);

  const clearPreview = useCallback(() => {
    setPreviewed(null);
  }, []);

  const value = useMemo<AisleContextValue>(
    () => ({ aisle, setAisle, preview, clearPreview }),
    [aisle, setAisle, preview, clearPreview],
  );

  return <AisleContext.Provider value={value}>{children}</AisleContext.Provider>;
}

export function useAisle(): AisleContextValue {
  const ctx = useContext(AisleContext);
  if (!ctx) throw new Error('useAisle must be used inside <AisleProvider>');
  return ctx;
}
