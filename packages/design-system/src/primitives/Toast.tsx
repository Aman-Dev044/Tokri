'use client';

/**
 * Toasts. Semantic colour only - never the aisle system, because a toast means
 * something (saved / failed) and colour must never be the only carrier of that
 * meaning. Every tone ships an icon and a text label alongside the hue.
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

export type ToastTone = 'info' | 'good' | 'warn' | 'crit';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms on screen; pass 0 to require a manual dismiss */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, 'description'>> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_LABEL: Record<ToastTone, string> = {
  info: 'Notice',
  good: 'Success',
  warn: 'Warning',
  crit: 'Error',
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {tone === 'good' ? (
        <path
          d="M6 10.4 L8.8 13.2 L14 7.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : tone === 'crit' ? (
        <path
          d="M7 7 L13 13 M13 7 L7 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M10 5.6 V11 M10 13.4 v0.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    ({ title, description, tone = 'info', duration = 5000 }: ToastOptions) => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, title, description, tone, duration }]);
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const handles = timers.current;
    return () => {
      handles.forEach((h) => window.clearTimeout(h));
      handles.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="mnd-toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <output
            key={t.id}
            className="mnd-toast"
            data-tone={t.tone}
            aria-live={t.tone === 'crit' ? 'assertive' : 'polite'}
          >
            <span className="mnd-toast__icon">
              <ToneIcon tone={t.tone} />
            </span>
            <span className="mnd-toast__text">
              <span className="mnd-toast__title">
                <span className="mnd-toast__tone-label">{TONE_LABEL[t.tone]}</span>
                {t.title}
              </span>
              {t.description ? (
                <span className="mnd-toast__desc">{t.description}</span>
              ) : null}
            </span>
            <button
              type="button"
              className="mnd-toast__close"
              onClick={() => dismiss(t.id)}
              aria-label={`Dismiss: ${t.title}`}
            >
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                <path
                  d="M5.5 5.5 L14.5 14.5 M14.5 5.5 L5.5 14.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Standalone, uncontrolled toast - for stories and one-off inline notices. */
export function Toast({
  title,
  description,
  tone = 'info',
  onDismiss,
}: ToastOptions & { onDismiss?: () => void }) {
  return (
    <output className="mnd-toast" data-tone={tone}>
      <span className="mnd-toast__icon">
        <ToneIcon tone={tone} />
      </span>
      <span className="mnd-toast__text">
        <span className="mnd-toast__title">
          <span className="mnd-toast__tone-label">{TONE_LABEL[tone]}</span>
          {title}
        </span>
        {description ? <span className="mnd-toast__desc">{description}</span> : null}
      </span>
      {onDismiss ? (
        <button
          type="button"
          className="mnd-toast__close"
          onClick={onDismiss}
          aria-label={`Dismiss: ${title}`}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <path
              d="M5.5 5.5 L14.5 14.5 M14.5 5.5 L5.5 14.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </output>
  );
}
