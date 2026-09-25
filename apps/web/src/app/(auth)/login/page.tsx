import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GroceryLoader } from '@mandi/design-system';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthPanel } from '@/components/auth/AuthPanel';

export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Sign in to Mandi with your email or mobile number and pick up where you left off.',
  alternates: { canonical: '/login' },
  // An auth page has nothing to offer a search engine and everything to lose.
  robots: { index: false, follow: false },
  openGraph: { title: 'Sign in · Mandi', url: '/login' },
};

export default function LoginPage() {
  return (
    <div className="authsplit">
      <section className="authsplit__form">
        {/* LoginForm reads ?next= through useSearchParams, which needs a
            Suspense boundary so the rest of the page can still be static. */}
        <Suspense
          fallback={
            <div className="authform authform--loading">
              <GroceryLoader.Inline size={36} label="Loading the sign-in form" />
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
