import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthPanel } from '@/components/auth/AuthPanel';
import { APP_NAME } from '@/config/brand';

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to ${APP_NAME} with your email or mobile number and pick up where you left off.`,
  alternates: { canonical: '/login' },
  // An auth page has nothing to offer a search engine and everything to lose.
  robots: { index: false, follow: false },
  openGraph: { title: `Sign in · ${APP_NAME}`, url: '/login' },
};

export default function LoginPage() {
  return (
    <div className="authsplit">
      <section className="authsplit__form">
        {/* LoginForm reads ?next= through useSearchParams, which needs a
            Suspense boundary so the rest of the page can still be static. */}
        <Suspense
          fallback={
            <div className="authform authform--loading" aria-live="polite">
              <span className="authform__skel" />
              <span className="authform__skel" />
              <span className="authform__skel" />
              <span className="mnd-visually-hidden">Loading the sign-in form</span>
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </section>

      <AuthPanel
        kicker="Pillar one · chromatic aisles"
        line="Eight crates, eight colours. Whichever one you reach for, the whole app follows you into it."
      />
    </div>
  );
}
