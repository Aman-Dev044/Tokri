'use client';

/**
 * The vendor shell: rail, top bar, store switch, new-order alert — and the gate
 * in front of all of it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ★ THE ROLE GATE BELOW IS UX. NOT SECURITY. ★                             │
 * │                                                                          │
 * │ It reads the session resolved by <VendorSessionProvider> and decides what │
 * │ to RENDER. It stops a customer who followed a link from watching a board  │
 * │ mount and then explode on its first 403. That is all it does.             │
 * │                                                                          │
 * │ The real enforcement is the API guard chain (plan §4.2), which runs on    │
 * │ every request regardless of what this file decided:                       │
 * │   ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →         │
 * │   ValidationPipe → ResourceOwnerGuard                                     │
 * │                                                                          │
 * │ ★ VendorScopeGuard is the one that matters on this surface: it pins every │
 * │   query to the caller's OWN vendorId server-side, which is what makes     │
 * │   multi-vendor isolation real (plan §8.1). Anyone can skip this component │
 * │   entirely with one curl command; every `/vendor/*` endpoint must be safe │
 * │   against that on its own.                                                │
 * │                                                                          │
 * │ NEVER move an authorisation decision into this file.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── KEYBOARD-FIRST (plan §2.4) ──────────────────────────────────────────────
 * Single-letter jumps: d, o, p, i, r, e, s. No modifier, because a shop owner
 * with one hand on a crate is not pressing Ctrl+Shift+anything. Suppressed
 * while a field has focus, so typing "spinach" into the product search does not
 * navigate seven times.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '@mandi/design-system';
import { useAuth } from '@/components/auth/AuthProvider';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import { VENDOR_NAV, isActiveHref, type VendorNavIcon } from '@/lib/vendor/nav';
import { primeAudio } from '@/lib/vendor/alert';
import { useVendorSession } from '@/lib/vendor/session';
import type { VendorProfile } from '@/lib/vendor/types';
import {
  IconAlert,
  IconCatalog,
  IconChevronLeft,
  IconClose,
  IconExternal,
  IconLock,
  IconMoon,
  IconOrders,
  IconOverview,
  IconRiders,
  IconSettings,
  IconSettlements,
  IconSignOut,
  IconStock,
  IconSun,
  IconUser,
} from '@/components/admin';
import { useVendorAlerts } from './VendorAlertProvider';

const COLLAPSE_KEY = 'mandi.vendor.railCollapsed';

const NAV_ICON: Record<VendorNavIcon, (props: { className?: string }) => ReactNode> = {
  dashboard: IconOverview,
  orders: IconOrders,
  products: IconCatalog,
  inventory: IconStock,
  partners: IconRiders,
  earnings: IconSettlements,
  settings: IconSettings,
};

export function VendorShell({ children }: { children: ReactNode }) {
  const session = useVendorSession();
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);

  /* ---- rail collapse, persisted ----------------------------------- */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* private window / blocked storage — the rail just starts expanded */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* a preference that does not survive a reload is not an error */
      }
      return next;
    });
  }, []);

  /* ---- single-letter navigation ----------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const item = VENDOR_NAV.find((candidate) => candidate.key === event.key.toLowerCase());
      if (!item) return;
      event.preventDefault();
      router.push(item.href);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  /* ---- gates ------------------------------------------------------- */

  if (session.status === 'checking') {
    return (
      <div className="adm ven ven-gate">
        <div className="ven-gate__card" aria-busy="true">
          <p className="ven-gate__title">Checking your session…</p>
          <p className="ven-gate__body">Exchanging the refresh cookie for an access token.</p>
        </div>
      </div>
    );
  }

  if (session.status === 'forbidden') {
    return (
      <div className="adm ven ven-gate">
        <div className="ven-gate__card">
          <p className="ven-gate__title">
            <IconLock style={{ width: 20, height: 20, verticalAlign: '-3px', marginRight: 8 }} />
            Not authorised
          </p>
          <p className="ven-gate__body">
            You are signed in as <strong>{session.apiRole ?? 'another role'}</strong>. The store
            panel is for shop owners. If you run a shop on Mandi and are seeing this, your account
            has not been linked to a store yet — ask an admin to check it.
          </p>
          <div className="adm-row">
            <Link className="adm-btn adm-btn--primary" href="/">
              Back to Mandi
            </Link>
            <Link className="adm-btn" href="/login">
              Sign in as someone else
            </Link>
          </div>
          <p className="ven-gate__note">
            This screen is a courtesy, not a lock. Every <code>/vendor/*</code> endpoint enforces
            the role and the store scope itself, server-side, on every request.
          </p>
        </div>
      </div>
    );
  }

  const preview = session.status === 'anonymous';

  return (
    <div className="adm ven ven-shell" data-collapsed={collapsed ? 'true' : 'false'}>
      <VendorRail collapsed={collapsed} pathname={pathname} onToggle={toggleCollapsed} />

      <div className="ven-main">
        <VendorTopBar preview={preview} name={session.name} contact={session.contact} />
        <main className="ven-content" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Rail                                                                */
/* ================================================================== */

function VendorRail({
  collapsed,
  pathname,
  onToggle,
}: {
  collapsed: boolean;
  pathname: string;
  onToggle: () => void;
}) {
  const { pendingCount } = useVendorAlerts();
  const profile = useVendorQuery<VendorProfile>('/vendor/profile');
  const storeName = profile.data?.storeName ?? 'Your store';

  return (
    <nav className="ven-rail" aria-label="Store sections">
      <Link className="ven-rail__brand" href="/vendor">
        <svg className="ven-rail__mark" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M3 9h18l-1.6 10.2A2 2 0 0 1 17.4 21H6.6a2 2 0 0 1-2-1.8L3 9Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M8 9V6.5a4 4 0 0 1 8 0V9" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="ven-rail__store">
          <span className="ven-rail__name">{storeName}</span>
          <span className="ven-rail__role">Store panel</span>
        </span>
      </Link>

      {VENDOR_NAV.map((item) => {
        const Icon = NAV_ICON[item.icon];
        const active = isActiveHref(pathname, item.href);
        const badge = item.href === '/vendor/orders' && pendingCount > 0 ? pendingCount : null;

        return (
          <Link
            key={item.href}
            className="ven-rail__link"
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
          >
            <Icon />
            <span className="ven-rail__label">{item.label}</span>
            {badge === null ? (
              <kbd className="ven-key" aria-hidden="true">
                {item.key}
              </kbd>
            ) : (
              <span className="ven-rail__count">
                {badge}
                <span className="adm-sr"> orders waiting to be accepted</span>
              </span>
            )}
          </Link>
        );
      })}

      <div className="ven-rail__foot">
        <button type="button" className="ven-rail__collapse" onClick={onToggle}>
          <IconChevronLeft />
          <span className="ven-rail__label">{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
    </nav>
  );
}

/* ================================================================== */
/* Top bar                                                             */
/* ================================================================== */

function VendorTopBar({
  preview,
  name,
  contact,
}: {
  preview: boolean;
  name: string;
  contact: string;
}) {
  return (
    <header className="ven-top">
      <StoreOpenToggle />
      <span className="ven-top__spacer" />
      {preview ? (
        <span className="adm-pill" data-tone="warn" title="No session — the API is not reachable">
          <span className="adm-pill__glyph" aria-hidden="true" />
          Preview
        </span>
      ) : null}
      <NewOrderAlert />
      <SoundToggle />
      <ThemeToggle />
      <UserMenu name={name} contact={contact} />
    </header>
  );
}

/* ---- ★ the store open / closed switch ---------------------------- */

/**
 * The single most consequential control in the panel.
 *
 * It states what the shop IS, in a word, on every screen — because a shop that
 * believes it is open while it is closed loses an evening of orders and nobody
 * finds out until a customer phones.
 *
 * ── WHY IT IS NOT OPTIMISTIC ────────────────────────────────────────────────
 * The label flips only after `PATCH /vendor/store/status` succeeds. An
 * optimistic flip here would show OPEN over a failed request, which is exactly
 * the lie this control exists to prevent. While the write is in flight the
 * button is disabled and says so.
 */
function StoreOpenToggle() {
  const profile = useVendorQuery<VendorProfile>('/vendor/profile');
  const [failed, setFailed] = useState(false);
  const toggle = useVendorMutation<{ isOpen: boolean }, { isOpen: boolean }>(
    '/vendor/store/status',
    'PATCH',
  );

  const isOpen = profile.data?.isOpen ?? false;
  const unknown = profile.data === null;

  const onClick = () => {
    setFailed(false);
    void toggle.mutate(
      { isOpen: !isOpen },
      {
        invalidate: ['/vendor/profile'],
        onError: () => setFailed(true),
      },
    );
  };

  if (unknown) {
    return (
      <span className="ven-openstate" aria-busy="true">
        <span className="ven-openstate__dot" />
        <span className="ven-openstate__word">Store…</span>
      </span>
    );
  }

  return (
    <div className="adm-row" style={{ gap: 'var(--s-2)' }}>
      <button
        type="button"
        className="ven-openstate"
        data-open={isOpen ? 'true' : 'false'}
        onClick={onClick}
        disabled={toggle.loading}
        aria-pressed={isOpen}
      >
        <span className="ven-openstate__dot" aria-hidden="true" />
        <span className="ven-openstate__word">{isOpen ? 'Open' : 'Closed'}</span>
        <span className="ven-openstate__hint">
          {toggle.loading ? 'saving…' : isOpen ? 'tap to close' : 'tap to open'}
        </span>
      </button>
      {failed ? (
        <span className="adm-pill" data-tone="crit" role="status">
          <span className="adm-pill__glyph" aria-hidden="true" />
          Not saved — {toggle.error?.friendlyMessage ?? 'the API did not respond'}
        </span>
      ) : null}
      {profile.isFixture ? (
        <span className="adm-pill" data-tone="warn" title="Sample data — the API is not reachable">
          <span className="adm-pill__glyph" aria-hidden="true" />
          Sample
        </span>
      ) : null}
    </div>
  );
}

/* ---- ★ the new-order alert --------------------------------------- */

/**
 * Visual half of the alert. Pulses ONCE on arrival and then holds — a banner
 * that pulses forever is filtered out by the eye inside five minutes, and an
 * alert nobody sees is not an alert.
 */
function NewOrderAlert() {
  const { pendingCount, freshIds, acknowledge, soundOn, soundBlocked } = useVendorAlerts();

  if (pendingCount === 0) return null;

  const fresh = freshIds.size;

  return (
    <Link
      className="ven-alert"
      href="/vendor/orders"
      onClick={acknowledge}
      key={fresh > 0 ? `fresh-${fresh}` : 'held'}
      role="status"
    >
      <IconAlert />
      <span className="ven-alert__count">{pendingCount}</span>
      <span>
        {pendingCount === 1 ? 'order waiting' : 'orders waiting'}
        {fresh > 0 ? ` · ${fresh} new` : null}
      </span>
      {soundOn && soundBlocked ? (
        <span className="adm-sr">
          Sound is on but this browser blocked it until you interact with the page.
        </span>
      ) : null}
      <button
        type="button"
        className="ven-alert__dismiss"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          acknowledge();
        }}
      >
        <IconClose />
        <span className="adm-sr">Dismiss the new-order highlight</span>
      </button>
    </Link>
  );
}

/**
 * The audible half, opt-in and remembered.
 *
 * Off by default, and that is not laziness: browsers refuse audio until the
 * user has interacted with the page, so a sound-on default would fail silently
 * on a tab nobody has clicked — leaving a vendor believing they will be alerted
 * when they will not. Switching it on IS the gesture that unlocks audio, and it
 * plays the chime immediately as proof.
 */
function SoundToggle() {
  const { soundOn, toggleSound, soundBlocked } = useVendorAlerts();

  return (
    <button
      type="button"
      className="adm-iconbtn ven-soundbtn"
      data-on={soundOn ? 'true' : 'false'}
      onClick={() => {
        primeAudio();
        toggleSound();
      }}
      title={
        soundBlocked
          ? 'Sound is on, but this browser is blocking it. Click anywhere on the page once.'
          : soundOn
            ? 'New-order sound is ON. Click to mute.'
            : 'New-order sound is OFF. Click to turn it on.'
      }
      aria-pressed={soundOn}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" strokeLinejoin="round" />
        {soundOn ? (
          <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" strokeLinecap="round" />
        ) : (
          <path d="m16 10 4 4m0-4-4 4" strokeLinecap="round" />
        )}
      </svg>
      <span className="adm-sr">
        {soundOn ? 'New-order sound is on. Activate to mute.' : 'New-order sound is off. Activate to turn on.'}
      </span>
    </button>
  );
}

function ThemeToggle() {
  const { theme, cycleTheme, resolved } = useTheme();
  const label = theme === 'system' ? 'Theme: follows your system' : `Theme: ${theme}`;

  return (
    <button type="button" className="adm-iconbtn" onClick={cycleTheme} title={label}>
      {/* `resolved` is null until the client effect runs; rendering the sun
          until then keeps the server and client markup identical. */}
      {resolved === 'dark' ? <IconMoon /> : <IconSun />}
      <span className="adm-sr">{label}. Activate to change.</span>
    </button>
  );
}

/* ---- user menu --------------------------------------------------- */

function UserMenu({ name, contact }: { name: string; contact: string }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'ME';
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase() || 'ME';
  }, [name]);

  return (
    <div className="ven-usermenu" ref={ref}>
      <button
        type="button"
        className="adm-user"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="adm-user__initials">{initials}</span>
        <span className="adm-user__name">{name || 'Signed out'}</span>
      </button>

      {open ? (
        <div className="ven-usermenu__panel" role="menu">
          <div className="ven-usermenu__head">
            <strong>{name || 'No session'}</strong>
            <p className="ven-usermenu__contact">{contact || 'Not signed in'}</p>
          </div>

          <Link className="ven-usermenu__item" href="/vendor/settings" role="menuitem">
            <IconSettings />
            Store settings
          </Link>
          <Link className="ven-usermenu__item" href="/" role="menuitem">
            <IconExternal />
            Open the storefront
          </Link>
          <button
            type="button"
            className="ven-usermenu__item"
            role="menuitem"
            onClick={() => {
              void logout();
            }}
          >
            <IconSignOut />
            Sign out
          </button>
          <p className="ven-usermenu__contact" style={{ padding: 'var(--s-2)' }}>
            <IconUser style={{ width: 12, height: 12, verticalAlign: '-2px' }} /> Signing out
            revokes the whole refresh-token family server-side.
          </p>
        </div>
      ) : null}
    </div>
  );
}
