'use client';

/**
 * ★ STOCK — and the one rule the whole screen is built around.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ STOCK IS ADJUSTED BY A DELTA. IT IS NEVER SET TO A TOTAL.                │
 * │                                                                          │
 * │ `PATCH /vendor/inventory/:productId  { delta, reason }` (plan §6.2).     │
 * │                                                                          │
 * │ The reason is not bureaucracy. Between the moment this page rendered and │
 * │ the moment the vendor presses save, customers are checking out and the   │
 * │ server is decrementing the same number. A "set stock to 40" write would  │
 * │ silently overwrite every sale in that window — the classic lost-update.  │
 * │ `+12` is commutative with whatever else happened; `= 40` is not.         │
 * │                                                                          │
 * │ So every control on this screen produces a signed delta, and the number  │
 * │ in the box is what will be ADDED, never what the stock will become.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE LOW-STOCK RAIL ──────────────────────────────────────────────────────
 * Out of stock first, then low. A zero is lost revenue right now; a low is a
 * warning about tomorrow, and mixing them in one alphabetical list makes both
 * invisible.
 *
 * ── ONE REQUEST, TWO VIEWS ──────────────────────────────────────────────────
 * The rail and the table used to be two calls to the same endpoint with
 * different filters. The API decides low-stock itself and stamps every row
 * with `isLowStock` and `isOutOfStock`, so the rail is a filter over the rows
 * already on screen. One request, and the two halves of the page can never
 * disagree about which products are short.
 *
 * ── PER-PRODUCT MOVEMENT HISTORY ────────────────────────────────────────────
 * `GET /vendor/inventory/:productId/logs` — every restock, correction and
 * order-driven change to one product, opened from the "Changed" column as a
 * drawer (`InventoryHistory`).
 */

import { useMemo, useState } from 'react';
import { useDebounced, useVendorMutation, useVendorQuery } from '@/hooks';
import { useVendorSession } from '@/lib/vendor/session';
import { humanise } from '../format';
import type {
  InventoryAdjust,
  InventoryBulkAdjust,
  InventoryBulkResult,
  InventoryRow,
  Paged,
} from '@/lib/vendor/types';
import { VenPage, VenSection } from '../Page';
import { IconInbox } from '../icons';
import {
  Btn,
  EmptyState,
  EndpointError,
  Money,
  RelativeTime,
  SkelStat,
  WriteFailure,
} from '../primitives';
import { ConfirmDialog } from '../overlay';
import { InventoryHistory } from './InventoryHistory';
import {
  SearchBox,
  SelectBox,
  Toolbar,
  ToolbarSpacer,
  VenTable,
  type Column,
} from '../table';

const LIMIT = 25;

interface Filters {
  q: string;
  lowStock: string;
}

const EMPTY_FILTERS: Filters = { q: '', lowStock: 'all' };

/**
 * The server already decided. `isOutOfStock` and `isLowStock` come down on
 * every row, and re-deriving them here from `stock <= threshold` is how a
 * table ends up disagreeing with the count in the rail above it.
 */
function levelOf(row: InventoryRow): 'out' | 'low' | 'ok' {
  if (row.isOutOfStock) return 'out';
  if (row.isLowStock) return 'low';
  return 'ok';
}

export function InventoryView({ initialLowStock = false }: { initialLowStock?: boolean }) {
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    lowStock: initialLowStock ? 'true' : 'all',
  });
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounced(filters.q, 300);

  // `ListInventoryQueryDto` takes q, page, limit, sort, from, to, lowStock,
  // outOfStock and categoryId. Nothing else — an unknown key is a 400.
  const params = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      lowStock: filters.lowStock === 'true' ? true : undefined,
      page,
      limit: LIMIT,
    }),
    [debouncedQuery, filters.lowStock, page],
  );

  const inventory = useVendorQuery<Paged<InventoryRow>>('/vendor/inventory', params);

  const adjust = useVendorMutation<InventoryAdjust, InventoryRow>(
    '/vendor/inventory/:productId',
    'PATCH',
  );
  // One transaction for the whole stock-take: a batch that applied 40 of its
  // 60 lines and then failed leaves the vendor with no way to know which 20 to
  // retype.
  const bulk = useVendorMutation<InventoryBulkAdjust, InventoryBulkResult>(
    '/vendor/inventory/bulk',
    'POST',
  );

  /* ---- pending deltas, one per row ---- */
  const [pending, setPending] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<InventoryAdjust['reason']>('restock');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [historyRow, setHistoryRow] = useState<{ productId: string; name: string } | null>(null);

  const setDelta = (productId: string, delta: number) => {
    setPending((previous) => {
      const next = { ...previous };
      if (delta === 0) delete next[productId];
      else next[productId] = delta;
      return next;
    });
  };

  const pendingEntries = Object.entries(pending);

  const applyOne = async (productId: string, delta: number) => {
    setFailure(null);
    const result = await adjust.mutate(
      { delta, reason },
      {
        params: { productId },
        invalidate: ['/vendor/inventory', '/vendor/products'],
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
    if (result !== null) setDelta(productId, 0);
    return result;
  };

  /**
   * The whole queue in ONE call.
   *
   * `POST /vendor/inventory/bulk` applies every adjustment inside a single
   * transaction. Sending them one at a time — as this screen used to — means a
   * failure halfway leaves the shelf half-corrected and the vendor guessing
   * which half. All or nothing is the only honest stock-take.
   */
  const applyAll = async () => {
    setFailure(null);
    const result = await bulk.mutate(
      {
        adjustments: pendingEntries.map(([productId, delta]) => ({ productId, delta })),
        reason,
      },
      {
        invalidate: ['/vendor/inventory', '/vendor/products', '/vendor/dashboard'],
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
    if (result !== null) setPending({});
    setConfirmBulk(false);
  };

  const resetFilters = () => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  };

  // Without inventory.adjust the board is read-only: no adjust column, no
  // queue. UX only — the API refuses the write either way.
  const canAdjust = useVendorSession().can('inventory.adjust');

  const adjustColumn: Column<InventoryRow> = {
    key: 'adjust',
    header: 'Adjust by',
    width: '220px',
    render: (row) => (
      <AdjustCell
        value={pending[row.productId] ?? 0}
        onChange={(delta) => setDelta(row.productId, delta)}
        onApply={() => {
          const delta = pending[row.productId] ?? 0;
          if (delta !== 0) void applyOne(row.productId, delta);
        }}
        busy={adjust.loading}
        stock={row.stock}
      />
    ),
  };

  const columns: Column<InventoryRow>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (row) => (
        <span>
          <strong>{row.name}</strong>
          <br />
          <span className="ven-dim">
            {row.sku}
            {row.brand ? ` · ${row.brand}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'On hand',
      align: 'right',
      numeric: true,
      render: (row) => {
        const level = levelOf(row);
        const ceiling = Math.max(row.lowStockThreshold * 3, 1);
        const fill = Math.min(100, Math.round((row.stock / ceiling) * 100));
        return (
          <span className="ven-stock" data-level={level}>
            <span className="ven-stock__n">{row.stock}</span>
            <span className="ven-stock__bar" aria-hidden="true">
              <span className="ven-stock__fill" style={{ width: `${Math.max(fill, 0)}%` }} />
            </span>
            <span className="ven-sr">
              {level === 'out'
                ? 'out of stock'
                : level === 'low'
                  ? `low, threshold ${row.lowStockThreshold}`
                  : 'in stock'}
            </span>
          </span>
        );
      },
    },
    {
      key: 'reserved',
      header: 'Held',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span title="Reserved by checkouts that are in flight">{row.reserved}</span>
      ),
    },
    {
      key: 'available',
      header: 'Sellable',
      align: 'right',
      numeric: true,
      // `available` is the server's own stock − reserved. Recomputing it here
      // would be a second opinion on a number that has exactly one authority.
      render: (row) => <strong>{row.available}</strong>,
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.price} />,
    },
    ...(canAdjust ? [adjustColumn] : []),
    {
      key: 'updatedAt',
      header: 'Changed',
      render: (row) =>
        row.updatedAt === null ? (
          <span className="ven-dim">never</span>
        ) : (
          <button
            type="button"
            className="ven-time-btn"
            onClick={() => setHistoryRow({ productId: row.productId, name: row.name })}
            title="Open the movement history for this product"
          >
            <RelativeTime value={row.updatedAt} live={false} />
          </button>
        ),
    },
  ];

  const rows = useMemo(() => inventory.data?.data ?? [], [inventory.data]);
  const sortedLow = useMemo(
    () => rows.filter((row) => row.isLowStock || row.isOutOfStock).sort((a, b) => a.stock - b.stock),
    [rows],
  );
  const meta = inventory.data?.meta;

  const fixturePaths = inventory.isFixture ? ['/vendor/inventory'] : [];

  return (
    <VenPage
      title="Inventory"
      description="Stock is adjusted by a delta, never set to a total — that is what keeps a sale made while you were typing from being overwritten."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
    >
      {failure ? <WriteFailure message={failure} /> : null}

      {inventory.error && inventory.data === null ? (
        <EndpointError
          path="/vendor/inventory"
          message={inventory.error.friendlyMessage}
          status={inventory.error.status}
          onRetry={inventory.refetch}
        />
      ) : null}

      <VenSection
        title="Running low"
        description="Out of stock first — a zero is money you are not taking right now. Counted over the products on this page."
      >
        {inventory.loading && !inventory.hasLoadedOnce ? (
          <SkelStat />
        ) : sortedLow.length === 0 ? (
          <EmptyState
            title="Nothing is low"
            body="Every product is above its threshold."
            icon={<IconInbox />}
          />
        ) : (
          <div className="ven-rail-low">
            {sortedLow.map((row) => (
              <article className="ven-lowcard" key={row.productId} data-level={levelOf(row)}>
                <p className="ven-lowcard__name" title={row.name}>
                  {row.name}
                </p>
                <p className="ven-lowcard__n">
                  {row.stock}
                  <span className="ven-field__hint"> / {row.lowStockThreshold} threshold</span>
                </p>
                {canAdjust ? (
                  <Btn size="sm" onClick={() => setDelta(row.productId, (pending[row.productId] ?? 0) + 10)}>
                    Queue +10
                  </Btn>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </VenSection>

      <VenSection title="All stock">
        <Toolbar>
          <SearchBox
            label="Search inventory"
            placeholder="Product or SKU…"
            value={filters.q}
            onChange={(value) => {
              setPage(1);
              setFilters((previous) => ({ ...previous, q: value }));
            }}
          />
          <SelectBox
            label="Show"
            value={filters.lowStock}
            onChange={(value) => {
              setPage(1);
              setFilters((previous) => ({ ...previous, lowStock: value }));
            }}
            options={[
              { label: 'Everything', value: 'all' },
              { label: 'Low or out of stock only', value: 'true' },
            ]}
          />
          <Btn variant="ghost" size="sm" onClick={resetFilters}>
            Clear filters
          </Btn>
          <ToolbarSpacer />
          <SelectBox
            label="Reason for these changes"
            value={reason}
            onChange={(value) => setReason(value as InventoryAdjust['reason'])}
            options={[
              { label: 'Restock — new delivery arrived', value: 'restock' },
              { label: 'Manual — count correction, damage, waste', value: 'manual' },
            ]}
          />
        </Toolbar>

        <VenTable
          columns={columns}
          rows={rows}
          loading={inventory.loading && !inventory.hasLoadedOnce}
          rowKey={(row) => row.productId}
          page={meta?.page}
          pageCount={meta?.pages}
          total={meta?.total}
          onPageChange={setPage}
          empty={
            <EmptyState
              title="No products match"
              body="Clear the filters to see the whole shelf."
              icon={<IconInbox />}
            />
          }
        />
      </VenSection>

      {canAdjust && pendingEntries.length > 0 ? (
        <div className="ven-dirty" role="status">
          <span className="ven-dirty__text">
            {pendingEntries.length} {pendingEntries.length === 1 ? 'adjustment' : 'adjustments'}{' '}
            queued
            <span className="ven-dirty__count">
              {' '}
              · net {pendingEntries.reduce((sum, [, delta]) => sum + delta, 0) > 0 ? '+' : ''}
              {pendingEntries.reduce((sum, [, delta]) => sum + delta, 0)}
            </span>
          </span>
          <span className="ven-dirty__actions">
            <Btn onClick={() => setPending({})}>Discard</Btn>
            <Btn
              variant="primary"
              onClick={() => setConfirmBulk(true)}
              disabled={adjust.loading || bulk.loading}
            >
              Apply all
            </Btn>
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmBulk}
        title="Apply every queued adjustment?"
        confirmLabel={`Apply ${pendingEntries.length}`}
        loading={bulk.loading}
        onCancel={() => setConfirmBulk(false)}
        onConfirm={() => {
          void applyAll();
        }}
        body={
          <div className="ven-stack">
            <p>
              All of them go in ONE transaction with the reason{' '}
              <strong>{humanise(reason)}</strong>. Either every line lands or none of them do —
              there is no state where half the shelf was corrected.
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {pendingEntries.slice(0, 8).map(([productId, delta]) => (
                <li key={productId} className="ven-num">
                  {productId}: {delta > 0 ? '+' : ''}
                  {delta}
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <InventoryHistory
        productId={historyRow?.productId ?? null}
        productName={historyRow?.name ?? ''}
        onClose={() => setHistoryRow(null)}
      />
    </VenPage>
  );
}

/* ================================================================== */
/* Adjust cell                                                         */
/* ================================================================== */

/**
 * `−1  [ +12 ]  +1  Apply`
 *
 * The box holds the DELTA, and the hint under it spells out what the stock will
 * become — the number a person is actually picturing — without ever sending it.
 */
function AdjustCell({
  value,
  onChange,
  onApply,
  busy,
  stock,
}: {
  value: number;
  onChange: (delta: number) => void;
  onApply: () => void;
  busy: boolean;
  stock: number;
}) {
  const result = stock + value;

  return (
    <span className="ven-adjust">
      <button
        type="button"
        className="ven-adjust__step"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease the adjustment by one"
      >
        −
      </button>
      <input
        className="ven-adjust__input"
        type="number"
        value={value === 0 ? '' : value}
        placeholder="0"
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || 0)}
        aria-label="Adjust stock by"
      />
      <button
        type="button"
        className="ven-adjust__step"
        onClick={() => onChange(value + 1)}
        aria-label="Increase the adjustment by one"
      >
        +
      </button>
      <Btn
        size="sm"
        onClick={onApply}
        disabled={value === 0 || busy || result < 0}
        title={
          result < 0
            ? 'That would take the stock below zero'
            : value === 0
              ? 'Nothing to apply'
              : `Stock becomes ${result}`
        }
      >
        Apply
      </Btn>
      {value !== 0 ? (
        <span className="ven-field__hint" style={{ whiteSpace: 'nowrap' }}>
          → {result}
        </span>
      ) : null}
    </span>
  );
}

/* ================================================================== */
/* History — NOT BUILT                                                 */
/* ================================================================== */

/*
  TODO: per-product movement history needs `GET /vendor/inventory/:productId/logs`,
  which the API does not expose. `InventoryLog` rows are written inside the same
  transaction as every stock change (restock, manual correction, order reserve,
  release and commit), so the data exists — there is simply no vendor-facing
  route that reads it.

  The drawer that used to live here has been removed rather than left pointing
  at a 404. An affordance that always fails teaches a shop owner to distrust
  every other button on the screen.
*/
