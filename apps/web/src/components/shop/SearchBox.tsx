'use client';

/**
 * The shop search box, with its suggestions.
 *
 * Two lists, from two very different places:
 *
 *   Recent   — the last eight things THIS person searched, kept on this
 *              device only (`lib/shop/recent-searches`). Never sent anywhere.
 *              Shown filtered by what is typed, with a Clear.
 *   Popular  — `GET /search/popular`: the week's most-searched terms, counted
 *              anonymously across everyone. Shown only while the box is empty
 *              — once someone is typing, a list of other people's words is
 *              noise. Fetched on first focus, not on every page load.
 *
 * ── THE COMBOBOX ────────────────────────────────────────────────────────────
 * The input is an ARIA combobox over one listbox; ↑/↓ move through every
 * option across both groups, Enter picks the highlighted one (or searches what
 * is typed when nothing is highlighted), Escape closes. Options are pressed on
 * `mousedown` with `preventDefault`, so the input never blurs mid-click and the
 * panel does not vanish under the pointer. "Clear" sits OUTSIDE the listbox —
 * a listbox may only hold options — and is reachable with Tab.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShopQuery } from '@/hooks/useShopQuery';
import {
  clearRecentSearches,
  normaliseQuery,
  readRecentSearches,
  rememberSearch,
} from '@/lib/shop/recent-searches';
import { readPopularSearches, type PopularSearches } from '@/lib/shop/types';

interface Option {
  kind: 'recent' | 'popular';
  term: string;
}

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const listId = useId();
  const wrapRef = useRef<HTMLFormElement | null>(null);

  const [query, setQuery] = useState(urlQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  /* Latched true on first focus: popular terms are fetched once, lazily. */
  const [wantPopular, setWantPopular] = useState(false);

  /* The URL is the source of truth for the current search — a popular term
     picked here, or ShopView clearing `?q=`, both land back in the box. */
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const popular = useShopQuery<PopularSearches>('/search/popular', undefined, {
    anonymous: true,
    enabled: wantPopular,
    read: useCallback((raw: unknown) => readPopularSearches(raw), []),
  });

  const typed = normaliseQuery(query).toLowerCase();

  const options = useMemo<Option[]>(() => {
    const mine = recent
      .filter((term) => typed === '' || term.toLowerCase().includes(typed))
      .filter((term) => term.toLowerCase() !== typed)
      .map((term): Option => ({ kind: 'recent', term }));
    if (typed !== '') return mine;

    const seen = new Set(recent.map((term) => term.toLowerCase()));
    const theirs = (popular.data?.terms ?? [])
      .filter(({ term }) => !seen.has(term.toLowerCase()))
      .map(({ term }): Option => ({ kind: 'popular', term }));
    return [...mine, ...theirs];
  }, [recent, popular.data, typed]);

  const recentOptions = options.filter((option) => option.kind === 'recent');
  const popularOptions = options.filter((option) => option.kind === 'popular');
  const showPanel = open && (options.length > 0 || (typed === '' && recent.length > 0));

  /* A list that changed under the highlight must not leave it pointing past the end. */
  useEffect(() => {
    setActive(-1);
  }, [typed, open]);

  const go = useCallback(
    (raw: string) => {
      const term = normaliseQuery(raw);
      setOpen(false);
      setActive(-1);
      setQuery(term);
      if (term !== '') setRecent(rememberSearch(term));
      // ★ Products, not stores. `GET /products?q=` searches the whole market
      // through the `searchText` index, so the search box can answer the
      // question people actually type into it — "milk", not "which shop
      // might sell milk".
      router.push(term === '' ? '/shop' : `/shop?q=${encodeURIComponent(term)}`);
    },
    [router],
  );

  const optionId = (index: number) => `${listId}-opt-${index}`;

  const renderOption = (option: Option) => {
    const index = options.indexOf(option);
    return (
      <li
        key={`${option.kind}:${option.term}`}
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        className="shop-suggest__option"
        data-active={index === active ? 'true' : undefined}
        onMouseDown={(event) => {
          event.preventDefault();
          go(option.term);
        }}
        onMouseEnter={() => {
          setActive(index);
        }}
      >
        {option.kind === 'recent' ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 5v3.2l2.1 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M2.5 11.5 6 8l2.5 2.5L13.5 5.5 M10 5.5h3.5V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span className="shop-suggest__term">{option.term}</span>
      </li>
    );
  };

  return (
    <form
      ref={wrapRef}
      className="shop-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const picked = active >= 0 ? options[active] : undefined;
        go(picked !== undefined ? picked.term : query);
      }}
      onBlur={(event) => {
        // Focus moving to "Clear" (inside the form) keeps the panel open.
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor="shop-q" className="mnd-visually-hidden">
        Search for a product
      </label>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M10.6 10.6 L14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      {/* `GET /products?q=` is market-wide and rides the `searchText` text
          index, so the placeholder can promise items. `/stores?q=` still
          searches store names; it is one link away. */}
      <input
        id="shop-q"
        type="search"
        className="shop-search__input"
        placeholder="Search for milk, atta, bananas…"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-activedescendant={showPanel && active >= 0 ? optionId(active) : undefined}
        value={query}
        onFocus={() => {
          setRecent(readRecentSearches());
          setWantPopular(true);
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
          if (options.length === 0) return;
          setActive((current) =>
            event.key === 'ArrowDown'
              ? (current + 1) % options.length
              : current <= 0
                ? options.length - 1
                : current - 1,
          );
        }}
      />

      {showPanel ? (
        <div className="shop-suggest">
          {recentOptions.length > 0 || (typed === '' && recent.length > 0) ? (
            <div className="shop-suggest__head">
              <p className="eyebrow" id={`${listId}-recent`}>
                Your recent searches
              </p>
              <button
                type="button"
                className="shop-suggest__clear"
                onClick={() => {
                  clearRecentSearches();
                  setRecent([]);
                }}
              >
                Clear
              </button>
            </div>
          ) : null}

          <ul id={listId} role="listbox" aria-label="Search suggestions" className="shop-suggest__list">
            {recentOptions.length > 0 ? (
              <li role="presentation">
                <ul role="group" aria-labelledby={`${listId}-recent`} className="shop-suggest__group">
                  {recentOptions.map(renderOption)}
                </ul>
              </li>
            ) : null}

            {popularOptions.length > 0 ? (
              <li role="presentation">
                <p className="eyebrow shop-suggest__label" id={`${listId}-popular`}>
                  Popular this week
                </p>
                <ul role="group" aria-labelledby={`${listId}-popular`} className="shop-suggest__group">
                  {popularOptions.map(renderOption)}
                </ul>
              </li>
            ) : null}
          </ul>

          <p className="shop-suggest__note">
            Recent searches stay on this device. Popular ones are counted anonymously.
          </p>
        </div>
      ) : null}
    </form>
  );
}
