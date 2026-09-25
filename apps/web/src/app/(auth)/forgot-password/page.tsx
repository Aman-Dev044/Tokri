import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
};

/**
 * TODO(product): password reset is not specified yet, and it shares every open
 * question with signup — is the reset code sent to the phone over MSG91 or to
 * the email over SendGrid, and does it reuse the OTP flow?
 *
 * This page exists so the "Forgot password?" link on /login does not 404. It
 * deliberately does not render a form: a form that collects an address and
 * silently does nothing is worse than an honest page.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="authsplit authsplit--single">
      <section className="authsplit__form">
        <div className="authform">
          <header className="authform__head">
            <p className="eyebrow">Password reset</p>
            <h1 className="authform__title">
              Not wired up
              <br />
              <span className="authform__title-accent">just yet.</span>
            </h1>
            <p className="authform__sub">
              Password reset goes out over the same channel as your sign-in code, and
              that flow is still being agreed. Until it ships, drop us a line and we
              will sort it out by hand.
            </p>
          </header>

          <Link href="/login" className="mnd-btn mnd-btn--outline mnd-btn--lg">
            Back to sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
