'use client';

/**
 * "Deliver with {APP_NAME}" — a rider application, not a signup.
 *
 * `POST /auth/apply/rider` — name, phone, password, vehicle type, email
 * optional — answers `201 { applicationId, status: 'pending' }`. Same rule as
 * the vendor path: no token, no session, an admin reviews it. See
 * `ApplicationPending`.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { AuthField, AuthButton } from '@/components/auth/fields';
import { ApplicationPending } from '@/components/auth/ApplicationPending';
import { api, ApiError } from '@/lib/api-client';
import { VEHICLE_LABEL, type VehicleType } from '@/lib/delivery/types';

const VEHICLE_TYPES = Object.keys(VEHICLE_LABEL) as VehicleType[];

interface Fields {
  name: string;
  email: string;
  phone: string;
  password: string;
  vehicleType: VehicleType;
}

const BLANK: Fields = { name: '', email: '', phone: '', password: '', vehicleType: 'scooter' };

type FieldErrors = Partial<Record<keyof Fields, string>>;

function normalisePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/^\+91/, '');
}

function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  if (fields.name.trim().length < 2) errors.name = 'Tell us what to call you.';
  const email = fields.email.trim();
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = 'That email address does not look right.';
  }
  if (!/^[6-9]\d{9}$/.test(normalisePhone(fields.phone))) {
    errors.phone = 'Enter a 10-digit Indian mobile number.';
  }
  if (fields.password.length < 10) {
    errors.password = 'Use at least 10 characters — length beats symbols.';
  }
  return errors;
}

interface ApplyResponse {
  applicationId: string;
  status: 'pending';
}

export function RiderApplicationForm() {
  const [fields, setFields] = useState<Fields>(BLANK);
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
      const next = validate(fields);
      setErrors(next);
      if (Object.keys(next).length > 0) return;

      setSubmitting(true);
      setFormError(null);
      try {
        const email = fields.email.trim();
        const res = await api.post<ApplyResponse>(
          '/auth/apply/rider',
          {
            name: fields.name.trim(),
            email: email === '' ? undefined : email,
            phone: normalisePhone(fields.phone),
            password: fields.password,
            vehicleType: fields.vehicleType,
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
    [fields],
  );

  if (application !== null) {
    return <ApplicationPending kind="rider" applicationId={application.applicationId} />;
  }

  return (
    <form className="authform" onSubmit={(e) => void onSubmit(e)} noValidate>
      <header className="authform__head">
        <p className="auth-eyebrow">Ride with us</p>
        <h1 className="authform__title">
          Deliver the
          <br />
          <span className="authform__title-accent">baskets you fill.</span>
        </h1>
        <p className="authform__sub">
          One application, reviewed by an admin — vehicle and identity are checked before you can
          take your first job.
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
        hint="Optional."
        disabled={submitting}
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

      <div className="authfield">
        <label className="authfield__label" htmlFor="rider-vehicle">
          Vehicle
        </label>
        <div className="authfield__shell">
          <select
            id="rider-vehicle"
            className="authfield__input"
            value={fields.vehicleType}
            onChange={(e) => set('vehicleType', e.target.value as VehicleType)}
            disabled={submitting}
          >
            {VEHICLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {VEHICLE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AuthButton loading={submitting} loadingLabel="Submitting your application">
        Submit application
      </AuthButton>
    </form>
  );
}
