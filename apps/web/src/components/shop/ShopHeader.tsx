'use client';

/**
 * The shop shell's head: where you are, what you are looking for, who you are.
 *
 * The location control is the one that matters. Refusing the browser prompt is
 * a completely reasonable thing to do and half the people who have it denied do
 * not know it — so the denial path is a fork, never a wall: type a PIN code and
 * the shop keeps working. See `useGeolocation` for the rest of that argument.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useGeolocation } from '@/hooks/useGeolocation';
import { AisleRail } from './AisleRail';

export function ShopHeader() {
  const router = useRouter();
  const params = useSearchParams();
  const geo = useGeolocation();

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [pincode, setPincode] = useState('');
  const locationDetails = useRef<HTMLDetailsElement | null>(null);

  /* Close the location popover once a choice lands. */
  useEffect(() => {
    if (geo.status === 'granted' || geo.status === 'manual') {
      if (locationDetails.current) locationDetails.current.open = false;
    }
  }, [geo.status]);

  const label = geo.location?.label ?? 'Set your location';

  return (
    <header className="shop-head">
      <div className="shop-head__bar shell">
        <Link href="/" className="shop-head__brand" aria-label="Mandi, home">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <path
              d="M4 11 H28 L25 27 H7 Z"
              fill="none"
              stroke="var(--aisle)"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <path
              d="M11 11 C11 6 13.2 4 16 4 C18.8 4 21 6 21 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <span className="shop-head__word">Mandi</span>
        </Link>

        {/* ── location ─────────────────────────────────────────────────── */}
        <details className="shop-loc" ref={locationDetails}>
          <summary className="shop-loc__summary">
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="M8 14.5s5-4.6 5-8a5 5 0 1 0-10 0c0 3.4 5 8 5 8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="8" cy="6.4" r="1.9" fill="currentColor" />
            </svg>
            <span className="shop-loc__label">{geo.ready ? label : 'Locating…'}</span>
          </summary>

          <div className="shop-loc__panel">
            <p className="eyebrow">Deliver to</p>

            <button
              type="button"
              className="mnd-btn mnd-btn--outline mnd-btn--sm mnd-btn--block"
              onClick={geo.request}
              disabled={geo.status === 'locating'}
            >
              {geo.status === 'locating' ? 'Finding you…' : 'Use my current location'}
            </button>

            {geo.error !== null ? (
              <p className="shop-loc__error" role="status">
                {geo.error}
              </p>
            ) : null}

            <form
              className="shop-loc__pin"
              onSubmit={(event) => {
                event.preventDefault();
                geo.setPincode(pincode);
              }}
            >
              <label className="shop-loc__pin-label" htmlFor="shop-pincode">
                Or enter a PIN code
              </label>
              <div className="shop-loc__pin-row">
                <input
                  id="shop-pincode"
                  className="mnd-field__input shop-loc__pin-input"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={6}
                  placeholder="560076"
                  value={pincode}
                  onChange={(event) => {
                    setPincode(event.target.value.replace(/[^0-9]/g, ''));
                  }}
                />
                <button type="submit" className="mnd-btn mnd-btn--solid mnd-btn--sm">
                  Use
                </button>
              </div>
              <p className="shop-loc__hint">
                A PIN code works just as well — we never need your exact position to
                list the shops near you.
              </p>
            </form>

            {geo.location !== null ? (
              <button type="button" className="shop-loc__clear" onClick={geo.clear}>
                Clear saved location
              </button>
            ) : null}
          </div>
        </details>

        {/* ── search ───────────────────────────────────────────────────── */}
        <form
          className="shop-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = query.trim();
            router.push(trimmed === '' ? '/stores' : `/stores?q=${encodeURIComponent(trimmed)}`);
          }}
        >
          <label htmlFor="shop-q" className="mnd-visually-hidden">
            Search the market
          </label>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M10.6 10.6 L14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            id="shop-q"
            type="search"
            className="shop-search__input"
            placeholder="Tomatoes, atta, curd…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </form>

        <nav className="shop-head__links" aria-label="Your account">
          <Link href="/orders" className="shop-head__link">
            Orders
          </Link>
          <Link href="/login" className="shop-head__link">
            Sign in
          </Link>
        </nav>
      </div>

      <div className="shop-head__rail shell">
        <AisleRail />
      </div>
    </header>
  );
}
