import type { Metadata } from 'next';
import { SignupForm } from '@/components/auth/SignupForm';
import { AuthPanel } from '@/components/auth/AuthPanel';

export const metadata: Metadata = {
  title: 'Create an account',
  description:
    'Create a Mandi account with your mobile number and start ordering from the shops already near you.',
  alternates: { canonical: '/signup' },
  robots: { index: false, follow: false },
  openGraph: { title: 'Create an account · Mandi', url: '/signup' },
};

export default function SignupPage() {
  return (
    <div className="authsplit authsplit--mirror">
      <AuthPanel
        kicker="Pillar two · circadian ground"
        line="The store at 7am does not look like the store at 11pm. Mandi shifts the light with your day."
      />

      <section className="authsplit__form">
        <SignupForm />
      </section>
    </div>
  );
}
