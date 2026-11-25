'use client';

/**
 * The bell in the shop header. Same data as the admin one — `useNotifications`
 * — styled for this surface: `shop-*` classes, the same popover pattern
 * `ProfileMenu` already uses (a button, a ref, a click-outside listener).
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { formatAgo } from '@/lib/shop/format';
import { useNotifications } from '@/hooks/useNotifications';

export function NotifyBell() {
  const { isAuthenticated } = useAuth();
  const { unreadCount, items, loading, error, fetchList, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchList(1);
  }, [open, fetchList]);

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

  if (!isAuthenticated) return null;

  return (
    <div className="shop-notify" ref={ref}>
      <button
        type="button"
        className="shop-notify__button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
          <path
            d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1.3 4.4H2.7C3 10.5 4 9.5 4 6.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M6.4 13a1.7 1.7 0 0 0 3.2 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        {unreadCount > 0 ? (
          <span key={unreadCount} className="shop-notify__count" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
        <span className="mnd-visually-hidden">
          Notifications{unreadCount > 0 ? `, ${unreadCount} unread` : ', none unread'}
        </span>
      </button>

      {open ? (
        <div className="shop-notify__panel" role="menu">
          <div className="shop-notify__head">
            <strong>Notifications</strong>
            {unreadCount > 0 ? (
              <button type="button" className="shop-linkish" onClick={() => markAllRead()}>
                Mark all read
              </button>
            ) : null}
          </div>

          {error !== null ? (
            <p className="shop-notify__empty">{error.friendlyMessage}</p>
          ) : loading && items.length === 0 ? (
            <p className="shop-notify__empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="shop-notify__empty">Nothing here yet.</p>
          ) : (
            <ul className="shop-notify__list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="shop-notify__item"
                    data-unread={item.readAt === null ? 'true' : undefined}
                    onClick={() => {
                      if (item.readAt === null) markRead(item.id);
                    }}
                  >
                    <span className="shop-notify__dot" aria-hidden="true" />
                    <span className="shop-notify__text">
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                      <span className="shop-notify__time mono">{formatAgo(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
