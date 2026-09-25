'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAV_ITEMS, type NavItem } from '@/lib/admin/nav';
import type { AdminLevel } from '@/lib/admin/types';
import { NAV_ICONS } from './icons';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  level: AdminLevel;
}

/**
 * ⌘K / Ctrl-K. Thirteen screens is exactly the size at which a sidebar stops
 * being the fastest way to reach one.
 *
 * ── MATCHING ────────────────────────────────────────────────────────────────
 * Subsequence matching, not substring: "sett" reaches Settlements AND Settings,
 * and "vnd" reaches Vendors. Substring matching on a thirteen-item list means
 * typing the beginning of a word you have to remember exactly.
 *
 * Results are ranked so a prefix match on the label wins over a match buried in
 * the hint, which is what makes the first Enter press do the obvious thing.
 *
 * Super-admin-only destinations are filtered out for a plain ADMIN, same as the
 * sidebar. That is presentation — the API's RolesGuard is the enforcement.
 */
export function CommandPalette({ open, onClose, level }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const pool = useMemo(
    () => NAV_ITEMS.filter((item) => level === 'SUPER_ADMIN' || !item.superAdmin),
    [level],
  );

  const results = useMemo(() => rank(pool, query), [pool, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    // The input is the whole interaction; anything else focused is a wasted
    // keystroke.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const go = (item: NavItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  return (
    <div className="adm-palette__scrim" onClick={onClose} role="presentation">
      <div
        className="adm-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search the console"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="adm-palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="adm-palette-list"
          aria-activedescendant={`adm-palette-opt-${cursor}`}
          placeholder="Go to…  vendors, settlements, audit"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(results[cursor]);
            }
          }}
        />

        <ul className="adm-palette__list" id="adm-palette-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <li style={{ padding: 'var(--s-4)', color: 'var(--adm-dim)' }}>
              Nothing matches “{query}”.
            </li>
          ) : (
            results.map((item, i) => {
              const Icon = NAV_ICONS[item.icon];
              return (
                <li key={item.href} role="none">
                  <button
                    type="button"
                    id={`adm-palette-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === cursor}
                    className="adm-palette__item"
                    data-active={i === cursor ? 'true' : undefined}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(item)}
                  >
                    <Icon />
                    <span style={{ minWidth: 0 }}>
                      <strong>{item.label}</strong>
                      <span className="adm-palette__hint">{item.hint}</span>
                    </span>
                    <span className="adm-kbd">{item.href}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="adm-palette__foot">
          <span>
            <span className="adm-kbd">↑</span> <span className="adm-kbd">↓</span> to move
          </span>
          <span>
            <span className="adm-kbd">↵</span> to open
          </span>
          <span>
            <span className="adm-kbd">esc</span> to close
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Subsequence score. Returns -1 for no match; higher is better.
 *
 * A contiguous prefix of the label scores highest, a scattered match in the
 * label next, and a match that only appears in the hint last — so typing "ord"
 * ranks Orders above "Coupons · codes, limits, redemption" even though both
 * contain the letters in order.
 */
function score(item: NavItem, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  const label = item.label.toLowerCase();

  if (label.startsWith(q)) return 1000 - label.length;
  if (label.includes(q)) return 800 - label.indexOf(q);

  if (isSubsequence(q, label)) return 600;
  if (item.hint.toLowerCase().includes(q)) return 400;
  if (item.href.toLowerCase().includes(q)) return 300;
  return -1;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

function rank(items: readonly NavItem[], query: string): NavItem[] {
  return items
    .map((item) => ({ item, s: score(item, query) }))
    .filter((entry) => entry.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((entry) => entry.item);
}
