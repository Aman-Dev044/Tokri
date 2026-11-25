'use client';

/**
 * Presentation-only form fields for the auth surface.
 *
 * The design-system's <Input>/<Checkbox>/<Button> primitives style
 * themselves off an older token set (--fs-small, --muted, --hairline-strong,
 * --focus, --aisle-edge and friends) that no longer exists now that
 * tokens.css is "Neon Orchard" — those custom properties are undefined, so
 * the primitives render with browser defaults instead of the design. Fixing
 * that lives in packages/design-system, which is out of scope here.
 *
 * These local fields carry the exact same behaviour (label, hint, inline
 * error wired through aria-describedby, adornment slot, disabled state) but
 * are styled entirely from auth.css against tokens that are actually defined,
 * so the sign-in and sign-up forms are fully readable and themed.
 */

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface AuthFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  hint?: string;
  error?: string;
  adornment?: ReactNode;
  adornmentSide?: 'start' | 'end';
  mono?: boolean;
}

export function AuthField({
  label,
  hint,
  error,
  adornment,
  adornmentSide = 'end',
  mono = false,
  id,
  ...rest
}: AuthFieldProps) {
  const autoId = useId();
  const inputId = id ?? `authfield-${autoId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="authfield" data-invalid={error ? 'true' : undefined}>
      <label className="authfield__label" htmlFor={inputId}>
        {label}
      </label>

      <div
        className={[
          'authfield__shell',
          adornment ? `authfield__shell--${adornmentSide}` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {adornment && adornmentSide === 'start' ? (
          <span className="authfield__adornment">{adornment}</span>
        ) : null}

        <input
          {...rest}
          id={inputId}
          className={['authfield__input', mono ? 'mono' : ''].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />

        {adornment && adornmentSide === 'end' ? (
          <span className="authfield__adornment">{adornment}</span>
        ) : null}
      </div>

      {error ? (
        <p className="authfield__msg authfield__msg--error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="authfield__msg" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface AuthCheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: ReactNode;
  error?: string;
}

export function AuthCheckbox({ label, error, id, ...rest }: AuthCheckboxProps) {
  const autoId = useId();
  const inputId = id ?? `authcheck-${autoId}`;
  const errorId = `${inputId}-error`;

  return (
    <div className="authcheck" data-invalid={error ? 'true' : undefined}>
      <div className="authcheck__row">
        <input
          {...rest}
          type="checkbox"
          id={inputId}
          className="authcheck__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <span className="authcheck__box" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path
              className="authcheck__tick"
              d="M3.5 8.5 L6.6 11.6 L12.5 4.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <label className="authcheck__label" htmlFor={inputId}>
          {label}
        </label>
      </div>

      {error ? (
        <p className="authfield__msg authfield__msg--error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The submit button. A spinner made of three dots — no dependency on the
 * design-system's GroceryLoader, which shares the same broken-token problem
 * as the primitives above for its page-level chrome. */
export function AuthButton({
  loading,
  loadingLabel = 'Working',
  children,
  ...rest
}: {
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type="submit"
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className="authbtn authbtn--solid authbtn--lg authbtn--block authbtn--glow"
      data-loading={loading ? 'true' : undefined}
    >
      <span className="authbtn__label">
        {children}
        <svg viewBox="0 0 24 24" aria-hidden="true" className="authbtn__arrow">
          <path
            d="M5 12h13m0 0-5-5m5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {loading ? (
        <span className="authbtn__spin" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : null}
      {loading ? <span className="mnd-visually-hidden">{loadingLabel}</span> : null}
    </button>
  );
}
