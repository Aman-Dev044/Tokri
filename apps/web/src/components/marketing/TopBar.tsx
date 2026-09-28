'use client';

/**
 * The top bar. Sticky, translucent, with a hairline of the live aisle across
 * the bottom edge that tracks reading progress.
 *
 * The "Shop by aisle" menu is the first place a visitor meets the retinting:
 * hovering — or arrow-keying to — an aisle previews that hue across the WHOLE
 * page, and leaving puts it back. It is a menu that demonstrates the product.
 *
 * Accessibility:
 *  · the aisle menu is a disclosure — a real <button> with aria-expanded and
 *    aria-controls over a real list of real links
 *  · arrow keys walk it, Home/End jump, Escape closes and returns focus
 *  · the mobile drawer traps Tab, locks body scroll, closes on Escape and
 *    returns focus to the burger that opened it
 *  · every control keeps its focus ring
 *
 * TODO(phase-1): aisle links point at landing-page anchors because the (shop)
 * surface is being built in parallel. When /aisle/[aisleKey] ships, swap the
 * href — that route stamps data-aisle itself and the preview here becomes a
 * progressive nicety rather than the mechanism.
 */

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { AISLES, useAisle, useTheme } from '@mandi/design-system';
import type { AisleKey } from '@mandi/design-system';
import { APP_NAME } from '@/config/brand';

const NAV: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'For vendors', href: '/#vendors' },
  { label: 'For riders', href: '/#riders' },
];

/** The swatch hue, as a token reference — never the literal from the data. */
function swatchVar(key: AisleKey): CSSProperties {
  return { ['--sw' as string]: `var(--aisle-${key})` };
}

function BasketMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M5 12h22l-3 14q-.6 2-2.5 2h-11Q8.6 28 8 26Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M5 12h22l-3 14q-.6 2-2.5 2h-11Q8.6 28 8 26Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M11 12q5-10 10 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="19.5" r="3.2" fill="currentColor" />
    </svg>
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
      className="mk-icon-btn"
      onClick={cycleTheme}
      aria-label={`${label}. Activate to change.`}
      title={label}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M10 1.5v2.2M10 16.3v2.2M18.5 10h-2.2M3.7 10H1.5M16 4l-1.6 1.6M5.6 14.4 4 16M16 16l-1.6-1.6M5.6 5.6 4 4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/* ── the aisle disclosure ─────────────────────────────────────────────────── */

function AisleMenu() {
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
    itemRefs.current[wrapped]?.focus();
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

  return (
    <div className="mk-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="mk-nav__link"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        Shop by aisle
        <svg
          className="mk-menu__chev"
          viewBox="0 0 12 12"
          width="11"
          height="11"
          aria-hidden="true"
        >
          <path
            d="m2.5 4.5 3.5 3.5 3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <ul id={menuId} className="mk-menu__panel" hidden={!open} onMouseLeave={clearPreview}>
        <li className="mk-menu__hint" aria-hidden="true">
          Hover one — the whole page changes colour
        </li>
        {AISLES.map((aisle, i) => (
          <li key={aisle.key}>
            <Link
              href="/#aisles"
              ref={(node) => {
                itemRefs.current[i] = node;
              }}
              className="mk-menu__item"
              onMouseEnter={() => preview(aisle.key)}
              onFocus={() => preview(aisle.key)}
              onKeyDown={(e) => onItemKeyDown(e, i)}
              onClick={() => {
                setAisle(aisle.key);
                setOpen(false);
              }}
            >
              <span className="mk-swatch" style={swatchVar(aisle.key)} aria-hidden="true" />
              <span>{aisle.name}</span>
              <span aria-hidden="true">{aisle.hindi}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── the mobile drawer ────────────────────────────────────────────────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Drawer({ onClose }: { onClose: () => void }) {
  const { setAisle } = useAisle();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Body scroll lock: a drawer that lets the page behind it scroll is the
    // classic mobile bug where closing it dumps you somewhere else entirely.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="mk-drawer">
      <button
        type="button"
        className="mk-drawer__scrim"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="mk-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
      >
        <div className="mk-drawer__head">
          <p className="mk-drawer__title">Menu</p>
          <button type="button" className="mk-icon-btn" onClick={onClose} aria-label="Close menu">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="m5 5 10 10M15 5 5 15"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="mk-drawer__nav" aria-label="Mobile">
          <Link href="/#top" className="mk-drawer__link" onClick={onClose}>
            Home
          </Link>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="mk-drawer__link" onClick={onClose}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div>
          <p className="mk-drawer__label">Shop by aisle</p>
          <ul className="mk-drawer__aisles" style={{ marginTop: 'var(--s-3)' }}>
            {AISLES.map((aisle) => (
              <li key={aisle.key}>
                <Link
                  href="/#aisles"
                  className="mk-drawer__aisle"
                  onClick={() => {
                    setAisle(aisle.key);
                    onClose();
                  }}
                >
                  <span className="mk-swatch" style={swatchVar(aisle.key)} aria-hidden="true" />
                  {aisle.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="mk-drawer__foot">
          <Link href="/login" className="mk-btn mk-btn--quiet mk-btn--block" onClick={onClose}>
            Log in
          </Link>
          <Link href="/signup" className="mk-btn mk-btn--solid mk-btn--block" onClick={onClose}>
            Get started
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── the bar ──────────────────────────────────────────────────────────────── */

export function TopBar() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 12);
      const max = document.documentElement.scrollHeight - window.innerHeight;
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

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <header className="mk-top" data-scrolled={scrolled ? 'true' : 'false'}>
      <div
        className="mk-top__progress"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />

      <div className="mk-top__inner mk-shell">
        <Link href="/#top" className="mk-brand" aria-label={`${APP_NAME}, home`}>
          <span className="mk-brand__mark">
            <BasketMark />
          </span>
          <span className="mk-brand__word">
            <b>{APP_NAME}</b>
            <span aria-hidden="true">मंडी</span>
          </span>
        </Link>

        <nav className="mk-nav" aria-label="Main">
          <Link className="mk-nav__link" href="/#how-it-works">
            How it works
          </Link>
          <AisleMenu />
          <Link className="mk-nav__link" href="/#vendors">
            For vendors
          </Link>
          <Link className="mk-nav__link" href="/#riders">
            For riders
          </Link>
        </nav>

        <div className="mk-top__acts">
          <ThemeToggle />
          <Link className="mk-top__login" href="/login">
            Log in
          </Link>
          {/* Styled as a button but it IS a link — a <button> inside an <a> is
              invalid HTML and breaks keyboard and assistive-tech behaviour. */}
          <Link href="/signup" className="mk-btn mk-btn--solid mk-btn--sm">
            Get started
          </Link>

          <button
            type="button"
            className="mk-icon-btn mk-burger"
            aria-expanded={drawerOpen}
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {drawerOpen ? <Drawer onClose={closeDrawer} /> : null}
    </header>
  );
}
