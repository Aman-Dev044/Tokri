/**
 * The public environment, validated once, at module load.
 *
 * ── THE BANNED PATTERN ──────────────────────────────────────────────────────
 *   const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
 *
 * A fallback means the app runs successfully while misconfigured. It points a
 * production build at localhost, or signs requests against the wrong origin,
 * and nobody notices until it is found from the outside. There is no fallback
 * anywhere in this codebase (plan section 4.1).
 *
 * ── WHY THESE ARE SPELLED OUT LITERALLY ─────────────────────────────────────
 * `process.env.NEXT_PUBLIC_X` is replaced with a string literal at build time
 * by Next's bundler. That substitution only happens for a STATIC member access,
 * so `process.env[name]` in a loop silently yields undefined in the browser.
 * Every var is therefore read by its full name, on its own line.
 */

function required(value: string | undefined, name: string): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `[mandi/web] Missing required environment variable ${name}.\n` +
        `Copy apps/web/.env.example to apps/web/.env.local and fill it in.\n` +
        `There is deliberately no fallback value: an app that boots while ` +
        `misconfigured is worse than one that refuses to boot.`,
    );
  }
  return value.trim();
}

function optional(value: string | undefined): string | null {
  return value && value.trim() !== '' ? value.trim() : null;
}

/** Base URL of the NestJS API, including the /api/v1 prefix. */
export const API_URL: string = required(
  process.env.NEXT_PUBLIC_API_URL,
  'NEXT_PUBLIC_API_URL',
);

/** Socket.IO origin (no path). */
export const SOCKET_URL: string = required(
  process.env.NEXT_PUBLIC_SOCKET_URL,
  'NEXT_PUBLIC_SOCKET_URL',
);

/** Absolute origin of this app - canonical URLs, OG images, sitemap. */
export const SITE_URL: string = required(
  process.env.NEXT_PUBLIC_SITE_URL,
  'NEXT_PUBLIC_SITE_URL',
);

/**
 * Not required yet. These belong to phases that have not been built, and an
 * empty value is an honest statement of that. The feature that needs one must
 * assert it is present at the point of use, not silently degrade.
 */
export const RAZORPAY_KEY_ID: string | null = optional(
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
);
export const MAPS_BROWSER_KEY: string | null = optional(
  process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY,
);
export const SENTRY_DSN: string | null = optional(process.env.NEXT_PUBLIC_SENTRY_DSN);

/** Use at the point a not-yet-required key becomes required. */
export function requireEnv(value: string | null, name: string): string {
  if (value === null) {
    throw new Error(
      `[mandi/web] ${name} is not configured. This feature cannot run without it.`,
    );
  }
  return value;
}
