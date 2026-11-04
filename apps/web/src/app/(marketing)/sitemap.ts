import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/config/env';
import { LEGAL_LAST_UPDATED } from '@/lib/legal';

/**
 * Only routes that actually exist and are actually public belong here. Listing
 * a route that 404s, or one that redirects to /login, costs crawl budget and
 * tells Google the site is unreliable.
 *
 * TODO(phase-1): add /aisle/[aisleKey] and /stores/[slug] once the (shop)
 * surface ships. Auth routes are deliberately excluded - see robots.ts.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    // Public, static, and dated by their own "Last updated" line rather
    // than by the build — re-dating them on every deploy would be untrue.
    {
      url: `${SITE_URL}/help`,
      lastModified: new Date(`${LEGAL_LAST_UPDATED}T00:00:00+05:30`),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: new Date(`${LEGAL_LAST_UPDATED}T00:00:00+05:30`),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: new Date(`${LEGAL_LAST_UPDATED}T00:00:00+05:30`),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
