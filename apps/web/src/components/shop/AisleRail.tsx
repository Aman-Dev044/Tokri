'use client';

/**
 * PILLAR 1 — the way in.
 *
 * Eight aisles, eight hues. Hovering one PREVIEWS the tint across the whole
 * interface before you commit to it; leaving restores whatever you were in.
 * That preview is the demo moment in miniature — you find out what the app does
 * before you have clicked anything.
 *
 * The rail scrolls inside itself on narrow screens. The page body never scrolls
 * sideways.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AISLES, useAisle } from '@mandi/design-system';

export function AisleRail() {
  const { aisle, preview, clearPreview } = useAisle();
  const pathname = usePathname();

  return (
    <nav className="shop-rail scroll-x" aria-label="Aisles">
      <ul className="shop-rail__list">
        {AISLES.map((entry) => {
          const href = `/aisle/${entry.key}`;
          const active = aisle === entry.key || pathname === href;
          return (
            <li key={entry.key}>
              <Link
                href={href}
                className="shop-rail__item"
                data-active={active ? 'true' : undefined}
                // The preview is a hover affordance, not information — the
                // label and the route carry the meaning on their own.
                onMouseEnter={() => {
                  preview(entry.key);
                }}
                onMouseLeave={clearPreview}
                onFocus={() => {
                  preview(entry.key);
                }}
                onBlur={clearPreview}
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className="shop-rail__swatch"
                  style={{ background: entry.swatch }}
                  aria-hidden="true"
                />
                <span className="shop-rail__name">{entry.name}</span>
                <span className="shop-rail__hindi" aria-hidden="true">
                  {entry.hindi}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
