'use client';

/**
 * Signup — UI ONLY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TODO(product): the registration flow is still being specified.           │
 * │                                                                          │
 * │ Open questions that change the request body, and therefore the API       │
 * │ contract, and therefore this form:                                       │
 * │   · is signup phone-first with an OTP step, or email + password?         │
 * │   · do vendors and riders register here, or through a separate           │
 * │     onboarding funnel with KYC?                                          │
 * │   · is the account created before or after the OTP is verified?          │
 * │   · which fields are required at creation vs. collected later?           │
 * │                                                                          │
 * │ Until those are answered, `submit()` below deliberately does NOT call    │
 * │ the API. Inventing POST /auth/register here would bake a guess into the  │
 * │ client that the backend then has to match.                               │
 * │                                                                          │
 * │ Everything else is real: validation, inline errors, show/hide password,  │
 * │ disabled + loading states, the GroceryLoader on submit.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Input, useToast } from '@mandi/design-system';

interface Fields {
  name: string;
  phone: string;
  email: string;
  password: string;
}

type FieldErrors = Partial<Record<keyof Fields | 'terms', string>>;

function validate(fields: Fields, terms: boolean): FieldErrors {
  const errors: FieldErrors = {};

  const name = fields.name.trim();
  if (!name) errors.name = 'Tell us what to call you.';
  else if (name.length < 2) errors.name = 'That looks a little short.';

  const phone = fields.phone.replace(/[\s-]/g, '').replace(/^\+91/, '');
  if (!phone) errors.phone = 'We need a mobile number for delivery updates.';
  else if (!/^[6-9]\d{9}$/.test(phone))
    errors.phone = 'Enter a 10-digit Indian mobile number.';

  const email = fields.email.trim();
  // Email is optional: plenty of customers shop on a phone number alone.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    errors.email = 'That email address does not look right.';

  if (!fields.password) errors.password = 'Choose a password.';
  else if (fields.password.length < 10)
    errors.password = 'Use at least 10 characters — length beats symbols.';

  if (!terms) errors.terms = 'Please accept the terms to continue.';

  return errors;
}

function strengthOf(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (password.length < 10) return { score: 0, label: 'Too short' };
  let score = 1;
  if (password.length >= 14) score += 1;
  if (/[^A-Za-z0-9]/.test(password) && /\d/.test(password)) score += 1;
  const labels = ['Too short', 'Workable', 'Good', 'Strong'] as const;
  const clamped = Math.min(3, score) as 0 | 1 | 2 | 3;
  return { score: clamped, label: labels[clamped] };
}

export function SignupForm() {
  const { toast } = useToast();

  const [fields, setFields] = useState<Fields>({
    name: '',
    phone: '',
    email: '',
    password: '',
  });
  const [terms, setTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const strength = strengthOf(fields.password);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const next = validate(fields, terms);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await registerStub(fields);
      toast({
        tone: 'warn',
        title: 'Signup is not connected yet',
        description:
          'The form and its validation are done. The registration API contract is still being agreed, so nothing was sent.',
        duration: 8000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="authform" onSubmit={onSubmit} noValidate>
      <header className="authform__head">
        <p className="auth-eyebrow">Create an account</p>
        <h1 className="authform__title">
          Eight aisles,
          <br />
          <span className="authform__title-accent">one basket.</span>
        </h1>
        <p className="authform__sub">
          A mobile number is all we really need. Everything else you can add later.
        </p>
      </header>

      <Input
        label="Your name"
        name="name"
        autoComplete="name"
        placeholder="Ananya Sharma"
        value={fields.name}
        onChange={(e) => set('name', e.target.value)}
        error={errors.name}
        disabled={submitting}
        required
      />

      <Input
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="98765 43210"
        adornmentSide="start"
        adornment={<span className="mono authform__prefix">+91</span>}
        mono
        value={fields.phone}
        onChange={(e) => set('phone', e.target.value)}
        error={errors.phone}
        hint="Your rider calls this number. Delivery updates come here too."
        disabled={submitting}
        required
      />

      <Input
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="you@example.com"
        value={fields.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
        hint="Optional. Only used for receipts and settlement statements."
        disabled={submitting}
      />

      <div className="authform__pw">
        <Input
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
        {fields.password ? (
          <p className="strength" data-score={strength.score}>
            <span className="strength__bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="strength__label mono">{strength.label}</span>
          </p>
        ) : null}
      </div>

      <Checkbox
        label={
          <>
            I agree to the <Link href="/#top">terms</Link> and the{' '}
            <Link href="/#top">privacy policy</Link>.
          </>
        }
        name="terms"
        checked={terms}
        onChange={(e) => setTerms(e.target.checked)}
        error={errors.terms}
        disabled={submitting}
      />

      <Button
        type="submit"
        size="lg"
        block
        loading={submitting}
        loadingLabel="Creating your account"
      >
        Create account
      </Button>

      <p className="authform__foot">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}

/* --------------------------------------------------------------------------
   TODO(product/api): replace this stub with the real call once the signup
   contract is agreed. Do NOT guess at it — the shape of this request decides
   the shape of the users collection.

   The eventual call is expected to look roughly like:

     await api.post<{ accessToken: string; user: SessionUser }>(
       '/auth/register',
       { name, phone, email, password },
       { anonymous: true },
     );

   …but whether it returns tokens immediately or hands off to an OTP step is
   exactly the open question, so it stays unwritten.
-------------------------------------------------------------------------- */
async function registerStub(_fields: Fields): Promise<void> {
  // The delay is here so the loading state is honest rather than instant.
  await new Promise((resolve) => setTimeout(resolve, 900));
}
