'use client';

/**
 * The top bar. Sticky, full-width, translucent once the page moves.
 *
 * The client asked for the menus to live up here, so they do - including the
 * "Shop by aisle" menu, which is the first place a visitor meets Pillar 1:
 * hovering (or arrow-keying to) an aisle re-tints the ENTIRE page live, and
 * leaving puts it back. It is a menu that demonstrates the product.
 *
 * Accessibility:
 *  - the aisle menu is a disclosure: a real <button> with aria-expanded and
 *    aria-controls, a real <ul> of real links
 *  - Arrow keys walk the list, Home/End jump, Escape closes and returns focus
 *  - clicking outside or tabbing out closes it
 *  - the mobile drawer is the design-system <Sheet>, which traps focus, locks
 *    body scroll, closes on Escape and returns focus to the opener
 *  - every control has a visible focus ring; none are removed
 *
 * TODO(phase-1): the aisle links point at landing-page anchors because the
 * (shop) surface does not exist yet. When /aisle/[aisleKey] ships, swap `href`
 * to `/aisle/${key}` - the route segment will stamp data-aisle itself and the
 * onClick preview here becomes unnecessary.
 */

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { AISLES, Sheet, useAisle, useTheme } from '@mandi/design-system';
import type { AisleKey } from '@mandi/design-system';

interface NavItem {
  label: string;
  href: string;
}

const NAV: readonly NavItem[] = [
  { label: 'Home', href: '/#top' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'For Vendors', href: '/#vendors' },
  { label: 'For Riders', href: '/#riders' },
];

function Wordmark() {
  return (
    <Link href="/#top" className="topbar__brand" aria-label="Mandi, home">
      <span className="topbar__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          {/* the basket again, reduced to a monogram */}
          <path
            d="M5 12 L27 12 L24 26 Q23.4 28 21.5 28 L10.5 28 Q8.6 28 8 26 Z"
            fill="var(--aisle)"
            opacity="0.24"
          />
          <path
            d="M5 12 L27 12 L24 26 Q23.4 28 21.5 28 L10.5 28 Q8.6 28 8 26 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M11 12 Q16 2 21 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="16" cy="19" r="3.4" fill="var(--aisle)" />
        </svg>
      </span>
      <span className="topbar__wordmark">
        Mandi
        <span className="topbar__wordmark-hi" aria-hidden="true">
          मंडी
        </span>
      </span>
    </Link>
  );
}

function ThemeToggle() {
  const { theme, cycleTheme, resolved } = useTheme();

  const label =
    theme === 'system'
      ? `Theme: follow system (currently ${resolved ?? 'loading'})`
      : `Theme: ${theme}`;

  return (
    <button
      type="button"
      className="topbar__icon-btn"
      onClick={cycleTheme}
      aria-label={`${label}. Activate to change.`}
      title={label}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="5.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M10 1.6v2.2M10 16.2v2.2M18.4 10h-2.2M3.8 10H1.6M15.9 4.1l-1.6 1.6M5.7 14.3l-1.6 1.6M15.9 15.9l-1.6-1.6M5.7 5.7 4.1 4.1"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
      <span className="mnd-visually-hidden">{label}</span>
    </button>
  );
}

function AisleMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { setAisle, preview, clearPreview } = useAisle();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const close = useCallback(
    (returnFocus = false) => {
      setOpen(false);
      clearPreview();
      if (returnFocus) triggerRef.current?.focus();
    },
    [clearPreview],
  );

  // Click-outside and Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, close]);

  const focusItem = (index: number) => {
    const count = AISLES.length;
    const wrapped = ((index % count) + count) % count;
    const node = itemRefs.current[wrapped];
    node?.focus();
    const aisle = AISLES[wrapped];
    if (aisle) preview(aisle.key);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => focusItem(0));
    }
  };

  const onItemKeyDown = (e: ReactKeyboardEvent<HTMLAnchorElement>, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(AISLES.length - 1);
        break;
      default:
        break;
    }
  };

  const commit = (key: AisleKey) => {
    setAisle(key);
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div className="aisle-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="topbar__link aisle-menu__trigger"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        Shop by aisle
        <svg
          className="aisle-menu__chev"
          viewBox="0 0 12 12"
          width="11"
          height="11"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5 L6 8 L9.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <ul
        id={menuId}
        className="aisle-menu__list"
        hidden={!open}
        onMouseLeave={clearPreview}
      >
        <li className="aisle-menu__hint" aria-hidden="true">
          Hover an aisle — the whole page changes colour.
        </li>
        {AISLES.map((aisle, i) => (
          <li key={aisle.key}>
            <Link
              href="/#aisles"
              ref={(node) => {
                itemRefs.current[i] = node;
              }}
              className="aisle-menu__item"
              onMouseEnter={() => preview(aisle.key)}
              onFocus={() => preview(aisle.key)}
              onKeyDown={(e) => onItemKeyDown(e, i)}
              onClick={() => commit(aisle.key)}
            >
              <span
                className="aisle-menu__swatch"
                style={{ background: aisle.swatch }}
                aria-hidden="true"
              />
              <span className="aisle-menu__name">{aisle.name}</span>
              <span className="aisle-menu__hindi mono" aria-hidden="true">
                {aisle.hindi}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TopBar() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { setAisle } = useAisle();

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 12);

      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0);
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <header className="topbar" data-scrolled={scrolled ? 'true' : 'false'}>
      {/* reading progress - a hairline of aisle colour, not a loading bar */}
      <div
        className="topbar__progress"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />

      <div className="topbar__inner shell">
        <Wordmark />

        <nav className="topbar__nav" aria-label="Main">
          <Link className="topbar__link" href={NAV[0]?.href ?? '/'}>
            {NAV[0]?.label}
          </Link>
          <Link className="topbar__link" href="/#how-it-works">
            How it works
          </Link>
          <AisleMenu />
          <Link className="topbar__link" href="/#vendors">
            For Vendors
          </Link>
          <Link className="topbar__link" href="/#riders">
            For Riders
          </Link>
        </nav>

        <div className="topbar__actions">
          <ThemeToggle />
          <Link className="topbar__link topbar__link--login" href="/login">
            Log in
          </Link>
          {/* Styled as a button, but it IS a link - a <button> nested inside an
              <a> is invalid HTML and breaks keyboard and AT behaviour. */}
          <Link href="/signup" className="mnd-btn mnd-btn--solid mnd-btn--sm topbar__cta">
            Get started
          </Link>

          <button
            type="button"
            className="topbar__burger"
            aria-expanded={drawerOpen}
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <Sheet
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Menu"
        side="right"
        footer={
          <div className="drawer__foot">
            <Link
              href="/login"
              className="mnd-btn mnd-btn--outline mnd-btn--md mnd-btn--block"
              onClick={() => setDrawerOpen(false)}
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="mnd-btn mnd-btn--solid mnd-btn--md mnd-btn--block"
              onClick={() => setDrawerOpen(false)}
            >
              Get started
            </Link>
          </div>
        }
      >
        <nav className="drawer__nav" aria-label="Mobile">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="drawer__link"
              onClick={() => setDrawerOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="eyebrow drawer__heading">Shop by aisle</p>
        <ul className="drawer__aisles">
          {AISLES.map((aisle) => (
            <li key={aisle.key}>
              <Link
                href="/#aisles"
                className="drawer__aisle"
                onClick={() => {
                  setAisle(aisle.key);
                  setDrawerOpen(false);
                }}
              >
                <span
                  className="aisle-menu__swatch"
                  style={{ background: aisle.swatch }}
                  aria-hidden="true"
                />
                <span>{aisle.name}</span>
                <span className="drawer__aisle-hi mono" aria-hidden="true">
                  {aisle.hindi}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </header>
  );
}
