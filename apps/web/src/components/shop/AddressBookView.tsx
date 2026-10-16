'use client';

/**
 * The address book, reached from the profile menu.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * Saved addresses were only ever reachable from inside checkout, which means
 * they could only be managed while holding a basket. `GET/POST/PATCH/DELETE
 * /addresses` is a full CRUD surface; this is the screen for it.
 *
 * ── WHAT THE API REQUIRES ───────────────────────────────────────────────────
 * `CreateAddressDto` requires `line1`, `city`, a 6-digit `pincode`, a 10-digit
 * `phone`, and `lat`/`lng` as NUMBERS — the address is geocoded once, at save
 * time, because serviceability, rider assignment and the ETA all run off the
 * stored 2dsphere point. There is no `location` object in the request body:
 * sending one is a 400, because the API runs `forbidNonWhitelisted`.
 *
 * ── SESSION ─────────────────────────────────────────────────────────────────
 * `/addresses` is not in `middleware.ts`'s protected prefix list, so a
 * signed-out visitor reaches this page rather than being bounced. That is
 * handled here, in words, instead of letting the API's 401 render as a broken
 * screen. The API is the real guard either way — the middleware is UX only.
 *   `/addresses` is in `PROTECTED_PREFIXES` now, so a signed-out visitor is
 *   redirected to `/login?next=/addresses` exactly like `/orders` is. The
 *   signed-out copy below is still the right fallback for the case the
 *   middleware cannot cover: a session that expires while the page is open.
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { MandiMap } from '@mandi/design-system/map';
import { useAuth } from '@/components/auth/AuthProvider';
import { api, ApiError } from '@/lib/api-client';
import { useShopQuery, invalidateShop } from '@/hooks/useShopQuery';
import { isValidPincode } from '@/lib/shop/format';
import { readAddresses, type Address, type LatLng } from '@/lib/shop/types';
import { ErrorNotice, FixtureBanner } from './notices';

/** Bengaluru city centre — only ever the OPENING view of an empty pin picker. */
const MAP_FALLBACK_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };

interface Draft {
  label: string;
  line1: string;
  line2: string;
  city: string;
  pincode: string;
  phone: string;
}

const BLANK: Draft = { label: 'Home', line1: '', line2: '', city: '', pincode: '', phone: '' };

export function AddressBookView() {
  const { isAuthenticated } = useAuth();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addresses = useShopQuery<Address[]>('/addresses', undefined, {
    enabled: isAuthenticated,
    read: useCallback((raw: unknown) => readAddresses(raw), []),
  });

  const rows = addresses.data ?? [];

  const save = useCallback(async () => {
    setFormError(null);
    if (draft.line1.trim().length < 3 || draft.city.trim().length < 2) {
      setFormError('A street line and a city are the minimum a rider needs.');
      return;
    }
    if (!isValidPincode(draft.pincode)) {
      setFormError('That is not a 6-digit Indian PIN code.');
      return;
    }
    if (!/^\d{10}$/.test(draft.phone.trim())) {
      setFormError('The rider needs a 10-digit mobile number, digits only.');
      return;
    }
    if (pin === null) {
      setFormError('Drop a pin on the map so the rider has a point to navigate to.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/addresses', {
        label: draft.label.trim() === '' ? undefined : draft.label.trim(),
        line1: draft.line1.trim(),
        line2: draft.line2.trim() === '' ? undefined : draft.line2.trim(),
        city: draft.city.trim(),
        pincode: draft.pincode,
        phone: draft.phone.trim(),
        lat: pin.lat,
        lng: pin.lng,
        isDefault: rows.length === 0,
      });
      invalidateShop('/addresses');
      setAdding(false);
      setDraft(BLANK);
      setPin(null);
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.friendlyMessage : 'We could not save that address.',
      );
    } finally {
      setBusy(false);
    }
  }, [draft, pin, rows.length]);

  const makeDefault = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await api.patch(`/addresses/${encodeURIComponent(id)}`, { isDefault: true });
      invalidateShop('/addresses');
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.friendlyMessage : 'We could not change the default.',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await api.delete(`/addresses/${encodeURIComponent(id)}`);
      invalidateShop('/addresses');
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.friendlyMessage : 'We could not delete that address.',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="shell shop-page">
        <header className="shop-page__head">
          <p className="eyebrow">Your account</p>
          <h1 className="shop-page__title">Addresses</h1>
        </header>
        <p className="lede">
          Saved addresses belong to your account, so this one needs a sign-in.{' '}
          <Link href="/login?next=/addresses">Sign in</Link> — you can keep browsing the market
          either way.
        </p>
      </div>
    );
  }

  return (
    <div className="shell shop-page">
      <header className="shop-page__head">
        <p className="eyebrow">Your account</p>
        <h1 className="shop-page__title">Addresses</h1>
        <p className="lede">
          The default is offered first at checkout. Each one is pinned on the map when you save
          it — that point is what decides which shops can reach you.
        </p>
      </header>

      {addresses.isFixture ? <FixtureBanner endpoint="GET /addresses" /> : null}
      {addresses.error !== null ? (
        <ErrorNotice error={addresses.error} onRetry={addresses.refetch} what="your addresses" />
      ) : null}
      {formError !== null ? (
        <p className="shop-notice shop-notice--error" role="alert">
          {formError}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="shop-addrbook">
          {rows.map((row) => (
            <li
              key={row.id}
              className="shop-addrbook__row"
              data-default={row.isDefault ? 'true' : undefined}
            >
              <div>
                <p className="shop-addrbook__label">
                  {row.label}
                  {row.isDefault ? (
                    <span className="shop-addrbook__default">Default</span>
                  ) : null}
                </p>
                <span className="shop-addrbook__lines">
                  {[row.line1, row.line2, row.city, row.pincode]
                    .filter((part): part is string => part !== null && part !== '')
                    .join(', ')}
                </span>
                {row.phone !== '' ? (
                  <span className="shop-addrbook__lines mono">{row.phone}</span>
                ) : null}
              </div>
              <div className="shop-addrbook__actions">
                {!row.isDefault ? (
                  <button
                    type="button"
                    className="mnd-btn mnd-btn--outline mnd-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      void makeDefault(row.id);
                    }}
                  >
                    Make default
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mnd-btn mnd-btn--ghost mnd-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    void remove(row.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : addresses.error === null && !addresses.loading ? (
        <p className="shop-empty">No addresses saved yet. Add the first one below.</p>
      ) : null}

      {!adding ? (
        <button
          type="button"
          className="mnd-btn mnd-btn--solid mnd-btn--md"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add an address
        </button>
      ) : (
        <form
          className="shop-addrform"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="shop-addrform__fields">
            <label>
              Label
              <input
                className="mnd-field__input"
                value={draft.label}
                onChange={(e) => {
                  setDraft({ ...draft, label: e.target.value });
                }}
              />
            </label>
            <label className="shop-addrform__wide">
              Flat, building, street
              <input
                className="mnd-field__input"
                autoComplete="address-line1"
                value={draft.line1}
                onChange={(e) => {
                  setDraft({ ...draft, line1: e.target.value });
                }}
              />
            </label>
            <label className="shop-addrform__wide">
              Area, landmark
              <input
                className="mnd-field__input"
                autoComplete="address-line2"
                value={draft.line2}
                onChange={(e) => {
                  setDraft({ ...draft, line2: e.target.value });
                }}
              />
            </label>
            <label>
              City
              <input
                className="mnd-field__input"
                autoComplete="address-level2"
                value={draft.city}
                onChange={(e) => {
                  setDraft({ ...draft, city: e.target.value });
                }}
              />
            </label>
            <label>
              PIN code
              <input
                className="mnd-field__input"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                value={draft.pincode}
                onChange={(e) => {
                  setDraft({ ...draft, pincode: e.target.value.replace(/[^0-9]/g, '') });
                }}
              />
            </label>
            <label>
              Phone for the rider
              <input
                className="mnd-field__input"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                placeholder="10 digits"
                value={draft.phone}
                onChange={(e) => {
                  setDraft({ ...draft, phone: e.target.value.replace(/[^0-9]/g, '') });
                }}
              />
            </label>
          </div>

          <div className="shop-addrform__map">
            <p className="shop-addrform__maplabel">
              Drop a pin — required. The API stores this point and everything downstream, from
              serviceability to the rider’s route, is worked out from it.
            </p>
            <MandiMap
              center={pin ?? MAP_FALLBACK_CENTER}
              zoom={15}
              height={220}
              markers={
                pin === null
                  ? []
                  : ([{ id: 'drop', position: pin, kind: 'drop' as const, label: 'Delivery pin' }] as const)
              }
              onPick={setPin}
              ariaLabel="Delivery pin picker"
            />
            {pin !== null ? (
              <p className="shop-addrform__pin mono">
                {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </p>
            ) : null}
          </div>

          <div className="shop-addrform__actions">
            <button type="submit" className="mnd-btn mnd-btn--solid mnd-btn--sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save address'}
            </button>
            <button
              type="button"
              className="mnd-btn mnd-btn--ghost mnd-btn--sm"
              onClick={() => {
                setAdding(false);
                setFormError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
