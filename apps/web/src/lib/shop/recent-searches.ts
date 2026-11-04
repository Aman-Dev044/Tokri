/**
 * The customer's own recent searches — on THIS DEVICE and nowhere else.
 *
 * Recent searches are personal (they are a list of what one person wanted),
 * so they never go to the API: `GET /search/popular` is anonymous counts
 * across everyone, and this is its private half. localStorage can throw —
 * private mode, a full quota, storage blocked by policy — so every access is
 * wrapped, and a failure simply means "no history", never a broken search box.
 */

const KEY = 'mandi.recent-searches';

/** How many are kept. Older ones fall off the end. */
export const RECENT_SEARCH_LIMIT = 8;

/** Same normalisation as the API's counter, so "Milk " and "milk" are one entry. */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .slice(0, RECENT_SEARCH_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — the list just does not persist */
  }
}

/** Puts `query` at the front, case-insensitively de-duplicated. Returns the new list. */
export function rememberSearch(query: string): string[] {
  const term = normaliseQuery(query);
  if (term === '') return readRecentSearches();
  const key = term.toLowerCase();
  const next = [
    term,
    ...readRecentSearches().filter((item) => item.toLowerCase() !== key),
  ].slice(0, RECENT_SEARCH_LIMIT);
  write(next);
  return next;
}

export function forgetSearch(query: string): string[] {
  const key = query.toLowerCase();
  const next = readRecentSearches().filter((item) => item.toLowerCase() !== key);
  write(next);
  return next;
}

export function clearRecentSearches(): void {
  write([]);
}
