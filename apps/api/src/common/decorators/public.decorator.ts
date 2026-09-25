import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route OUT of the global authentication guard.
 *
 * The API is deny-by-default: `JwtAuthGuard` is registered as an APP_GUARD,
 * so every route requires a valid access token unless it carries this
 * decorator. Forgetting a decorator therefore makes a route MORE secure,
 * never less — which is the entire point of the inversion.
 *
 * Every use of @Public() is a deliberate, reviewable decision, and the
 * complete set is asserted by `test/integration/public-routes.spec.ts`.
 * Adding one without updating that test fails CI.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
