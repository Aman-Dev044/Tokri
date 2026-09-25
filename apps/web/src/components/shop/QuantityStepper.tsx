'use client';

/**
 * − 2 +
 *
 * Big enough to hit on a phone with one thumb, keyboard-operable, and it never
 * silently clamps: hitting the stock ceiling says so in words rather than just
 * refusing to increment, which otherwise reads as a broken button.
 *
 * The value bounces on `--spring` every time it changes — `shop.css`'s
 * `shop-bounce` keyframe — so a tap reads as the number reacting, not just
 * repainting. `prefers-reduced-motion` collapses it to an instant change via
 * the global reduced-motion block; the state below still flips either way.
 */

import { useEffect, useRef, useState } from 'react';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  /** null = no known ceiling */
  max?: number | null;
  /** what the stepper is counting, for screen readers */
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = null,
  label,
  size = 'md',
  disabled = false,
}: QuantityStepperProps) {
  const atMax = max !== null && value >= max;
  const atMin = value <= min;

  /* Bounce the number, not the whole control, every time it changes — never
     on the first render, or every stepper on a loaded page would pop at once. */
  const previous = useRef(value);
  const [bounce, setBounce] = useState(false);
  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setBounce(true);
      const timer = window.setTimeout(() => {
        setBounce(false);
      }, 320);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [value]);

  return (
    <div className="shop-step" data-size={size} data-disabled={disabled ? 'true' : undefined}>
      <button
        type="button"
        className="shop-step__btn"
        onClick={() => {
          onChange(Math.max(min, value - 1));
        }}
        disabled={disabled || atMin}
        aria-label={`Remove one ${label}`}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M3.5 8 H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <output
        className="shop-step__value"
        data-bounce={bounce ? 'true' : undefined}
        aria-label={`${value} ${label}`}
      >
        {value}
      </output>

      <button
        type="button"
        className="shop-step__btn"
        onClick={() => {
          onChange(max === null ? value + 1 : Math.min(max, value + 1));
        }}
        disabled={disabled || atMax}
        aria-label={`Add one ${label}`}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M8 3.5 V12.5 M3.5 8 H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {atMax ? (
        <span className="shop-step__cap" role="status">
          {max} is all the store has
        </span>
      ) : null}
    </div>
  );
}
