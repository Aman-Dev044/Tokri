'use client';

import { useId } from 'react';

export type FilterType = 'search' | 'select' | 'daterange';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterDef {
  key: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  placeholder?: string;
}

/**
 * Filter state is a flat string map. A daterange occupies two keys — `<key>` is
 * the start and `<key>To` the end — rather than a nested object, because the
 * whole map then serialises straight into a query string and straight back out
 * of `useSearchParams` with no marshalling in between.
 */
export type FilterValues = Record<string, string>;

/**
 * `values` is generic over any object, not pinned to `FilterValues`.
 *
 * TypeScript gives an object TYPE ALIAS an implicit index signature but does
 * NOT give one to an INTERFACE, so a page that declares
 * `interface Filters { q: string; status: string }` — the natural way to write
 * it — is not assignable to `Record<string, string>` and gets a compile error
 * that has nothing to do with anything the author did wrong. Accepting any
 * object and reading it defensively inside removes that footgun; `onChange`
 * still hands back a plain `FilterValues`.
 */
export interface FilterBarProps<V extends object = FilterValues> {
  filters: FilterDef[];
  values: V;
  onChange: (values: FilterValues) => void;
  onReset?: () => void;
  className?: string;
}

/**
 * The filter row above a table.
 *
 * ── CONTROLLED, AND NOT DEBOUNCED HERE ──────────────────────────────────────
 * Every keystroke is reported upward immediately. The page decides what to do
 * with it — typically `useDebounced` before the value reaches `useAdminQuery`.
 *
 * Putting the debounce inside this component would be the obvious convenience
 * and the wrong one: a controlled input whose value trails what was typed loses
 * characters the moment a re-render lands mid-flight, and the bug looks like a
 * flaky keyboard rather than like a state-management mistake.
 */
export function FilterBar<V extends object>({
  filters,
  values,
  onChange,
  onReset,
  className,
}: FilterBarProps<V>) {
  const uid = useId().replace(/:/g, '');

  const read = values as Record<string, string | undefined>;

  const set = (key: string, value: string) => {
    onChange({ ...read, [key]: value } as FilterValues);
  };

  const hasValues = Object.values(read).some(
    (value) => value !== undefined && value !== '' && value !== 'all',
  );

  return (
    <div className={['adm-filters', className].filter(Boolean).join(' ')} role="search">
      {filters.map((filter) => {
        const id = `${uid}-${filter.key}`;

        if (filter.type === 'search') {
          return (
            <div className="adm-field adm-field--search" key={filter.key}>
              <label className="adm-field__label" htmlFor={id}>
                {filter.label}
              </label>
              <input
                id={id}
                className="adm-input"
                type="search"
                value={read[filter.key] ?? ''}
                placeholder={filter.placeholder ?? 'Search…'}
                onChange={(event) => set(filter.key, event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          );
        }

        if (filter.type === 'select') {
          return (
            <div className="adm-field" key={filter.key}>
              <label className="adm-field__label" htmlFor={id}>
                {filter.label}
              </label>
              <select
                id={id}
                className="adm-select"
                value={read[filter.key] ?? 'all'}
                onChange={(event) => set(filter.key, event.target.value)}
              >
                {(filter.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        // daterange — two native date inputs. A hand-built calendar popover is
        // a week of work and worse than the platform's on every device that has
        // a real one.
        return (
          <div className="adm-field" key={filter.key}>
            <span className="adm-field__label">{filter.label}</span>
            <div className="adm-daterange">
              <input
                className="adm-input"
                type="date"
                aria-label={`${filter.label} from`}
                value={read[filter.key] ?? ''}
                max={read[`${filter.key}To`] || undefined}
                onChange={(event) => set(filter.key, event.target.value)}
              />
              <span aria-hidden="true">→</span>
              <input
                className="adm-input"
                type="date"
                aria-label={`${filter.label} to`}
                value={read[`${filter.key}To`] ?? ''}
                min={read[filter.key] || undefined}
                onChange={(event) => set(`${filter.key}To`, event.target.value)}
              />
            </div>
          </div>
        );
      })}

      {onReset ? (
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--sm adm-filters__reset"
          onClick={onReset}
          disabled={!hasValues}
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}
