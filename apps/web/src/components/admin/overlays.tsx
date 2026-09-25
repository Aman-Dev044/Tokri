'use client';

/**
 * The two overlays: a detail drawer and a confirm dialog.
 *
 * ── WHY THESE ARE HAND-BUILT AND NOT `<dialog>` ─────────────────────────────
 * `<dialog showModal()>` gives focus trapping and inertness for free, and it
 * would be the right call for the dialog alone. The drawer needs to animate in
 * from the right and animate OUT before it unmounts, which `<dialog>` fights,
 * and having the two overlays in this console behave differently — different
 * scrim, different escape handling, different focus restore — is worse than
 * writing the twenty lines twice.
 *
 * Both share `useOverlay` below, so the behaviour IS the same: Escape closes,
 * focus moves in on open and returns to where it came from on close, Tab is
 * trapped, and the body cannot scroll behind the overlay.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { IconClose } from './icons';

/* ================================================================== */
/* Shared overlay behaviour                                            */
/* ================================================================== */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useOverlay(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = ref.current;
    // Focus the first control, or the container itself. Leaving focus behind on
    // the trigger means the first Tab press walks the page under the overlay.
    const first = container?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !container) return;

      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  return ref;
}

/* ================================================================== */
/* DetailDrawer                                                        */
/* ================================================================== */

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** how wide — a settlement drawer needs more room than a vendor one */
  width?: string;
  children: ReactNode;
}

/**
 * A side panel for the thing you just clicked, without losing the list you
 * clicked it from.
 *
 * The slide uses the spring easing (`--spring`), which is the one place it
 * appears in the console: a drawer is a physical object being pulled out, and
 * it should settle rather than stop dead. Everything else here uses `--ease`.
 * Scattering bounce around an operations tool makes it feel unserious.
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  width,
  children,
}: DetailDrawerProps) {
  const ref = useOverlay(open, onClose);

  if (!open) return null;

  return (
    <>
      <div className="adm-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="adm-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        style={width ? { width } : undefined}
      >
        <header className="adm-drawer__head">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h2 className="adm-drawer__title">{title}</h2>
            {subtitle ? <p className="adm-drawer__sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="adm-iconbtn" onClick={onClose}>
            <IconClose />
            <span className="adm-sr">Close</span>
          </button>
        </header>

        <div className="adm-drawer__body">{children}</div>

        {actions ? <footer className="adm-drawer__actions">{actions}</footer> : null}
      </div>
    </>
  );
}

/* ================================================================== */
/* ConfirmDialog                                                       */
/* ================================================================== */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** keeps the dialog open and both buttons disabled while the write runs */
  loading?: boolean;
  /**
   * Block confirmation until the dialog's own body is satisfied — an unassign
   * whose reason is still empty, say. Cancel stays live: a dialog you cannot
   * leave is worse than one you cannot submit.
   *
   * This is UX. The API validates the same rule itself, and is what actually
   * refuses an unexplained write.
   */
  confirmDisabled?: boolean;
}

/**
 * "Are you sure" — used only where the answer could genuinely be no.
 *
 * ── IT STAYS OPEN WHILE THE REQUEST RUNS ────────────────────────────────────
 * `loading` disables both buttons and leaves the dialog up. The tempting
 * alternative — close on click and let a toast report the outcome — means a
 * failed suspension looks exactly like a successful one for the two seconds
 * before the toast arrives, and the operator has already moved on.
 *
 * Cancel is focused first when the action is destructive, so a reflexive Enter
 * does the safe thing.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  loading = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  // Escape must not dismiss a dialog whose request is already in flight — the
  // write is happening either way, and hiding it does not stop it.
  const handleClose = useCallback(() => {
    if (!loading) onCancel();
  }, [loading, onCancel]);

  const ref = useOverlay(open, handleClose);

  if (!open) return null;

  return (
    <div className="adm-dialog__scrim" onClick={handleClose}>
      <div
        className="adm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="adm-dialog__title">{title}</h2>
        <div className="adm-dialog__body">{body}</div>

        <div className="adm-dialog__actions">
          <button
            type="button"
            className="adm-btn"
            onClick={onCancel}
            disabled={loading}
            autoFocus={destructive}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'adm-btn adm-btn--danger' : 'adm-btn adm-btn--primary'}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            autoFocus={!destructive}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
