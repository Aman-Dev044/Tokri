'use client';

import { forwardRef } from 'react';
import type { LabelHTMLAttributes } from 'react';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** appends the required marker and the visually-hidden word "required" */
  required?: boolean;
  /** small all-caps eyebrow treatment, used above form groups */
  eyebrow?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { required = false, eyebrow = false, className, children, ...rest },
  ref,
) {
  return (
    <label
      {...rest}
      ref={ref}
      className={['mnd-label', eyebrow ? 'mnd-label--eyebrow' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
      {required ? (
        <>
          <span className="mnd-label__req" aria-hidden="true">
            *
          </span>
          <span className="mnd-visually-hidden"> (required)</span>
        </>
      ) : null}
    </label>
  );
});
