'use client';

/**
 * Vendor-only atoms.
 *
 * Everything that already exists on the admin surface — DataTable, KpiTile,
 * StatusPill, Money, RelativeTime, DetailDrawer, ConfirmDialog, EmptyState, the
 * charts — is imported from `@/components/admin` and used as-is. Only what the
 * shop panel genuinely has and the console does not lives here.
 */

import type { ChangeEvent, ReactNode } from 'react';
import { useId } from 'react';
import type { Freshness } from '@/hooks';

/* ================================================================== */
/* FreshLine                                                           */
/* ================================================================== */

export interface FreshLineProps {
  freshness: Freshness;
  /** the poll interval, so the line can say how often it should update */
  everyMs: number;
  onRefresh?: () => void;
}

/**
 * ★ "Updated 4s ago" — and whether that is still true.
 *
 * A board that silently stops polling looks exactly like a quiet evening. The
 * vendor keeps reading a frozen screen and decides they have nothing to do.
 * That is the worst failure an ops surface has and it is invisible unless the
 * page says, out loud, how old what you are looking at is.
 *
 * STALE is a WORD, not just a colour (plan §2.6), and the paused state is
 * spelled out too — a backgrounded tab is not stale data, it is deliberate,
 * and the two deserve different sentences.
 */
export function FreshLine({ freshness, everyMs, onRefresh }: FreshLineProps) {
  const { secondsAgo, stale, visible } = freshness;
  const state = !visible ? 'paused' : stale ? 'stale' : 'live';

  const text =
    secondsAgo === null
      ? 'waiting for first data'
      : state === 'paused'
        ? `paused — tab in background · last update ${secondsAgo}s ago`
        : state === 'stale'
          ? `STALE — no update for ${secondsAgo}s`
          : `updated ${secondsAgo}s ago`;

  return (
    <span className="ven-fresh" data-state={state} role="status">
      <span className="ven-fresh__dot" aria-hidden="true" />
      {text}
      <span className="adm-sr">. Refreshes every {Math.round(everyMs / 1000)} seconds.</span>
      {onRefresh ? (
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRefresh}>
          Refresh now
        </button>
      ) : null}
    </span>
  );
}

/* ================================================================== */
/* Segmented switch                                                    */
/* ================================================================== */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
}

/** Day / week / month, and the three order-history ranges. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="ven-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ven-seg__btn"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Form field                                                          */
/* ================================================================== */

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** rendered instead of an input when the field is something custom */
  children: (id: string) => ReactNode;
}

/**
 * Label, control, hint, error — wired together with one generated id.
 *
 * The id is generated rather than passed because a duplicated `htmlFor` across
 * two drawers is invisible on screen and completely breaks a screen reader, and
 * hand-written ids duplicate the moment a form is copied.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId().replace(/:/g, '');
  return (
    <div className="ven-field">
      <label className="ven-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? <span className="ven-field__hint">{hint}</span> : null}
      {error ? (
        <span className="ven-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Rupee input                                                         */
/* ================================================================== */

export interface RupeeInputProps {
  id: string;
  /** INTEGER PAISE */
  value: number;
  onChange: (paise: number) => void;
  disabled?: boolean;
}

/**
 * ★ The one place a human types rupees and an integer comes out.
 *
 * Money is stored as integer paise everywhere (plan §5.2), but nobody types
 * `14950` for ₹149.50. So this component — and nothing else in the panel —
 * converts, and it does it with a `Math.round` rather than a bare multiply:
 * `149.5 * 100` is `14949.999999999998` in IEEE 754, and truncating that is how
 * an order ends up a paisa short.
 */
export function RupeeInput({ id, value, onChange, disabled }: RupeeInputProps) {
  const rupees = (value / 100).toFixed(2);

  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(event.target.value);
    onChange(Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
  };

  return (
    <input
      id={id}
      className="ven-input"
      data-num="true"
      type="number"
      inputMode="decimal"
      min={0}
      step="0.01"
      value={rupees}
      onChange={handle}
      disabled={disabled}
    />
  );
}

/* ================================================================== */
/* Error / not-built-yet panel                                         */
/* ================================================================== */

export interface EndpointErrorProps {
  path: string;
  message: string;
  onRetry?: () => void;
}

/**
 * Shown when a query failed AND there is no fixture for it.
 *
 * The path is on screen deliberately. "Something went wrong" sends a vendor to
 * support; `/vendor/earnings — 404` sends a developer to the right file.
 */
export function EndpointError({ path, message, onRetry }: EndpointErrorProps) {
  return (
    <div className="adm-empty">
      <p className="adm-empty__title">This screen could not load</p>
      <p className="adm-empty__body">
        {message}
        <br />
        <code>{path}</code>
      </p>
      {onRetry ? (
        <div style={{ marginTop: 'var(--s-2)' }}>
          <button type="button" className="adm-btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
