'use client';

/**
 * − 2 +
 *
 * Big enough to hit on a phone with one thumb, keyboard-operable, and it never
 * silently clamps: hitting the stock ceiling says so in words rather than just
 * refusing to increment, which otherwise reads as a broken button.
 */

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

      <output className="shop-step__value" aria-label={`${value} ${label}`}>
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
