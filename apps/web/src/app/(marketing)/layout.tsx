import type { ReactNode } from 'react';
import { TopBar } from '@/components/marketing/TopBar';
import { Marquee } from '@/components/marketing/Marquee';
import { Footer } from '@/components/marketing/Footer';
import { SITE_URL } from '@/config/env';
import { APP_NAME, APP_DESCRIPTION } from '@/config/brand';

import '@/styles/marketing.css';

/**
 * The public marketing shell: SSG + ISR, SEO-first (plan section 3.3).
 *
 * The JSON-LD below describes the organisation and the site search entry point.
 * It is a build-time constant - nothing user-supplied reaches it, which is what
 * makes the dangerouslySetInnerHTML safe here.
 */

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: APP_NAME,
      url: SITE_URL,
      description: APP_DESCRIPTION,
      areaServed: { '@type': 'Country', name: 'India' },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#site`,
      url: SITE_URL,
      name: APP_NAME,
      publisher: { '@id': `${SITE_URL}/#org` },
      inLanguage: 'en-IN',
    },
  ],
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing">
      <Marquee />
      <TopBar />
      <main id="main">{children}</main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
