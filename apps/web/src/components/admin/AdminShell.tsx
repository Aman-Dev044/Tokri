'use client';

/**
 * The admin shell: rail, top bar, and the gate in front of both.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ★ THE ROLE GATE AND THE ROLE-AWARE MENU BELOW ARE UX. NOT SECURITY. ★    │
 * │                                                                          │
 * │ They read the session resolved by <AdminRoleProvider> and decide what to │
 * │ RENDER. They stop a customer who followed a link from watching a         │
 * │ dashboard mount and then explode on its first 403, and they keep a plain │
 * │ ADMIN from being offered buttons that will 403. That is all they do.     │
 * │                                                                          │
 * │ The real enforcement is the API guard chain (plan §4.2), which runs on   │
 * │ every request regardless of what this file decided:                      │
 * │   ThrottlerGuard → JwtAuthGuard → RolesGuard → VendorScopeGuard →        │
 * │   ValidationPipe → ResourceOwnerGuard                                    │
 * │ Anyone can skip this component entirely with one curl command. Every     │
 * │ `/admin/*` endpoint must be safe against that, on its own.               │
 * │                                                                          │
 * │ NEVER move an authorisation decision into this file, and never let a     │
 * │ hidden nav item stand in for a role check on the server.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── TWO ROLES, ONE ROUTE TREE ───────────────────────────────────────────────
 * A plain ADMIN and a SUPER_ADMIN share every URL under `/admin`. What differs
 * is the menu (13 entries vs 18), the landing page (an ops queue vs the
 * governance overview) and the ⌘K command set. Forking a second route tree
 * would double the maintenance on thirteen screens to express a difference the
 * server already enforces.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@mandi/design-system';
import { useAuth } from '@/components/auth/AuthProvider';
import { opsBadges, useMediaQuery, useOpsSummary } from '@/hooks';
import { useNotifications } from '@/hooks/useNotifications';
import { formatRelative } from '@/lib/admin/format';
import { isActiveHref, isRestrictedHref, navItemFor, visibleNav } from '@/lib/admin/nav';
import { ADMIN_LEVEL_LABEL, ADMIN_LEVEL_PILL, useAdminRole } from '@/lib/admin/session';
import type { AdminLevel } from '@/lib/admin/types';
import { CommandPalette } from './CommandPalette';
import {
  IconBell,
  IconChevronLeft,
  IconClose,
  IconExternal,
  IconLock,
  IconMenu,
  IconMoon,
  IconSearch,
  IconSignOut,
  IconSun,
  NAV_ICONS,
} from './icons';

const COLLAPSE_KEY = 'mandi.admin.railCollapsed';

/**
 * The sidebar badge poll. Slower than the board's 15s: these are counts that
 * change on the scale of minutes, and the rail is on screen for every one of
 * the eighteen sections.
 */
const BADGE_REFRESH_MS = 60_000;

export function AdminShell({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const session = useAdminRole();
  const pathname = usePathname();
  const isDrawer = useMediaQuery('(max-width: 1023px)');

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

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

  /* ---- ⌘K --------------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ---- close transient UI on navigation --------------------------- */

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
    setBellOpen(false);
  }, [pathname]);

  /* ---- live queue counts for the rail ----------------------------- */

  // Skipped entirely until there is a session: with no token this would 401
  // once a minute for nothing.
  const summary = useOpsSummary({
    refreshMs: BADGE_REFRESH_MS,
    enabled: session.status !== 'checking',
  });
  const badges = useMemo(
    () => opsBadges(summary.data, summary.isFixture),
    [summary.data, summary.isFixture],
  );

  /* ---- gates ------------------------------------------------------- */

  if (session.status === 'checking') {
    return (
      <div className="adm adm-gate">
        <div className="adm-gate__card" aria-busy="true">
          <p className="adm-gate__title">Checking your session…</p>
          <p className="adm-gate__body">Exchanging the refresh cookie for an access token.</p>
        </div>
      </div>
    );
  }

  if (session.status === 'forbidden') {
    return (
      <div className="adm adm-gate">
        <div className="adm-gate__card">
          <p className="adm-gate__title">
            <IconLock style={{ width: 20, height: 20, verticalAlign: '-3px', marginRight: 8 }} />
            Not authorised
          </p>
          <p className="adm-gate__body">
            You are signed in as <strong>{session.apiRole ?? 'another role'}</strong>. The admin
            console is for platform administrators. If you believe this is wrong, ask a super admin
            to check your account.
          </p>
          <div className="adm-row">
            <Link className="adm-btn adm-btn--primary" href="/">
              Back to Mandi
            </Link>
            <Link className="adm-btn" href="/login">
              Sign in as someone else
            </Link>
          </div>
          <p className="adm-gate__note">
            This screen is a courtesy, not a lock. Every <code>/admin/*</code> endpoint enforces the
            role itself, server-side, on every request.
          </p>
        </div>
      </div>
    );
  }

  const level: AdminLevel = session.role;
  const preview = session.status === 'anonymous';
  const groups = visibleNav(level);

  /**
   * A plain ADMIN who types `/admin/team` gets a clean explanation instead of a
   * page that assumes a super-admin payload and dies on its first 403.
   *
   * This is a COURTESY. The team endpoints refuse the request either way, and
   * that refusal — not this branch — is what protects the data.
   */
  const restricted = isRestrictedHref(pathname, level);
  const restrictedSection = restricted ? navItemFor(pathname) : null;

  return (
    <div
      className="adm adm-shell"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-drawer={drawerOpen ? 'true' : 'false'}
    >
      {/* ------------------------------------------------ rail ---- */}
      <nav className="adm-rail" aria-label="Admin sections">
        <Link className="adm-rail__brand" href="/admin">
          <svg className="adm-rail__mark" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3.5 9 5 4h14l1.5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M4.5 9v10.5h15V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M9.5 19.5v-5h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="adm-rail__wordmark">Mandi</span>
          <span className="adm-rail__env">{level === 'SUPER_ADMIN' ? 'super' : 'ops'}</span>
        </Link>

        {groups.map((group) => (
          <div className="adm-rail__group" key={group.label}>
            <p className="adm-rail__grouplabel">{group.label}</p>
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActiveHref(item.href, pathname);
              const badge = item.badge === undefined ? undefined : badges[item.badge];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="adm-rail__link"
                  aria-current={active ? 'page' : undefined}
                  title={collapsed && !isDrawer ? item.label : undefined}
                >
                  <Icon className="adm-rail__icon" />
                  <span className="adm-rail__label">{item.label}</span>

                  {badge === undefined ? null : (
                    <span
                      className="adm-rail__badge"
                      data-fixture={badge.isFixture ? 'true' : undefined}
                      title={
                        badge.isFixture
                          ? `${badge.count} waiting — SAMPLE DATA, the API is not reachable`
                          : `${badge.count} waiting`
                      }
                    >
                      {badge.count > 99 ? '99+' : badge.count}
                      <span className="adm-sr">
                        {badge.isFixture
                          ? ` waiting, sample data — not real`
                          : ` waiting`}
                      </span>
                    </span>
                  )}

                  {item.superAdmin ? (
                    <span className="adm-rail__su" title="Super admin only">
                      SUPER
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="adm-rail__foot">
          <button type="button" className="adm-rail__collapse" onClick={toggleCollapsed}>
            <IconChevronLeft className="adm-rail__chev" />
            <span className="adm-rail__label">Collapse</span>
            <span className="adm-sr">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
          </button>
        </div>
      </nav>

      {isDrawer && drawerOpen ? (
        <button
          type="button"
          className="adm-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      {/* -------------------------------------------- main ------- */}
      <div className="adm-main">
        <header className="adm-top">
          <button
            type="button"
            className="adm-iconbtn adm-top__burger"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <IconClose /> : <IconMenu />}
            <span className="adm-sr">Navigation</span>
          </button>

          <button type="button" className="adm-search" onClick={() => setPaletteOpen(true)}>
            <IconSearch style={{ width: 15, height: 15, flex: '0 0 auto' }} />
            <span className="adm-search__text">Search the console…</span>
            <span className="adm-kbd">⌘K</span>
          </button>

          <span className="adm-top__spacer" />

          {preview ? (
            <span className="adm-pill" data-tone="warn" title="No admin session — sample data only">
              <span className="adm-pill__glyph" aria-hidden="true" />
              Preview · sample data
            </span>
          ) : null}

          <ThemeToggle />
          <NotificationBell open={bellOpen} onToggle={() => setBellOpen((o) => !o)} />

          <div className="adm-menu__wrap">
            <button
              type="button"
              className="adm-user"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="adm-user__initials" aria-hidden="true">
                {initialsOf(preview ? 'Preview' : session.name)}
              </span>
              <span className="adm-user__name">{preview ? 'Not signed in' : session.name}</span>
              <span className="adm-rolepill" data-level={level}>
                {ADMIN_LEVEL_PILL[level]}
              </span>
            </button>

            {menuOpen ? (
              <UserMenu
                name={preview ? 'Not signed in' : session.name}
                contact={preview ? 'Preview mode — sample data only' : session.contact}
                level={level}
                canPreviewSwitch={session.canPreviewSwitch}
                onPreviewLevel={session.setPreviewRole}
                onClose={() => setMenuOpen(false)}
                onSignOut={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              />
            ) : null}
          </div>
        </header>

        <main className="adm-content" id="main">
          {preview ? <PreviewNotice /> : null}
          {restricted ? <RestrictedNotice section={restrictedSection?.label ?? 'This section'} /> : children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} level={level} />
    </div>
  );
}

/* ================================================================== */
/* Restricted section                                                  */
/* ================================================================== */

/**
 * What a plain ADMIN sees at `/admin/team`, `/admin/settings`, `/admin/reports`,
 * `/admin/payments` or `/admin/settlements`.
 *
 * It is deliberately a plain, calm explanation rather than a scary error: the
 * person is a legitimate admin who followed a bookmark, not an intruder. And it
 * says out loud that the server is the thing refusing, so nobody reads this
 * panel as the lock.
 */
function RestrictedNotice({ section }: { section: string }) {
  return (
    <div className="adm-page">
      <div className="adm-panel adm-panel--pad adm-stack" role="status">
        <p className="adm-gate__title">
          <IconLock style={{ width: 20, height: 20, verticalAlign: '-3px', marginRight: 8 }} />
          Not authorised
        </p>
        <p className="adm-gate__body">
          <strong>{section}</strong> is restricted to super admins. Your account is a platform{' '}
          <strong>admin</strong>, which covers operations — the live board, dispatch, approvals,
          issues and stock — but not money, the team or platform configuration.
        </p>
        <div className="adm-row">
          <Link className="adm-btn adm-btn--primary" href="/admin">
            Back to the dashboard
          </Link>
          <Link className="adm-btn" href="/admin/board">
            Open the live board
          </Link>
        </div>
        <p className="adm-gate__note">
          This panel is a courtesy, not a lock. The endpoints behind this section refuse the request
          server-side whether or not this screen was drawn.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Preview notice                                                      */
/* ================================================================== */

/**
 * Shown once, at the top of every screen, whenever there is no admin session.
 * The individual pages still show their own per-query sample-data banners; this
 * one explains WHY they are all showing it.
 */
function PreviewNotice() {
  return (
    <div className="adm-fixture" role="status">
      <IconLock />
      <div>
        <p className="adm-fixture__title">Preview mode — no admin session</p>
        <p className="adm-fixture__body">
          The API did not return a session, so every panel below is rendering local sample data.
          Nothing here is real and no privileged data has been fetched — the API refuses these
          requests without a valid admin token regardless of what this screen chooses to draw.{' '}
          <Link href="/login" style={{ color: 'inherit' }}>
            Sign in
          </Link>{' '}
          to load real data.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Top-bar pieces                                                      */
/* ================================================================== */

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

/**
 * `GET /notifications` returns `{ id, type, title, body, data, readAt,
 * createdAt }` — there is no `href`. An earlier draft of this bell invented
 * one and linked every row to it; that guess is gone. A row is now a plain
 * button: click it and it is marked read, nothing more, because the payload
 * in `data` is type-dependent and this bell does not know how to route it.
 */
function NotificationBell({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { unreadCount, items, loading, error, fetchList, markRead, markAllRead } =
    useNotifications();

  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) fetchList(1);
    // Fires once per open, not on every keystroke elsewhere on the page —
    // `fetchList` is stable across renders (see `useNotifications`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: globalThis.MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onToggle();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, onToggle]);

  return (
    <div className="adm-menu__wrap" ref={wrapRef}>
      <button
        type="button"
        className="adm-iconbtn"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <IconBell />
        {unreadCount > 0 ? (
          <span className="adm-iconbtn__count" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
        <span className="adm-sr">
          Notifications{unreadCount > 0 ? `, ${unreadCount} unread` : ', none unread'}
        </span>
      </button>

      {open ? (
        <div className="adm-menu" role="menu" style={{ minWidth: 320 }}>
          <div className="adm-menu__head">
            <strong>Notifications</strong>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="adm-menu__email"
                style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => markAllRead()}
              >
                Mark all {unreadCount} read
              </button>
            ) : (
              <p className="adm-menu__email">Nothing unread</p>
            )}
          </div>
          {error !== null ? (
            <p style={{ padding: 'var(--s-3)', color: 'var(--crit)' }}>{error.friendlyMessage}</p>
          ) : loading && items.length === 0 ? (
            <p style={{ padding: 'var(--s-3)', color: 'var(--adm-dim)' }}>Loading…</p>
          ) : items.length === 0 ? (
            <p style={{ padding: 'var(--s-3)', color: 'var(--adm-dim)' }}>Nothing waiting.</p>
          ) : (
            items.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                className="adm-menu__item"
                role="menuitem"
                style={{ border: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => {
                  if (item.readAt === null) markRead(item.id);
                }}
              >
                <span
                  className="adm-dot"
                  style={{
                    background: item.readAt ? 'var(--adm-line-strong)' : 'var(--crit)',
                    borderRadius: 999,
                    width: 6,
                    height: 6,
                  }}
                  aria-hidden="true"
                />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{item.title}</strong>
                  <span className="adm-palette__hint">{item.body}</span>
                  <span className="adm-palette__hint">
                    {formatRelative(item.createdAt, Date.now())}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({
  name,
  contact,
  level,
  canPreviewSwitch,
  onPreviewLevel,
  onClose,
  onSignOut,
}: {
  name: string;
  contact: string;
  level: AdminLevel;
  canPreviewSwitch: boolean;
  onPreviewLevel: (level: AdminLevel) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (event: globalThis.MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="adm-menu" role="menu" ref={ref}>
      <div className="adm-menu__head">
        <strong>{name}</strong>
        <p className="adm-menu__email">{contact}</p>
        <span
          className="adm-rolepill"
          data-level={level}
          style={{ marginTop: 6, display: 'inline-block' }}
          title={
            level === 'SUPER_ADMIN'
              ? 'Governance: money, the team and platform configuration, on top of everything an admin can do.'
              : 'Operations: the live board, dispatch, approvals, issues and stock.'
          }
        >
          {ADMIN_LEVEL_PILL[level]}
        </span>
        <p className="adm-menu__email" style={{ marginTop: 4 }}>
          {level === 'SUPER_ADMIN'
            ? `${ADMIN_LEVEL_LABEL.SUPER_ADMIN} — governance and operations`
            : `${ADMIN_LEVEL_LABEL.ADMIN} — operations`}
        </p>
      </div>

      {canPreviewSwitch ? (
        <>
          {/*
            Preview only. This changes what this browser tab DRAWS so a reviewer
            can see both sides of the super-admin gate without two accounts. It
            grants nothing: with no token, every request 401s either way.
          */}
          <p className="adm-field__label" style={{ padding: 'var(--s-2) var(--s-2) 0' }}>
            Preview as
          </p>
          <div className="adm-row" style={{ padding: 'var(--s-1) var(--s-2) var(--s-2)' }}>
            <div className="adm-segmented">
              {(['ADMIN', 'SUPER_ADMIN'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="adm-segmented__btn"
                  aria-pressed={level === option}
                  onClick={() => onPreviewLevel(option)}
                >
                  {ADMIN_LEVEL_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <Link className="adm-menu__item" href="/" role="menuitem">
        <IconExternal style={{ width: 15, height: 15 }} />
        Open the storefront
      </Link>

      <button
        type="button"
        className="adm-menu__item adm-menu__item--danger"
        role="menuitem"
        onClick={onSignOut}
      >
        <IconSignOut style={{ width: 15, height: 15 }} />
        Sign out
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}
