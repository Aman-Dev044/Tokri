'use client';

/**
 * What a vendor or rider application ends on.
 *
 * ── NOT A SESSION ────────────────────────────────────────────────────────
 * `POST /auth/apply/vendor` and `POST /auth/apply/rider` both answer
 * `201 { applicationId, status: 'pending' }` — no token, no user, no cookie.
 * There is nothing for `AuthProvider` to hold, because there is no account to
 * sign into yet: an admin has to approve the application first. This screen
 * says that plainly rather than leaving someone tapping a "sign in" link that
 * will just 401.
 */

import Link from 'next/link';
import { APP_NAME } from '@/config/brand';

export function ApplicationPending({
  kind,
  applicationId,
}: {
  kind: 'vendor' | 'rider';
  applicationId: string;
}) {
  return (
    <div className="authform">
      <div className="authwait">
        <span className="authwait__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M12 7v5l3.2 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1 className="authwait__title">Waiting for approval</h1>

        <p className="authwait__body">
          Your {kind === 'vendor' ? 'store' : 'rider'} application is in — reference{' '}
          <strong className="mono">{applicationId}</strong>. A {APP_NAME} admin reviews every
          {kind === 'vendor' ? ' store' : ' rider'} application by hand, which usually takes a
          day or two. <strong>You cannot sign in until it is approved</strong> — there is no
          account yet, only this application.
        </p>

        <p className="authwait__body">
          We&rsquo;ll reach out on the phone number and email you gave us once a decision is
          made.
        </p>

        <p className="authform__foot">
          <Link href="/">Back to {APP_NAME}</Link>
        </p>
      </div>
    </div>
  );
}
