'use client';

/**
 * A plain arc spinner.
 *
 * Deliberately NOT the house loading state - <GroceryLoader/> is. Spinner is
 * for the places where a basket would be silly: a 14px indicator beside a
 * live-search field, a table cell refreshing in place. If you are filling a
 * page or a button, reach for GroceryLoader instead.
 */

export interface SpinnerProps {
  size?: number;
  /** stroke width in viewBox units */
  weight?: number;
  label?: string;
  className?: string;
}

export function Spinner({
  size = 16,
  weight = 3,
  label = 'Loading',
  className,
}: SpinnerProps) {
  return (
    <span
      className={['mnd-spinner', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="status"
      aria-live="polite"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth={weight}
          opacity="0.2"
        />
        <path
          d="M21 12 a9 9 0 0 0 -9 -9"
          fill="none"
          stroke="currentColor"
          strokeWidth={weight}
          strokeLinecap="round"
        />
      </svg>
      <span className="mnd-visually-hidden">{label}</span>
    </span>
  );
}
