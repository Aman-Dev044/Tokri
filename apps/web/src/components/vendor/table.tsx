'use client';

/**
 * ★ THE TABLES STAY TABLES.
 *
 * The dashboard and the earnings screen are bento. The catalogue, the stock
 * list, the ledger and the order history are not, and turning them into cards
 * would be a mistake dressed as a redesign: the question those screens answer
 * is "compare these rows", and a grid of cards destroys the one thing that
 * makes comparison possible — a shared column edge that the eye can run down.
 *
 * So this is a real `<table>`, with real `<th scope="col">`, and it gets three
 * things right that a div-grid cannot:
 *
 *   · Screen readers announce row and column position.
 *   · Numeric columns are right-aligned and mono, so digits line up by place
 *     value and a wrong order of magnitude is visible without reading.
 *   · A wide table scrolls INSIDE ITS OWN CONTAINER. The page body never
 *     scrolls sideways — a horizontal scrollbar on the document is how a
 *     tablet user loses the sidebar and cannot find it again.
 */

import type { ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from './icons';
import { Btn } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right';
  /** mono + tabular figures, for anything that is a quantity or a code */
  numeric?: boolean;
  width?: string;
  render?: (row: T) => ReactNode;
}

export interface VenTableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
  /* pagination — omit every one of these for an unpaginated table */
  page?: number;
  pageCount?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}

export function VenTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 5,
  empty,
  onRowClick,
  caption,
  page,
  pageCount,
  total,
  onPageChange,
}: VenTableProps<T>) {
  const showEmpty = !loading && rows.length === 0;

  return (
    <div className="ven-tablewrap">
      <div className="ven-scroll">
        <table className="ven-table">
          {caption ? <caption className="ven-sr">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  data-align={column.align ?? 'left'}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
                  <tr key={`skel-${rowIndex}`} aria-hidden="true">
                    {columns.map((column) => (
                      <td key={column.key} data-align={column.align ?? 'left'}>
                        {/* Widths vary per column so the block reads as text,
                            not as a grey grid. */}
                        <span
                          className="ven-skel"
                          style={{
                            height: 12,
                            width: `${45 + ((rowIndex * 13 + column.key.length * 7) % 45)}%`,
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, rowIndex) => (
                  <tr
                    key={rowKey(row)}
                    style={{ ['--i' as string]: Math.min(rowIndex, 14) }}
                    data-clickable={onRowClick ? 'true' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    // A clickable row must be reachable without a mouse. The
                    // row keeps its semantics; the keyboard just gets the same
                    // affordance the pointer already had.
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        data-align={column.align ?? 'left'}
                        data-num={column.numeric ? 'true' : undefined}
                      >
                        {column.render
                          ? column.render(row)
                          : String((row as Record<string, unknown>)[column.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {showEmpty ? <div className="ven-table__empty">{empty}</div> : null}

      {page !== undefined && pageCount !== undefined && pageCount > 1 && onPageChange ? (
        <div className="ven-pager">
          <span className="ven-pager__count">
            Page <span className="ven-num">{page}</span> of{' '}
            <span className="ven-num">{pageCount}</span>
            {total !== undefined ? (
              <>
                {' · '}
                <span className="ven-num">{total}</span> in total
              </>
            ) : null}
          </span>
          <span className="ven-pager__btns">
            <Btn size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <IconChevronLeft />
              Previous
            </Btn>
            <Btn size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
              Next
              <IconChevronRight />
            </Btn>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Toolbar                                                             */
/* ================================================================== */

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ven-toolbar">{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ven-toolbar__spacer" />;
}

/* ================================================================== */
/* Search + select filters                                             */
/* ================================================================== */

export interface SelectOption {
  label: string;
  value: string;
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <label className="ven-search">
      <span className="ven-sr">{label}</span>
      <input
        className="ven-input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function SelectBox({
  value,
  onChange,
  options,
  label,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  label: string;
  id?: string;
}) {
  return (
    <label className="ven-selectwrap">
      <span className="ven-selectwrap__label">{label}</span>
      <select
        id={id}
        className="ven-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
