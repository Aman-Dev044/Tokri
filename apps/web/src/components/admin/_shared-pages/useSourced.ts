'use client';

/**
 * Live endpoint first, clearly-labelled fixture second.
 *
 * The admin API (`/admin/*`) is being built alongside these pages, so any of
 * these endpoints may 404 for a while. The rule these helpers enforce is the
 * one that matters: a page NEVER silently shows made-up numbers. When the call
 * fails we fall back to a fixture *and* flip `isSample`, which every page turns
 * into a loud amber banner (see `SampleBanner`).
 *
 * Nothing here caches or retries — `useAdminQuery` owns that.
 */

import { useMemo } from 'react';
import { useAdminQuery } from '@/hooks';

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/** Every list endpoint answers in this envelope (plan §6.1). */
export interface ListEnvelope<T> {
  data: T[];
  meta: ListMeta;
}

/** Query params. Stringified at the call site so the shape is always the same. */
export type QueryParams = Record<string, string>;

export interface Sourced<T> {
  /** Rows to render — live when we have them, fixture otherwise. */
  rows: T[];
  meta: ListMeta;
  loading: boolean;
  /** true ⇒ `rows` are fixtures. Must be surfaced in the UI. */
  isSample: boolean;
  refetch: () => void;
}

export interface SourcedOne<T> {
  value: T;
  loading: boolean;
  isSample: boolean;
  refetch: () => void;
}

function metaFor(rows: readonly unknown[]): ListMeta {
  return { page: 1, limit: rows.length, total: rows.length, pages: 1 };
}

/**
 * Drop `undefined`/empty entries so we never send `?status=` and have the API
 * read it as a real filter value.
 */
export function cleanParams(
  raw: Record<string, string | number | undefined | null>,
): QueryParams {
  const out: QueryParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text === '') continue;
    out[key] = text;
  }
  return out;
}

/** A list endpoint, with a fixture standing in when it cannot be reached. */
export function useSourcedList<T>(
  path: string,
  params: QueryParams,
  fixture: readonly T[],
): Sourced<T> {
  const { data, loading, error, refetch } = useAdminQuery<ListEnvelope<T>>(path, params);

  return useMemo<Sourced<T>>(() => {
    const live = data ?? null;
    const usable = live !== null && Array.isArray(live.data);

    if (usable) {
      return {
        rows: live.data,
        meta: live.meta ?? metaFor(live.data),
        loading,
        isSample: false,
        refetch: () => {
          void refetch();
        },
      };
    }

    const copy = [...fixture];
    return {
      rows: copy,
      meta: metaFor(copy),
      loading,
      // Only claim "sample" once the request has actually settled. While it is
      // in flight the page shows skeletons, not a false alarm.
      isSample: !loading && (Boolean(error) || live === null),
      refetch: () => {
        void refetch();
      },
    };
  }, [data, loading, error, refetch, fixture]);
}

/** A single-resource endpoint, same contract. */
export function useSourcedOne<T>(path: string, fixture: T): SourcedOne<T> {
  const { data, loading, error, refetch } = useAdminQuery<T>(path);

  return useMemo<SourcedOne<T>>(() => {
    const live = data ?? null;
    return {
      value: live === null ? fixture : live,
      loading,
      isSample: !loading && (Boolean(error) || live === null),
      refetch: () => {
        void refetch();
      },
    };
  }, [data, loading, error, refetch, fixture]);
}

/* ------------------------------------------------------------------ */
/* Client-side list ops — used on the fixture path, and to keep typing */
/* responsive on the live path.                                        */
/* ------------------------------------------------------------------ */

/**
 * A live payload is not the type just because the type says so.
 *
 * `useSourcedOne` hands back whatever the endpoint returned, typed but not
 * validated. Worker A's DTOs are still moving, so a detail view that does
 * `value.entries.length` on a response that omitted `entries` crashes the whole
 * page over one missing key. This keeps that a rendering no-op instead.
 */
export function safeArray<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

export function matchesSearch(haystack: readonly (string | undefined)[], needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (q === '') return true;
  return haystack.some((part) => (part ?? '').toLowerCase().includes(q));
}

/**
 * Inclusive date-window test.
 *
 * `<FilterBar>`'s daterange occupies two keys — `<key>` and `<key>To` — and
 * both are plain `YYYY-MM-DD` strings. Comparing the date part of the row's
 * timestamp as a string is exact for that format and sidesteps timezone
 * arithmetic entirely: an admin filtering "2026-09-20" means that calendar day
 * where they are sitting, not a UTC instant.
 */
export function withinRange(iso: string, from: string, to: string): boolean {
  if (from === '' && to === '') return true;
  const day = iso.slice(0, 10);
  if (from !== '' && day < from) return false;
  if (to !== '' && day > to) return false;
  return true;
}

export function paginate<T>(rows: readonly T[], page: number, limit: number): T[] {
  const start = (page - 1) * limit;
  return rows.slice(start, start + limit);
}

export function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

/** Stable sort by a caller-supplied accessor. */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  accessor: (row: T, key: string) => string | number | null,
): T[] {
  if (sort === null) return [...rows];
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = accessor(a, sort.key);
    const right = accessor(b, sort.key);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * factor;
    }
    return String(left).localeCompare(String(right)) * factor;
  });
}
