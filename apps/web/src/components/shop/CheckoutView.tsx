'use client';

/**
 * Checkout.
 *
 * ── WHAT IS HONEST HERE, AND WHY IT MATTERS MOST ON THIS SCREEN ─────────────
 * · COD works today. It is the default, and it is not a degraded option — it is
 *   the payment method most Indian grocery orders actually use.
 * · The ONLINE path returns `503 payment provider not configured`, because
 *   Razorpay credentials do not exist yet (plan §1.1, still blocking). That is
 *   rendered as exactly what it is. We do not fake a success screen, we do not
 *   quietly downgrade the order to COD behind the customer's back, and we do
 *   not hide the option as though it will never exist.
 * · Delivery is ON-DEMAND ONLY in v1 (plan decision #10). Scheduled slots need
 *   a capacity planner and a rider roster. The slot control says so instead of
 *   showing greyed-out times that imply they are coming back at 6pm.
 * · The map pin is optional. With no `NEXT_PUBLIC_MAPS_BROWSER_KEY` the picker
 *   renders a designed placeholder and the address still saves — a typed
 *   address is a complete address.
 *
 * ── IDEMPOTENCY (plan §6.1) ─────────────────────────────────────────────────
 * `POST /checkout` REQUIRES an `Idempotency-Key`. It is minted once per attempt
 * and held in a ref: a retry after a timeout must present the SAME key, or a
 * customer who double-taps through a flaky connection gets two orders and two
 * charges.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { MandiMap } from '@mandi/design-system/map';
import { formatPaise } from '@mandi/design-system';
import { api, ApiError } from '@/lib/api-client';
import { useShopQuery, invalidateShop } from '@/hooks/useShopQuery';
import { newIdempotencyKey, isValidPincode } from '@/lib/shop/format';
import { isDict, readAddress, readPaged, type Address, type LatLng, type Paged } from '@/lib/shop/types';
import { useBasket } from './BasketProvider';
import { ErrorNotice, FixtureBanner } from './notices';

type PaymentMethod = 'cod' | 'online';

/** Bengaluru city centre — only ever the OPENING view of an empty pin picker. */
const MAP_FALLBACK_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };

interface NewAddress {
  label: string;
  line1: string;
  line2: string;
  city: string;
  pincode: string;
  phone: string;
}

const BLANK: NewAddress = { label: 'Home', line1: '', line2: '', city: '', pincode: '', phone: '' };

export function CheckoutView() {
  const router = useRouter();
  const basket = useBasket();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewAddress>(BLANK);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);

  const [coupon, setCoupon] = useState('');
  const [couponState, setCouponState] = useState<
    { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok'; discountPaise: number } | { kind: 'bad'; message: string }
  >({ kind: 'idle' });

  const [method, setMethod] = useState<PaymentMethod>('cod');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<{ status: number; message: string } | null>(null);
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  const addresses = useShopQuery<Paged<Address>>('/addresses', undefined, {
    read: useCallback((raw: unknown) => readPaged(raw, readAddress), []),
  });

  const rows = addresses.data?.data ?? [];
  const chosen = rows.find((row) => row.id === selectedId) ?? rows.find((row) => row.isDefault) ?? rows[0] ?? null;

  const subtotal = basket.subtotalPaise;
  const discount = couponState.kind === 'ok' ? couponState.discountPaise : 0;
  const deliveryFee = 2900;
  const total = Math.max(0, subtotal + deliveryFee - discount);

  const markers = useMemo(
    () =>
      pin === null
        ? []
        : ([{ id: 'drop', position: pin, kind: 'drop' as const, label: 'Delivery pin' }] as const),
    [pin],
  );

  /* ── add an address ─────────────────────────────────────────────────── */

  const saveAddress = useCallback(async () => {
    setAddressError(null);
    if (draft.line1.trim() === '' || draft.city.trim() === '') {
      setAddressError('A street line and a city are the minimum a rider needs.');
      return;
    }
    if (!isValidPincode(draft.pincode)) {
      setAddressError('That is not a 6-digit Indian PIN code.');
      return;
    }
    setSavingAddress(true);
    try {
      await api.post('/addresses', {
        ...draft,
        location:
          pin === null ? undefined : { type: 'Point', coordinates: [pin.lng, pin.lat] },
      });
      invalidateShop('/addresses');
      setAdding(false);
      setDraft(BLANK);
      setPin(null);
    } catch (cause) {
      setAddressError(
        cause instanceof ApiError
          ? cause.friendlyMessage
          : 'We could not save that address. Try again.',
      );
    } finally {
      setSavingAddress(false);
    }
  }, [draft, pin]);

  /* ── coupon ─────────────────────────────────────────────────────────── */

  const checkCoupon = useCallback(async () => {
    const code = coupon.trim().toUpperCase();
    if (code === '') return;
    setCouponState({ kind: 'checking' });
    try {
      const raw = await api.post<unknown>('/checkout/validate', {
        vendorId: basket.store?.vendorId,
        couponCode: code,
        items: basket.lines.map((line) => ({ productId: line.productId, qty: line.qty })),
      });
      const value =
        isDict(raw) && typeof raw['discountPaise'] === 'number'
          ? raw['discountPaise']
          : isDict(raw) && isDict(raw['pricing']) && typeof raw['pricing']['discount'] === 'number'
            ? raw['pricing']['discount']
            : 0;
      setCouponState(
        value > 0
          ? { kind: 'ok', discountPaise: value }
          : { kind: 'bad', message: 'That code did not apply to this basket.' },
      );
    } catch (cause) {
      setCouponState({
        kind: 'bad',
        message:
          cause instanceof ApiError
            ? cause.friendlyMessage
            : 'We could not check that code right now.',
      });
    }
  }, [coupon, basket.store, basket.lines]);

  /* ── place the order ────────────────────────────────────────────────── */

  const placeOrder = useCallback(async () => {
    if (chosen === null || basket.store === null) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const raw = await api.post<unknown>(
        '/checkout',
        {
          vendorId: basket.store.vendorId,
          addressId: chosen.id,
          paymentMethod: method,
          couponCode: couponState.kind === 'ok' ? coupon.trim().toUpperCase() : undefined,
          items: basket.lines.map((line) => ({ productId: line.productId, qty: line.qty })),
        },
        // Same key across every retry of THIS attempt. See the file header.
        { idempotencyKey: idempotencyKey.current },
      );

      const orderId =
        isDict(raw) && typeof raw['id'] === 'string'
          ? raw['id']
          : isDict(raw) && typeof raw['orderId'] === 'string'
            ? raw['orderId']
            : null;

      basket.clear();
      router.push(orderId === null ? '/orders' : `/orders/${encodeURIComponent(orderId)}/track`);
    } catch (cause) {
      const error =
        cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true);
      // 503 is the specced answer for "no payment provider configured". It is
      // reported verbatim: the server's own words, the real status code, and
      // the one thing the customer can do about it.
      setPlaceError({
        status: error.status,
        message:
          error.status === 503
            ? (error.problem.detail ??
              'Payment provider not configured — online payment is not live yet.')
            : error.friendlyMessage,
      });
      // A failed attempt gets a fresh key: it is a NEW attempt, not a retry of
      // one the server may already have committed.
      idempotencyKey.current = newIdempotencyKey();
    } finally {
      setPlacing(false);
    }
  }, [chosen, basket, method, coupon, couponState, router]);

  /* ── empty basket ───────────────────────────────────────────────────── */

  if (basket.hydrated && basket.lines.length === 0) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Nothing to check out</h1>
        <p className="lede">
          Your basket is empty. <Link href="/stores">Find a store near you</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="shell shop-page shop-checkout">
      <header className="shop-page__head">
        <p className="eyebrow">Checkout</p>
        <h1 className="shop-page__title">Where, when, and how you pay</h1>
      </header>

      {addresses.isFixture ? <FixtureBanner endpoint="GET /addresses" /> : null}
      {addresses.error !== null ? (
        <ErrorNotice error={addresses.error} onRetry={addresses.refetch} what="your addresses" />
      ) : null}

      <div className="shop-checkout__grid">
        <div className="shop-checkout__main">
          {/* ── 1. address ──────────────────────────────────────────────── */}
          <section className="shop-panel" aria-labelledby="ck-address">
            <h2 id="ck-address" className="shop-panel__title">
              <span className="shop-panel__step">1</span> Delivery address
            </h2>

            {rows.length > 0 ? (
              <ul className="shop-addresses">
                {rows.map((row) => (
                  <li key={row.id}>
                    <label className="shop-address" data-selected={chosen?.id === row.id ? 'true' : undefined}>
                      <input
                        type="radio"
                        name="address"
                        value={row.id}
                        checked={chosen?.id === row.id}
                        onChange={() => {
                          setSelectedId(row.id);
                        }}
                      />
                      <span>
                        <strong className="shop-address__label">{row.label}</strong>
                        <span className="shop-address__lines">
                          {[row.line1, row.line2, row.city, row.pincode]
                            .filter((part) => part !== null && part !== '')
                            .join(', ')}
                        </span>
                        {row.phone !== null ? (
                          <span className="shop-address__phone mono">{row.phone}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="shop-empty">No saved addresses yet.</p>
            )}

            {!adding ? (
              <button
                type="button"
                className="mnd-btn mnd-btn--outline mnd-btn--sm"
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add a new address
              </button>
            ) : (
              <form
                className="shop-addrform"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveAddress();
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
                      inputMode="tel"
                      autoComplete="tel"
                      value={draft.phone}
                      onChange={(e) => {
                        setDraft({ ...draft, phone: e.target.value });
                      }}
                    />
                  </label>
                </div>

                <div className="shop-addrform__map">
                  <p className="shop-addrform__maplabel">
                    Drop a pin (optional) — it helps the rider find the gate, not the street.
                  </p>
                  <MandiMap
                    center={pin ?? MAP_FALLBACK_CENTER}
                    zoom={15}
                    height={220}
                    markers={markers}
                    onPick={setPin}
                    ariaLabel="Delivery pin picker"
                  />
                  {pin !== null ? (
                    <p className="shop-addrform__pin mono">
                      {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}{' '}
                      <button
                        type="button"
                        className="shop-linkish"
                        onClick={() => {
                          setPin(null);
                        }}
                      >
                        clear
                      </button>
                    </p>
                  ) : null}
                </div>

                {addressError !== null ? (
                  <p className="shop-notice shop-notice--error" role="alert">
                    {addressError}
                  </p>
                ) : null}

                <div className="shop-addrform__actions">
                  <button type="submit" className="mnd-btn mnd-btn--solid mnd-btn--sm" disabled={savingAddress}>
                    {savingAddress ? 'Saving…' : 'Save address'}
                  </button>
                  <button
                    type="button"
                    className="mnd-btn mnd-btn--ghost mnd-btn--sm"
                    onClick={() => {
                      setAdding(false);
                      setAddressError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* ── 2. slot ─────────────────────────────────────────────────── */}
          <section className="shop-panel" aria-labelledby="ck-slot">
            <h2 id="ck-slot" className="shop-panel__title">
              <span className="shop-panel__step">2</span> Delivery time
            </h2>
            <div className="shop-slot" data-selected="true">
              <strong>As soon as it is packed</strong>
              <span className="mono">typically 15–30 min</span>
            </div>
            <p className="shop-panel__note">
              On-demand only for now. Scheduled slots need a capacity planner and a rider roster,
              and both are out of scope for this release — so rather than show you greyed-out
              times that will not light up, there is one option and it is the real one.
            </p>
          </section>

          {/* ── 3. coupon ───────────────────────────────────────────────── */}
          <section className="shop-panel" aria-labelledby="ck-coupon">
            <h2 id="ck-coupon" className="shop-panel__title">
              <span className="shop-panel__step">3</span> Coupon
            </h2>
            <form
              className="shop-coupon"
              onSubmit={(event) => {
                event.preventDefault();
                void checkCoupon();
              }}
            >
              <label htmlFor="ck-coupon-code" className="mnd-visually-hidden">
                Coupon code
              </label>
              <input
                id="ck-coupon-code"
                className="mnd-field__input"
                placeholder="MANDI100"
                value={coupon}
                onChange={(event) => {
                  setCoupon(event.target.value.toUpperCase());
                  setCouponState({ kind: 'idle' });
                }}
              />
              <button
                type="submit"
                className="mnd-btn mnd-btn--outline mnd-btn--md"
                disabled={couponState.kind === 'checking'}
              >
                {couponState.kind === 'checking' ? 'Checking…' : 'Apply'}
              </button>
            </form>
            {couponState.kind === 'ok' ? (
              <p className="shop-coupon__ok" role="status">
                Applied — {formatPaise(couponState.discountPaise)} off.
              </p>
            ) : couponState.kind === 'bad' ? (
              <p className="shop-coupon__bad" role="status">
                {couponState.message}
              </p>
            ) : null}
          </section>

          {/* ── 4. payment ──────────────────────────────────────────────── */}
          <section className="shop-panel" aria-labelledby="ck-pay">
            <h2 id="ck-pay" className="shop-panel__title">
              <span className="shop-panel__step">4</span> Payment
            </h2>

            <label className="shop-pay" data-selected={method === 'cod' ? 'true' : undefined}>
              <input
                type="radio"
                name="payment"
                value="cod"
                checked={method === 'cod'}
                onChange={() => {
                  setMethod('cod');
                }}
              />
              <span>
                <strong>Cash on delivery</strong>
                <span className="shop-pay__note">
                  Working today. Up to ₹2,000 per order, where the store allows it.
                </span>
              </span>
            </label>

            <label className="shop-pay" data-selected={method === 'online' ? 'true' : undefined}>
              <input
                type="radio"
                name="payment"
                value="online"
                checked={method === 'online'}
                onChange={() => {
                  setMethod('online');
                }}
              />
              <span>
                <strong>Card, UPI or netbanking</strong>
                <span className="shop-pay__note">
                  <strong>Not live yet.</strong> The payment provider is not configured, so
                  placing an online order returns <code>503 payment provider not configured</code>.
                  You will see that error, not a fake success.
                </span>
              </span>
            </label>
          </section>
        </div>

        {/* ── summary ──────────────────────────────────────────────────── */}
        <aside className="shop-summary shop-summary--sticky" aria-label="Order total">
          <h2 className="shop-summary__title">
            {basket.store?.storeName ?? 'Your order'}
          </h2>

          <ul className="shop-summary__items">
            {basket.lines.map((line) => (
              <li key={line.productId}>
                <span>
                  {line.name} <span className="mono">× {line.qty}</span>
                </span>
                <span className="price">{formatPaise(line.pricePaise * line.qty)}</span>
              </li>
            ))}
          </ul>

          <dl className="shop-summary__rows">
            <div>
              <dt>Items</dt>
              <dd className="price">{formatPaise(subtotal)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd className="price">{formatPaise(deliveryFee)}</dd>
            </div>
            {discount > 0 ? (
              <div>
                <dt>Coupon</dt>
                <dd className="price">−{formatPaise(discount)}</dd>
              </div>
            ) : null}
            <div className="shop-summary__total">
              <dt>{method === 'cod' ? 'Pay on delivery' : 'Total'}</dt>
              <dd className="price">{formatPaise(total)}</dd>
            </div>
          </dl>

          {placeError !== null ? (
            <div className="shop-notice shop-notice--error" role="alert">
              <p>
                <strong>
                  {placeError.status === 503 ? 'Online payment is not available' : 'Order not placed'}
                </strong>
                <br />
                {placeError.message}
                {placeError.status === 503 ? (
                  <>
                    {' '}
                    Switch to <strong>cash on delivery</strong> and this order will go through.
                  </>
                ) : null}
                {placeError.status > 0 ? (
                  <span className="shop-notice__code"> · HTTP {placeError.status}</span>
                ) : null}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            className="mnd-btn mnd-btn--solid mnd-btn--lg mnd-btn--block"
            disabled={placing || chosen === null}
            onClick={() => {
              void placeOrder();
            }}
          >
            {placing ? 'Placing…' : method === 'cod' ? 'Place order · pay on delivery' : 'Place order'}
          </button>

          {chosen === null ? (
            <p className="shop-summary__note">Pick or add a delivery address first.</p>
          ) : (
            <p className="shop-summary__note">
              Stock and prices are re-checked one last time when you press this. If anything has
              moved you will be told before the order is created.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
