'use client';

/**
 * The one hook behind every bell — the shop header and the admin shell both
 * mount this, never at the same time (each surface has its own layout), so a
 * plain hook is enough; there is no need for a shared provider or a second
 * invalidation bus.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *   · Reads the unread count once on mount, and again on a slow poll — the
 *     poll is the fallback; the socket is the fast path.
 *   · Opens a small socket connection and listens for `notification.created`.
 *     The gateway joins the caller to `user:{userId}` from the JWT at connect
 *     time, so there is nothing to subscribe to here.
 *   · Fetches a page of notifications on demand (`fetchList`), for the panel.
 *   · `markRead` / `markAllRead` update local state optimistically and fall
 *     back to a re-fetch of the unread count if the write did not land — a
 *     bell that gets out of sync with the server is worse than one that is
 *     briefly a beat behind it.
 *
 * ── WHY THERE IS NO FIXTURE FALLBACK HERE ───────────────────────────────────
 * A notification bell that is wrong silently (sample data dressed as real
 * alerts) is worse than one that is empty. A failed unread-count fetch just
 * leaves the badge at its last known value; a failed list fetch surfaces a
 * real inline error in the panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ApiError, api, getAccessToken } from '@/lib/api-client';
import { SOCKET_URL } from '@/config/env';
import { LiteSocket } from '@/lib/shop/socket-io-lite';
import {
  readNotificationPage,
  readUnreadCount,
  type NotificationItem,
  type PageMeta,
} from '@/lib/notifications';

/** How often the badge re-checks itself when the socket has not said anything. */
const POLL_MS = 60_000;
const PAGE_LIMIT = 20;

export interface UseNotifications {
  unreadCount: number;
  items: NotificationItem[];
  meta: PageMeta | null;
  loading: boolean;
  error: ApiError | null;
  /** Fetch page 1 (or a later page, appended) of the notification list. */
  fetchList: (page?: number) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  refreshUnread: () => void;
}

export function useNotifications(): UseNotifications {
  const { isAuthenticated } = useAuth();

  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const refreshUnread = useCallback(() => {
    if (!isAuthenticated) return;
    void api
      .get<unknown>('/notifications/unread-count')
      .then((raw) => setUnreadCount(readUnreadCount(raw)))
      .catch(() => {
        // A stale badge is a minor annoyance; a toast for it would not be.
      });
  }, [isAuthenticated]);

  /* ---- unread count: once on sign-in, then a slow poll ---- */
  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    refreshUnread();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshUnread();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [isAuthenticated, refreshUnread]);

  /* ---- live pushes ---- */
  useEffect(() => {
    if (!isAuthenticated) return;
    let disposed = false;
    let socket: LiteSocket | null = null;

    socket = new LiteSocket({
      url: SOCKET_URL,
      auth: () => {
        const token = getAccessToken();
        return token === null ? {} : { token };
      },
      onPhase: () => {
        // The bell has no connection indicator — a missed push is caught by
        // the next poll or the next time the panel is opened.
      },
      onEvent: (name) => {
        if (disposed) return;
        if (name === 'notification.created') {
          setUnreadCount((count) => count + 1);
        }
      },
    });
    socket.connect();

    return () => {
      disposed = true;
      socket?.close();
    };
  }, [isAuthenticated]);

  /* ---- the list, fetched on demand when the panel opens ---- */
  const requestId = useRef(0);

  const fetchList = useCallback(
    (page = 1) => {
      if (!isAuthenticated) return;
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      void api
        .get<unknown>('/notifications', { query: { page, limit: PAGE_LIMIT } })
        .then((raw) => {
          if (requestId.current !== id) return;
          const paged = readNotificationPage(raw);
          setItems((previous) => (page === 1 ? paged.data : [...previous, ...paged.data]));
          setMeta(paged.meta);
        })
        .catch((cause: unknown) => {
          if (requestId.current !== id) return;
          setError(cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true));
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    },
    [isAuthenticated],
  );

  const markRead = useCallback(
    (id: string) => {
      const already = items.find((item) => item.id === id)?.readAt !== null;
      setItems((previous) =>
        previous.map((item) =>
          item.id === id && item.readAt === null
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ),
      );
      if (!already) setUnreadCount((count) => Math.max(0, count - 1));

      void api.patch(`/notifications/${encodeURIComponent(id)}/read`).catch(() => {
        // The write may not have landed — trust the server's own count again.
        refreshUnread();
      });
    },
    [items, refreshUnread],
  );

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setItems((previous) => previous.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    setUnreadCount(0);

    void api.post('/notifications/read-all').catch(() => {
      refreshUnread();
    });
  }, [refreshUnread]);

  return { unreadCount, items, meta, loading, error, fetchList, markRead, markAllRead, refreshUnread };
}
