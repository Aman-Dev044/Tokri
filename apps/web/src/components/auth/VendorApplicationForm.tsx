'use client';

/**
 * "Sell on {APP_NAME}" — a vendor application, not a signup.
 *
 * `POST /auth/apply/vendor` takes the owner's own login details (name, email,
 * phone, password) ALONGSIDE the store's — `storeName`, a full address, and a
 * map pin — because a vendor account is created by an admin approving this
 * application, not by this request itself. It answers
 * `201 { applicationId, status: 'pending' }`: no token, no session. See
 * `ApplicationPending` for what happens next.
 *
 * The pin is required for the same reason it is on the checkout address form:
 * serviceability and delivery radius both run off the stored point, and there
 * is no geocoding key wired into the browser to derive one from the typed
 * address.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { MandiMap } from '@mandi/design-system/map';
import { AuthField, AuthButton } from '@/components/auth/fields';
import { ApplicationPending } from '@/components/auth/ApplicationPending';
import { api, ApiError } from '@/lib/api-client';
import { isValidPincode } from '@/lib/shop/format';
import type { LatLng } from '@/lib/shop/types';

/** Bengaluru city centre — only ever the OPENING view of an empty pin picker. */
const MAP_FALLBACK_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };

interface Fields {
  name: string;
  email: string;
  phone: string;
  password: string;
  storeName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

const BLANK: Fields = {
  name: '',
  email: '',
  phone: '',
  password: '',
  storeName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
};

type FieldErrors = Partial<Record<keyof Fields | 'pin', string>>;

function normalisePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/^\+91/, '');
}

function validate(fields: Fields, pin: LatLng | null): FieldErrors {
  const errors: FieldErrors = {};
  if (fields.name.trim().length < 2) errors.name = 'Tell us who to contact.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fields.email.trim())) {
    errors.email = 'That email address does not look right.';
  }
  if (!/^[6-9]\d{9}$/.test(normalisePhone(fields.phone))) {
    errors.phone = 'Enter a 10-digit Indian mobile number.';
  }
  if (fields.password.length < 10) {
    errors.password = 'Use at least 10 characters — length beats symbols.';
  }
  if (fields.storeName.trim().length < 2) errors.storeName = 'What should customers call your shop?';
  if (fields.line1.trim().length < 3) errors.line1 = 'A street or building is the minimum.';
  if (fields.city.trim().length < 2) errors.city = 'Which city?';
  if (fields.state.trim().length < 2) errors.state = 'Which state?';
  if (!isValidPincode(fields.pincode)) errors.pincode = 'That is not a 6-digit Indian PIN code.';
  if (pin === null) errors.pin = 'Drop a pin so delivery radius and rider routing have a point to use.';
  return errors;
}

interface ApplyResponse {
  applicationId: string;
  status: 'pending';
}

export function VendorApplicationForm() {
  const [fields, setFields] = useState<Fields>(BLANK);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplyResponse | null>(null);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const next = validate(fields, pin);
      setErrors(next);
      if (Object.keys(next).length > 0 || pin === null) return;

      setSubmitting(true);
      setFormError(null);
      try {
        const res = await api.post<ApplyResponse>(
          '/auth/apply/vendor',
          {
            name: fields.name.trim(),
            email: fields.email.trim(),
            phone: normalisePhone(fields.phone),
            password: fields.password,
            storeName: fields.storeName.trim(),
            address: {
              line1: fields.line1.trim(),
              line2: fields.line2.trim() === '' ? undefined : fields.line2.trim(),
              city: fields.city.trim(),
              state: fields.state.trim(),
              pincode: fields.pincode,
            },
            lat: pin.lat,
            lng: pin.lng,
          },
          { anonymous: true },
        );
        setApplication(res);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          setFormError(
            cause.problem.detail ??
              "We couldn't take that application with those details. If you already applied, we're reviewing it.",
          );
        } else {
          setFormError(cause instanceof ApiError ? cause.friendlyMessage : 'Something went wrong.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [fields, pin],
  );

  if (application !== null) {
    return <ApplicationPending kind="vendor" applicationId={application.applicationId} />;
  }

  const markers = pin === null ? [] : ([{ id: 'store', position: pin, kind: 'store' as const }] as const);

  return (
    <form className="authform" onSubmit={(e) => void onSubmit(e)} noValidate>
      <header className="authform__head">
        <p className="auth-eyebrow">Sell here</p>
        <h1 className="authform__title">
          Open your store
          <br />
          <span className="authform__title-accent">on the market.</span>
        </h1>
        <p className="authform__sub">
          One application, reviewed by an admin. There is no self-serve vendor signup — someone
          checks every shop before it goes live.
        </p>
      </header>

      {formError !== null ? (
        <div className="authform__alert" role="alert">
          <span className="authform__alert-mark" aria-hidden="true">
            !
          </span>
          <span>{formError}</span>
        </div>
      ) : null}

      <p className="authform__section">You</p>

      <AuthField
        label="Your name"
        name="name"
        autoComplete="name"
        value={fields.name}
        onChange={(e) => set('name', e.target.value)}
        error={errors.name}
        disabled={submitting}
        required
      />
      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        value={fields.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
        disabled={submitting}
        required
      />
      <AuthField
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        adornmentSide="start"
        adornment={<span className="mono authform__prefix">+91</span>}
        mono
        value={fields.phone}
        onChange={(e) => set('phone', e.target.value)}
        error={errors.phone}
        disabled={submitting}
        required
      />
      <AuthField
        label="Password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder="At least 10 characters"
        value={fields.password}
        onChange={(e) => set('password', e.target.value)}
        error={errors.password}
        disabled={submitting}
        required
        adornment={
          <button
            type="button"
            className="authform__peek"
            onClick={() => setShowPassword((s) => !s)}
            aria-pressed={showPassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        }
      />

      <p className="authform__section">Your store</p>

      <AuthField
        label="Store name"
        name="storeName"
        value={fields.storeName}
        onChange={(e) => set('storeName', e.target.value)}
        error={errors.storeName}
        disabled={submitting}
        required
      />
      <AuthField
        label="Flat, building, street"
        name="line1"
        autoComplete="address-line1"
        value={fields.line1}
        onChange={(e) => set('line1', e.target.value)}
        error={errors.line1}
        disabled={submitting}
        required
      />
      <AuthField
        label="Area, landmark"
        name="line2"
        autoComplete="address-line2"
        value={fields.line2}
        onChange={(e) => set('line2', e.target.value)}
        disabled={submitting}
      />
      <AuthField
        label="City"
        name="city"
        autoComplete="address-level2"
        value={fields.city}
        onChange={(e) => set('city', e.target.value)}
        error={errors.city}
        disabled={submitting}
        required
      />
      <AuthField
        label="State"
        name="state"
        autoComplete="address-level1"
        value={fields.state}
        onChange={(e) => set('state', e.target.value)}
        error={errors.state}
        disabled={submitting}
        required
      />
      <AuthField
        label="PIN code"
        name="pincode"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={6}
        mono
        value={fields.pincode}
        onChange={(e) => set('pincode', e.target.value.replace(/[^0-9]/g, ''))}
        error={errors.pincode}
        disabled={submitting}
        required
      />

      <div className="authform__mapwrap">
        <p className="authform__maplabel">
          Drop a pin on your store — required. This is what serviceability and rider routing run
          off once you&rsquo;re approved.
        </p>
        <MandiMap
          center={pin ?? MAP_FALLBACK_CENTER}
          zoom={15}
          height={220}
          markers={markers}
          onPick={setPin}
          ariaLabel="Store location pin picker"
        />
        {pin !== null ? (
          <p className="authform__pin mono">
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}{' '}
            <button type="button" className="authform__resend" onClick={() => setPin(null)}>
              clear
            </button>
          </p>
        ) : errors.pin !== undefined ? (
          <p className="authfield__msg authfield__msg--error" role="alert">
            {errors.pin}
          </p>
        ) : null}
      </div>

      <AuthButton loading={submitting} loadingLabel="Submitting your application">
        Submit application
      </AuthButton>
    </form>
  );
}
