'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: string;
  error?: string;
}

/**
 * A real <input type="checkbox">, visually replaced but never removed: it keeps
 * keyboard behaviour, form participation and the native indeterminate state.
 * The tick is drawn as an SVG path that strokes itself on, in --aisle.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `mnd-check-${autoId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div
      className={['mnd-check', className].filter(Boolean).join(' ')}
      data-invalid={error ? 'true' : undefined}
    >
      <div className="mnd-check__row">
        <input
          {...rest}
          ref={ref}
          type="checkbox"
          id={inputId}
          className="mnd-check__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <span className="mnd-check__box" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path
              className="mnd-check__tick"
              d="M3.5 8.5 L6.6 11.6 L12.5 4.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <label className="mnd-check__label" htmlFor={inputId}>
          {label}
        </label>
      </div>

      {error ? (
        <p className="mnd-field__msg mnd-field__msg--error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mnd-field__msg" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
