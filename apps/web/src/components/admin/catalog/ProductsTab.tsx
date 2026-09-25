'use client';

import { useMemo, useState } from 'react';

import {
  AisleDot,
  ConfirmDialog,
  DataTable,
  FilterBar,
  KpiTile,
  Money,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation, useDebounced } from '@/hooks';
import { formatCount } from '@/lib/admin/format';

import { AISLE_OPTIONS } from '../_shared-pages/aisles';
import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  type SortState,
} from '../_shared-pages/useSourced';
import { PRODUCTS_FIXTURE, type ProductRow } from './fixtures';

const ENDPOINT = '/admin/products';
const LIMIT = 12;

const STATUS_OPTIONS = [
  { label: 'All products', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

const STOCK_OPTIONS = [
  { label: 'Any stock', value: '' },
  { label: 'Low stock', value: 'low' },
  { label: 'Out of stock', value: 'out' },
];

interface Filters {
  q: string;
  aisle: string;
  status: string;
  stock: string;
}

const EMPTY_FILTERS: Filters = { q: '', aisle: '', status: '', stock: '' };

type StockLevel = 'ok' | 'low' | 'out';

function stockLevel(row: ProductRow): StockLevel {
  if (row.stock <= 0) return 'out';
  if (row.stock <= row.lowStockThreshold) return 'low';
  return 'ok';
}

function sortValue(row: ProductRow, key: string): string | number | null {
  switch (key) {
    case 'name':
      return row.name;
    case 'vendor':
      return row.vendorName;
    case 'category':
      return row.categoryName;
    case 'price':
      return row.pricePaise;
    case 'stock':
      return row.stock;
    case 'status':
      return row.isActive ? 'active' : 'inactive';
    default:
      return null;
  }
}

export function ProductsTab() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({ key: 'stock', dir: 'asc' });
  const [toggling, setToggling] = useState<ProductRow | null>(null);

  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        aisle: filters.aisle,
        status: filters.status,
        stock: filters.stock,
        page,
        limit: LIMIT,
      }),
    [debouncedQ, filters.aisle, filters.status, filters.stock, page],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<ProductRow>(
    ENDPOINT,
    params,
    PRODUCTS_FIXTURE,
  );

  const setActive = useAdminMutation<{ isActive: boolean }, ProductRow>(
    toggling === null ? ENDPOINT : `${ENDPOINT}/${toggling.id}/status`,
    'PATCH',
  );

  const filtered = useMemo(() => {
    const matched = rows.filter((row) => {
      if (
        !matchesSearch(
          [row.name, row.sku, row.brand ?? undefined, row.vendorName, row.categoryName],
          debouncedQ,
        )
      ) {
        return false;
      }
      if (filters.aisle !== '' && row.aisleKey !== filters.aisle) return false;
      if (filters.status === 'active' && !row.isActive) return false;
      if (filters.status === 'inactive' && row.isActive) return false;
      const level = stockLevel(row);
      if (filters.stock === 'low' && level !== 'low') return false;
      if (filters.stock === 'out' && level !== 'out') return false;
      return true;
    });
    return sortRows(matched, sort, sortValue);
  }, [rows, debouncedQ, filters.aisle, filters.status, filters.stock, sort]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const kpis = useMemo(() => {
    let low = 0;
    let out = 0;
    let active = 0;
    for (const row of rows) {
      const level = stockLevel(row);
      if (level === 'low') low += 1;
      if (level === 'out') out += 1;
      if (row.isActive) active += 1;
    }
    return { total: rows.length, active, low, out };
  }, [rows]);

  async function applyToggle() {
    if (toggling === null) return;
    await setActive.mutate({ isActive: !toggling.isActive });
    setToggling(null);
    refetch();
  }

  return (
    <>
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Products"
          value={kpis.total}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Active"
          value={kpis.active}
          tone="good"
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Low stock"
          value={kpis.low}
          tone={kpis.low > 0 ? 'warn' : 'neutral'}
          deltaLabel="at or below the vendor's threshold"
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Out of stock"
          value={kpis.out}
          tone={kpis.out > 0 ? 'crit' : 'neutral'}
          deltaLabel="unbuyable right now"
          loading={loading}
        />
      </div>

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search' },
          {
            key: 'aisle',
            label: 'Aisle',
            type: 'select',
            options: [{ label: 'All aisles', value: '' }, ...AISLE_OPTIONS],
          },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
          { key: 'stock', label: 'Stock', type: 'select', options: STOCK_OPTIONS },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            q: next.q ?? '',
            aisle: next.aisle ?? '',
            status: next.status ?? '',
            stock: next.stock ?? '',
          });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: ProductRow) => row.id}
        rows={visible}
        loading={loading}
        empty="No product matches those filters."
        page={page}
        pageCount={pageCount(filtered.length, LIMIT)}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'name',
            header: 'Product',
            sortable: true,
            render: (row: ProductRow) => (
              <span className={styles.rowWrap}>
                <AisleDot aisle={row.aisleKey} />
                <span className={styles.twoLine}>
                  <span className={styles.strong}>{row.name}</span>
                  <span className={styles.subtle}>
                    {row.brand === null ? '' : `${row.brand} · `}
                    <span className={styles.mono}>{row.sku}</span> · {row.unitValue}
                    {row.unit}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: 'vendor',
            header: 'Vendor',
            sortable: true,
            render: (row: ProductRow) => <span className={styles.truncate}>{row.vendorName}</span>,
          },
          {
            key: 'category',
            header: 'Category',
            width: '12rem',
            sortable: true,
            render: (row: ProductRow) => row.categoryName,
          },
          {
            key: 'price',
            header: 'Price',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: ProductRow) => (
              <span className={styles.twoLine}>
                <Money value={row.pricePaise} />
                {row.mrpPaise > row.pricePaise ? (
                  <span className={styles.subtle}>
                    MRP <Money value={row.mrpPaise} />
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'stock',
            header: 'Stock',
            align: 'right',
            width: '8rem',
            sortable: true,
            render: (row: ProductRow) => {
              const level = stockLevel(row);
              // Colour never carries the meaning alone — the word is there too.
              return (
                <span className={styles.twoLine}>
                  <span
                    className={`${styles.num} ${
                      level === 'out' ? styles.crit : level === 'low' ? styles.warn : ''
                    }`}
                  >
                    {formatCount(row.stock)}
                  </span>
                  {level === 'ok' ? (
                    <span className={styles.subtle}>min {row.lowStockThreshold}</span>
                  ) : (
                    <span className={level === 'out' ? styles.crit : styles.warn}>
                      <span className={styles.subtle}>
                        {level === 'out' ? 'out of stock' : 'low stock'}
                      </span>
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            width: '7rem',
            sortable: true,
            render: (row: ProductRow) => (
              <StatusPill status={row.isActive ? 'active' : 'inactive'} />
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: '8rem',
            render: (row: ProductRow) => (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onClick={() => setToggling(row)}
              >
                {row.isActive ? 'Deactivate' : 'Activate'}
              </button>
            ),
          },
        ]}
      />

      {/*
        Enabling a listing across vendors is an admin privilege. Hiding the
        button would be UX only; the API's RolesGuard is the enforcement.
      */}
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive === true ? 'Deactivate this product?' : 'Activate this product?'}
        body={
          toggling === null
            ? ''
            : toggling.isActive
              ? `${toggling.name} will disappear from browse and search for every customer of ${toggling.vendorName}. Carts that already hold it are re-validated at checkout.`
              : `${toggling.name} will become buyable again, subject to its stock (${formatCount(
                  toggling.stock,
                )} on hand).`
        }
        confirmLabel={toggling?.isActive === true ? 'Deactivate' : 'Activate'}
        destructive={toggling?.isActive === true}
        loading={setActive.loading}
        onConfirm={() => {
          void applyToggle();
        }}
        onCancel={() => setToggling(null)}
      />
    </>
  );
}
