'use client';

/**
 * Login.
 *
 * POSTs { identifier, password } to ${NEXT_PUBLIC_API_URL}/auth/login with
 * credentials: 'include', so the API can set the httpOnly mandi_rt refresh
 * cookie on the response.
 *
 * The access token that comes back goes into React state via AuthProvider and
 * into one module variable in api-client. It is NEVER written to localStorage
 * or sessionStorage (plan section 4.3) - any XSS on this origin could read it
 * there, and a leaked bearer token is a full account takeover.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Input } from '@mandi/design-system';
import { HOME_FOR_ROLE, useAuth, type Role } from '@/components/auth/AuthProvider';
import { ApiError } from '@/lib/api-client';

interface FieldErrors {
  identifier?: string;
  password?: string;
}

/** Accepts an email address OR a 10-digit Indian mobile number. */
function validateIdentifier(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your email or mobile number.';

  const looksLikeEmail = v.includes('@');
  if (looksLikeEmail) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
      ? undefined
      : 'That email address does not look right.';
  }

  const digits = v.replace(/[\s-]/g, '').replace(/^\+91/, '');
  return /^[6-9]\d{9}$/.test(digits)
    ? undefined
    : 'Enter a 10-digit mobile number, or use your email instead.';
}

function validatePassword(value: string): string | undefined {
  if (!value) return 'Enter your password.';
  return undefined;
}

/**
 * Where to land after a successful sign-in.
 *
 * `raw` is the ?next= the middleware attached when it bounced someone off a
 * protected page — honour it, but only as a path on this origin, never as a
 * supplied URL (that would be an open redirect).
 *
 * With no ?next=, fall back to the role's own home rather than to `/`:
 * signing in at /login directly used to dump an admin back on the marketing
 * page, which is indistinguishable from the login having failed.
 */
function safeNext(raw: string | null, role: Role): string {
  const home = HOME_FOR_ROLE[role] ?? '/';
  if (!raw) return home;
  if (!raw.startsWith('/') || raw.startsWith('//')) return home;
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const next: FieldErrors = {
      identifier: validateIdentifier(identifier),
      password: validatePassword(password),
    };
    setErrors(next);
    if (next.identifier || next.password) return;

    setSubmitting(true);
    try {
      const user = await login(identifier.trim(), password);
      router.push(safeNext(params.get('next'), user.role));
    } catch (err) {
      if (err instanceof ApiError) {
        // 401 gets a friendly, deliberately non-specific message: saying
        // "no such account" would let anyone enumerate who has one.
        setFormError(
          err.status === 401
            ? "That email or number and password don't match an account. Try again."
            : err.friendlyMessage,
        );
        const fieldErrors = err.fieldErrors;
        if (Object.keys(fieldErrors).length > 0) {
          setErrors({
            identifier: fieldErrors.identifier,
            password: fieldErrors.password,
          });
        }
      } else {
        setFormError('Something went wrong. Try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="authform" onSubmit={onSubmit} noValidate>
      <header className="authform__head">
        <p className="eyebrow">Welcome back</p>
        <h1 className="authform__title">
          The market is
          <br />
          <span className="authform__title-accent">already open.</span>
        </h1>
        <p className="authform__sub">
          Sign in with the email or mobile number on your account.
        </p>
      </header>

      {formError ? (
        <div className="authform__alert" role="alert">
          <span className="authform__alert-mark" aria-hidden="true">
            !
          </span>
          <span>{formError}</span>
        </div>
      ) : null}

      <Input
        label="Email or mobile number"
        name="identifier"
        type="text"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="you@example.com or 98765 43210"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        onBlur={() =>
          setErrors((p) => ({ ...p, identifier: validateIdentifier(identifier) }))
        }
        error={errors.identifier}
        disabled={submitting}
        required
      />

      <Input
        label="Password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onBlur={() => setErrors((p) => ({ ...p, password: validatePassword(password) }))}
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

      <div className="authform__row">
        {/* TODO(api): "keep me signed in" is presentational until the API
            accepts it. The refresh cookie's lifetime is set server-side, so
            honouring this means sending the flag on /auth/login and having the
            API issue a short- or long-lived cookie. Wiring it client-side only
            would be a lie. */}
        <Checkbox
          label="Keep me signed in"
          name="remember"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={submitting}
        />
        <Link href="/forgot-password" className="authform__minor">
          Forgot password?
        </Link>
      </div>

      <Button
        type="submit"
        size="lg"
        block
        loading={submitting}
        loadingLabel="Signing you in"
      >
        Sign in
      </Button>

      <p className="authform__foot">
        New to Mandi? <Link href="/signup">Create an account</Link>
      </p>
    </form>
  );
}
