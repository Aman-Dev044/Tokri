/**
 * Mandi - Next.js configuration.
 *
 * Security headers live here AND in the Nginx config (plan section 4.5). Both,
 * deliberately: Nginx covers static assets served without touching Node, and
 * this covers `next start` and any deploy target that has no reverse proxy in
 * front of it. Duplicated headers are harmless; a missing one is not.
 */

/** @type {(isDev: boolean) => string} */
const contentSecurityPolicy = (isDev) => {
  // The API origin has to be reachable from the browser, so it belongs in
  // connect-src. It is read from the environment - never hardcoded, and never
  // given a fallback (plan section 4.1: a fallback means the app boots while
  // misconfigured).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

  if (!apiUrl || !socketUrl) {
    throw new Error(
      'Missing required public env vars: NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SOCKET_URL must ' +
        'both be set (see apps/web/.env.example). Refusing to build a CSP that cannot reach ' +
        'the API.',
    );
  }

  const origin = (value) => new URL(value).origin;
  const apiOrigin = origin(apiUrl);
  const socketOrigin = origin(socketUrl);
  const wsOrigin = socketOrigin.replace(/^http/, 'ws');

  const connect = [
    "'self'",
    apiOrigin,
    socketOrigin,
    wsOrigin,
    'https://*.sentry.io',
  ];

  return [
    "default-src 'self'",
    // next/font self-hosts at build time, so no font CDN is needed at runtime.
    "font-src 'self' data:",
    // 'unsafe-eval' is required by the Next dev overlay and React Refresh only.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://checkout.razorpay.com https://maps.googleapis.com`,
    // Next injects inline <style> for critical CSS; there is no way around this.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.s3.amazonaws.com https://maps.gstatic.com https://maps.googleapis.com",
    `connect-src ${connect.join(' ')}`,
    'frame-src https://api.razorpay.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The design system ships raw .ts/.tsx source; Next compiles it with the app.
  transpilePackages: ['@mandi/design-system'],

  eslint: {
    dirs: ['src'],
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    // Product photography lands in S3. Add the bucket host here when it exists;
    // an empty list means only local /public images load, which is correct for
    // the marketing build.
    remotePatterns: [],
  },

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(isDev),
          },
          {
            // Two years, subdomains included, preload-list eligible.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            // geolocation + camera are needed by the delivery panel (live
            // tracking and the proof-of-delivery photo). Microphone, never.
            key: 'Permissions-Policy',
            value: 'geolocation=(self), camera=(self), microphone=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
