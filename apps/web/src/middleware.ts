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
const REFRESH_COOKIE = 'mandi_rt';

/**
 * Prefixes that require a session. The roles are documented rather than
 * enforced, because enforcing them here would require verifying a JWT we
 * cannot verify. The API enforces them for real.
 */
const PROTECTED_PREFIXES: ReadonlyArray<{ prefix: string; roles: readonly string[] }> = [
  { prefix: '/vendor', roles: ['vendor'] },
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/delivery', roles: ['delivery'] },
  { prefix: '/cart', roles: ['customer'] },
  { prefix: '/checkout', roles: ['customer'] },
  { prefix: '/orders', roles: ['customer'] },
];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

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
  ],
};
