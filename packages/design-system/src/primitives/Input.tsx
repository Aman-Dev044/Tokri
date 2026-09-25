'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** helper copy under the field - replaced by `error` when one is present */
  hint?: string;
  /** inline validation message. Sets aria-invalid and wires aria-describedby. */
  error?: string;
  /** e.g. a show/hide password button, or a ₹ prefix */
  adornment?: ReactNode;
  adornmentSide?: 'start' | 'end';
  /** prices, OTPs, phone numbers - switches to the mono face + tabular figures */
  mono?: boolean;
  block?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    adornment,
    adornmentSide = 'end',
    mono = false,
    block = true,
    id,
    className,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `mnd-input-${autoId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div
      className={['mnd-field', block ? 'mnd-field--block' : '', className]
        .filter(Boolean)
        .join(' ')}
      data-invalid={error ? 'true' : undefined}
    >
      {label ? (
        <label className="mnd-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <div
        className={[
          'mnd-field__shell',
          adornment ? `mnd-field__shell--${adornmentSide}` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {adornment && adornmentSide === 'start' ? (
          <span className="mnd-field__adornment">{adornment}</span>
        ) : null}

        <input
          {...rest}
          ref={ref}
          id={inputId}
          className={['mnd-field__input', mono ? 'mnd-mono' : ''].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />

        {adornment && adornmentSide === 'end' ? (
          <span className="mnd-field__adornment">{adornment}</span>
        ) : null}
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
