/**
 * The `GroceryLoader.Page / .Inline / .Skeleton` namespace.
 *
 * ── WHY THIS FILE HAS NO 'use client' DIRECTIVE ─────────────────────────────
 * When a Server Component imports from a 'use client' module, the bundler hands
 * it a *client reference*, not the function object. Statics attached at module
 * scope inside that file (`GroceryLoader.Page = PageLoader`) do not survive the
 * boundary: reading `.Page` off a client reference gives `undefined`, and React
 * throws "Element type is invalid ... but got: undefined".
 *
 * `app/loading.tsx`, `app/not-found.tsx` and the auth pages are all Server
 * Components. So the namespace has to be a PLAIN OBJECT, assembled in a
 * server-safe module, whose values are the individual client references. Each
 * value is still a genuine client component; only the container is server-side.
 */

import {
  GroceryLoaderInline,
  GroceryLoaderPage,
  GroceryLoaderSkeleton,
} from './GroceryLoader';

export const GroceryLoader = {
  /** full-screen route transition */
  Page: GroceryLoaderPage,
  /** inside a button or a section */
  Inline: GroceryLoaderInline,
  /** card / row / text placeholders */
  Skeleton: GroceryLoaderSkeleton,
} as const;
