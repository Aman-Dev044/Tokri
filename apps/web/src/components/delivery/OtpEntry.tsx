'use client';

/**
 * Proof of delivery: four digits, read aloud by the customer, typed by the
 * rider.
 *
 * ── WHAT THIS COMPONENT DOES NOT KNOW ───────────────────────────────────────
 * It does not know the correct OTP, and it cannot. The order document holds it
 * HASHED (plan phase 6, item 7) and the customer's app reveals it only after
 * `OUT_FOR_DELIVERY`. Nothing in the rider app ever receives it, displays it,
 * caches it or logs it. The four boxes below are a keypad, not a comparison.
 *
 * ── ATTEMPTS ────────────────────────────────────────────────────────────────
 * The API counts wrong attempts and locks the order after five. This shows the
 * count so the rider is never surprised by the lock — but the number is
 * advisory. Deleting it in a debugger buys nothing; the API is the authority.
 *
 * ── INPUT DETAILS THAT MATTER ON A PHONE ────────────────────────────────────
 *   · `inputMode="numeric"` so the numeric keypad opens, not a QWERTY
 *   · `autoComplete="one-time-code"` — harmless here and correct semantically
 *   · paste of "4417" fills all four boxes, because a customer will sometimes
 *     message the code and the rider will paste it
 *   · backspace on an empty box steps back, which is the only behaviour that
 *     does not require looking at the screen
 */

import { useCallback, useRef, useState } from 'react';
import styles from './delivery.module.css';

const LENGTH = 4;

export interface OtpEntryProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * Counts down from 5, straight off the active order's nested
   * `otp.attemptsRemaining`. `null` ⇒ the API has not told us, and the line is
   * hidden rather than guessed at.
   */
  attemptsRemaining?: number | null;
  /** true after a rejected attempt — boxes go red until the next keystroke. */
  invalid?: boolean;
  disabled?: boolean;
}

export function OtpEntry({
  value,
  onChange,
  attemptsRemaining = null,
  invalid = false,
  disabled = false,
}: OtpEntryProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [touched, setTouched] = useState(false);

  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('');

  const write = useCallback(
    (index: number, raw: string) => {
      const clean = raw.replace(/\D/g, '');
      if (clean === '') return;
      setTouched(true);

      // A paste lands entirely in whichever box was focused. Spread it.
      const next = value.split('');
      for (let i = 0; i < clean.length && index + i < LENGTH; i += 1) {
        next[index + i] = clean.charAt(i);
      }
      const joined = next.join('').replace(/\s/g, '').slice(0, LENGTH);
      onChange(joined);

      const landed = Math.min(index + clean.length, LENGTH - 1);
      refs.current[landed]?.focus();
    },
    [value, onChange],
  );

  const onKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace') {
        event.preventDefault();
        setTouched(true);
        const next = value.split('');
        if (next[index] === undefined || next[index] === '') {
          if (index > 0) {
            next[index - 1] = '';
            refs.current[index - 1]?.focus();
          }
        } else {
          next[index] = '';
        }
        onChange(next.join('').replace(/\s/g, ''));
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
      if (event.key === 'ArrowRight' && index < LENGTH - 1) refs.current[index + 1]?.focus();
    },
    [value, onChange],
  );

  const low = attemptsRemaining !== null && attemptsRemaining <= 2;

  return (
    <div>
      <label className={styles.stepTag} htmlFor="rider-otp-0">
        Ask the customer for their 4-digit code
      </label>

      <div className={styles.otpRow}>
        {digits.map((digit, index) => {
          const filled = digit.trim() !== '';
          const classes = [
            styles.otpBox,
            filled ? styles.otpFilled : '',
            invalid && touched ? styles.otpError : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <input
              key={index}
              id={`rider-otp-${index}`}
              ref={(node) => {
                refs.current[index] = node;
              }}
              className={classes}
              type="text"
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              pattern="[0-9]*"
              maxLength={LENGTH}
              value={digit.trim()}
              disabled={disabled}
              aria-label={`Code digit ${index + 1} of ${LENGTH}`}
              aria-invalid={invalid}
              onChange={(event) => write(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              onFocus={(event) => event.currentTarget.select()}
            />
          );
        })}
      </div>

      {attemptsRemaining === null ? null : (
        <p
          className={`${styles.attempts} ${low ? styles.attemptsLow : ''}`}
          role={low ? 'alert' : 'status'}
        >
          {attemptsRemaining === 1
            ? '1 attempt left before this order locks'
            : `${attemptsRemaining} attempts left`}
        </p>
      )}
    </div>
  );
}
