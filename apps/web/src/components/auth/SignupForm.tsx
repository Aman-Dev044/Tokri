'use client';

/**
 * Signup — three paths, one screen.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY TABS, NOT SEPARATE ROUTES                                            │
 * │                                                                          │
 * │ `/signup/vendor` and `/signup/rider` would each need their own page      │
 * │ file, their own metadata, and — because `(auth)/layout.tsx` wraps every  │
 * │ route in this group in the same split panel — no visual difference from │
 * │ a tab anyway. A tab switch is instant, keeps the three paths visibly     │
 * │ next to each other (so nobody mistakes "sell here" for the only way in), │
 * │ and there is exactly one place — this file — that decides which signup   │
 * │ paths exist. Admin and super-admin have NO signup path; they are simply  │
 * │ never options here, and there is no route for them to reach either.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Each tab is a fully separate flow with its own contract:
 *   Customer   — phone OTP, three steps, ends signed in.
 *   Vendor     — one form, ends on "waiting for approval" — not a session.
 *   Rider      — one form, ends on "waiting for approval" — not a session.
 */

import { useState } from 'react';
import { CustomerSignupFlow } from '@/components/auth/CustomerSignupFlow';
import { VendorApplicationForm } from '@/components/auth/VendorApplicationForm';
import { RiderApplicationForm } from '@/components/auth/RiderApplicationForm';

type Tab = 'customer' | 'vendor' | 'rider';

const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'customer', label: 'Shop' },
  { key: 'vendor', label: 'Sell' },
  { key: 'rider', label: 'Deliver' },
];

export function SignupForm() {
  const [tab, setTab] = useState<Tab>('customer');

  return (
    <div className="authform__wrap">
      <div className="authtabs" role="tablist" aria-label="What are you signing up to do?">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`signup-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`signup-panel-${entry.key}`}
            className="authtabs__btn"
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`signup-panel-${tab}`} aria-labelledby={`signup-tab-${tab}`} key={tab}>
        {tab === 'customer' ? (
          <CustomerSignupFlow />
        ) : tab === 'vendor' ? (
          <VendorApplicationForm />
        ) : (
          <RiderApplicationForm />
        )}
      </div>
    </div>
  );
}
