'use client';

/**
 * Reviews on the product page — verified purchases only.
 *
 * ── WHAT EACH PART READS ────────────────────────────────────────────────────
 *   GET  /products/:id/reviews        public; the list, newest first, and
 *                                     `summary { average, count }`
 *   GET  /products/:id/reviews/mine   customer only; "may I review this?"
 *                                     and their own review, hidden or not
 *   POST /products/:id/reviews        write one
 *   PATCH /products/:id/reviews/mine  edit it
 *
 * The form is shown only when the API says `canReview` (a delivered order
 * containing the product, no review yet) or there is a review to edit. The
 * rule lives on the server; this screen does not second-guess it, it only
 * explains it when the answer is no.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/shop/format';
import {
  REVIEW_COMMENT_MAX,
  formatRating,
  readMyReview,
  readMyReviewState,
  readReviewPage,
  type MyReview,
  type MyReviewState,
  type Review,
  type ReviewPage,
} from '@/lib/shop/engagement';
import { useShopQuery } from '@/hooks/useShopQuery';
import { StarInput, Stars } from './Stars';

const PAGE_SIZE = 5;

export function ProductReviews({ productId }: { productId: string }) {
  const { user, isAuthenticated } = useAuth();
  const isCustomer = isAuthenticated && user?.role === 'customer';
  const base = `/products/${encodeURIComponent(productId)}/reviews`;

  /* Pages accumulate: "Show more" appends rather than replacing the list
     the reader is half-way down. */
  const [page, setPage] = useState(1);
  const [older, setOlder] = useState<Review[]>([]);

  const list = useShopQuery<ReviewPage>(
    base,
    { page, limit: PAGE_SIZE },
    { anonymous: true, read: useCallback((raw: unknown) => readReviewPage(raw), []) },
  );

  const mine = useShopQuery<MyReviewState>(`${base}/mine`, undefined, {
    enabled: isCustomer,
    read: useCallback((raw: unknown) => readMyReviewState(raw), []),
  });

  // A different product — client-side navigation between two detail pages.
  useEffect(() => {
    setPage(1);
    setOlder([]);
  }, [productId]);

  const current = list.data;
  // De-duplicated by id: while page N+1 is loading the hook still holds
  // page N, which is already in `older`.
  const rows = [
    ...new Map(
      (page === 1 ? (current?.data ?? []) : [...older, ...(current?.data ?? [])]).map(
        (review) => [review.id, review] as const,
      ),
    ).values(),
  ];
  const summary = current?.summary ?? { average: 0, count: 0 };
  const hasMore = current !== null && current.meta.page < current.meta.pages;

  const refreshAll = () => {
    setPage(1);
    setOlder([]);
    list.refetch();
    mine.refetch();
  };

  return (
    <section className="shop-reviews" id="reviews" aria-labelledby="reviews-title">
      <header className="shop-reviews__head">
        <h2 className="shop-reviews__title" id="reviews-title">
          Reviews
        </h2>
        {summary.count > 0 ? (
          <p className="shop-reviews__summary">
            <Stars value={summary.average} />
            <strong className="mono">{formatRating(summary.average)}</strong>
            <span>
              from {summary.count} verified {summary.count === 1 ? 'purchase' : 'purchases'}
            </span>
          </p>
        ) : null}
      </header>

      <YourReview
        base={base}
        isCustomer={isCustomer}
        signedIn={isAuthenticated}
        state={mine.data}
        onSaved={refreshAll}
      />

      {list.error !== null ? (
        <p className="shop-reviews__note" role="status">
          Reviews could not be loaded just now.{' '}
          <button type="button" className="shop-linkish" onClick={list.refetch}>
            Try again
          </button>
        </p>
      ) : list.loading && !list.hasLoadedOnce ? (
        <p className="shop-reviews__note">Loading reviews…</p>
      ) : rows.length === 0 ? (
        <p className="shop-reviews__note">
          No reviews yet. Reviews come only from customers who have received this product.
        </p>
      ) : (
        <>
          <ul className="shop-reviews__list">
            {rows.map((review) => (
              <li key={review.id} className="shop-review">
                <div className="shop-review__head">
                  <Stars value={review.rating} label={`${review.rating} out of 5`} />
                  <span className="shop-review__who">{review.authorName}</span>
                  <span className="shop-review__badge">Verified purchase</span>
                </div>
                {review.comment !== null ? <p className="shop-review__body">{review.comment}</p> : null}
                <p className="shop-review__when">
                  {formatDateTime(review.createdAt) ?? ''}
                  {review.editedAt !== null ? ' · edited' : ''}
                </p>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <button
              type="button"
              className="mnd-btn mnd-btn--outline mnd-btn--sm"
              disabled={list.loading}
              onClick={() => {
                setOlder(rows);
                setPage((n) => n + 1);
              }}
            >
              {list.loading ? 'Loading…' : 'Show more reviews'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ───────────────────────── the customer's own review ───────────────────── */

function YourReview({
  base,
  isCustomer,
  signedIn,
  state,
  onSaved,
}: {
  base: string;
  isCustomer: boolean;
  signedIn: boolean;
  state: MyReviewState | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!signedIn) {
    return (
      <p className="shop-reviews__note">
        Bought this before? <Link href="/login">Sign in</Link> to review it.
      </p>
    );
  }
  if (!isCustomer || state === null) return null;

  const existing = state.review;

  if (existing !== null && !editing) {
    return (
      <div className="shop-reviews__mine">
        <p className="shop-reviews__mine-title">Your review</p>
        <div className="shop-review__head">
          <Stars value={existing.rating} label={`You gave ${existing.rating} out of 5`} />
          {existing.isHidden ? (
            <span className="shop-review__badge" data-tone="warn">
              Hidden by a moderator
            </span>
          ) : null}
        </div>
        {existing.comment !== null ? <p className="shop-review__body">{existing.comment}</p> : null}
        <button
          type="button"
          className="mnd-btn mnd-btn--ghost mnd-btn--sm"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit your review
        </button>
      </div>
    );
  }

  if (existing === null && !state.canReview) {
    return (
      <p className="shop-reviews__note">
        You can review this once an order containing it has been delivered to you.
      </p>
    );
  }

  return (
    <ReviewForm
      base={base}
      existing={existing}
      onCancel={existing !== null ? () => setEditing(false) : null}
      onSaved={() => {
        setEditing(false);
        onSaved();
      }}
    />
  );
}

function ReviewForm({
  base,
  existing,
  onCancel,
  onSaved,
}: {
  base: string;
  existing: MyReview | null;
  onCancel: (() => void) | null;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rating === null) {
      setProblem('Choose a rating from one to five stars.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const body = { rating, comment: comment.trim() === '' ? null : comment.trim() };
      const raw =
        existing === null
          ? await api.post<unknown>(base, body)
          : await api.patch<unknown>(`${base}/mine`, body);
      if (readMyReview(raw) === null) throw new Error('Unexpected reply');
      onSaved();
    } catch (cause) {
      setProblem(
        cause instanceof ApiError ? cause.friendlyMessage : 'Could not save your review. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="shop-reviews__form" onSubmit={(event) => void submit(event)}>
      <p className="shop-reviews__mine-title">
        {existing === null ? 'Review this product' : 'Edit your review'}
      </p>
      <StarInput legend="Your rating" value={rating} onChange={setRating} disabled={busy} />
      <label className="shop-reviews__label" htmlFor="review-comment">
        Comment <span className="shop-reviews__optional">(optional)</span>
      </label>
      <textarea
        id="review-comment"
        className="mnd-field__input shop-reviews__text"
        rows={3}
        maxLength={REVIEW_COMMENT_MAX}
        value={comment}
        disabled={busy}
        onChange={(event) => {
          setComment(event.target.value);
        }}
        placeholder="How was it? Freshness, taste, packing…"
      />
      <p className="shop-reviews__count mono">
        {comment.length}/{REVIEW_COMMENT_MAX}
      </p>
      {problem !== null ? (
        <p className="shop-notice shop-notice--error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="shop-reviews__actions">
        <button type="submit" className="mnd-btn mnd-btn--solid mnd-btn--sm" disabled={busy}>
          {busy ? 'Saving…' : existing === null ? 'Post review' : 'Save changes'}
        </button>
        {onCancel !== null ? (
          <button
            type="button"
            className="mnd-btn mnd-btn--ghost mnd-btn--sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
      </div>
      <p className="shop-reviews__optional">
        Shown publicly with your first name and initial, marked as a verified purchase.
      </p>
    </form>
  );
}
