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
 *   · Review and Decline are the deliberate exception to "one action per
 *     screen": the offer is a genuine binary. They are still not peers.
 *   · On expiry it says so plainly and returns to waiting. No silent vanish.
 *
 * ── WHY "REVIEW" AND NOT "ACCEPT" ───────────────────────────────────────────
 * Accepting now CHARGES the rider a pick fee, drawn at random per order. A
 * button that takes money out of someone's wallet must not be the same reflex
 * tap as a button that only takes a job, so the accept itself lives one screen
 * deeper — `/delivery/offers/[id]` — where the items, both addresses, the
 * balance and the fee are all on screen while the decision is still
 * reversible. The countdown continues there; the extra screen costs a tap, not
 * a second of the 45.
 *
 * Decline stays HERE, because declining costs nothing and a rider who has
 * decided should not have to open anything to do it.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './delivery.module.css';
import { Dock } from './Dock';
import { FixtureBanner, Notice } from './Banners';
import { PlaceCard } from './PlaceCard';
import { useHideNav } from './RiderShell';
import { useRider } from './RiderProvider';
import { IconBox, IconNavigate, IconResting, IconWallet, IconX } from './icons';
import { clock, distanceKm, money, rupeesOnly, secondsUntil } from '@/lib/delivery/format';
import { useTicker } from '@/lib/delivery/tracking';
import type { Offer } from '@/lib/delivery/types';

/** Under this, the countdown goes critical and starts pulsing. */
const URGENT_SECONDS = 15;

/** The offer's full life, in seconds — what the ring's sweep is drawn against. */
const OFFER_TOTAL_SECONDS = 45;
const RING_RADIUS = 45;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function OffersView() {
  const {
    profile,
    offers,
    offersAreSample,
    wallet,
    kyc,
    decline,
    expire,
    refresh,
    sampleEndpoints,
    loadError,
  } = useRider();
  const now = useTicker(true);

  // The nav is hidden only while an offer is actually on screen. Waiting is
  // not a task, and a rider staring at an empty screen with no way out of it
  // is the version of "one action per screen" that helps nobody.
  useHideNav(offers.length > 0);

  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [gone, setGone] = useState(false);

  const offer: Offer | undefined = offers[0];
  const remaining = offer === undefined ? 0 : secondsUntil(offer.expiresAt, now);

  /* Expiry. The countdown hitting zero is a STATE CHANGE, not a cosmetic one:
     the card is removed and the rider is told, in one place. */
  useEffect(() => {
    if (offer === undefined || remaining > 0) return;
    setExpired(true);
    expire(offer.id);
  }, [offer, remaining, expire]);

  /* A fresh offer clears every previous outcome message. */
  const assignmentId = offer?.id;
  useEffect(() => {
    if (assignmentId === undefined) return;
    setExpired(false);
    setGone(false);
  }, [assignmentId]);

  const onDecline = useCallback(async () => {
    if (offer === undefined || busy) return;
    setBusy(true);
    await decline(offer);
    setBusy(false);
  }, [offer, busy, decline]);

  const facts = useMemo(() => {
    if (offer === undefined) return null;
    return [
      // KILOMETRES. The API sends `distanceKm`; there is no metres field.
      { label: 'Distance', value: distanceKm(offer.distanceKm) },
      { label: 'Items', value: String(offer.itemCount) },
      {
        // A COD amount of 0 IS "prepaid" — the API sends 0, not null, for an
        // order that is already paid for.
        label: 'Collect',
        value: offer.codAmountPaise > 0 ? money(offer.codAmountPaise) : 'Prepaid',
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
        {loadError === null ? null : (
          <Notice tone="crit" title="Could not load your offers">
            {loadError}
          </Notice>
        )}

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

        <div
          className={`${styles.resting} ${
            profile?.isOnline === true ? styles.restingOn : styles.restingOff
          }`}
        >
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

      {/* The offer zooms in on a spring; its countdown ring glows gold. */}
      <section className={styles.offerCard}>
        <div className={styles.offerHead}>
          <div className={styles.payoutBlock}>
            <span className={styles.stepTag}>You earn</span>
            {/* The payout, before accepting. Never after. */}
            <span className={styles.payoutValue}>{money(offer.payoutPaise)}</span>
            {offer.orderNo === '' ? null : (
              <span className={styles.stepTag}>Order {offer.orderNo}</span>
            )}
          </div>

          <div
            className={`${styles.countdown} ${urgent ? styles.countdownUrgent : ''}`}
            role="timer"
            aria-live="off"
          >
            {/* The draining ring. Purely decorative — the number beside it is
                the actual information, so the ring is aria-hidden. Its sweep
                is drawn against a fixed 45s life, not against whatever
                `remaining` happened to be on the first render, so a rider who
                opens the tab mid-countdown sees a ring already part-drained
                rather than one that lies about a full 45 seconds left. */}
            <svg className={styles.ring} viewBox="0 0 104 104" aria-hidden="true">
              <circle className={styles.ringTrack} cx="52" cy="52" r={RING_RADIUS} />
              <circle
                className={styles.ringDrain}
                cx="52"
                cy="52"
                r={RING_RADIUS}
                style={{
                  strokeDasharray: RING_CIRCUMFERENCE,
                  strokeDashoffset:
                    RING_CIRCUMFERENCE *
                    (1 - Math.max(0, Math.min(1, remaining / OFFER_TOTAL_SECONDS))),
                }}
              />
            </svg>
            <div className={styles.countdownInner}>
              <div className={styles.countdownValue}>{clock(remaining)}</div>
              <div className={styles.countdownLabel}>left</div>
            </div>
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
        } seconds left to review and accept.`}
      </p>

      {/*
        The rest of the working list, as ONE line of text rather than a
        second card. A queue of cards is a decision; this screen is a
        reflex, and the 45 seconds belong to the offer on top. The count
        is live — it is driven by `delivery.assigned` over the socket and
        by offers expiring locally, not by a poll.
      */}
      {offers.length > 1 ? (
        <p className={styles.lede}>
          {offers.length - 1} more offer{offers.length === 2 ? '' : 's'} behind
          this one. They are answered in order.
        </p>
      ) : null}

      <PlaceCard kind="pickup" place={offer.pickup} />
      <PlaceCard kind="drop" place={offer.drop} />

      {offer.codAmountPaise > 0 ? (
        <div className={styles.prepaid}>
          <IconBox size={18} /> Cash on delivery — you collect{' '}
          {money(offer.codAmountPaise)} at the door.
        </div>
      ) : null}

      {/*
        The charge, stated on the reflex screen as well as on the confirm
        screen. A rider glancing at this card should already know that taking
        it costs them something before they tap anything at all.
      */}
      {wallet === null ? null : (
        <div className={styles.feeNote}>
          <IconWallet size={18} />
          <span>
            Accepting costs a pick fee of {money(wallet.pickFeeMinPaise)}–
            {money(wallet.pickFeeMaxPaise)}, taken from your wallet. Balance{' '}
            {money(wallet.balancePaise)}.
          </span>
        </div>
      )}

      {kyc !== null && kyc.status !== 'verified' ? (
        <Notice tone="warn" title="You cannot accept jobs yet">
          Your documents are {kyc.status === 'submitted' ? 'being checked' : 'not verified'}.{' '}
          <Link href="/delivery/profile" className={styles.inlineLink}>
            Open verification
          </Link>
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
          <Link
            className={styles.primary}
            href={`/delivery/offers/${encodeURIComponent(offer.id)}`}
          >
            <IconNavigate size={24} />
            {`Review · ${money(offer.payoutPaise)}`}
          </Link>
        </div>
      </Dock>
    </>
  );
}
