'use client';

/**
 * Customer signup — three steps, phone-first.
 *
 *   1. phone           POST /auth/register/request-otp   { phone }
 *   2. 6-digit code     POST /auth/register/verify-otp    { requestId, phone, otp }
 *   3. name + password  POST /auth/register                { registrationToken, name, password, email? }
 *
 * ── THE THREE REAL CONSTRAINTS ON STEP 2 ────────────────────────────────────
 * The OTP is 6 digits, lives 5 minutes, allows 3 wrong attempts before the
 * request is dead, and a resend is rate-limited to once every 60 seconds.
 * All three are shown, not just enforced: a countdown to expiry, "N attempts
 * left" once a wrong code has been entered, and a resend button that says
 * when it will be live again rather than just refusing the tap.
 *
 * ── THE DUPLICATE-PHONE ORACLE ──────────────────────────────────────────────
 * A phone already on an account surfaces as a plain 409 at step 3, not at
 * step 1 or step 2 — the whole OTP round trip happens the same way whether or
 * not the number is registered. That is deliberate: a different error at
 * step 1 would let anyone probe which numbers have accounts. This screen
 * trusts the server's own wording for that 409 and adds nothing that would
 * confirm or deny an existing account either.
 *
 * ── devOtp ───────────────────────────────────────────────────────────────
 * Present only outside production. Shown in a dashed, clearly-labelled
 * "DEV ONLY" box so the flow is testable end to end without SMS wired up —
 * never styled as if it were a normal part of the screen.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { HOME_FOR_ROLE, useAuth } from '@/components/auth/AuthProvider';
import { AuthField, AuthCheckbox, AuthButton } from '@/components/auth/fields';
import { api, ApiError } from '@/lib/api-client';

const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_SEC = 60;

type Step = 'phone' | 'otp' | 'details';

interface RequestOtpResponse {
  requestId: string;
  expiresInSec: number;
  devOtp?: string;
}

interface VerifyOtpResponse {
  registrationToken: string;
  expiresInSec: number;
}

function normalisePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/^\+91/, '');
}

function isValidPhone(raw: string): boolean {
  return /^[6-9]\d{9}$/.test(normalisePhone(raw));
}

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest.toString().padStart(2, '0')}`;
}

export function CustomerSignupFlow() {
  const router = useRouter();
  const { register } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [requesting, setRequesting] = useState(false);

  const [requestId, setRequestId] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | undefined>(undefined);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [verifying, setVerifying] = useState(false);

  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [detailErrors, setDetailErrors] = useState<{
    name?: string;
    password?: string;
    email?: string;
    terms?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* One ticking clock for both the OTP expiry and the resend cooldown. */
  useEffect(() => {
    if (step !== 'otp') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  const requestOtp = useCallback(
    async (isResend: boolean) => {
      const trimmed = normalisePhone(phone);
      if (!isValidPhone(phone)) {
        setPhoneError('Enter a 10-digit Indian mobile number.');
        return;
      }
      setPhoneError(undefined);
      setRequesting(true);
      setFormError(null);
      try {
        const res = await api.post<RequestOtpResponse>(
          '/auth/register/request-otp',
          { phone: trimmed },
          { anonymous: true },
        );
        setRequestId(res.requestId);
        setDevOtp(res.devOtp ?? null);
        setOtp('');
        setOtpError(undefined);
        setAttemptsLeft(MAX_ATTEMPTS);
        setExpiresAt(Date.now() + res.expiresInSec * 1000);
        setResendAt(Date.now() + RESEND_COOLDOWN_SEC * 1000);
        setNow(Date.now());
        if (!isResend) setStep('otp');
      } catch (cause) {
        setFormError(cause instanceof ApiError ? cause.friendlyMessage : 'Something went wrong.');
      } finally {
        setRequesting(false);
      }
    },
    [phone],
  );

  const onPhoneSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void requestOtp(false);
    },
    [requestOtp],
  );

  const onOtpSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (requestId === null) return;
      if (otp.length !== OTP_LENGTH) {
        setOtpError(`Enter the ${OTP_LENGTH}-digit code.`);
        return;
      }
      setOtpError(undefined);
      setVerifying(true);
      setFormError(null);
      try {
        const res = await api.post<VerifyOtpResponse>(
          '/auth/register/verify-otp',
          { requestId, phone: normalisePhone(phone), otp },
          { anonymous: true },
        );
        setRegistrationToken(res.registrationToken);
        setStep('details');
      } catch (cause) {
        setOtp('');
        if (cause instanceof ApiError) {
          const remaining = Math.max(0, attemptsLeft - 1);
          setAttemptsLeft(remaining);
          setOtpError(
            remaining > 0
              ? `${cause.friendlyMessage} ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
              : 'No attempts left on this code. Request a new one.',
          );
        } else {
          setFormError('Something went wrong. Try again.');
        }
      } finally {
        setVerifying(false);
      }
    },
    [requestId, otp, phone, attemptsLeft],
  );

  const onDetailsSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (registrationToken === null) return;

      const errors: typeof detailErrors = {};
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName.length < 2) errors.name = 'Tell us what to call you.';
      if (!password || password.length < 10) {
        errors.password = 'Use at least 10 characters — length beats symbols.';
      }
      const trimmedEmail = email.trim();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
        errors.email = 'That email address does not look right.';
      }
      if (!terms) errors.terms = 'Please accept the terms to continue.';
      setDetailErrors(errors);
      if (Object.keys(errors).length > 0) return;

      setSubmitting(true);
      setFormError(null);
      try {
        const user = await register({
          registrationToken,
          name: trimmedName,
          password,
          email: trimmedEmail === '' ? undefined : trimmedEmail,
        });
        router.push(HOME_FOR_ROLE[user.role] ?? '/stores');
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          // The deliberate, generic 409 — never confirm or deny an existing
          // account. Trust the server's own wording; it is written to the
          // same rule.
          setFormError(
            cause.problem.detail ??
              "We couldn't create your account with those details. If you already have one, sign in instead.",
          );
        } else if (cause instanceof ApiError && cause.status === 410) {
          // The registration token expired — the whole OTP round trip is
          // stale. Back to the start, honestly, rather than a confusing 400.
          setFormError('That took a little too long — start again with your number.');
          setStep('phone');
          setRegistrationToken(null);
        } else {
          setFormError(cause instanceof ApiError ? cause.friendlyMessage : 'Something went wrong.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [registrationToken, name, password, email, terms, register, router],
  );

  const secondsToExpiry = expiresAt === null ? 0 : (expiresAt - now) / 1000;
  const expired = step === 'otp' && secondsToExpiry <= 0;
  const secondsToResend = resendAt === null ? 0 : Math.max(0, (resendAt - now) / 1000);
  const canResend = secondsToResend <= 0;

  /* ---------------- step 1 — phone ---------------- */

  if (step === 'phone') {
    return (
      <form className="authform" onSubmit={onPhoneSubmit} noValidate>
        <header className="authform__head">
          <p className="auth-eyebrow">Create an account</p>
          <h1 className="authform__title">
            Eight aisles,
            <br />
            <span className="authform__title-accent">one basket.</span>
          </h1>
          <p className="authform__sub">
            A mobile number is all we need to start. We&rsquo;ll text you a code.
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
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98765 43210"
          adornmentSide="start"
          adornment={<span className="mono authform__prefix">+91</span>}
          mono
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={phoneError}
          disabled={requesting}
          required
        />

        <AuthButton loading={requesting} loadingLabel="Sending your code">
          Send code
        </AuthButton>

        <p className="authform__foot">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    );
  }

  /* ---------------- step 2 — otp ---------------- */

  if (step === 'otp') {
    return (
      <form className="authform" onSubmit={(e) => void onOtpSubmit(e)} noValidate>
        <header className="authform__head">
          <p className="auth-eyebrow">Verify your number</p>
          <h1 className="authform__title">
            Enter the code
            <br />
            <span className="authform__title-accent">we just sent.</span>
          </h1>
          <p className="authform__sub">
            Texted to <strong className="mono">+91 {normalisePhone(phone)}</strong>.{' '}
            <button
              type="button"
              className="authform__resend"
              onClick={() => setStep('phone')}
              style={{ fontSize: 'inherit', fontWeight: 600 }}
            >
              Wrong number?
            </button>
          </p>
        </header>

        {devOtp !== null ? (
          <p className="authform__devhint">
            <span className="authform__devhint-tag">Dev only</span>
            This never appears in production. Code: <code>{devOtp}</code>
          </p>
        ) : null}

        {formError !== null ? (
          <div className="authform__alert" role="alert">
            <span className="authform__alert-mark" aria-hidden="true">
              !
            </span>
            <span>{formError}</span>
          </div>
        ) : null}

        <AuthField
          label={`${OTP_LENGTH}-digit code`}
          name="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          mono
          placeholder="000000"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH))}
          error={otpError}
          disabled={verifying || expired}
          required
        />

        <p className="authform__meta">
          <span>
            {expired ? (
              <>Code expired.</>
            ) : (
              <>
                Expires in <strong>{mmss(secondsToExpiry)}</strong>
              </>
            )}
            {attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && !expired ? (
              <> · {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left</>
            ) : null}
          </span>
          <button
            type="button"
            className="authform__resend"
            disabled={!canResend || requesting}
            onClick={() => void requestOtp(true)}
          >
            {canResend
              ? requesting
                ? 'Sending…'
                : 'Resend code'
              : `Resend in ${mmss(secondsToResend)}`}
          </button>
        </p>

        <AuthButton
          loading={verifying}
          loadingLabel="Checking your code"
          disabled={expired || otp.length !== OTP_LENGTH || attemptsLeft <= 0}
        >
          Verify
        </AuthButton>
      </form>
    );
  }

  /* ---------------- step 3 — details ---------------- */

  return (
    <form className="authform" onSubmit={(e) => void onDetailsSubmit(e)} noValidate>
      <header className="authform__head">
        <p className="auth-eyebrow">Almost there</p>
        <h1 className="authform__title">
          Your number is
          <br />
          <span className="authform__title-accent">confirmed.</span>
        </h1>
        <p className="authform__sub">A name and a password, and you&rsquo;re in.</p>
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
        placeholder="Ananya Sharma"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={detailErrors.name}
        disabled={submitting}
        required
      />

      <AuthField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={detailErrors.email}
        hint="Optional. Only used for receipts and settlement statements."
        disabled={submitting}
      />

      <AuthField
        label="Password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder="At least 10 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={detailErrors.password}
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

      <AuthCheckbox
        label={
          <>
            I agree to the <Link href="/#top">terms</Link> and the{' '}
            <Link href="/#top">privacy policy</Link>.
          </>
        }
        name="terms"
        checked={terms}
        onChange={(e) => setTerms(e.target.checked)}
        error={detailErrors.terms}
        disabled={submitting}
      />

      <AuthButton loading={submitting} loadingLabel="Creating your account">
        Create account
      </AuthButton>

      <p className="authform__foot">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
