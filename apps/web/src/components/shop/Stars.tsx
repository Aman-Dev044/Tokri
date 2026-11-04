'use client';

/**
 * Stars — one to read, one to choose.
 *
 * The read-only row is decoration over a sentence: the stars are
 * `aria-hidden` and the number is said in words, because "star star star
 * star hollow-star" is not something anyone wants read aloud.
 *
 * The input is FIVE RADIO BUTTONS in a fieldset, not five clickable spans:
 * that is what a single choice out of five is, so arrow keys, the tab
 * order and a screen reader's "3 of 5, selected" all come for free.
 * No transforms on hover or press — colour only — because these also sit
 * inside panels that may one day tilt.
 */

import { useId } from 'react';

export function Stars({ value, label }: { value: number; label?: string }) {
  const filled = Math.round(value);
  return (
    <span className="shop-stars" role="img" aria-label={label ?? `${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" data-on={n <= filled ? 'true' : 'false'}>
          ★
        </span>
      ))}
    </span>
  );
}

const WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'] as const;

export function StarInput({
  legend,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  value: number | null;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="shop-starinput" disabled={disabled}>
      <legend className="shop-starinput__legend">{legend}</legend>
      <div className="shop-starinput__row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="shop-starinput__star"
            data-on={value !== null && n <= value ? 'true' : 'false'}
          >
            <input
              type="radio"
              className="mnd-visually-hidden"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => {
                onChange(n);
              }}
            />
            <span aria-hidden="true">★</span>
            <span className="mnd-visually-hidden">
              {n} {n === 1 ? 'star' : 'stars'} — {WORDS[n]}
            </span>
          </label>
        ))}
        <span className="shop-starinput__word" aria-hidden="true">
          {value === null ? 'Tap a star' : WORDS[value]}
        </span>
      </div>
    </fieldset>
  );
}
