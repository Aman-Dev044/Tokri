'use client';

/**
 * ★ The confirm screen — the last place the decision is free.
 *
 * Accepting an order CHARGES the rider a pick fee, drawn at random per order
 * from a range the platform sets. That makes this screen the most important
 * one in the app after the offer itself, and it exists for one reason:
 *
 *   A RIDER MUST NEVER DISCOVER THE CHARGE AFTER THE MONEY HAS GONE.
 *
 * So everything that bears on the decision is on screen while it is still
 * reversible — what was ordered, where it comes from, where it goes, what the
 * job pays, what accepting costs, and what is in the wallet right now.
 *
 * ── WHY IT SHOWS A RANGE AND NOT A NUMBER ───────────────────────────────────
 * The fee is drawn at the moment of accepting, inside the same transaction
 * that assigns the job. There is no held quote to show: drawing it early would
 * mean either a reservation on money with no expiry, or quoting one figure and
 * charging another. "₹25–₹50" is the only statement that is true when it is
 * made — and it is still the whole difference between an informed decision and
 * a surprise.
 *
 * The exact figure appears the instant it is taken: `POST .../accept` answers
 * with `pickFeePaise` and the new balance, and the next screen opens with the
 * charge named.
 *
 * ── THE TWO REFUSALS THAT ARE NOT BUGS ──────────────────────────────────────
 * 403 KYC_NOT_VERIFIED and 402 INSUFFICIENT_WALLET_BALANCE each get their own
 * message and their own way out, because each has a different next action.
 * Both are pre-empted here — the accept button is disabled with the reason
 * written under it — but the server is still the authority and the handler
 * below reads its answer rather than trusting this screen's guess.
 *
 * ── THE COUNTDOWN KEEPS RUNNING ─────────────────────────────────────────────
 * Derived from the server's `expiresAt` on every tick, exactly as on the offer
 * screen. Opening this screen does not pause the 45 seconds and must not
 * pretend to.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import styles from './delivery.module.css';
import { Dock } from './Dock';
import { Notice } from './Banners';
import { PlaceCard } from './PlaceCard';
import { CardSkeleton } from './Skeletons';
import { useHideNav } from './RiderShell';
import { useRider } from './RiderProvider';
import { IconCheck, IconWallet, IconX } from './icons';
import { ApiError } from '@/lib/api-client';
import { fetchOfferDetail } from '@/lib/delivery/wallet-api';
import { clock, distanceKm, money, secondsUntil } from '@/lib/delivery/format';
import { useTicker } from '@/lib/delivery/tracking';
import type { OfferDetail } from '@/lib/delivery/types';

export function OfferConfirmView({ assignmentId }: { assignmentId: string }) {
  useHideNav();
  const router = useRouter();
  const { offers, accept, decline, wallet } = useRider();
  const now = useTicker(true);

  const [detail, setDetail] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState<{
    requiredPaise: number | null;
    balancePaise: number | null;
  } | null>(null);
  const [needsKyc, setNeedsKyc] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);

    void (async () => {
      try {
        const row = await fetchOfferDetail(assignmentId, controller.signal);
        if (!live) return;
        // A 404 and a null row mean the same thing: this offer is not the
        // caller's, or it no longer exists. Neither is an error to shout
        // about — it is the normal end of an offer that timed out.
        if (row === null) setMissing(true);
        else setDetail(row);
      } catch (cause) {
        if (!live) return;
        if (cause instanceof ApiError && cause.status === 404) setMissing(true);
        else if (cause instanceof ApiError && !cause.isNetworkError) {
          setProblem(cause.friendlyMessage);
        } else {
          setProblem('Could not load this offer. Check your connection.');
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [assignmentId]);

  const remaining =
    detail === null ? 0 : secondsUntil(detail.expiresAt, now);
  const expired = detail !== null && remaining <= 0;

  const onAccept = useCallback(async () => {
    if (detail === null || busy) return;
    setBusy(true);
    setProblem(null);
    setNeedsFunds(null);
    setNeedsKyc(false);

    const offer = offers.find((row) => row.id === detail.id) ?? detail;
    const outcome = await accept(offer);
    setBusy(false);

    if (outcome.result === 'accepted') {
      // The charge is named in the URL so the job screen can open with it
      // stated rather than leaving the rider to find it in a ledger.
      router.push(
        `/delivery/active/${encodeURIComponent(detail.orderId)}` +
          `?fee=${outcome.pickFeePaise}&balance=${outcome.walletBalancePaise}`,
      );
      return;
    }

    if (outcome.result === 'kyc') {
      setNeedsKyc(true);
      return;
    }
    if (outcome.result === 'funds') {
      setNeedsFunds({
        requiredPaise: outcome.requiredPaise,
        balancePaise: outcome.balancePaise,
      });
      return;
    }
    if (outcome.result === 'gone') {
      setMissing(true);
      return;
    }
    setProblem(
      'The request did not get through. Try once more, or let it expire and ' +
        'wait for the next offer.',
    );
  }, [detail, busy, offers, accept, router]);

  const onDecline = useCallback(async () => {
    if (detail === null || busy) return;
    setBusy(true);
    const offer = offers.find((row) => row.id === detail.id) ?? detail;
    await decline(offer);
    setBusy(false);
    router.push('/delivery/offers');
  }, [detail, busy, offers, decline, router]);

  /* ---------------- loading / gone ---------------- */

  if (loading) {
    return (
      <>
        <h1 className={styles.h1}>Loading the job…</h1>
        <CardSkeleton />
      </>
    );
  }

  if (missing || detail === null) {
    return (
      <>
        <Notice tone="neutral" title="That offer is no longer yours">
          It expired, or another rider took it first. Nothing was charged.
        </Notice>
        <Link className={styles.primary} href="/delivery/offers">
          Back to offers
        </Link>
      </>
    );
  }

  const balancePaise = wallet?.balancePaise ?? detail.walletBalancePaise;
  const kycBlocked = detail.kycStatus !== 'verified';
  const fundsBlocked = !detail.canAfford;
  const blocked = kycBlocked || fundsBlocked || expired;

  return (
    <>
      <section className={styles.panelFlat}>
        <div className={styles.offerHead}>
          <div className={styles.payoutBlock}>
            <span className={styles.stepTag}>You earn</span>
            <span className={styles.payoutValue}>{money(detail.payoutPaise)}</span>
            {detail.orderNo === '' ? null : (
              <span className={styles.stepTag}>Order {detail.orderNo}</span>
            )}
          </div>
          <div
            className={`${styles.countdown} ${remaining <= 15 ? styles.countdownUrgent : ''}`}
            role="timer"
            aria-live="off"
          >
            <div className={styles.countdownInner}>
              <div className={styles.countdownValue}>{clock(remaining)}</div>
              <div className={styles.countdownLabel}>left</div>
            </div>
          </div>
        </div>

        <div className={styles.facts}>
          <div className={styles.fact}>
            <div className={styles.factValue}>{distanceKm(detail.distanceKm)}</div>
            <div className={styles.factLabel}>Distance</div>
          </div>
          <div className={styles.fact}>
            <div className={styles.factValue}>{String(detail.itemCount)}</div>
            <div className={styles.factLabel}>Items</div>
          </div>
          <div className={styles.fact}>
            <div className={styles.factValue}>
              {detail.codAmountPaise > 0 ? money(detail.codAmountPaise) : 'Prepaid'}
            </div>
            <div className={styles.factLabel}>Collect</div>
          </div>
        </div>
      </section>

      {/* ── THE CHARGE, stated before it happens ─────────────────────── */}
      <section className={styles.panel} aria-label="What accepting costs">
        <div className={styles.feeHead}>
          <IconWallet size={20} />
          <h2 className={styles.h2}>What accepting costs you</h2>
        </div>
        <p className={styles.feeAmount}>
          {money(detail.pickFeeMinPaise)} – {money(detail.pickFeeMaxPaise)}
        </p>
        <p className={styles.lede}>
          A pick fee is taken from your wallet the moment you accept. The exact
          amount is drawn at random inside that range for every order, and you
          are told the figure straight away. If {' '}
          {/* The refund promise, stated plainly — it is the rider's money. */}
          the order is cancelled by the store or by support, the fee is
          refunded automatically.
        </p>
        <div className={styles.feeRow}>
          <span className={styles.feeRowLabel}>Wallet balance</span>
          <span className={styles.feeRowValue}>{money(balancePaise)}</span>
        </div>
      </section>

      {/* ── What was actually ordered ────────────────────────────────── */}
      <section className={styles.panel} aria-label="Items in this order">
        <h2 className={styles.h2}>
          {detail.itemCount} item{detail.itemCount === 1 ? '' : 's'} to collect
        </h2>
        <ul className={styles.items}>
          {detail.items.map((item, index) => (
            // The API sends no item id — name, qty, unit and image only. The
            // index is the right key for a list that never reorders.
            <li key={`${item.name}-${index}`} className={styles.item}>
              <span className={styles.itemQty}>
                {item.qty}
                {item.unit === '' ? '' : ` ${item.unit}`}
              </span>
              <span className={styles.itemName}>{item.name}</span>
            </li>
          ))}
          {detail.items.length === 0 ? (
            <li className={styles.item}>
              <span className={styles.itemName}>
                The item list did not come through. Check the packed bag
                against the order number with the store.
              </span>
            </li>
          ) : null}
        </ul>
      </section>

      <PlaceCard kind="pickup" place={detail.pickup} showMap />
      <PlaceCard kind="drop" place={detail.drop} />

      {/* ── The blockers, each with the one thing to do about it ─────── */}
      {kycBlocked ? (
        <Notice tone="warn" title="Finish verification first">
          You cannot accept an order until your documents are verified.{' '}
          <Link href="/delivery/profile" className={styles.inlineLink}>
            Open verification
          </Link>
        </Notice>
      ) : null}

      {needsKyc ? (
        <Notice tone="crit" title="Your documents are not verified">
          The platform refused this job because verification is not complete.{' '}
          <Link href="/delivery/profile" className={styles.inlineLink}>
            Open verification
          </Link>
        </Notice>
      ) : null}

      {fundsBlocked || needsFunds !== null ? (
        <Notice tone="crit" title="Not enough in your wallet">
          {needsFunds?.requiredPaise === null || needsFunds === null
            ? `You need at least ${money(detail.pickFeeMinPaise)} to accept a job.`
            : `This job's fee was ${money(needsFunds.requiredPaise ?? 0)} and your balance is ${money(
                needsFunds.balancePaise ?? balancePaise,
              )}.`}{' '}
          Nothing was charged.{' '}
          <Link href="/delivery/wallet" className={styles.inlineLink}>
            Open wallet
          </Link>
        </Notice>
      ) : null}

      {expired ? (
        <Notice tone="warn" title="This offer expired">
          The 45 seconds ran out, so it went to another rider. Nothing was
          charged.
        </Notice>
      ) : null}

      {problem === null ? null : (
        <Notice tone="crit" title="Could not accept">
          {problem}
        </Notice>
      )}

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
            disabled={busy || blocked}
          >
            <IconCheck size={24} />
            {busy ? 'Accepting…' : 'Accept and pay the fee'}
          </button>
        </div>
      </Dock>
    </>
  );
}
