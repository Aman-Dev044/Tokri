'use client';

/**
 * The two things that cover the panel: a side drawer and a confirm dialog.
 *
 * ── WHY NOT <dialog> ────────────────────────────────────────────────────────
 * `showModal()` gives focus trapping and inertness for free, but it also moves
 * the element to the top layer, where the spring entrance and the backdrop
 * blur behave differently across engines and the drawer cannot animate its own
 * width. These are implemented by hand instead — which means the three things
 * `<dialog>` would have given us have to be implemented by hand too, and are:
 *
 *   · Escape closes.
 *   · Focus moves INTO the overlay on open and BACK to the opener on close.
 *     A drawer that opens behind the keyboard's focus is a drawer a keyboard
 *     user cannot reach.
 *   · Tab is cycled inside the overlay while it is open.
 *
 * ── THE DIALOG STAYS OPEN OVER A FAILING WRITE ──────────────────────────────
 * `loading` disables the confirm button and keeps the dialog mounted. Closing
 * optimistically and letting the request fail behind an already-dismissed
 * dialog is how a vendor believes they rejected an order that is still live.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { IconClose } from './icons';
import { Btn } from './primitives';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Escape-to-close, focus-in on open, focus-back on close, Tab cycling. */
function useOverlayFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // The first focusable thing inside, or the panel itself when there is
    // nothing — never leave focus behind on the page underneath.
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener.current?.focus();
    };
  }, [open, onClose]);

  const onKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const node = ref.current;
    if (!node) return;

    const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return { ref, onKeyDownCapture };
}

/* ================================================================== */
/* Drawer                                                              */
/* ================================================================== */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** the footer row — save, cancel, delete */
  actions?: ReactNode;
  width?: string;
  children: ReactNode;
}

/**
 * A right-hand drawer, for editing ONE thing without losing the list behind it.
 *
 * It springs in rather than sliding linearly: the overshoot is what makes it
 * read as a physical panel arriving instead of a rectangle being revealed. The
 * spring lives in CSS and is flattened under `prefers-reduced-motion`.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  width = 'min(760px, 96vw)',
  children,
}: DrawerProps) {
  const { ref, onKeyDownCapture } = useOverlayFocus(open, onClose);

  if (!open) return null;

  return (
    <div className="ven-overlay" role="presentation">
      <button
        type="button"
        className="ven-overlay__scrim"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div
        className="ven-drawer"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Editor'}
        ref={ref}
        tabIndex={-1}
        onKeyDownCapture={onKeyDownCapture}
      >
        <header className="ven-drawer__head">
          <div className="ven-drawer__headtext">
            <h2 className="ven-drawer__title">{title}</h2>
            {subtitle ? <p className="ven-drawer__sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="ven-iconbtn" onClick={onClose}>
            <IconClose />
            <span className="ven-sr">Close</span>
          </button>
        </header>

        <div className="ven-drawer__body">{children}</div>

        {actions ? <footer className="ven-drawer__foot">{actions}</footer> : null}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Confirm dialog                                                      */
/* ================================================================== */

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** red confirm button — for anything that cannot be undone */
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { ref, onKeyDownCapture } = useOverlayFocus(open, onCancel);

  if (!open) return null;

  return (
    <div className="ven-overlay" data-centre="true" role="presentation">
      <button
        type="button"
        className="ven-overlay__scrim"
        onClick={onCancel}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div
        className="ven-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Confirm'}
        ref={ref}
        tabIndex={-1}
        onKeyDownCapture={onKeyDownCapture}
      >
        <h2 className="ven-dialog__title">{title}</h2>
        {body ? <div className="ven-dialog__body">{body}</div> : null}
        <div className="ven-dialog__foot">
          <Btn onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Btn>
          <Btn
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
          >
            {loading ? 'Working…' : confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
