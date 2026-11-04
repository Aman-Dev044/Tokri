'use client';

/**
 * "Cancel order" for the customer's own PLACED order.
 *
 * `POST /orders/:id/cancel` is free only while the order is PLACED (decision
 * #8). Once the store accepts, the API answers 409 `CANCELLATION_NEEDS_APPROVAL`
 * — the store has started picking — and this says so in plain words with a way
 * to support, rather than a button that silently does nothing. The race is
 * real (the store can accept between this screen loading and the tap), which is
 * why the 409 is handled here and not just hidden behind `status === 'PLACED'`.
 *
 * The API REQUIRES a reason (3–300 characters), so the confirm step offers the
 * usual few and an optional note; nothing has to be typed.
 *
 * On success every `/orders…` query is invalidated: the list, the detail and
 * the track view all re-read the order the server now has.
 */

import Link from 'next/link';
import { useId, useState } from 'react';
import { useToast } from '@mandi/design-system';
import { invalidateShop } from '@/hooks/useShopQuery';
import { api, ApiError } from '@/lib/api-client';
import { readProblemCode } from '@/lib/shop/types';

const REASONS = [
  'Ordered by mistake',
  'Want to change the items',
  'Wrong delivery address',
  'It is taking too long',
] as const;

/** `CancelOrderDto.reason` is `@Length(3, 300)`. */
const MAX_NOTE = 200;

function refusalCopy(error: ApiError): string {
  switch (readProblemCode(error.problem)) {
    case 'CANCELLATION_NEEDS_APPROVAL':
      return 'The store has already accepted this order, so it can no longer be cancelled here. Contact support and they will sort it out with the store.';
    case 'ORDER_CLOSED':
      return 'This order is already closed, so there is nothing to cancel.';
    default:
      return error.friendlyMessage;
  }
}

export function CancelOrder({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const { toast } = useToast();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setRefusal(null);
    const extra = note.trim();
    try {
      await api.post(`/orders/${encodeURIComponent(orderId)}/cancel`, {
        reason: extra === '' ? reason : `${reason}: ${extra}`.slice(0, 300),
      });
      setOpen(false);
      toast({
        tone: 'info',
        title: `Order ${orderNo} cancelled`,
        description: 'Nothing will be charged, and the items are back on the store’s shelf.',
      });
      invalidateShop('/orders');
    } catch (cause) {
      setRefusal(
        cause instanceof ApiError
          ? refusalCopy(cause)
          : 'We could not cancel this order. Please try again.',
      );
      // NOT invalidated on a refusal: the re-read would move the order past
      // PLACED, unmount this control and take the explanation with it. The
      // list's own poll catches the new status a moment later.
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <>
        <button
          type="button"
          className="mnd-btn mnd-btn--ghost mnd-btn--sm shop-cancel__open"
          onClick={() => {
            setOpen(true);
            setRefusal(null);
          }}
        >
          Cancel order
        </button>
        {refusal !== null ? <CancelRefusal message={refusal} /> : null}
      </>
    );
  }

  return (
    <form
      className="shop-cancel"
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="shop-cancel__title" id={`${formId}-title`}>
        Cancel order {orderNo}?
      </p>
      <p className="shop-cancel__body">
        Free while the store has not accepted it yet. Nothing is charged.
      </p>

      <fieldset className="shop-cancel__reasons">
        <legend className="eyebrow">Why are you cancelling?</legend>
        {REASONS.map((option) => (
          <label key={option} className="shop-cancel__reason">
            <input
              type="radio"
              name={`${formId}-reason`}
              value={option}
              checked={reason === option}
              onChange={() => {
                setReason(option);
              }}
            />
            {option}
          </label>
        ))}
      </fieldset>

      <label className="shop-cancel__note-label" htmlFor={`${formId}-note`}>
        Anything to add? <span className="shop-cancel__optional">(optional)</span>
      </label>
      <textarea
        id={`${formId}-note`}
        className="mnd-field__input shop-cancel__note"
        rows={2}
        maxLength={MAX_NOTE}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />

      {refusal !== null ? <CancelRefusal message={refusal} /> : null}

      <div className="shop-cancel__actions">
        <button type="submit" className="mnd-btn mnd-btn--solid mnd-btn--sm" disabled={busy} aria-busy={busy}>
          {busy ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          className="mnd-btn mnd-btn--ghost mnd-btn--sm"
          disabled={busy}
          onClick={() => {
            setOpen(false);
          }}
        >
          Keep the order
        </button>
      </div>
    </form>
  );
}

function CancelRefusal({ message }: { message: string }) {
  return (
    <p className="shop-cancel__refusal" role="alert">
      {message} <Link href="/help">Contact support</Link>
    </p>
  );
}
