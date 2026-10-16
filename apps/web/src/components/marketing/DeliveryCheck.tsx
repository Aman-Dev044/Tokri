'use client';

import { useState } from 'react';
import Link from 'next/link';

import { ApiError, api } from '@/lib/api-client';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  "DO WE DELIVER TO YOU?"
 * ════════════════════════════════════════════════════════════════════════
 *
 * The first question anyone has about a grocery service, asked before they
 * will look at a single price. Answering it on the landing page — before a
 * signup, before a location permission prompt — is the difference between
 * a visitor and a bounce.
 *
 * ── It asks the REAL endpoint ───────────────────────────────────────────
 * `GET /pincodes/:pincode` is public and is the same check `/checkout`
 * runs. There is no second list of PIN codes in the front end to drift
 * from it: a code that answers yes here is a code the checkout will also
 * accept, and the day operations add a city both screens learn it at once.
 *
 * ── The refusal is the useful half ──────────────────────────────────────
 * A 400 from that route carries the cities the platform DOES serve, so a
 * "no" is never a dead end — it names where the service exists today. That
 * list is rendered from the error body rather than typed here, for the
 * same reason as above.
 */

interface Serviceable {
  pincode: string;
  city: string;
}

interface NotServiceable {
  code?: string;
  serviceable?: ReadonlyArray<{ city: string; pincodes: readonly string[] }>;
}

type Result =
  | { kind: 'yes'; city: string; pincode: string }
  | { kind: 'no'; cities: readonly string[] }
  | { kind: 'error'; message: string };

export function DeliveryCheck() {
  const [pincode, setPincode] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const valid = /^\d{6}$/.test(pincode);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || checking) return;
    setChecking(true);
    setResult(null);
    try {
      const hit = await api.get<Serviceable>(`/pincodes/${pincode}`);
      setResult({ kind: 'yes', city: hit.city, pincode: hit.pincode });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400) {
        // The 400 body names every city on the platform — a refusal that
        // tells you where to go next is not really a refusal.
        //
        // `ProblemDetails.errors` is typed as the field-level validation bag
        // every other endpoint returns, and this route puts a different
        // shape in it. Narrowed here rather than widened there: loosening
        // the shared type would cost every caller its checking.
        const body = cause.problem.errors as unknown as NotServiceable | undefined;
        const cities = (body?.serviceable ?? []).map((row) => row.city);
        setResult({ kind: 'no', cities });
      } else {
        setResult({
          kind: 'error',
          message: 'We could not check that just now. Try again in a moment.',
        });
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mk-sec mk-sec--tight" id="delivery-check">
      <div className="mk-shell">
        <div className="mk-check tkr-card">
          <header className="mk-check__head">
            <p className="mk-eyebrow">Serviceability</p>
            <h2 className="mk-title mk-title--sm">Do we deliver to you?</h2>
            <p className="mk-lede">
              Six digits, and you will know before you make an account.
            </p>
          </header>

          <form className="mk-check__form" onSubmit={check} noValidate>
            <label className="mk-sr" htmlFor="mk-pin">
              Your 6-digit PIN code
            </label>
            <input
              id="mk-pin"
              className="mk-check__input"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="560001"
              maxLength={6}
              value={pincode}
              onChange={(e) => {
                setPincode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setResult(null);
              }}
            />
            <button
              className="mk-check__btn"
              type="submit"
              disabled={!valid || checking}
            >
              {checking ? 'Checking…' : 'Check'}
            </button>
          </form>

          {/* `aria-live` so the answer reaches a screen reader: this is the
              one thing on the page that changes without a navigation. */}
          <p className="mk-check__out" aria-live="polite" data-state={result?.kind ?? 'idle'}>
            {result === null ? (
              <span className="mk-check__hint">
                We are in Bengaluru, Mumbai, New Delhi, Hyderabad, Pune and Ahmedabad
                so far.
              </span>
            ) : result.kind === 'yes' ? (
              <>
                <strong>Yes — we deliver to {result.city}.</strong>{' '}
                <Link className="mk-link" href="/shop">
                  Start shopping →
                </Link>
              </>
            ) : result.kind === 'no' ? (
              <>
                <strong>Not {pincode} yet.</strong>{' '}
                {result.cities.length > 0
                  ? `Today we are in ${result.cities.join(', ')}.`
                  : 'We are adding cities steadily.'}
              </>
            ) : (
              result.message
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
