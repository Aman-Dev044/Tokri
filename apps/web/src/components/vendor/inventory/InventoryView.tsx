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
 */

import { useMemo, useState } from 'react';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  EmptyState,
  FilterBar,
  IconInbox,
  Money,
  RelativeTime,
  Toolbar,
  type Column,
  type FilterDef,
  type FilterValues,
} from '@/components/admin';
import { useDebounced, useVendorMutation, useVendorQuery } from '@/hooks';
import { humanise } from '@/lib/admin/format';
import type {
  InventoryAdjust,
  InventoryLogEntry,
  InventoryRow,
  Paged,
} from '@/lib/vendor/types';

const LIMIT = 25;

interface Filters {
  q: string;
  lowStock: string;
}

const EMPTY_FILTERS: Filters = { q: '', lowStock: 'all' };

function levelOf(row: InventoryRow): 'out' | 'low' | 'ok' {
  if (row.stock <= 0) return 'out';
  if (row.stock <= row.lowStockThreshold) return 'low';
  return 'ok';
}

export function InventoryView({ initialLowStock = false }: { initialLowStock?: boolean }) {
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    lowStock: initialLowStock ? 'true' : 'all',
  });
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounced(filters.q, 300);

  const params = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      lowStock: filters.lowStock === 'true' ? 'true' : undefined,
      page,
      limit: LIMIT,
    }),
    [debouncedQuery, filters.lowStock, page],
  );

  const inventory = useVendorQuery<Paged<InventoryRow>>('/vendor/inventory', params);
  const low = useVendorQuery<Paged<InventoryRow>>('/vendor/inventory', {
    lowStock: 'true',
    limit: 20,
  });

  const adjust = useVendorMutation<InventoryAdjust, InventoryRow>(
    '/vendor/inventory/:productId',
    'PATCH',
  );

  /* ---- pending deltas, one per row ---- */
  const [pending, setPending] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<InventoryAdjust['reason']>('restock');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [history, setHistory] = useState<InventoryRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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

  const applyAll = async () => {
    // Sequential, not `Promise.all`: each one is a separate audited write and a
    // partial failure has to be visible per product rather than collapsing into
    // one rejected promise.
    for (const [productId, delta] of pendingEntries) {
      const result = await applyOne(productId, delta);
      if (result === null) break;
    }
    setConfirmBulk(false);
  };

  const filterDefs: FilterDef[] = [
    { key: 'q', label: 'Search', type: 'search', placeholder: 'Product or SKU…' },
    {
      key: 'lowStock',
      label: 'Show',
      type: 'select',
      options: [
        { label: 'Everything', value: 'all' },
        { label: 'Low or out of stock only', value: 'true' },
      ],
    },
  ];

  const columns: Column<InventoryRow>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (row) => (
        <span>
          <strong>{row.name}</strong>
          <br />
          <span className="adm-dim">
            {row.sku} · {row.categoryName}
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
            <span className="adm-sr">
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
      key: 'sellable',
      header: 'Sellable',
      align: 'right',
      numeric: true,
      render: (row) => <strong>{Math.max(0, row.stock - row.reserved)}</strong>,
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.price} />,
    },
    {
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
    },
    {
      key: 'updatedAt',
      header: 'Changed',
      render: (row) => (
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--sm"
          onClick={() => setHistory(row)}
        >
          <RelativeTime value={row.updatedAt} live={false} />
        </button>
      ),
    },
  ];

  const lowRows = low.data?.data ?? [];
  const sortedLow = [...lowRows].sort((a, b) => a.stock - b.stock);
  const meta = inventory.data?.meta;

  const fixturePaths = inventory.isFixture ? ['/vendor/inventory'] : [];

  return (
    <AdminPage
      title="Inventory"
      description="Stock is adjusted by a delta, never set to a total — that is what keeps a sale made while you were typing from being overwritten."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
    >
      {failure ? (
        <div className="adm-fixture" role="alert" style={{ marginBottom: 'var(--s-3)' }}>
          <div>
            <p className="adm-fixture__title">That adjustment did not save</p>
            <p className="adm-fixture__body">{failure}</p>
          </div>
        </div>
      ) : null}

      <AdminSection
        title="Running low"
        description="Out of stock first — a zero is money you are not taking right now."
      >
        {low.loading && !low.hasLoadedOnce ? (
          <div className="adm-skel adm-skel--tile" />
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
                <button
                  type="button"
                  className="adm-btn adm-btn--sm"
                  onClick={() => setDelta(row.productId, (pending[row.productId] ?? 0) + 10)}
                >
                  Queue +10
                </button>
              </article>
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection title="All stock">
        <Toolbar>
          <FilterBar
            filters={filterDefs}
            values={filters}
            onChange={(values: FilterValues) => {
              setPage(1);
              setFilters({ q: values['q'] ?? '', lowStock: values['lowStock'] ?? 'all' });
            }}
            onReset={() => {
              setPage(1);
              setFilters(EMPTY_FILTERS);
            }}
          />
          <Toolbar.Spacer />
          <label className="ven-field__label" htmlFor="ven-reason-select">
            Reason for these changes
          </label>
          <select
            id="ven-reason-select"
            className="ven-select"
            style={{ width: 'auto' }}
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as InventoryAdjust['reason'])
            }
          >
            <option value="restock">Restock — new delivery arrived</option>
            <option value="manual">Manual — count correction, damage, waste</option>
          </select>
        </Toolbar>

        <DataTable
          columns={columns}
          rows={inventory.data?.data ?? []}
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
      </AdminSection>

      {pendingEntries.length > 0 ? (
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
            <button type="button" className="adm-btn" onClick={() => setPending({})}>
              Discard
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              onClick={() => setConfirmBulk(true)}
              disabled={adjust.loading}
            >
              Apply all
            </button>
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmBulk}
        title="Apply every queued adjustment?"
        confirmLabel={`Apply ${pendingEntries.length}`}
        loading={adjust.loading}
        onCancel={() => setConfirmBulk(false)}
        onConfirm={() => {
          void applyAll();
        }}
        body={
          <div className="adm-stack">
            <p>
              Each one is sent as a separate audited change with the reason{' '}
              <strong>{humanise(reason)}</strong>. They are applied one at a time, and if one
              fails the rest are left queued rather than half-applied.
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {pendingEntries.slice(0, 8).map(([productId, delta]) => (
                <li key={productId} className="adm-num">
                  {productId}: {delta > 0 ? '+' : ''}
                  {delta}
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <DetailDrawer
        open={history !== null}
        onClose={() => setHistory(null)}
        title={history?.name ?? ''}
        subtitle="Every movement the server recorded for this product"
        width="min(620px, 96vw)"
      >
        {history ? <InventoryHistory productId={history.productId} /> : null}
      </DetailDrawer>
    </AdminPage>
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
      <button
        type="button"
        className="adm-btn adm-btn--sm"
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
      </button>
      {value !== 0 ? (
        <span className="ven-field__hint" style={{ whiteSpace: 'nowrap' }}>
          → {result}
        </span>
      ) : null}
    </span>
  );
}

/* ================================================================== */
/* History                                                             */
/* ================================================================== */

function InventoryHistory({ productId }: { productId: string }) {
  const path = `/vendor/inventory/${productId}/logs`;
  const logs = useVendorQuery<InventoryLogEntry[]>(path);

  const columns: Column<InventoryLogEntry>[] = [
    {
      key: 'at',
      header: 'When',
      render: (row) => <RelativeTime value={row.at} live={false} />,
    },
    {
      key: 'delta',
      header: 'Change',
      align: 'right',
      numeric: true,
      render: (row) => (
        <strong style={{ color: row.delta < 0 ? 'var(--crit-ink)' : 'var(--good-ink)' }}>
          {row.delta > 0 ? '+' : ''}
          {row.delta}
        </strong>
      ),
    },
    {
      key: 'balance',
      header: 'After',
      align: 'right',
      numeric: true,
      render: (row) => (row.balance === undefined ? '—' : String(row.balance)),
    },
    { key: 'reason', header: 'Reason', render: (row) => humanise(row.reason) },
    {
      key: 'refId',
      header: 'Reference',
      numeric: true,
      render: (row) => row.refId ?? '—',
    },
    { key: 'byName', header: 'By' },
  ];

  return (
    <div className="adm-stack">
      {logs.isFixture ? (
        <p className="ven-note">
          Sample history — <code>{path}</code> is not reachable, so none of these movements are
          real.
        </p>
      ) : null}
      <DataTable
        columns={columns}
        rows={logs.data ?? []}
        loading={logs.loading && !logs.hasLoadedOnce}
        rowKey={(row) => row.id}
        skeletonRows={6}
        empty={
          <EmptyState
            title="No movements yet"
            body="Restocks, sales and corrections all appear here."
            icon={<IconInbox />}
          />
        }
      />
    </div>
  );
}
