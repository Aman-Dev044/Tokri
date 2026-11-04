import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  SearchTermCount,
  SearchTermCountDocument,
} from '../schemas/search-term-count.schema';

/** Shorter than this is a keystroke, not a search. */
export const SEARCH_TERM_MIN = 2;
/** Longer than this is a pasted paragraph, not a search. */
export const SEARCH_TERM_MAX = 40;
/** How many terms `GET /search/popular` returns. */
export const POPULAR_LIMIT = 8;
/** The window it counts over. */
export const POPULAR_WINDOW_DAYS = 7;
/**
 * A term must have been searched at least this many times in the window to
 * be shown to everyone. One person's one odd query is not "popular", and
 * a list every visitor sees should not be writable by a single request.
 */
export const POPULAR_MIN_COUNT = 2;

export interface PopularSearches {
  windowDays: number;
  terms: { term: string; count: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `"  Amul   BUTTER "` → `"amul butter"`, or `null` for a term that must
 * not be counted at all.
 *
 * Refused outright, whatever its length:
 *   - anything with an `@` — an email address typed into the wrong box;
 *   - a run of six or more digits — a phone number, an order number, a
 *     PIN code or an Aadhaar fragment.
 * Those are personal, and a popular-search list is shown to everyone.
 * Better to under-count a real query than to publish someone's number.
 */
export function normaliseSearchTerm(raw: string): string | null {
  const term = raw.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (term.length < SEARCH_TERM_MIN || term.length > SEARCH_TERM_MAX) return null;
  if (term.includes('@')) return null;
  if (/\d{6,}/.test(term)) return null;
  return term;
}

/** UTC midnight of the given instant. */
function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  POPULAR SEARCHES — counted, never attributed
 * ════════════════════════════════════════════════════════════════════════
 *
 * `count` is called by the two product searches — market-wide
 * `GET /products?q=` and in-store `GET /stores/:id/products?q=` — on their
 * first page only, so "show more" is not a second search. It takes a
 * STRING and nothing else — not the request, not the user, not the IP —
 * so it is structurally incapable of writing who searched. See
 * `SearchTermCount` for the other half of that guarantee.
 *
 * Counting never slows or fails the search. `count` returns before the
 * write starts, and the write swallows its own error into a log line. A
 * counter is a nice-to-have; a search that 500s because the counter
 * collection is unhappy is a broken shop.
 */
@Injectable()
export class PopularSearchesService {
  private readonly logger = new Logger(PopularSearchesService.name);

  constructor(
    @InjectModel(SearchTermCount.name)
    private readonly counts: Model<SearchTermCountDocument>,
  ) {}

  /** Fire-and-forget: the caller never waits on, or sees, the write. */
  count(raw: string): void {
    void this.record(raw);
  }

  /** Awaitable, for tests. Never rejects. */
  async record(raw: string, at: Date = new Date()): Promise<void> {
    const term = normaliseSearchTerm(raw);
    if (term === null) return;

    try {
      await this.counts
        .updateOne(
          { term, day: utcDay(at) },
          { $inc: { count: 1 } },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      // The term itself is not logged: it is user input, and the whole
      // point of this collection is that nobody can tie one to a request.
      this.logger.warn(
        `Search counter write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async popular(now: Date = new Date()): Promise<PopularSearches> {
    // Today plus the six days before it.
    const since = new Date(utcDay(now).getTime() - (POPULAR_WINDOW_DAYS - 1) * DAY_MS);

    const rows = await this.counts
      .aggregate<{ _id: string; count: number }>([
        { $match: { day: { $gte: since } } },
        { $group: { _id: '$term', count: { $sum: '$count' } } },
        { $match: { count: { $gte: POPULAR_MIN_COUNT } } },
        // `_id` breaks ties so the list is stable between two reads.
        { $sort: { count: -1, _id: 1 } },
        { $limit: POPULAR_LIMIT },
      ])
      .exec();

    return {
      windowDays: POPULAR_WINDOW_DAYS,
      terms: rows.map((row) => ({ term: row._id, count: row.count })),
    };
  }
}
