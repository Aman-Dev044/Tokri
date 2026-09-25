'use client';

/**
 * Checkout.
 *
 * ── THE SERVER DOES THE ARITHMETIC ──────────────────────────────────────────
 * `POST /checkout/validate` re-prices the basket from the cart and product
 * collections and returns the whole quote: per-line flags, the pricing block,
 * the coupon result, whether the address is inside the store's radius, whether
 * COD is available at this amount, and an `issues[]` list. `checkoutReady` is
 * true only when `issues` is empty.
 *
 * This screen used to add up its own total from the local basket and a
 * hard-coded ₹29 delivery fee. That number is now read from the quote — it is
 * the number that will actually be charged.
 *
 * Neither checkout endpoint accepts a price, a total or a line item. This view
 * used to send `items: [...]` on both calls, and because the API runs
 * `forbidNonWhitelisted`, both answered `400 property items should not exist`
 * — so the coupon box never worked and no order could ever be placed.
 *
 * ── WHAT IS HONEST HERE, AND WHY IT MATTERS MOST ON THIS SCREEN ─────────────
 * · COD works today, and whether it is available at THIS amount comes from the
 *   quote (`payment.cod.reason` says why, when it does not).
 * · The ONLINE path returns `503 payment provider not configured` until
 *   Razorpay credentials exist. That is rendered as exactly what it is. We do
 *   not fake a success screen, do not quietly downgrade to COD, and do not hide
 *   the option as though it will never exist.
 * · Delivery is ON-DEMAND ONLY in v1 (decision #10).
 * · The map pin is NOT optional, because `CreateAddressDto` requires `lat` and
 *   `lng`: serviceability, rider assignment and the ETA all run off the stored
 *   2dsphere point, and the address is geocoded once at save time. The form
 *   used to send `location: { type:'Point', coordinates:[…] }` and no lat/lng
 *   at all, which was a 400 every single time.
 *
 * ── IDEMPOTENCY (plan §6.1) ─────────────────────────────────────────────────
 * `POST /checkout` REQUIRES an `Idempotency-Key`. It is minted once per attempt
 * and held in a ref: a retry after a timeout must present the SAME key, or a
 * customer who double-taps through a flaky connection gets two orders.
 *
 * ── ★ THE DELIVERY OTP ──────────────────────────────────────────────────────
 * `POST /checkout` returns the plaintext 4-digit code EXACTLY ONCE; only its
 * hash is stored, so no later request can read it. This view used to throw the
 * whole response away and redirect. It now stops on a confirmation panel that
 * shows the code, because that panel is the only place it will ever exist.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MandiMap } from '@mandi/design-system/map';
import { formatPaise } from '@mandi/design-system';
import { api, ApiError } from '@/lib/api-client';
import { useShopQuery, invalidateShop } from '@/hooks/useShopQuery';
import { newIdempotencyKey, isValidPincode } from '@/lib/shop/format';
import {
  readAddresses,
  readCheckoutQuote,
  readPlacedOrder,
  type Address,
  type CheckoutQuote,
  type LatLng,
  type PaymentMethod,
  type PlacedOrder,
} from '@/lib/shop/types';
import { useBasket } from './BasketProvider';
import { ErrorNotice, FixtureBanner, StaleFlagChips } from './notices';

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
  const basket = useBasket();
  const vendorId = basket.store?.vendorId ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewAddress>(BLANK);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);

  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);

  const [method, setMethod] = useState<PaymentMethod>('cod');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<{ status: number; message: string } | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  /* `GET /addresses` answers with a BARE ARRAY — not a `{ data, meta }` page. */
  const addresses = useShopQuery<Address[]>('/addresses', undefined, {
    read: useCallback((raw: unknown) => readAddresses(raw), []),
  });

  const rows = useMemo(() => addresses.data ?? [], [addresses.data]);
  const chosen =
    rows.find((row) => row.id === selectedId) ?? rows.find((row) => row.isDefault) ?? rows[0] ?? null;
  const chosenId = chosen?.id ?? null;

  /* ── the quote ──────────────────────────────────────────────────────── */

  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    if (vendorId === null || placed !== null) return;
    let live = true;
    setQuoting(true);

    void api
      .post<unknown>('/checkout/validate', {
        vendorId,
        addressId: chosenId ?? undefined,
        couponCode: appliedCoupon ?? undefined,
        paymentMethod: method,
      })
      .then((raw) => {
        if (!live) return;
        setQuote(readCheckoutQuote(raw));
        setQuoteError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setQuote(null);
        setQuoteError(
          cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true),
        );
      })
      .finally(() => {
        if (live) setQuoting(false);
      });

    return () => {
      live = false;
    };
  }, [vendorId, chosenId, appliedCoupon, method, placed]);

  /* ── add an address ─────────────────────────────────────────────────── */

  const saveAddress = useCallback(async () => {
    setAddressError(null);
    if (draft.line1.trim().length < 3 || draft.city.trim().length < 2) {
      setAddressError('A street line and a city are the minimum a rider needs.');
      return;
    }
    if (!isValidPincode(draft.pincode)) {
      setAddressError('That is not a 6-digit Indian PIN code.');
      return;
    }
    if (!/^\d{10}$/.test(draft.phone.trim())) {
      setAddressError('The rider needs a 10-digit mobile number, digits only.');
      return;
    }
    // `lat` and `lng` are REQUIRED by CreateAddressDto — the address is
    // geocoded once, at save time, and everything downstream runs off the
    // stored point. Without a pin there is nothing to store.
    if (pin === null) {
      setAddressError('Drop a pin on the map so the rider has a point to navigate to.');
      return;
    }

    setSavingAddress(true);
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

  /* ── place the order ────────────────────────────────────────────────── */

  const placeOrder = useCallback(async () => {
    if (chosen === null || vendorId === null) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const raw = await api.post<unknown>(
        '/checkout',
        {
          vendorId,
          addressId: chosen.id,
          paymentMethod: method,
          couponCode: appliedCoupon ?? undefined,
        },
        // Same key across every retry of THIS attempt. See the file header.
        { idempotencyKey: idempotencyKey.current },
      );

      const result = readPlacedOrder(raw);
      basket.clear();
      invalidateShop(['/cart', '/orders']);
      // ★ Stop here. The OTP in this response is never readable again.
      setPlaced(result);
    } catch (cause) {
      const error =
        cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true);
      // 503 is the specced answer for "no payment provider configured". It is
      // reported verbatim: the server's own words, the real status code, and
      // the one thing the customer can do about it.
      setPlaceError({ status: error.status, message: error.friendlyMessage });
      // A failed attempt gets a fresh key: it is a NEW attempt, not a retry of
      // one the server may already have committed.
      idempotencyKey.current = newIdempotencyKey();
    } finally {
      setPlacing(false);
    }
  }, [chosen, vendorId, method, appliedCoupon, basket]);

  /* ── ★ placed: the one and only sight of the delivery code ──────────── */

  if (placed !== null) {
    const trackHref =
      placed.order === null ? '/orders' : `/orders/${encodeURIComponent(placed.order.id)}/track`;

    return (
      <div className="shell shop-page">
        <header className="shop-page__head">
          <p className="eyebrow">Order placed</p>
          <h1 className="shop-page__title">
            {placed.order === null ? 'Your order is in' : placed.order.orderNo}
          </h1>
          <p className="lede">
            {placed.payment.next === 'pay_on_delivery'
              ? 'Pay the rider at the door. The store will start packing shortly.'
              : 'The store will start packing shortly.'}
          </p>
        </header>

        {placed.deliveryOtp !== null ? (
          <section className="shop-panel" aria-labelledby="ck-otp">
            <h2 id="ck-otp" className="shop-panel__title">
              Your delivery code
            </h2>
            <p className="shop-product__price">
              <span className="price" style={{ letterSpacing: '0.3em' }}>
                {placed.deliveryOtp}
              </span>
            </p>
            <p className="shop-panel__note">
              <strong>Write this down now.</strong> Read it to the rider at your door to
              complete the delivery. Only a hash of it is stored, so this screen is the only
              place it can ever be shown — not your order history, not this page after a
              reload.
            </p>
          </section>
        ) : null}

        <p className="shop-cart__cta">
          <Link href={trackHref} className="mnd-btn mnd-btn--solid mnd-btn--md">
            Follow this order
          </Link>{' '}
          <Link href="/orders" className="mnd-btn mnd-btn--ghost mnd-btn--md">
            All your orders
          </Link>
        </p>
      </div>
    );
  }

  /* ── empty basket ───────────────────────────────────────────────────── */

  if (basket.hydrated && (basket.lines.length === 0 || vendorId === null)) {
    return (
      <div className="shell shop-page">
        <h1 className="shop-page__title">Nothing to check out</h1>
        <p className="lede">
          Your basket is empty. <Link href="/stores">Find a store near you</Link>.
        </p>
      </div>
    );
  }

  /* ── derived from the quote, never computed here ────────────────────── */

  const pricing = quote?.pricing ?? null;
  const codAvailable = quote?.payment.cod.available ?? true;
  const codReason = quote?.payment.cod.reason ?? null;
  const onlineAvailable = quote?.payment.online.available ?? false;
  const onlineReason = quote?.payment.online.reason ?? null;
  const issues = quote?.issues ?? [];
  const ready = quote !== null && quote.checkoutReady;
  const serviceable = quote?.delivery.serviceable ?? null;

  const markers =
    pin === null
      ? []
      : ([{ id: 'drop', position: pin, kind: 'drop' as const, label: 'Delivery pin' }] as const);

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
      {quoteError !== null ? (
        <ErrorNotice
          error={quoteError}
          what="the final price for this basket"
        />
      ) : null}

      <div className="shop-split">
        <div className="shop-checkout__main">
          {/* ── 1. address ──────────────────────────────────────────────── */}
          <section className="shop-panel" aria-labelledby="ck-address">
            <h2 id="ck-address" className="shop-panel__title">
              <span className="shop-panel__step">1</span> Delivery address
            </h2>

            {rows.length > 0 ? (
              <ul className="shop-choices">
                {rows.map((row) => (
                  <li key={row.id}>
                    <label className="shop-choice" data-selected={chosen?.id === row.id ? 'true' : undefined}>
                      <input
                        type="radio"
                        name="address"
                        value={row.id}
                        checked={chosen?.id === row.id}
                        onChange={() => {
                          setSelectedId(row.id);
                        }}
                      />
                      <span className="shop-choice__text">
                        <strong className="shop-choice__label">{row.label}</strong>
                        <span className="shop-choice__lines">
                          {[row.line1, row.line2, row.city, row.pincode]
                            .filter((part): part is string => part !== null && part !== '')
                            .join(', ')}
                        </span>
                        {row.phone !== '' ? (
                          <span className="shop-choice__phone mono">{row.phone}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="shop-empty">No saved addresses yet.</p>
            )}

            {chosen !== null && serviceable === false ? (
              <p className="shop-notice shop-notice--error" role="alert">
                {basket.store?.storeName ?? 'This store'} does not deliver to that address — it
                is outside their {quote?.delivery.radiusKm ?? 0} km radius. Pick another
                address, or a store closer to you.
              </p>
            ) : null}

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
                    Drop a pin — required. Serviceability, the rider’s route and the delivery
                    estimate are all worked out from this point, so an address without one
                    cannot be saved.
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
            <div className="shop-choice" data-selected="true">
              <span className="shop-choice__text">
                <strong className="shop-choice__label">As soon as it is packed</strong>
                <span className="shop-choice__note mono">typically 15–30 min</span>
              </span>
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
                const code = coupon.trim().toUpperCase();
                // The quote is the only thing that can judge a code, so
                // applying just re-runs it with the code attached.
                setAppliedCoupon(code === '' ? null : code);
              }}
            >
              <label htmlFor="ck-coupon-code" className="mnd-visually-hidden">
                Coupon code
              </label>
              <input
                id="ck-coupon-code"
                className="mnd-field__input"
                placeholder="MANDI50"
                value={coupon}
                onChange={(event) => {
                  setCoupon(event.target.value.toUpperCase());
                }}
              />
              <button type="submit" className="mnd-btn mnd-btn--outline mnd-btn--md" disabled={quoting}>
                {quoting ? 'Checking…' : 'Apply'}
              </button>
            </form>
            {quote?.coupon != null ? (
              <p className="shop-coupon__ok" role="status">
                {quote.coupon.code} applied — {formatPaise(quote.coupon.discount)} off.
              </p>
            ) : quote?.couponProblem != null ? (
              <p className="shop-coupon__bad" role="status">
                {quote.couponProblem.message}
              </p>
            ) : null}
          </section>

          {/* ── 4. payment ──────────────────────────────────────────────── */}
          <section className="shop-panel" aria-labelledby="ck-pay">
            <h2 id="ck-pay" className="shop-panel__title">
              <span className="shop-panel__step">4</span> Payment
            </h2>

            <label className="shop-choice" data-selected={method === 'cod' ? 'true' : undefined}>
              <input
                type="radio"
                name="payment"
                value="cod"
                checked={method === 'cod'}
                onChange={() => {
                  setMethod('cod');
                }}
              />
              <span className="shop-choice__text">
                <strong className="shop-choice__label">Cash on delivery</strong>
                <span className="shop-choice__note">
                  {codAvailable
                    ? 'Working today. Pay the rider at your door.'
                    : (codReason ?? 'Not available for this order.')}
                </span>
              </span>
            </label>

            <label className="shop-choice" data-selected={method === 'online' ? 'true' : undefined}>
              <input
                type="radio"
                name="payment"
                value="online"
                checked={method === 'online'}
                onChange={() => {
                  setMethod('online');
                }}
              />
              <span className="shop-choice__text">
                <strong className="shop-choice__label">Card, UPI or netbanking</strong>
                <span className="shop-choice__note">
                  {onlineAvailable ? (
                    'Available for this order.'
                  ) : (
                    <>
                      <strong>Not live yet.</strong>{' '}
                      {onlineReason ??
                        'The payment provider is not configured, so placing an online order returns 503. You will see that error, not a fake success.'}
                    </>
                  )}
                </span>
              </span>
            </label>
          </section>
        </div>

        {/* ── summary ──────────────────────────────────────────────────── */}
        <aside className="shop-summary shop-summary--sticky" aria-label="Order total">
          <h2 className="shop-summary__title">
            {quote?.store?.storeName ?? basket.store?.storeName ?? 'Your order'}
          </h2>

          {/* The lines come from the QUOTE, re-priced server-side, with their
              live flags. Falling back to the local basket only when the quote
              has not answered yet. */}
          {quote !== null ? (
            <ul className="shop-summary__items">
              {quote.items.map((line) => (
                <li key={line.productId}>
                  <span>
                    {line.name} <span className="mono">× {line.qty}</span>
                    <StaleFlagChips line={line} />
                  </span>
                  <span className="price">{formatPaise(line.lineTotal)}</span>
                </li>
              ))}
            </ul>
          ) : (
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
          )}

          {pricing !== null ? (
            <dl className="shop-summary__rows">
              <div>
                <dt>Items</dt>
                <dd className="price">{formatPaise(pricing.itemsSubtotal)}</dd>
              </div>
              {pricing.discount > 0 ? (
                <div>
                  <dt>Coupon</dt>
                  <dd className="price">−{formatPaise(pricing.discount)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Delivery</dt>
                <dd className="price">{formatPaise(pricing.deliveryFee)}</dd>
              </div>
              {pricing.taxes > 0 ? (
                <div>
                  <dt>Taxes</dt>
                  <dd className="price">{formatPaise(pricing.taxes)}</dd>
                </div>
              ) : null}
              <div className="shop-summary__total">
                <dt>{method === 'cod' ? 'Pay on delivery' : 'Total'}</dt>
                <dd className="price">{formatPaise(pricing.grandTotal)}</dd>
              </div>
            </dl>
          ) : (
            <p className="shop-summary__note">
              {quoting
                ? 'Getting the final price from the store…'
                : 'The final price comes from the store when your address is set.'}
            </p>
          )}

          {issues.length > 0 ? (
            <div className="shop-notice shop-notice--warn" role="status">
              <p>
                <strong>Before you can place this:</strong>
              </p>
              <ul className="shop-flags">
                {issues.map((issue) => (
                  <li
                    key={`${issue.code}:${issue.productId ?? ''}`}
                    className="shop-flag"
                    data-tone="warn"
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
            disabled={placing || chosen === null || !ready}
            onClick={() => {
              void placeOrder();
            }}
          >
            {placing ? 'Placing…' : method === 'cod' ? 'Place order · pay on delivery' : 'Place order'}
          </button>

          {chosen === null ? (
            <p className="shop-summary__note">Pick or add a delivery address first.</p>
          ) : !ready ? (
            <p className="shop-summary__note">
              {quoting
                ? 'Re-checking stock and prices with the store…'
                : 'The store has not cleared this basket for checkout yet — see above.'}
            </p>
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
