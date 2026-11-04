'use client';

/**
 * The shop shell's head: where you are, what you are looking for, who you are.
 *
 * The location control is the one that matters. Refusing the browser prompt is
 * a completely reasonable thing to do and half the people who have it denied do
 * not know it — so the denial path is a fork, never a wall: type a PIN code and
 * the shop keeps working. See `useGeolocation` for the rest of that argument.
 *
 * ── ★ THE PROFILE MENU ──────────────────────────────────────────────────────
 * Signed in, the right-hand control is a menu with the name, the email, a
 * `CUSTOMER` role pill, links to Orders and Addresses, and Sign out. Signing
 * out calls `POST /auth/logout` (which revokes the whole refresh-token family
 * server-side), clears the in-memory access token through `AuthProvider`, and
 * sends the customer to `/login`.
 *
 * Signed OUT it is a plain "Sign in" link and nothing else changes. Browsing
 * before login is a deliberate feature of this app — `/stores`, `/aisle/:key`
 * and `/product/:id` are `@Public()` on the API for exactly that reason — so
 * the header is never gated behind a session.
 *
 * ── WHY THE SESSION IS RESTORED HERE ────────────────────────────────────────
 * The access token lives in memory only (plan §4.3), so a page RELOAD starts
 * with none and every authenticated call — `/cart`, `/orders`, `/addresses` —
 * would go out unauthenticated and come back 401. `AuthProvider.restore()`
 * trades the httpOnly refresh cookie for a fresh access token; nothing on the
 * customer surface was calling it. This header is mounted by the shop layout on
 * every shop route, so it is the one place that runs exactly once per load.
 * The module-level latch keeps a remount from rotating the refresh cookie again.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { APP_NAME } from '@/config/brand';
import { useGeolocation } from '@/hooks/useGeolocation';
import { AisleRail } from './AisleRail';
import { NotifyBell } from './NotifyBell';
import { SearchBox } from './SearchBox';

/** One restore attempt per page load, not per mount. */
let restoreStarted = false;

export function ShopHeader() {
  const geo = useGeolocation();
  const { restore } = useAuth();

  const [pincode, setPincode] = useState('');
  const locationDetails = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (restoreStarted) return;
    restoreStarted = true;
    void restore();
  }, [restore]);

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
        <Link href="/" className="shop-brand" aria-label={`${APP_NAME}, home`}>
          <span className="shop-brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="20" height="20">
              <path
                d="M4 11 H28 L25 27 H7 Z"
                fill="none"
                stroke="currentColor"
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
          </span>
          <span className="shop-brand__word">{APP_NAME}</span>
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
                A PIN code narrows the store list too — sharing your exact location just sorts
                it by distance on top of that.
              </p>
            </form>

            {geo.location !== null ? (
              <button type="button" className="shop-loc__clear" onClick={geo.clear}>
                Clear saved location
              </button>
            ) : null}
          </div>
        </details>

        {/* ── search — the box and its recent/popular suggestions ──────── */}
        <SearchBox />

        <div className="shop-head__actions">
          <NotifyBell />
          <ProfileMenu />
        </div>
      </div>

      <div className="shop-head__rail shell">
        <AisleRail />
      </div>
    </header>
  );
}

/* ══════════════════════════ ★ the profile menu ═══════════════════════════ */

function ProfileMenu() {
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = useMemo(() => {
    const parts = (user?.name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'ME';
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase() || 'ME';
  }, [user?.name]);

  /* Browse-before-login is the point. No session, no menu — just a way in. */
  if (!isAuthenticated || user === null) {
    return (
      <nav className="shop-head__links" aria-label="Your account">
        <Link href="/orders" className="shop-head__link">
          Orders
        </Link>
        <Link href="/login" className="shop-head__link">
          Sign in
        </Link>
      </nav>
    );
  }

  const signOut = () => {
    setSigningOut(true);
    void logout().finally(() => {
      setOpen(false);
      setSigningOut(false);
      // `logout()` already cleared the in-memory token and the user. The push
      // is what makes the state change visible instead of leaving the customer
      // on a page that is now going to 401.
      router.push('/login');
      router.refresh();
    });
  };

  return (
    <div className="shop-profile" ref={ref}>
      <button
        type="button"
        className="shop-profile__button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="shop-profile__initials" aria-hidden="true">
          {initials}
        </span>
        <span className="shop-profile__name">{user.name}</span>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <path
            d="M2.5 4.5 L6 8 L9.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="shop-profile__panel" role="menu">
          <div className="shop-profile__head">
            <p className="shop-profile__who">{user.name}</p>
            {user.email !== undefined && user.email !== '' ? (
              <p className="shop-profile__contact">{user.email}</p>
            ) : user.phone !== undefined && user.phone !== '' ? (
              <p className="shop-profile__contact mono">{user.phone}</p>
            ) : null}
            <span className="shop-profile__role">{user.role.replace('_', ' ')}</span>
          </div>

          <Link href="/orders" className="shop-profile__item" role="menuitem">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M3 3.5h10v9H3z M5.5 6.5h5 M5.5 9.5h3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            Orders
          </Link>

          <Link href="/wishlist" className="shop-profile__item" role="menuitem">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M8 13.6s-5-3.1-5-6.8A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5 1.8c0 3.7-5 6.8-5 6.8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            Wishlist
          </Link>

          <Link href="/addresses" className="shop-profile__item" role="menuitem">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M8 14.5s5-4.6 5-8a5 5 0 1 0-10 0c0 3.4 5 8 5 8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="8" cy="6.4" r="1.7" fill="currentColor" />
            </svg>
            Addresses
          </Link>

          <button
            type="button"
            className="shop-profile__item shop-profile__item--danger"
            role="menuitem"
            disabled={signingOut}
            onClick={signOut}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M6.5 3.5H3.5v9h3 M9 5.5 11.5 8 9 10.5 M11.5 8H6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>

          <p className="shop-profile__note">
            Signing out revokes the whole refresh-token family on the server, not just this
            tab.
          </p>
        </div>
      ) : null}
    </div>
  );
}
