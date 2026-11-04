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
 * ── PERMISSIONS ARE UX HERE TOO ─────────────────────────────────────────────
 * The rail, the shortcuts and the screen gate below draw only what
 * `/vendor/me` says the signed-in person may do. A staff member who types a
 * hidden URL gets a polite card here — and a 403 from the API on every call
 * the screen would have made, which is the part that actually matters.
 *
 * ── KEYBOARD-FIRST (plan §2.4) ──────────────────────────────────────────────
 * Single-letter jumps: d, o, b, p, i, r, e, t, s. No modifier, because a shop owner
 * with one hand on a crate is not pressing Ctrl+Shift+anything. Suppressed
 * while a field has focus, so typing "spinach" into the product search does not
 * navigate seven times.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '@mandi/design-system';
import { useAuth } from '@/components/auth/AuthProvider';
import { APP_NAME } from '@/config/brand';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import { isActiveHref, navFor, navItemFor, type VendorNavIcon } from '@/lib/vendor/nav';
import { primeAudio } from '@/lib/vendor/alert';
import { useVendorSession } from '@/lib/vendor/session';
import type { VendorProfile, VendorStoreStatus } from '@/lib/vendor/types';
import {
  IconAlert,
  IconBilling,
  IconChevronLeft,
  IconClose,
  IconDashboard,
  IconEarnings,
  IconExternal,
  IconLock,
  IconMoon,
  IconOrders,
  IconProducts,
  IconRiders,
  IconSettings,
  IconSignOut,
  IconSoundOff,
  IconSoundOn,
  IconStaff,
  IconStock,
  IconSun,
  IconUser,
} from './icons';
import { Pill } from './primitives';
import { useVendorAlerts } from './VendorAlertProvider';

const COLLAPSE_KEY = 'mandi.vendor.railCollapsed';

const NAV_ICON: Record<VendorNavIcon, (props: { className?: string }) => ReactNode> = {
  dashboard: IconDashboard,
  orders: IconOrders,
  products: IconProducts,
  inventory: IconStock,
  partners: IconRiders,
  earnings: IconEarnings,
  billing: IconBilling,
  staff: IconStaff,
  settings: IconSettings,
};

export function VendorShell({ children }: { children: ReactNode }) {
  const session = useVendorSession();
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);

  // What this person may open. Recomputed when the session settles.
  const allowedNav = useMemo(() => navFor(session.can), [session.can]);
  const currentItem = navItemFor(pathname);
  const screenAllowed = currentItem === null || session.can(currentItem.permission);
  const panelReady = session.status === 'ready' || session.status === 'anonymous';

  /* ---- land somewhere useful ----------------------------------------
   * A biller has no orders.view, so the dashboard is not theirs. Rather
   * than greet them with "not allowed" on the page login sent them to,
   * the home route forwards to the first screen they CAN use. */
  useEffect(() => {
    if (!panelReady || screenAllowed) return;
    if (pathname !== '/vendor' && pathname !== '/vendor/') return;
    const first = allowedNav[0];
    if (first) router.replace(first.href);
  }, [panelReady, screenAllowed, pathname, allowedNav, router]);

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

      const item = allowedNav.find((candidate) => candidate.key === event.key.toLowerCase());
      if (!item) return;
      event.preventDefault();
      router.push(item.href);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router, allowedNav]);

  /* ---- gates ------------------------------------------------------- */

  if (session.status === 'checking') {
    return (
      <div className="ven ven-gate">
        <div className="ven-gate__card" aria-busy="true">
          <p className="ven-gate__title">Checking your session…</p>
          <p className="ven-gate__body">Exchanging the refresh cookie for an access token.</p>
        </div>
      </div>
    );
  }

  if (session.status === 'forbidden') {
    return (
      <div className="ven ven-gate">
        <div className="ven-gate__card">
          <p className="ven-gate__title">
            <IconLock style={{ width: 20, height: 20, verticalAlign: '-3px', marginRight: 8 }} />
            Not authorised
          </p>
          <p className="ven-gate__body">
            You are signed in as <strong>{session.apiRole ?? 'another role'}</strong>. The store
            panel is for shop owners. If you run a shop on {APP_NAME} and are seeing this, your
            account has not been linked to a store yet — ask an admin to check it.
          </p>
          <div className="ven-row">
            <Link className="ven-btn" data-variant="primary" data-size="md" href="/">
              Back to {APP_NAME}
            </Link>
            <Link className="ven-btn" data-variant="plain" data-size="md" href="/login">
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
    <div className="ven ven-shell" data-collapsed={collapsed ? 'true' : 'false'}>
      <VendorRail collapsed={collapsed} pathname={pathname} onToggle={toggleCollapsed} />

      <div className="ven-main">
        <VendorTopBar
          preview={preview}
          name={session.name}
          contact={session.contact}
          apiRole={session.apiRole}
        />
        <main className="ven-content" id="main">
          {screenAllowed ? (
            children
          ) : (
            <div className="ven-gate__card ven-gate__card--inline">
              <p className="ven-gate__title">
                <IconLock style={{ width: 20, height: 20, verticalAlign: '-3px', marginRight: 8 }} />
                Not part of your role
              </p>
              <p className="ven-gate__body">
                {currentItem?.label ?? 'This screen'} needs the{' '}
                <code>{currentItem?.permission}</code> permission, which your account does not
                have. Ask the store owner or a manager if you need it.
              </p>
              {allowedNav[0] ? (
                <Link
                  className="ven-btn"
                  data-variant="primary"
                  data-size="md"
                  href={allowedNav[0].href}
                >
                  Go to {allowedNav[0].label}
                </Link>
              ) : null}
            </div>
          )}
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
  const session = useVendorSession();
  const items = useMemo(() => navFor(session.can), [session.can]);
  // `/vendor/me` carries the store name for everyone; the profile (which
  // needs store.manage) is only the offline preview's source.
  const profile = useVendorQuery<VendorProfile>('/vendor/profile', undefined, {
    enabled: session.storeName === null && session.can('store.manage'),
  });
  const storeName = session.storeName ?? profile.data?.storeName ?? 'Your store';

  return (
    <nav className="ven-rail" aria-label="Store sections">
      <Link className="ven-rail__brand" href="/vendor">
        <svg className="ven-rail__mark" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M3 9h18l-1.6 10.2A2 2 0 0 1 17.4 21H6.6a2 2 0 0 1-2-1.8L3 9Z"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path d="M8 9V6.5a4 4 0 0 1 8 0V9" stroke="currentColor" strokeWidth="1.75" />
        </svg>
        <span className="ven-rail__store">
          <span className="ven-rail__name">{storeName}</span>
          <span className="ven-rail__role">
            {session.roleLabel ? `Store panel · ${session.roleLabel}` : 'Store panel'}
          </span>
        </span>
      </Link>

      {items.map((item) => {
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
                <span className="ven-sr"> orders waiting to be accepted</span>
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
  apiRole,
}: {
  preview: boolean;
  name: string;
  contact: string;
  apiRole: string | null;
}) {
  const session = useVendorSession();

  return (
    <header className="ven-top">
      {session.can('store.manage') ? (
        <StoreOpenToggle />
      ) : session.storeOpen !== null ? (
        // Staff without store.manage see the shutter state, not the switch.
        <span className="ven-openstate" data-open={session.storeOpen ? 'true' : 'false'}>
          <span className="ven-openstate__dot" aria-hidden="true" />
          <span className="ven-openstate__word">{session.storeOpen ? 'Open' : 'Closed'}</span>
        </span>
      ) : null}
      <span className="ven-top__spacer" />
      {session.roleLabel ? (
        <span className="ven-top__who" title={contact || undefined}>
          <span className="ven-top__whoname">{name}</span>
          <Pill tone={session.isOwner ? 'good' : 'info'}>{session.roleLabel}</Pill>
          {session.shiftLabel ? <span className="ven-dim">{session.shiftLabel}</span> : null}
        </span>
      ) : null}
      {preview ? (
        <Pill tone="warn" title="No session — the API is not reachable">
          Preview
        </Pill>
      ) : null}
      <NewOrderAlert />
      <SoundToggle />
      <ThemeToggle />
      <UserMenu name={name} contact={contact} apiRole={apiRole} />
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
  // The reply is the full `StoreStatus` — id, isOpen, status, updatedAt.
  const toggle = useVendorMutation<{ isOpen: boolean }, VendorStoreStatus>(
    '/vendor/store/status',
    'PATCH',
  );

  const isOpen = profile.data?.isOpen ?? false;
  const unknown = profile.data === null;
  // Only an APPROVED store may open — the API answers 400 otherwise, and a
  // button that is guaranteed to fail is worse than one that explains itself.
  const approved = profile.data?.status === 'approved';

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
    <div className="ven-row">
      <button
        type="button"
        className="ven-openstate"
        data-open={isOpen ? 'true' : 'false'}
        onClick={onClick}
        disabled={toggle.loading || (!isOpen && !approved)}
        aria-pressed={isOpen}
        title={
          !isOpen && !approved
            ? `This store is ${profile.data?.status ?? 'not approved'} — only an approved store can open.`
            : undefined
        }
      >
        <span className="ven-openstate__dot" aria-hidden="true" />
        <span className="ven-openstate__word">{isOpen ? 'Open' : 'Closed'}</span>
        <span className="ven-openstate__hint">
          {toggle.loading
            ? 'saving…'
            : !isOpen && !approved
              ? `${profile.data?.status ?? 'not approved'} — an admin must approve you`
              : isOpen
                ? 'tap to close'
                : 'tap to open'}
        </span>
      </button>
      {failed ? (
        <Pill tone="crit">
          Not saved — {toggle.error?.friendlyMessage ?? 'the API did not respond'}
        </Pill>
      ) : null}
      {profile.isFixture ? (
        <Pill tone="warn" title="Sample data — the API is not reachable">
          Sample
        </Pill>
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
        <span className="ven-sr">
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
        <span className="ven-sr">Dismiss the new-order highlight</span>
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
      className="ven-iconbtn ven-soundbtn"
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
      {soundOn ? <IconSoundOn /> : <IconSoundOff />}
      <span className="ven-sr">
        {soundOn ? 'New-order sound is on. Activate to mute.' : 'New-order sound is off. Activate to turn on.'}
      </span>
    </button>
  );
}

function ThemeToggle() {
  const { theme, cycleTheme, resolved } = useTheme();
  const label = theme === 'system' ? 'Theme: follows your system' : `Theme: ${theme}`;

  return (
    <button type="button" className="ven-iconbtn" onClick={cycleTheme} title={label}>
      {/* `resolved` is null until the client effect runs; rendering the sun
          until then keeps the server and client markup identical. */}
      {resolved === 'dark' ? <IconMoon /> : <IconSun />}
      <span className="ven-sr">{label}. Activate to change.</span>
    </button>
  );
}

/* ---- user menu --------------------------------------------------- */

/**
 * ★ WHO IS SIGNED IN, AND THE WAY OUT.
 *
 * Name, contact and the role the API itself reported — not a role this
 * component assumed from the fact that it is rendering inside `/vendor`. If
 * the pill ever says something other than VENDOR, the session and the surface
 * disagree and the person looking at it needs to know that.
 *
 * ── SIGNING OUT ─────────────────────────────────────────────────────────────
 * `logout()` POSTs `/auth/logout` (which revokes the whole refresh-token
 * family server-side) and clears the in-memory access token in its `finally`,
 * so a failed request still ends the client session. This component then
 * navigates to `/login` with `replace`, not `push`: the back button must not
 * return a signed-out person to a dashboard shell that will immediately start
 * firing 401s.
 *
 * `router.refresh()` afterwards drops the cached Server Component payload for
 * the vendor layout, so nothing of the previous session survives in the RSC
 * cache.
 */
function UserMenu({
  name,
  contact,
  apiRole,
}: {
  name: string;
  contact: string;
  apiRole: string | null;
}) {
  const { logout } = useAuth();
  const router = useRouter();
  const canManageStore = useVendorSession().can('store.manage');
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
        className="ven-user"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="ven-user__initials">{initials}</span>
        <span className="ven-user__name">{name || 'Signed out'}</span>
      </button>

      {open ? (
        <div className="ven-usermenu__panel" role="menu">
          <div className="ven-usermenu__head">
            <strong>{name || 'No session'}</strong>
            <p className="ven-usermenu__contact">{contact || 'Not signed in'}</p>
            <div style={{ marginTop: 'var(--s-1)' }}>
              <Pill tone={apiRole === 'vendor' || apiRole === 'staff' ? 'good' : 'warn'}>
                {(apiRole ?? 'no role').toUpperCase()}
              </Pill>
            </div>
          </div>

          {canManageStore ? (
            <Link className="ven-usermenu__item" href="/vendor/settings" role="menuitem">
              <IconSettings />
              Store settings
            </Link>
          ) : null}
          <Link className="ven-usermenu__item" href="/" role="menuitem">
            <IconExternal />
            Open the storefront
          </Link>
          <button
            type="button"
            className="ven-usermenu__item"
            role="menuitem"
            disabled={signingOut}
            onClick={() => {
              void (async () => {
                setSigningOut(true);
                // `logout` clears the in-memory token in its own `finally`, so
                // this resolves even when the network call fails — and the
                // redirect must happen either way.
                await logout();
                setOpen(false);
                router.replace('/login');
                router.refresh();
              })();
            }}
          >
            <IconSignOut />
            {signingOut ? 'Signing out…' : 'Sign out'}
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
