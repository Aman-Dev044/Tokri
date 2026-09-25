'use client';

/**
 * ★ THE GROCERY LOADER - Mandi's signature waiting state.
 *
 * THE IDEA: "the drop". A hand-woven cane basket sits at the bottom, drawn in
 * hairline ink like a market sketch. Above it, produce falls in - a tomato, a
 * leaf of saag, an egg, a jar - one at a time along a slight arc. Each one
 * squashes on landing with the spring easing, the basket rim flexes, and the
 * contents inside rise a little higher with every catch. When the basket is
 * full it empties and the cycle restarts.
 *
 * It is the Basket pillar (3) shrunk to loader size: a physical object that
 * fills, catches and reacts - not a spinner.
 *
 * All of it is inline SVG plus CSS keyframes. No animation library, no GIF,
 * no Lottie. Every falling item is filled with `var(--aisle)` at a different
 * alpha, so the loader re-tints with the rest of the app - the fruits aisle
 * loads in tomato red, frozen loads in frost blue.
 *
 * Three variants, all exported off one object:
 *   <GroceryLoader.Page />      full-screen route transition
 *   <GroceryLoader.Inline />    inside a button or a section
 *   <GroceryLoader.Skeleton />  card placeholders
 *
 * REDUCED MOTION: the falling stops, but feedback never does. The basket and
 * its contents are drawn in their resting "full" state and breathe gently
 * between 55% and 100% opacity. Removing feedback entirely is worse than
 * animating - the user still needs to know the app is working.
 * (All of that is handled in styles/components.css under the
 *  `prefers-reduced-motion` block - this file ships no inline animation.)
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';

/* ------------------------------------------------------------------ */
/* The basket, drawn once and reused at every size                     */
/* ------------------------------------------------------------------ */

function BasketMark({ full = false }: { full?: boolean }) {
  // Several loaders can share a page (a skeleton grid draws one per card), so
  // the pattern and clip-path ids must be unique or the browser silently
  // reuses the first definition and the markup is invalid HTML.
  const uid = useId().replace(/:/g, '');
  const weaveId = `mnd-weave-${uid}`;
  const bowlId = `mnd-bowl-${uid}`;

  return (
    <svg
      className="mnd-loader__svg"
      viewBox="0 0 120 120"
      role="presentation"
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        {/* the weave. A crosshatch, so the basket reads as cane and not as a bucket */}
        <pattern
          id={weaveId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(12)"
        >
          <path
            d="M0 4h8M4 0v8"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.34"
            fill="none"
          />
        </pattern>
        {/* everything below the rim is clipped, so the rising mass never spills */}
        <clipPath id={bowlId}>
          <path d="M22 74 L98 74 L90 110 Q88 116 82 116 L38 116 Q32 116 30 110 Z" />
        </clipPath>
      </defs>

      {/* ---- falling produce ------------------------------------------------ */}
      {!full && (
        <g className="mnd-loader__drops">
          {/* tomato */}
          <g className="mnd-loader__drop mnd-loader__drop--1">
            <circle cx="0" cy="0" r="9.5" fill="var(--aisle)" opacity="0.92" />
            <path
              d="M-4 -9 q4 -5 8 0"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </g>
          {/* leaf of saag */}
          <g className="mnd-loader__drop mnd-loader__drop--2">
            <path
              d="M0 -10 Q10 -2 0 10 Q-10 -2 0 -10 Z"
              fill="var(--aisle)"
              opacity="0.72"
            />
            <path
              d="M0 -8 V8"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity="0.5"
              fill="none"
            />
          </g>
          {/* egg */}
          <g className="mnd-loader__drop mnd-loader__drop--3">
            <ellipse cx="0" cy="0" rx="7" ry="9" fill="var(--aisle)" opacity="0.55" />
          </g>
          {/* jar of masala */}
          <g className="mnd-loader__drop mnd-loader__drop--4">
            <rect
              x="-7"
              y="-8"
              width="14"
              height="17"
              rx="2.5"
              fill="var(--aisle)"
              opacity="0.82"
            />
            <rect
              x="-8.5"
              y="-11"
              width="17"
              height="4"
              rx="1.5"
              fill="currentColor"
              opacity="0.55"
            />
          </g>
        </g>
      )}

      {/* ---- the basket ----------------------------------------------------- */}
      <g className="mnd-loader__basket">
        {/* contents: a rising mass, clipped to the bowl */}
        <g clipPath={`url(#${bowlId})`}>
          <g className={full ? 'mnd-loader__fill mnd-loader__fill--static' : 'mnd-loader__fill'}>
            <rect x="18" y="74" width="84" height="46" fill="var(--aisle)" opacity="0.2" />
            <circle cx="40" cy="80" r="11" fill="var(--aisle)" opacity="0.55" />
            <circle cx="62" cy="76" r="13" fill="var(--aisle)" opacity="0.38" />
            <circle cx="82" cy="82" r="10" fill="var(--aisle)" opacity="0.6" />
          </g>
        </g>

        {/* bowl body */}
        <path
          className="mnd-loader__bowl"
          d="M22 74 L98 74 L90 110 Q88 116 82 116 L38 116 Q32 116 30 110 Z"
          fill={`url(#${weaveId})`}
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        {/* rim - this is the part that flexes on catch */}
        <rect
          className="mnd-loader__rim"
          x="17"
          y="67"
          width="86"
          height="10"
          rx="5"
          fill="var(--paper)"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        {/* handle, drawn behind-ish so the basket reads as a market basket */}
        <path
          className="mnd-loader__handle"
          d="M36 68 Q60 26 84 68"
          stroke="currentColor"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

export interface GroceryLoaderProps {
  /** announced to assistive tech and, on .Page, shown under the basket */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Full-screen route transition. Used by app/loading.tsx. */
export function GroceryLoaderPage({
  label = 'Filling your basket',
  className,
  style,
}: GroceryLoaderProps) {
  return (
    <div
      className={['mnd-loader-page', className].filter(Boolean).join(' ')}
      style={style}
      role="status"
      aria-live="polite"
    >
      <div className="mnd-loader mnd-loader--page">
        <BasketMark />
      </div>
      <p className="mnd-loader-page__label">{label}</p>
      <p className="mnd-loader-page__sub">
        मंडी <span aria-hidden="true">·</span> the market is waking up
      </p>
    </div>
  );
}

export interface InlineLoaderProps extends GroceryLoaderProps {
  /** ~18px inside buttons, ~32px inside a section */
  size?: number;
}

/** Button and section scale. Inherits currentColor, so it works on any fill. */
export function GroceryLoaderInline({
  label = 'Loading',
  size = 20,
  className,
  style,
}: InlineLoaderProps) {
  return (
    <span
      className={['mnd-loader', 'mnd-loader--inline', className]
        .filter(Boolean)
        .join(' ')}
      style={{ ...style, ['--mnd-loader-size' as string]: `${size}px` }}
      role="status"
      aria-live="polite"
    >
      <BasketMark />
      <span className="mnd-visually-hidden">{label}</span>
    </span>
  );
}

export interface SkeletonLoaderProps {
  /** how many placeholder cards to draw */
  count?: number;
  /** 'card' for product tiles, 'row' for list rows, 'text' for paragraphs */
  variant?: 'card' | 'row' | 'text';
  label?: string;
  className?: string;
}

/**
 * Card placeholders. The sweep is tinted with the aisle hue and a faint basket
 * watermark sits in the corner of each card, so even the skeleton is Mandi and
 * not a grey rectangle.
 */
export function GroceryLoaderSkeleton({
  count = 4,
  variant = 'card',
  label = 'Loading products',
  className,
}: SkeletonLoaderProps) {
  return (
    <div
      className={['mnd-skel-grid', `mnd-skel-grid--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          className={`mnd-skel mnd-skel--${variant}`}
          key={i}
          style={{ ['--mnd-skel-i' as string]: String(i) }}
        >
          {variant === 'card' && (
            <>
              <div className="mnd-skel__media">
                <span className="mnd-skel__watermark" aria-hidden="true">
                  <BasketMark full />
                </span>
              </div>
              <div className="mnd-skel__line mnd-skel__line--title" />
              <div className="mnd-skel__line mnd-skel__line--meta" />
              <div className="mnd-skel__line mnd-skel__line--price" />
            </>
          )}
          {variant === 'row' && (
            <>
              <div className="mnd-skel__thumb" />
              <div className="mnd-skel__rows">
                <div className="mnd-skel__line mnd-skel__line--title" />
                <div className="mnd-skel__line mnd-skel__line--meta" />
              </div>
            </>
          )}
          {variant === 'text' && (
            <>
              <div className="mnd-skel__line mnd-skel__line--title" />
              <div className="mnd-skel__line" />
              <div className="mnd-skel__line mnd-skel__line--meta" />
            </>
          )}
        </div>
      ))}
      <span className="mnd-visually-hidden">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NOTE ON THE `GroceryLoader.Page` NAMESPACE                          */
/* ------------------------------------------------------------------ */
/*
 * The dot-notation namespace is assembled in `./grocery-loader.ts`, NOT here,
 * and that file deliberately has no 'use client' directive.
 *
 * Why: when a Server Component imports from a 'use client' module, the bundler
 * hands it a *client reference*, not the function object. Statics attached at
 * module scope (`GroceryLoader.Page = ...`) do not survive that boundary -
 * reading `.Page` off a client reference yields `undefined`, and React then
 * throws "Element type is invalid ... got: undefined".
 *
 * `app/loading.tsx`, `app/not-found.tsx` and the auth pages are all Server
 * Components, so the namespace has to be a PLAIN OBJECT built in a server-safe
 * module whose values are the individual client references. That is exactly
 * what grocery-loader.ts does.
 */
