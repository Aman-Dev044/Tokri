'use client';

/**
 * A side / bottom sheet. Used for the mobile nav drawer, the cart, filters.
 *
 * Accessibility, done properly rather than gestured at:
 *  - focus moves into the sheet on open and returns to the opener on close
 *  - Tab is trapped inside while it is open
 *  - Escape closes
 *  - the page behind is inert to scroll
 *  - role="dialog" aria-modal with a labelled title
 */

import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export type SheetSide = 'left' | 'right' | 'bottom';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** hide the title visually but keep it for assistive tech */
  hideTitle?: boolean;
  side?: SheetSide;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  side = 'right',
  children,
  footer,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    returnFocusTo.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', handleKeyDown);

    // Focus the first control inside, or the panel itself.
    const raf = window.requestAnimationFrame(() => {
      const node =
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
      node?.focus();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="mnd-sheet-root" data-side={side}>
      <button
        type="button"
        className="mnd-sheet__scrim"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={['mnd-sheet', `mnd-sheet--${side}`, className]
          .filter(Boolean)
          .join(' ')}
      >
        <header className="mnd-sheet__head">
          <h2
            id={titleId}
            className={hideTitle ? 'mnd-visually-hidden' : 'mnd-sheet__title'}
          >
            {title}
          </h2>
          <button
            type="button"
            className="mnd-sheet__close"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="M5 5 L15 15 M15 5 L5 15"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="mnd-sheet__body">{children}</div>

        {footer ? <footer className="mnd-sheet__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
