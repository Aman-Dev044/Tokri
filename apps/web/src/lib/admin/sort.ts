/**
 * ════════════════════════════════════════════════════════════════════════
 *  TABLE COLUMNS ARE NOT DATABASE FIELDS
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every admin list sorts twice: the server orders and pages the rows, and
 * the client re-sorts what it was given so the controls still work on the
 * fixture path. That is deliberate — one code path instead of two that
 * drift.
 *
 * What was NOT deliberate is that the client's column key went to the
 * server verbatim. A column is named for what an operator reads — "Spend",
 * "GMV", "Age", "Urgency" — and the service allowlists what Mongo can
 * actually sort on. The two were never the same vocabulary:
 *
 *     /admin/customers?sort=-spend       -> 400, wants `totalSpend`
 *     /admin/vendors?sort=-gmvPaise      -> 400, wants `gmv`
 *     /admin/ops/issues?sort=-urgency    -> 400, wants `priority`
 *
 * All three were the DEFAULT sort on their screen, so the first request
 * each one made failed, every time, for everyone. Nobody saw it because
 * `useAdminQuery` answered the 400 with sample data; that fallback is now
 * network-only, which is what surfaced these within a minute.
 *
 * ── Why some keys map to nothing ────────────────────────────────────────
 * "Urgency" is a score this app computes from priority and age; "Assignee"
 * is a name the list resolves after the fact. Neither is a field, so
 * neither can be a `sort`. Those keys send no `sort` at all and the client
 * orders the page it was given — correct within the page, and honest about
 * not being a global ordering.
 *
 * `null` means exactly that: "the server cannot sort by this". It is not
 * the same as a key being absent from the map, which is a mistake, so the
 * absent case falls through to the key itself and will 400 loudly rather
 * than quietly sorting by something else.
 */

export interface SortLike {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * A column key -> the field the service allowlists, or `null` when the
 * service has no equivalent and the ordering has to stay client-side.
 */
export type SortFieldMap = Readonly<Record<string, string | null>>;

/**
 * Build the `sort` query parameter, or `undefined` when this column is not
 * something the server can order by.
 */
export function toSortParam(
  sort: SortLike | null,
  map: SortFieldMap,
): string | undefined {
  if (sort === null) return undefined;
  // `undefined` (key not in the map) deliberately falls through to the key
  // itself: an unmapped column is an oversight, and a loud 400 is how it
  // gets found. Only an explicit `null` means "cannot sort server-side".
  const field = map[sort.key] === undefined ? sort.key : map[sort.key];
  if (field === null) return undefined;
  return `${sort.dir === 'desc' ? '-' : ''}${field}`;
}

/** `/admin/vendors` — allowlist: commissionPct createdAt gmv orderCount rating status storeName */
export const VENDOR_SORT: SortFieldMap = {
  storeName: 'storeName',
  status: 'status',
  commissionPct: 'commissionPct',
  orderCount: 'orderCount',
  gmv: 'gmv',
  rating: 'rating',
  createdAt: 'createdAt',
  actions: null,
};

/** `/admin/customers` — allowlist: createdAt lastLoginAt lastOrderAt name orderCount totalSpend */
export const CUSTOMER_SORT: SortFieldMap = {
  name: 'name',
  orders: 'orderCount',
  spend: 'totalSpend',
  lastOrder: 'lastOrderAt',
  // The service does not order by status, and there is no sensible proxy
  // for it — the client sorts the page instead.
  status: null,
};

/** `/admin/ops/issues` — allowlist: code createdAt priority status updatedAt */
export const ISSUE_SORT: SortFieldMap = {
  code: 'code',
  priority: 'priority',
  status: 'status',
  age: 'createdAt',
  updated: 'updatedAt',
  // Urgency is a computed score, but it is dominated by priority — so the
  // server is asked for `priority` to put roughly the right rows on page
  // one, and the client refines the exact order within that page. Sending
  // nothing here would page by creation date and genuinely bury the worst
  // issue, which is the one thing this screen exists to surface.
  urgency: 'priority',
  subject: null,
  assignee: null,
};

/** `/admin/delivery-partners` — allowlist: completedCount createdAt rating status */
export const RIDER_SORT: SortFieldMap = {
  completed: 'completedCount',
  rating: 'rating',
  status: 'status',
  // Joined or derived after the fact — the client orders the page.
  name: null,
  vehicle: null,
  vendor: null,
};
