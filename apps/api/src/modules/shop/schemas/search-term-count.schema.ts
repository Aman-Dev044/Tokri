import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SearchTermCountDocument = HydratedDocument<SearchTermCount>;

/** How long a day's counts are kept. The read only ever looks back 7 days. */
export const SEARCH_TERM_RETENTION_DAYS = 30;

/**
 * How many times one normalised search term was searched on one UTC day.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
 * No user id, no IP, no session, no device, no timestamp finer than the
 * day. Not "hashed", not "anonymised" — absent. The schema has no field to
 * put them in, and Mongoose's default `strict` mode drops any key a writer
 * tries to add, so a later change to the writer cannot quietly start
 * recording who searched for what. A popularity chart needs a count; it
 * does not need to know who is buying pregnancy tests.
 *
 * `timestamps` is OFF for the same reason: `createdAt` on the first row of
 * the day would be the exact second one particular person searched.
 */
@Schema({
  timestamps: false,
  // Nothing here is edited as a document, so there is nothing to version:
  // the row is exactly term, day, count.
  versionKey: false,
  collection: 'search_term_counts',
})
export class SearchTermCount {
  /** Normalised: trimmed, lowercased, whitespace collapsed. 2-40 chars. */
  @Prop({ required: true })
  term: string;

  /** UTC midnight of the day being counted. */
  @Prop({ type: Date, required: true })
  day: Date;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  count: number;
}

export const SearchTermCountSchema =
  SchemaFactory.createForClass(SearchTermCount);

/** One counter per (term, day) — the target of the `$inc` upsert. */
SearchTermCountSchema.index({ term: 1, day: 1 }, { unique: true });
/**
 * Old days fall away on their own — nothing here is worth keeping. The
 * same index serves the popular read's `day >= …` window, so it is the
 * only one on `day`.
 */
SearchTermCountSchema.index(
  { day: 1 },
  { expireAfterSeconds: SEARCH_TERM_RETENTION_DAYS * 24 * 60 * 60 },
);
