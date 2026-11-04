'use client';

/**
 * "How was it?" — the one rating a delivered order can get.
 *
 * `POST /orders/:id/rating` takes the store's stars, the rider's (only when a
 * rider carried the order — `hasRider`) and an optional comment. It succeeds
 * once per order, only after delivery, and only until `rateUntil`; the panel
 * reads `canRate` from `GET /orders/:id` rather than recomputing that window,
 * so the screen and the API cannot disagree about whether it is still open.
 *
 * Once given, the rating is shown back as given — never editable here, since
 * the store's average has already absorbed it.
 */

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/shop/format';
import { readOrderRating, type OrderDetail } from '@/lib/shop/types';
import { StarInput, Stars } from './Stars';

const COMMENT_MAX = 500;

export function OrderRatingPanel({
  order,
  storeName,
  onRated,
}: {
  order: OrderDetail;
  storeName: string;
  onRated: () => void;
}) {
  const [storeRating, setStoreRating] = useState<number | null>(null);
  const [riderRating, setRiderRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (order.status !== 'DELIVERED') return null;

  if (order.rating !== null) {
    return (
      <section className="shop-rate" aria-label="Your rating">
        <h3 className="shop-rate__title">Your rating</h3>
        <p className="shop-rate__given">
          <span>{storeName}</span>
          <Stars value={order.rating.storeRating} label={`${order.rating.storeRating} out of 5`} />
        </p>
        {order.rating.riderRating !== null ? (
          <p className="shop-rate__given">
            <span>Rider</span>
            <Stars value={order.rating.riderRating} label={`${order.rating.riderRating} out of 5`} />
          </p>
        ) : null}
        {order.rating.comment !== null ? (
          <p className="shop-rate__comment">“{order.rating.comment}”</p>
        ) : null}
        <p className="shop-summary__note">Thank you — it counts towards the store’s rating.</p>
      </section>
    );
  }

  if (!order.canRate) {
    return (
      <p className="shop-summary__note">
        The window to rate this order has closed — ratings are open for 14 days after delivery.
      </p>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (storeRating === null) {
      setProblem(`Choose how many stars to give ${storeName}.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const raw = await api.post<unknown>(`/orders/${encodeURIComponent(order.id)}/rating`, {
        storeRating,
        ...(order.hasRider && riderRating !== null ? { riderRating } : {}),
        ...(comment.trim() !== '' ? { comment: comment.trim() } : {}),
      });
      if (readOrderRating(raw) === null) throw new Error('Unexpected reply');
      onRated();
    } catch (cause) {
      setProblem(
        cause instanceof ApiError ? cause.friendlyMessage : 'Could not send your rating. Try again.',
      );
      // Already rated in another tab: re-read so the panel shows it.
      if (cause instanceof ApiError && cause.status === 409) onRated();
    } finally {
      setBusy(false);
    }
  };

  const until = formatDateTime(order.rateUntil);

  return (
    <form className="shop-rate" onSubmit={(event) => void submit(event)}>
      <h3 className="shop-rate__title">How was this order?</h3>
      <StarInput
        legend={`The store — ${storeName}`}
        value={storeRating}
        onChange={setStoreRating}
        disabled={busy}
      />
      {order.hasRider ? (
        <StarInput
          legend="The rider (optional)"
          value={riderRating}
          onChange={setRiderRating}
          disabled={busy}
        />
      ) : null}
      <label className="shop-reviews__label" htmlFor={`rate-${order.id}`}>
        Anything to add? <span className="shop-reviews__optional">(optional)</span>
      </label>
      <textarea
        id={`rate-${order.id}`}
        className="mnd-field__input shop-reviews__text"
        rows={2}
        maxLength={COMMENT_MAX}
        value={comment}
        disabled={busy}
        onChange={(event) => {
          setComment(event.target.value);
        }}
      />
      {problem !== null ? (
        <p className="shop-notice shop-notice--error" role="alert">
          {problem}
        </p>
      ) : null}
      <button type="submit" className="mnd-btn mnd-btn--solid mnd-btn--sm" disabled={busy}>
        {busy ? 'Sending…' : 'Send rating'}
      </button>
      <p className="shop-summary__note">
        One rating per order{until !== null ? `, open until ${until}` : ''}. It cannot be changed
        afterwards.
      </p>
    </form>
  );
}
