'use client';

/**
 * ★ The incoming assignment.
 *
 * This is the screen the whole surface is built around. A rider has 45 seconds
 * (plan §8.5) and is probably holding handlebars, so:
 *
 *   · ONE offer at a time, full screen. A list of offers is a decision; this
 *     is a reflex. Anything else queued is a line of text, not a second card.
 *   · The PAYOUT IS SHOWN BEFORE ACCEPTING, in the largest mono type on the
 *     screen. A rider agreeing to a job without knowing what it pays is the
 *     single worst thing this app could do.
 *   · The countdown is derived from the server's `expiresAt` on every tick,
 *     never decremented locally — a suspended tab must not leave a rider
 *     believing they still have time.
 *   · Accept and Decline are the deliberate exception to "one action per
 *     screen": the offer is a genuine binary. They are still not peers.
 *   · On expiry it says so plainly and returns to waiting. No silent vanish.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './delivery.module.css';
import { Dock } from './Dock';
import { FixtureBanner, Notice } from './Banners';
import { PlaceCard } from './PlaceCard';
import { useHideNav } from './RiderShell';
import { useRider } from './RiderProvider';
import { IconBox, IconCheck, IconResting, IconX } from './icons';
import { clock, distance, money, rupeesOnly, secondsUntil } from '@/lib/delivery/format';
import { useTicker } from '@/lib/delivery/tracking';
import type { Offer } from '@/lib/delivery/types';

/** Under this, the countdown goes critical and starts pulsing. */
const URGENT_SECONDS = 15;

export function OffersView() {
  const router = useRouter();
  const { offers, offersAreSample, accept, decline, expire, refresh, sampleEndpoints } =
    useRider();
  const now = useTicker(true);

  // The nav is hidden only while an offer is actually on screen. Waiting is
  // not a task, and a rider staring at an empty screen with no way out of it
  // is the version of "one action per screen" that helps nobody.
  useHideNav(offers.length > 0);

  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);

  const offer: Offer | undefined = offers[0];
  const remaining = offer === undefined ? 0 : secondsUntil(offer.expiresAt, now);

  /* Expiry. The countdown hitting zero is a STATE CHANGE, not a cosmetic one:
     the card is removed and the rider is told, in one place. */
  useEffect(() => {
    if (offer === undefined || remaining > 0) return;
    setExpired(true);
    expire(offer.assignmentId);
  }, [offer, remaining, expire]);

  /* A fresh offer clears every previous outcome message. */
  const assignmentId = offer?.assignmentId;
  useEffect(() => {
    if (assignmentId === undefined) return;
    setExpired(false);
    setGone(false);
    setFailed(false);
  }, [assignmentId]);

  const onAccept = useCallback(async () => {
    if (offer === undefined || busy) return;
    setBusy(true);
    setFailed(false);
    const outcome = await accept(offer);
    setBusy(false);
    if (outcome === 'accepted') {
      router.push(`/delivery/active/${encodeURIComponent(offer.orderId)}`);
      return;
    }
    if (outcome === 'gone') setGone(true);
    else setFailed(true);
  }, [offer, busy, accept, router]);

  const onDecline = useCallback(async () => {
    if (offer === undefined || busy) return;
    setBusy(true);
    await decline(offer);
    setBusy(false);
  }, [offer, busy, decline]);

  const facts = useMemo(() => {
    if (offer === undefined) return null;
    return [
      { label: 'Distance', value: distance(offer.distanceMeters) },
      {
        label: 'Items',
        value: offer.itemCount === undefined ? '—' : String(offer.itemCount),
      },
      {
        label: 'Collect',
        value:
          offer.codAmountPaise === null || offer.codAmountPaise === undefined
            ? 'Prepaid'
            : money(offer.codAmountPaise),
      },
    ];
  }, [offer]);

  /* ---------------- no offer on screen ---------------- */

  if (offer === undefined) {
    return (
      <>
        {offersAreSample ? (
          <FixtureBanner endpoints={sampleEndpoints} onRetry={refresh} />
        ) : null}

        {expired ? (
          <Notice tone="warn" title="That offer expired">
            The 45 seconds ran out, so it went to another rider. Stay online and the next
            one will come through.
          </Notice>
        ) : null}
        {gone ? (
          <Notice tone="neutral" title="Someone else took it">
            That job was gone before your tap landed. Nothing lost — wait for the next.
          </Notice>
        ) : null}

        <div className={styles.resting}>
          <IconResting size={72} className={styles.restingMark} />
          <h1 className={styles.h1}>Waiting for offers</h1>
          <p className={styles.lede}>
            Keep this screen open. A new job arrives with a 45-second countdown.
          </p>
        </div>
      </>
    );
  }

  /* ---------------- the offer ---------------- */

  const urgent = remaining <= URGENT_SECONDS;

  return (
    <>
      {offersAreSample ? (
        <FixtureBanner endpoints={sampleEndpoints} onRetry={refresh} />
      ) : null}

      <section className={styles.panelFlat}>
        <div className={styles.offerHead}>
          <div className={styles.payoutBlock}>
            <span className={styles.stepTag}>You earn</span>
            {/* The payout, before accepting. Never after. */}
            <span className={styles.payoutValue}>{money(offer.payoutPaise)}</span>
            {offer.orderNo === undefined ? null : (
              <span className={styles.stepTag}>Order {offer.orderNo}</span>
            )}
          </div>

          <div
            className={`${styles.countdown} ${urgent ? styles.countdownUrgent : ''}`}
            role="timer"
            aria-live="off"
          >
            <div className={styles.countdownValue}>{clock(remaining)}</div>
            <div className={styles.countdownLabel}>left</div>
          </div>
        </div>

        {facts === null ? null : (
          <div className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label} className={styles.fact}>
                <div className={styles.factValue}>{fact.value}</div>
                <div className={styles.factLabel}>{fact.label}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* A screen-reader announcement that does not re-read every second. */}
      <p className={styles.srOnly} role="status">
        {`New delivery offer. You earn ${rupeesOnly(offer.payoutPaise)} rupees. ${
          Math.ceil(remaining / 5) * 5
        } seconds left to accept.`}
      </p>

      <PlaceCard kind="pickup" place={offer.pickup} />
      <PlaceCard kind="drop" place={offer.drop} />

      {offer.codAmountPaise === null || offer.codAmountPaise === undefined ? null : (
        <div className={styles.prepaid}>
          <IconBox size={18} /> Cash on delivery — you collect{' '}
          {money(offer.codAmountPaise)} at the door.
        </div>
      )}

      {failed ? (
        <Notice tone="crit" title="Could not accept">
          The request did not get through. Try once more, or let it expire and wait for
          the next offer.
        </Notice>
      ) : null}

      <Dock>
        <div className={styles.choiceRow}>
          <button
            type="button"
            className={styles.decline}
            onClick={() => void onDecline()}
            disabled={busy}
          >
            <IconX size={20} /> Decline
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void onAccept()}
            disabled={busy}
          >
            <IconCheck size={24} />
            {busy ? 'Accepting…' : `Accept ${money(offer.payoutPaise)}`}
          </button>
        </div>
      </Dock>
    </>
  );
}
