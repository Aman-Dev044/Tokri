import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/config/env';

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
  ];
}
