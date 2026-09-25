'use client';

import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { IconArrowUp, IconChevronLeft, IconChevronRight, IconInbox } from './icons';
import { EmptyState } from './primitives';

/* ================================================================== */
/* Contract                                                            */
/* ================================================================== */

export type ColumnAlign = 'left' | 'right' | 'center';

export interface Column<T> {
  /** matches a key on the row unless `render` is given; also the sort key */
  key: string;
  header: string;
  align?: ColumnAlign;
  /** a CSS width — `'22ch'`, `'160px'`. Columns are otherwise content-sized. */
  width?: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  /** render the cell in the mono face — every column of digits should */
  numeric?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  /** shown when `rows` is empty and not loading */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** 1-based */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  /** `null` is accepted as well as omitted — both mean nothing is sorted. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** stable identity per row — never the array index */
  rowKey: (row: T) => string;
  /** total row count for the "1–20 of 214" line */
  total?: number;
  /** how many skeleton rows to draw while loading */
  skeletonRows?: number;
  className?: string;
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

/**
 * The console's one table.
 *
 * ── SORTING AND PAGING ARE CONTROLLED, ALWAYS ───────────────────────────────
 * This component never sorts or slices anything itself. It reports the
 * interaction and re-renders with what it is given, because on every real
 * screen here the data set is larger than the page and the server does the
 * work. A table that quietly sorts the 20 rows it happens to be holding, while
 * the user believes they sorted 214, is worse than no sorting at all.
 *
 * ── THE STAGGER ────────────────────────────────────────────────────────────
 * Rows animate in 20ms apart (admin.css), which reads as "this list just
 * changed" — the point of the animation is to catch the eye when a filter
 * lands. It is capped at 14 rows: past that, the stagger stops being feedback
 * and becomes a queue you wait through.
 *
 * ── HORIZONTAL SCROLL ──────────────────────────────────────────────────────
 * The scroller is `.adm-tablewrap`, around the table and nothing else. The page
 * body never scrolls sideways.
 */
export function DataTable<T>({
  columns,
  rows,
  loading = false,
  empty,
  onRowClick,
  page,
  pageCount,
  onPageChange,
  sort,
  onSortChange,
  rowKey,
  total,
  skeletonRows = 8,
  className,
}: DataTableProps<T>) {
  const clickable = Boolean(onRowClick);

  const headers = useMemo(
    () =>
      columns.map((column) => {
        const sorted = sort?.key === column.key ? sort.dir : undefined;
        return { column, sorted };
      }),
    [columns, sort],
  );

  const handleSort = (key: string) => {
    if (!onSortChange) return;
    const next: SortState =
      sort?.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : // A new column starts descending: on this console every sortable
          // column is a quantity or a date, and "most first" is the question.
          { key, dir: 'desc' };
    onSortChange(next);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  };

  const showEmpty = !loading && rows.length === 0;

  return (
    <div className={['adm-tablewrap', className].filter(Boolean).join(' ')}>
      <table className="adm-table">
        <thead>
          <tr>
            {headers.map(({ column, sorted }) => (
              <th
                key={column.key}
                scope="col"
                data-align={column.align ?? 'left'}
                style={column.width ? { width: column.width } : undefined}
                aria-sort={
                  sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                }
              >
                {column.sortable && onSortChange ? (
                  <button
                    type="button"
                    className="adm-table__sort"
                    data-sorted={sorted ?? 'none'}
                    onClick={() => handleSort(column.key)}
                  >
                    {column.header}
                    <IconArrowUp />
                    <span className="adm-sr">
                      {sorted === 'asc'
                        ? ', sorted ascending'
                        : sorted === 'desc'
                          ? ', sorted descending'
                          : ', sort by this column'}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loading
            ? // Skeleton rows are shaped like the real ones — same height, same
              // column count — so the layout does not jump when data lands.
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`skel-${i}`} aria-hidden="true">
                  {columns.map((column) => (
                    <td key={column.key} data-align={column.align ?? 'left'}>
                      <span
                        className="adm-skel adm-skel--line"
                        style={{
                          display: 'block',
                          width: column.align === 'right' ? '60%' : '80%',
                          marginLeft: column.align === 'right' ? 'auto' : undefined,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => (
                <tr
                  key={rowKey(row)}
                  data-clickable={clickable ? 'true' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                  onKeyDown={clickable ? (event) => onRowKeyDown(event, row) : undefined}
                  style={{ ['--adm-i' as string]: String(Math.min(i, 14)) }}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-align={column.align ?? 'left'}
                      className={column.numeric ? 'is-num' : undefined}
                    >
                      {column.render ? column.render(row) : readCell(row, column.key)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>

      {showEmpty ? (
        <div>
          {empty ?? (
            <EmptyState
              title="Nothing here"
              body="No rows matched. Widen the filters, or clear them to start again."
              icon={<IconInbox />}
            />
          )}
        </div>
      ) : null}

      {page !== undefined && pageCount !== undefined && pageCount > 1 ? (
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          rowsOnPage={rows.length}
          onPageChange={onPageChange}
        />
      ) : null}
    </div>
  );
}

/**
 * Fallback cell rendering for a column with no `render`.
 *
 * `T` is generic, so reading `row[key]` needs a narrowing step. Anything that
 * is not a string or a finite number renders as an em-dash rather than as
 * `[object Object]` or the string "undefined" — a table cell that says
 * "undefined" is how a missing API field reaches a screenshot.
 */
function readCell<T>(row: T, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '—';
}

/* ================================================================== */
/* Pager                                                               */
/* ================================================================== */

function Pager({
  page,
  pageCount,
  total,
  rowsOnPage,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total?: number;
  rowsOnPage: number;
  onPageChange?: (page: number) => void;
}) {
  const first = total === undefined ? null : (page - 1) * Math.max(rowsOnPage, 1) + 1;

  return (
    <div className="adm-pager">
      <span>
        {total === undefined || first === null
          ? `Page ${page} of ${pageCount}`
          : `${first.toLocaleString('en-IN')}–${(first + rowsOnPage - 1).toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}
      </span>

      <div className="adm-pager__nav">
        <button
          type="button"
          className="adm-btn adm-btn--sm adm-btn--icon"
          disabled={page <= 1}
          onClick={() => onPageChange?.(page - 1)}
        >
          <IconChevronLeft />
          <span className="adm-sr">Previous page</span>
        </button>
        <span className="adm-num" style={{ padding: '0 var(--s-2)' }}>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="adm-btn adm-btn--sm adm-btn--icon"
          disabled={page >= pageCount}
          onClick={() => onPageChange?.(page + 1)}
        >
          <IconChevronRight />
          <span className="adm-sr">Next page</span>
        </button>
      </div>
    </div>
  );
}
