/**
 * The notification centre — shared across every signed-in surface.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────────
 *   GET   /notifications?page&limit    -> { data:[Notification], meta }
 *   GET   /notifications/unread-count  -> { count }
 *   PATCH /notifications/:id/read      -> 200
 *   POST  /notifications/read-all      -> 200
 *
 * `data` on a notification is an arbitrary, type-dependent payload — a
 * vendor-approval notification might carry a vendorId, a delivery-failure one
 * an orderId. There is no `href` in the real contract (an earlier admin-only
 * stub invented one), so this reads it as an opaque bag and never assumes a
 * shape inside it.
 *
 * Live pushes arrive on the existing socket as `notification.created` on the
 * caller's own `user:{userId}` room — the gateway joins that room from the
 * JWT at connect time, so nothing here ever emits a subscribe request for it.
 */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Opaque, type-dependent payload. Never assumed to have a particular shape. */
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(source: Dict, key: string, fallback = ''): string {
  const value = source[key];
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(source: Dict, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readNotification(value: unknown): NotificationItem | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === '') return null;
  const data = value['data'];
  return {
    id,
    type: str(value, 'type', 'notification'),
    title: str(value, 'title'),
    body: str(value, 'body'),
    data: isDict(data) ? data : {},
    readAt: nullableStr(value, 'readAt'),
    createdAt: str(value, 'createdAt'),
  };
}

export interface NotificationPage {
  data: NotificationItem[];
  meta: PageMeta;
}

export function readNotificationPage(value: unknown): NotificationPage {
  const source = isDict(value) ? value : {};
  const rawData = source['data'];
  const data: NotificationItem[] = [];
  if (Array.isArray(rawData)) {
    for (const row of rawData) {
      const item = readNotification(row);
      if (item !== null) data.push(item);
    }
  }
  const meta = isDict(source['meta']) ? (source['meta'] as Dict) : {};
  return {
    data,
    meta: {
      page: typeof meta['page'] === 'number' ? meta['page'] : 1,
      limit: typeof meta['limit'] === 'number' ? meta['limit'] : data.length,
      total: typeof meta['total'] === 'number' ? meta['total'] : data.length,
      pages: typeof meta['pages'] === 'number' ? meta['pages'] : 1,
    },
  };
}

export function readUnreadCount(value: unknown): number {
  if (!isDict(value)) return 0;
  const count = value['count'];
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}
