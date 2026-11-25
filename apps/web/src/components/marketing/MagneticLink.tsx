'use client';

import Link from 'next/link';
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/**
 * A call to action that leans toward the pointer.
 *
 * The pull is written to two custom properties and consumed by the `translate`
 * property in marketing.css, so it never collides with the press squash (which
 * lives on `scale`) or with any transform an ancestor is running.
 *
 * It is switched off for coarse pointers — there is no hover on a phone, and a
 * touch would otherwise leave the button parked off-centre — and for anyone who
 * asked for reduced motion. The link itself is an ordinary next/link either
 * way: the magnetism is decoration on top of a control that already works.
 */

export type MagneticVariant = 'solid' | 'quiet' | 'ghost';

export interface MagneticLinkProps {
  href: string;
  children: ReactNode;
  variant?: MagneticVariant;
  /** how far the button may travel, in px */
  strength?: number;
  className?: string;
}

export function MagneticLink({
  href,
  children,
  variant = 'solid',
  strength = 9,
  className,
}: MagneticLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);

  const reset = () => {
    const node = ref.current;
    if (!node) return;
    node.style.removeProperty('--mx');
    node.style.removeProperty('--my');
  };

  const onMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const node = ref.current;
    if (!node) return;
    if (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const box = node.getBoundingClientRect();
    const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
    const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);

    node.style.setProperty('--mx', `${(dx * strength).toFixed(2)}px`);
    node.style.setProperty('--my', `${(dy * strength * 0.7).toFixed(2)}px`);
  };

  return (
    <Link
      ref={ref}
      href={href}
      className={['mk-btn', 'mk-btn--lg', `mk-btn--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onBlur={reset}
    >
      <span className="mk-btn__label">{children}</span>
      {/* The arrow is decoration: hidden from assistive technology, so the
          link's accessible name is still exactly its label. */}
      {variant === 'ghost' ? null : (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mk-btn__arrow">
          <path
            d="M5 12h13m0 0-5-5m5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Link>
  );
}
