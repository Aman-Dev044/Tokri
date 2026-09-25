'use client';

import type { CSSProperties, ElementType, ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   BENTO — the layout primitive of the "Bento Pop" system.

   A bento grid is a 12-column grid whose cells claim different spans, so
   the page reads as a composed set of panels rather than a uniform table
   of cards. The span vocabulary is deliberately small and named by ROLE,
   not by number of columns: a caller asks for a "hero" or a "half", and
   the grid decides what that means at each breakpoint. That is what keeps
   five different surfaces looking like one product.

   Everything here is presentation only. No data, no fetching, no state
   beyond what an animation needs.
   ═══════════════════════════════════════════════════════════════════════ */

export type BentoSpan =
  | 'hero' /* 12 cols, the one thing that matters most */
  | 'wide' /* 8  cols */
  | 'half' /* 6  cols */
  | 'third' /* 4  cols */
  | 'quarter' /* 3  cols — the KPI tile */
  | 'tall'; /* 4  cols × 2 rows */

export type BentoTone =
  | 'plain'
  | 'accent'
  | 'pop-1'
  | 'pop-2'
  | 'pop-3'
  | 'pop-4'
  | 'good'
  | 'warn'
  | 'crit';

export interface BentoGridProps {
  children: ReactNode;
  className?: string;
  /** Tighten the gap for dense operational screens (vendor, admin). */
  dense?: boolean;
  as?: ElementType;
}

export function BentoGrid({
  children,
  className,
  dense = false,
  as: Tag = 'div',
}: BentoGridProps) {
  return (
    <Tag
      className={['mnd-bento', dense ? 'mnd-bento--dense' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Tag>
  );
}

export interface BentoCardProps {
  children: ReactNode;
  span?: BentoSpan;
  tone?: BentoTone;
  /**
   * Position in the entrance stagger. Cells animate in at
   * `index * --stagger`, so a grid assembles instead of appearing.
   */
  index?: number;
  /** Lift on hover and take a pointer cursor. Only for cells that DO something. */
  interactive?: boolean;
  /** Flat cell: no shadow, hairline only. For a cell inside another cell. */
  flat?: boolean;
  className?: string;
  as?: ElementType;
  onClick?: () => void;
  style?: CSSProperties;

  /**
   * Accessibility and test attributes, passed straight through.
   *
   * Without these a caller could not give a cell an accessible name, so a
   * titled panel rendered as a BentoCard vanished from the screen-reader
   * document outline. The admin console had to keep its own panel element
   * rather than adopt this one for exactly that reason.
   *
   * Deliberately an allowlist, not `[k: string]: unknown`: a wide-open
   * spread lets a typo silently become a DOM attribute.
   */
  id?: string;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-live'?: 'off' | 'polite' | 'assertive';
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
  'aria-current'?: boolean | 'page' | 'step';
  'data-testid'?: string;
}

export function BentoCard({
  children,
  span = 'third',
  tone = 'plain',
  index = 0,
  interactive = false,
  flat = false,
  className,
  as,
  onClick,
  style,
  ...a11y
}: BentoCardProps) {
  // An onClick with no element override becomes a real <button>, so it is
  // reachable by keyboard and announced correctly. A div with a click
  // handler is invisible to anyone not using a mouse.
  const Tag: ElementType = as ?? (onClick ? 'button' : 'div');

  return (
    <Tag
      className={[
        'mnd-cell',
        `mnd-cell--${span}`,
        tone !== 'plain' ? `mnd-cell--${tone}` : '',
        interactive || onClick ? 'mnd-cell--act' : '',
        flat ? 'mnd-cell--flat' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--i' as string]: index, ...style }}
      onClick={onClick}
      {...a11y}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
    >
      {children}
    </Tag>
  );
}

export interface BentoHeadProps {
  title: ReactNode;
  /** Small uppercase eyebrow. Use it for a real category, not decoration. */
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function BentoHead({ title, eyebrow, action, className }: BentoHeadProps) {
  return (
    <header className={['mnd-cell__head', className].filter(Boolean).join(' ')}>
      <div className="mnd-cell__head-text">
        {eyebrow ? <span className="mnd-label">{eyebrow}</span> : null}
        <h3 className="mnd-cell__title">{title}</h3>
      </div>
      {action ? <div className="mnd-cell__head-act">{action}</div> : null}
    </header>
  );
}
