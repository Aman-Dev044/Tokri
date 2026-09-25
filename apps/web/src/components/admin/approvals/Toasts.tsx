'use client';

/**
 * A minimal toast dock, local to the approvals inbox.
 *
 * ── WHY NOT A GLOBAL PROVIDER ───────────────────────────────────────────────
 * Exactly one screen in this console needs "that worked, and the row is gone".
 * A context provider mounted at the admin layout would be a shared surface
 * three people are editing at once for the benefit of one page. When a second
 * screen needs this, it moves up — not before.
 *
 * ── WHY A TOAST AT ALL ──────────────────────────────────────────────────────
 * The confirmation is that the row vanished, and a row vanishing is ambiguous:
 * it looks the same as a filter changing under you. The toast names what
 * happened and to whom, so an operator clearing forty applications can tell a
 * successful approve from a mis-click.
 *
 * It is `aria-live="polite"` and never steals focus — the decision is already
 * made; interrupting the next one would be worse than silence.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './approvals.module.css';

export type ToastTone = 'good' | 'warn' | 'crit';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

const GLYPH: Record<ToastTone, string> = {
  good: '✓',
  warn: '◆',
  crit: '▲',
};

const DISMISS_MS = 6_000;

export interface ToastApi {
  toasts: Toast[];
  push: (tone: ToastTone, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // Timers have to be cancellable on unmount, or a dismissal fires into a
  // component that is gone.
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((list) => [...list, { id, tone, title, detail }]);
      const timer = window.setTimeout(() => dismiss(id), DISMISS_MS);
      timers.current.push(timer);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastDock({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className={styles.toastDock} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${
            toast.tone === 'good'
              ? styles.toastGood
              : toast.tone === 'crit'
                ? styles.toastCrit
                : styles.toastWarn
          }`}
        >
          {/* The glyph is the non-colour half of the signal. */}
          <span className={styles.toastGlyph} aria-hidden="true">
            {GLYPH[toast.tone]}
          </span>
          <div className={styles.toastBody}>
            <p className={styles.toastTitle}>{toast.title}</p>
            {toast.detail === undefined ? null : (
              <p className={styles.toastDetail}>{toast.detail}</p>
            )}
          </div>
          <button type="button" className={styles.toastClose} onClick={() => dismiss(toast.id)}>
            ×<span className="adm-sr">Dismiss notification</span>
          </button>
        </div>
      ))}
    </div>
  );
}
