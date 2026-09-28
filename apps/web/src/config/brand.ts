/**
 * THE BRAND, IN ONE PLACE.
 *
 * Everything the user reads that names this product comes from here, and
 * here reads exactly one environment variable. Change `NEXT_PUBLIC_APP_NAME`
 * in `.env.local`, restart, and the page titles, the OG tags, the header,
 * the footer, the manifest and every "Welcome to …" string follow.
 *
 * ── WHAT THIS CANNOT RENAME, AND WHY ───────────────────────────────────────
 * Two things stay fixed no matter what this file says, because no runtime
 * value can reach them:
 *
 *   1. The `@tokri/*` npm workspace names. An `import` specifier must be a
 *      static string — that is a language rule, not a design choice — and
 *      the package manager resolves them at install time, long before any
 *      env var is read.
 *
 *   2. The `tkr-` CSS class prefix. A stylesheet has custom properties for
 *      VALUES, never for selector names, so `.tkr-cell` cannot be composed
 *      at runtime.
 *
 * Neither is ever shown to a user. They are internal identifiers, and
 * renaming them is a one-off mechanical find-and-replace, not configuration.
 *
 * ── NO FALLBACK ────────────────────────────────────────────────────────────
 * Deliberately required, like every other value in `env.ts`. A default of
 * "Tokri" here would mean a misconfigured deployment ships someone else's
 * brand name and nobody notices until a customer points at the tab title.
 */

function required(value: string | undefined, name: string): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `[web] Missing required environment variable ${name}.\n` +
        `Set it in apps/web/.env.local. There is deliberately no fallback: ` +
        `an app that boots under the wrong name is worse than one that refuses to boot.`,
    );
  }
  return value.trim();
}

/**
 * The product name. Read as a static member access on its own line —
 * Next's bundler only substitutes `process.env.NEXT_PUBLIC_X` in that exact
 * form, so a computed lookup would silently be `undefined` in the browser.
 */
export const APP_NAME: string = required(
  process.env.NEXT_PUBLIC_APP_NAME,
  'NEXT_PUBLIC_APP_NAME',
);

/** One-line positioning, used under the logo and as the metadata default. */
export const APP_TAGLINE: string = required(
  process.env.NEXT_PUBLIC_APP_TAGLINE,
  'NEXT_PUBLIC_APP_TAGLINE',
);

/** Lowercase form for wordmarks and URLs. */
export const APP_NAME_LOWER: string = APP_NAME.toLowerCase();

/** `Tokri — fill your basket`. The default document title and OG title. */
export const APP_TITLE = `${APP_NAME} — ${APP_TAGLINE}`;

/** `%s · Tokri`. Next's per-page title template. */
export const APP_TITLE_TEMPLATE = `%s · ${APP_NAME}`;

/** Longer description for metadata, the manifest and share cards. */
export const APP_DESCRIPTION: string = required(
  process.env.NEXT_PUBLIC_APP_DESCRIPTION,
  'NEXT_PUBLIC_APP_DESCRIPTION',
);
