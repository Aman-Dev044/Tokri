import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/config/env';

/**
 * NOTE ON LOCATION: this lives at `app/robots.ts`, not inside the (marketing)
 * route group where the plan sketches it. Next.js only generates /robots.txt
 * from the ROOT app segment - placed in a route group it silently produces
 * nothing and the URL 404s. `sitemap.ts` does work from inside the group
 * (nested sitemaps are a supported feature), so that one stayed put.
 *
 * robots.txt is a crawling hint, never an access control. Every path listed
 * under `disallow` is also protected by middleware.ts (UX) and, where it
 * matters, by the API guard chain (security). Publishing the list here does not
 * expose anything that was not already guessable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/login',
          '/signup',
          '/otp',
          '/forgot-password',
          '/vendor/',
          '/admin/',
          '/delivery/',
          '/cart/',
          '/checkout/',
          '/orders/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
