import type { ReactNode } from 'react';
import Link from 'next/link';

import '@/styles/auth.css';

/**
 * The auth shell. Deliberately NOT the marketing top bar: someone signing in
 * has one job, and a nav full of other places to go is a distraction with a
 * measurable cost. Just the wordmark, and a way back.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <header className="auth__bar auth__shell">
        <Link href="/" className="auth__brand" aria-label="Mandi, home">
          <span className="auth__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path
                d="M5 12 L27 12 L24 26 Q23.4 28 21.5 28 L10.5 28 Q8.6 28 8 26 Z"
                fill="var(--accent)"
                opacity="0.24"
              />
              <path
                d="M5 12 L27 12 L24 26 Q23.4 28 21.5 28 L10.5 28 Q8.6 28 8 26 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M11 12 Q16 2 21 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="16" cy="19" r="3.4" fill="var(--accent)" />
            </svg>
          </span>
          <span className="auth__wordmark">Mandi</span>
        </Link>

        <Link href="/" className="auth__back">
          <span aria-hidden="true">←</span> Back to the market
        </Link>
      </header>

      <main id="main" className="auth__main">
        {children}
      </main>
    </div>
  );
}
