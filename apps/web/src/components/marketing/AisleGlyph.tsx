import type { ReactNode } from 'react';
import type { AisleKey } from '@mandi/design-system';

/**
 * One drawn produce mark per aisle, as inline SVG.
 *
 * Deliberately not emoji: an emoji section marker renders differently on every
 * platform, cannot take the aisle hue, and reads as a placeholder. These take
 * `currentColor`, so the caller tints them with `var(--aisle-…)` and both
 * themes are handled by the token, not by a second copy of the drawing.
 *
 * No 'use client': it is pure presentation with no state, so it renders on the
 * server inside a Server Component and equally inside a client one.
 */

const PATHS: Record<AisleKey, ReactNode> = {
  fruits: (
    <>
      <circle cx="16" cy="19" r="9" />
      <path d="M16 10q3-5 8-5" />
    </>
  ),
  vegetables: (
    <>
      <path d="M16 28Q6 18 16 5q10 13 0 23Z" />
      <path d="M16 24V9" />
    </>
  ),
  dairy: (
    <>
      <path d="M11 12h10v16H11z" />
      <path d="m11 12 5-7 5 7" />
    </>
  ),
  bakery: (
    <>
      <path d="M5 21q11-14 22 0-11 7-22 0Z" />
      <path d="m12 16 2 6M19 15l2 7" />
    </>
  ),
  beverages: (
    <>
      <path d="M13 6h6v4l3 6v12H10V16l3-6z" />
      <path d="M10 20h12" />
    </>
  ),
  snacks: (
    <>
      <circle cx="16" cy="16" r="10" />
      <path d="m9 9 14 14M23 9 9 23" />
    </>
  ),
  staples: (
    <>
      <path d="M16 5v22" />
      <path d="M16 11q6-1 7-6M16 11q-6-1-7-6" />
      <path d="M16 19q6-1 7-6M16 19q-6-1-7-6" />
    </>
  ),
  frozen: (
    <>
      <path d="M16 4v24M6 10l20 12M26 10 6 22" />
      <path d="m13 7 3 3 3-3M13 25l3-3 3 3" />
    </>
  ),
  // A handset: the one shape that reads as "electronics" at 32px without
  // needing a brand mark or a colour of its own.
  electronics: (
    <>
      <rect x="10" y="4" width="12" height="24" rx="2.5" />
      <path d="M14 7h4" />
      <circle cx="16" cy="24" r="1.2" />
    </>
  ),
};

export function AisleGlyph({
  aisleKey,
  className,
}: {
  aisleKey: AisleKey;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[aisleKey]}
    </svg>
  );
}
