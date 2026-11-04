import { NextResponse, type NextRequest } from 'next/server';

/**
 * ROUTE PROTECTION - LAYER 1 OF 3 (plan section 4.4)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ READ THIS BEFORE TRUSTING ANYTHING IN THIS FILE.                         │
 * │                                                                          │
 * │ This middleware is UX, NOT SECURITY. All it does is stop a signed-out    │
 * │ user from watching a dashboard render and then explode. It checks for    │
 * │ the PRESENCE of a cookie. It does not verify a signature, it does not    │
 * │ check a role, and it cannot: the refresh token is httpOnly and opaque    │
 * │ to us, and its signing secret lives only in the API.                     │
 * │                                                                          │
 * │ Anyone can skip this entirely with `curl`. The only thing standing       │
 * │ between an attacker and the data is the API guard chain (plan §4.2):     │
 * │ ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →          │
 * │ ValidationPipe → ResourceOwnerGuard. That is Layer 3, and that is the    │
 * │ layer that matters.                                                      │
 * │                                                                          │
 * │ Layer 2 is a server-side session check inside each protected layout,     │
 * │ added when those layouts are built.                                      │
 * │                                                                          │
 * │ NEVER move an authorisation decision into this file.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Set by the API as httpOnly + Secure + SameSite=Strict. Opaque here. */
/**
 * Must match REFRESH_COOKIE_NAME on the API.
 *
 * Middleware runs in the edge runtime and cannot import the validated config
 * module, so it reads the public var directly — and throws rather than
 * guessing, because a wrong cookie name here silently signs everyone out
 * while looking exactly like a working deployment.
 */
function requiredCookieName(): string {
  // Static member access on its own line: Next's bundler only substitutes
  // `process.env.NEXT_PUBLIC_X` in exactly that form.
  const name = process.env.NEXT_PUBLIC_REFRESH_COOKIE_NAME;
  if (!name || name.trim() === '') {
    throw new Error(
      '[web] NEXT_PUBLIC_REFRESH_COOKIE_NAME is not set. ' +
        'Route protection cannot run without it, and it must match ' +
        'REFRESH_COOKIE_NAME in apps/api/.env.',
    );
  }
  return name.trim();
}

const REFRESH_COOKIE: string = requiredCookieName();

/**
 * Prefixes that require a session. The roles are documented rather than
 * enforced, because enforcing them here would require verifying a JWT we
 * cannot verify. The API enforces them for real.
 */
const PROTECTED_PREFIXES: ReadonlyArray<{ prefix: string; roles: readonly string[] }> = [
  { prefix: '/vendor', roles: ['vendor', 'staff'] },
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/delivery', roles: ['delivery'] },
  { prefix: '/cart', roles: ['customer'] },
  { prefix: '/checkout', roles: ['customer'] },
  { prefix: '/orders', roles: ['customer'] },
  { prefix: '/addresses', roles: ['customer'] },
  { prefix: '/wishlist', roles: ['customer'] },
];

/**
 * Paths under a protected prefix that must stay reachable WITHOUT a
 * session, because the browser — not a page — fetches them, and it does so
 * with no credentials attached.
 *
 * Both are public by nature. The manifest is a name, some colours and icon
 * paths; the service worker is static JavaScript, byte-identical for every
 * visitor. Neither describes a rider.
 *
 * Without this the rider PWA cannot install at all: the manifest request
 * is redirected to /login, and `upgrade-insecure-requests` then rewrites
 * that redirect to https, which nothing serves in development. The failure
 * is invisible — "Add to Home Screen" simply does nothing.
 */
const PUBLIC_UNDER_PROTECTED: ReadonlySet<string> = new Set([
  '/delivery/manifest.webmanifest',
  '/delivery/sw.js',
]);

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_UNDER_PROTECTED.has(pathname)) return NextResponse.next();

  const match = PROTECTED_PREFIXES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!match) return NextResponse.next();

  const hasSession = req.cookies.has(REFRESH_COOKIE);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', req.url);
  // Bring them back to where they were trying to go. Relative path only -
  // taking a full URL here would be an open-redirect.
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/vendor/:path*',
    '/admin/:path*',
    '/delivery/:path*',
    '/cart/:path*',
    '/checkout/:path*',
    '/orders/:path*',
    '/addresses/:path*',
    '/wishlist/:path*',
  ],
};

/**
 * THE TWO LISTS ABOVE MUST AGREE, AND NOTHING MAKES THEM.
 *
 * `matcher` decides where this file RUNS. `PROTECTED_PREFIXES` decides what
 * it does once it has run. A prefix present in the second but missing from
 * the first is not a weaker rule — it is NO rule: the middleware is never
 * invoked for that path and the entry sits there looking like protection.
 *
 * That is exactly what happened to `/addresses`. It was added to
 * `PROTECTED_PREFIXES`, the change was reviewed and committed as "now
 * protected", and it did nothing at all, because the matcher did not list
 * it. A signed-out visitor still got a broken address book instead of the
 * login page.
 *
 * Next requires `matcher` to be a statically analysable literal, so the two
 * cannot be derived from one source. They can at least be checked: this
 * throws at module load in development, which is the first page load after
 * somebody edits one list and forgets the other. Production never evaluates
 * it — a guard that can take the site down is worse than the drift.
 */
if (process.env.NODE_ENV !== 'production') {
  const covered = new Set(config.matcher.map((entry) => entry.replace('/:path*', '')));
  const orphans = PROTECTED_PREFIXES.filter(({ prefix }) => !covered.has(prefix));
  if (orphans.length > 0) {
    throw new Error(
      `middleware.ts: ${orphans.map((o) => o.prefix).join(', ')} ` +
        'is in PROTECTED_PREFIXES but not in `config.matcher`, so the ' +
        'middleware never runs for it and the prefix is NOT protected. ' +
        'Add it to the matcher.',
    );
  }
}
