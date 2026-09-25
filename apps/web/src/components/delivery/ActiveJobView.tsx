'use client';

/**
 * The job in progress — one step, one screen, one action.
 *
 *   Go to store  →  Picked up  →  Out for delivery  →  Deliver
 *
 * Each step shows only what that step needs and exactly one bottom-anchored
 * primary action (plan §2.4). "Can't deliver" exists, but it lives in the body
 * as a quiet outline button: it must never be reachable by the same thumb
 * sweep that confirms a delivery.
 *
 * ── THE FOUR THINGS THAT MUST NOT BE GOT WRONG ──────────────────────────────
 * 1. The COD amount is the largest thing on the delivery screen. A rider who
 *    collects the wrong cash has a problem no refund fixes cleanly.
 * 2. Location tracking runs ONLY while `OUT_FOR_DELIVERY` — see `tracking.ts`.
 *    It is started by the status, not by arriving on this screen.
 * 3. The OTP is typed, never displayed. This app does not know it. The API
 *    counts attempts and locks after five; the count here is advisory.
 * 4. Every transition is a request the API may reject with 409. The rider is
 *    told what happened rather than being left on a dead button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from './delivery.module.css';
import { CachedBanner, FixtureBanner, Notice } from './Banners';
import { Dock, PrimaryButton } from './Dock';
import { LocationBadge } from './LocationBadge';
import { OtpEntry } from './OtpEntry';
import { PhotoProof } from './PhotoProof';
import { PlaceCard } from './PlaceCard';
import { useHideNav } from './RiderShell';
import { useRider } from './RiderProvider';
import { IconBox, IconCheck, IconClock, IconStore } from './icons';
import { ApiError } from '@/lib/api-client';
import {
  deliverOrder,
  failDelivery,
  markOutForDelivery,
  markPickedUp,
} from '@/lib/delivery/api';
import { distance, etaMinutes, money, rupeesOnly } from '@/lib/delivery/format';
import { useLocationTracking, useTicker, useWakeLock } from '@/lib/delivery/tracking';
import { STEP_LABEL, STEP_ORDER, stepForStatus, type JobStep } from '@/lib/delivery/types';

const FAIL_REASONS = [
  'Customer not reachable',
  'Wrong or incomplete address',
  'Customer refused the order',
  'Cannot reach the location',
] as const;

export function ActiveJobView({ orderId }: { orderId: string }) {
  useHideNav();
  const router = useRouter();
  const {
    activeJob,
    jobIsSample,
    jobFromCache,
    loading,
    refresh,
    sampleEndpoints,
    setActiveJob,
  } = useRider();

  /**
   * "I'm at the store" is a LOCAL step. The API has no ASSIGNED→at-store
   * transition (§5.3), so nothing is written until the pickup is confirmed —
   * which is the real transition. Keeping it local means a mis-tap costs a tap
   * to undo, not a 409.
   */
  const [arrived, setArrived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [otp, setOtp] = useState('');
  const [otpWrong, setOtpWrong] = useState(false);
  const [attempts, setAttempts] = useState<number | undefined>(undefined);
  const [locked, setLocked] = useState(false);

  const [failOpen, setFailOpen] = useState(false);
  const [done, setDone] = useState(false);

  const job = activeJob;
  const status = job?.status;
  const step: JobStep = status === undefined ? 'GO_TO_STORE' : stepForStatus(status, arrived);

  /* Tracking runs on the STATUS, never on which screen is open. */
  const trackingActive = status === 'OUT_FOR_DELIVERY';
  const tracking = useLocationTracking(trackingActive);
  const wakeLock = useWakeLock(job !== null && !jobIsSample);
  const now = useTicker(trackingActive || step === 'DELIVER');

  useEffect(() => {
    setAttempts(job?.otpAttemptsRemaining);
  }, [job?.otpAttemptsRemaining]);

  /* Moving forward clears the local "arrived" flag for the next job. */
  useEffect(() => {
    if (status !== 'ASSIGNED') setArrived(false);
  }, [status]);

  const advance = useCallback(
    async (action: () => Promise<void>, optimisticStatus: 'PICKED_UP' | 'OUT_FOR_DELIVERY') => {
      if (busy || job === null) return;
      setBusy(true);
      setProblem(null);
      try {
        await action();
        // Move the local job forward immediately — the rider is already
        // walking. The refresh behind it reconciles with the API.
        setActiveJob({ ...job, status: optimisticStatus });
        refresh();
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          setProblem(
            'This order has already moved on. Pulling the latest from Mandi…',
          );
          refresh();
        } else {
          setProblem(
            cause instanceof ApiError
              ? cause.friendlyMessage
              : 'That did not go through. Try again.',
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, job, refresh, setActiveJob],
  );

  const onDeliver = useCallback(async () => {
    if (busy || job === null || otp.length !== 4) return;
    setBusy(true);
    setProblem(null);
    setOtpWrong(false);
    try {
      // The OTP goes straight out and is cleared straight after. It is never
      // held, logged or compared locally.
      await deliverOrder(job.orderId, otp);
      setOtp('');
      setDone(true);
      setActiveJob(null);
      refresh();
    } catch (cause) {
      setOtp('');
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 422)) {
        setOtpWrong(true);
        setAttempts((prev) => (prev === undefined ? undefined : Math.max(0, prev - 1)));
        setProblem('That code did not match. Ask the customer to read it again.');
      } else if (cause instanceof ApiError && cause.status === 429) {
        setLocked(true);
        setProblem(null);
      } else {
        setProblem(
          cause instanceof ApiError
            ? cause.friendlyMessage
            : 'Could not confirm the delivery. Try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }, [busy, job, otp, refresh, setActiveJob]);

  const onFail = useCallback(
    async (reason: string) => {
      if (busy || job === null) return;
      setBusy(true);
      try {
        await failDelivery(job.orderId, reason);
        setActiveJob(null);
        setFailOpen(false);
        refresh();
        router.push('/delivery');
      } catch (cause) {
        setProblem(
          cause instanceof ApiError
            ? cause.friendlyMessage
            : 'Could not report that. Try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, job, refresh, router, setActiveJob],
  );

  const codAmount = job?.codAmountPaise ?? null;

  const progress = useMemo(() => {
    const index = STEP_ORDER.indexOf(step);
    return `Step ${index + 1} of ${STEP_ORDER.length} · ${STEP_LABEL[step]}`;
  }, [step]);

  /* ---------------- empty / wrong-job states ---------------- */

  if (done) {
    return (
      <>
        <div className={styles.resting}>
          <IconCheck size={64} />
          <h1 className={styles.h1}>Delivered</h1>
          <p className={styles.lede}>
            Nice work. Your earnings update once Mandi settles the order.
          </p>
        </div>
        <Dock>
          <PrimaryButton onClick={() => router.push('/delivery')}>
            Back to offers
          </PrimaryButton>
        </Dock>
      </>
    );
  }

  if (loading && job === null) {
    return <div className={styles.skeleton} style={{ height: '16rem' }} aria-hidden="true" />;
  }

  if (job === null) {
    return (
      <>
        <div className={styles.resting}>
          <IconBox size={64} className={styles.restingMark} />
          <h1 className={styles.h1}>No active delivery</h1>
          <p className={styles.lede}>
            This job is finished or was reassigned. Go back and wait for the next offer.
          </p>
        </div>
        <Dock>
          <PrimaryButton onClick={() => router.push('/delivery')}>
            Back to offers
          </PrimaryButton>
        </Dock>
      </>
    );
  }

  if (job.orderId !== orderId) {
    // A stale URL — a bookmarked job, or a back button after a reassignment.
    return (
      <>
        <Notice tone="warn" title="That is not your current delivery">
          You are on a different job now.
        </Notice>
        <Dock>
          <PrimaryButton
            onClick={() =>
              router.replace(`/delivery/active/${encodeURIComponent(job.orderId)}`)
            }
          >
            Open my current job
          </PrimaryButton>
        </Dock>
      </>
    );
  }

  /* ---------------- the job ---------------- */

  return (
    <>
      {jobIsSample ? <FixtureBanner endpoints={sampleEndpoints} onRetry={refresh} /> : null}
      {jobFromCache && !jobIsSample ? <CachedBanner onRetry={refresh} /> : null}

      <div className={styles.stepTag}>
        <IconClock size={14} /> {progress}
      </div>

      {problem === null ? null : (
        <Notice tone="crit" title="Something went wrong">
          {problem}
        </Notice>
      )}

      {step === 'GO_TO_STORE' ? (
        <>
          <div className={styles.etaRow}>
            <span className={styles.mega}>{etaMinutes(job.etaMinutes)}</span>
            <span className={styles.megaUnit}>min to store</span>
          </div>
          <p className={styles.lede}>
            {distance(job.distanceMeters)} total · you earn {money(job.payoutPaise)}
          </p>

          <PlaceCard kind="pickup" place={job.pickup} showMap phoneLabel="Call store" />

          <Dock>
            <PrimaryButton onClick={() => setArrived(true)}>
              <IconStore size={24} /> I&rsquo;m at the store
            </PrimaryButton>
          </Dock>
        </>
      ) : null}

      {step === 'AT_STORE' ? (
        <>
          <h1 className={styles.h1}>Collect {job.items.length} items</h1>
          <section className={styles.panel}>
            <ul className={styles.items}>
              {job.items.map((item) => (
                <li key={item.id} className={styles.item}>
                  <span className={styles.itemQty}>
                    {item.qty}
                    {item.unit === undefined ? '' : ` ${item.unit}`}
                  </span>
                  <span className={styles.itemName}>{item.name}</span>
                </li>
              ))}
              {job.items.length === 0 ? (
                <li className={styles.item}>
                  <span className={styles.itemName}>
                    The order list did not load. Check the packed bag against the order
                    number with the store.
                  </span>
                </li>
              ) : null}
            </ul>
          </section>

          <button type="button" className={styles.ghost} onClick={() => setArrived(false)}>
            Not at the store yet
          </button>

          <Dock>
            <PrimaryButton
              onClick={() => void advance(() => markPickedUp(job.orderId), 'PICKED_UP')}
              disabled={busy}
            >
              <IconCheck size={24} /> {busy ? 'Saving…' : 'Picked up'}
            </PrimaryButton>
          </Dock>
        </>
      ) : null}

      {step === 'TO_CUSTOMER' ? (
        <>
          <h1 className={styles.h1}>Ready to go</h1>
          <p className={styles.lede}>
            Starting the delivery tells the customer you are on the way and begins
            sharing your location.
          </p>

          <PlaceCard kind="drop" place={job.drop} />

          <Dock>
            <PrimaryButton
              onClick={() =>
                void advance(() => markOutForDelivery(job.orderId), 'OUT_FOR_DELIVERY')
              }
              disabled={busy}
            >
              {busy ? 'Starting…' : 'Start delivery'}
            </PrimaryButton>
          </Dock>
        </>
      ) : null}

      {step === 'DELIVER' ? (
        <>
          <LocationBadge tracking={tracking} now={now} />

          <PlaceCard
            kind="drop"
            place={job.drop}
            showMap
            phoneLabel={job.customerName === undefined ? 'Call' : 'Call customer'}
          />

          {codAmount === null ? (
            <div className={styles.prepaid}>
              <IconCheck size={20} /> Prepaid — collect nothing.
            </div>
          ) : (
            <div className={styles.cod}>
              <div className={styles.codLabel}>Collect cash</div>
              <div className={styles.codValue}>
                <span className={styles.codRupee}>&#8377;</span>
                {rupeesOnly(codAmount)}
              </div>
            </div>
          )}

          {/* Locked either because the API said so (429 / rate-limited), or
              because the attempt counter it gave us has run out. Both are the
              same thing to a rider standing at a door. */}
          {locked || attempts === 0 ? (
            <div className={styles.locked} role="alert">
              This order is locked after too many wrong codes. Call the store or support
              — you cannot complete it from here.
            </div>
          ) : (
            <section className={styles.panelFlat}>
              <OtpEntry
                value={otp}
                onChange={(next) => {
                  setOtp(next);
                  setOtpWrong(false);
                }}
                attemptsRemaining={attempts}
                invalid={otpWrong}
                disabled={busy}
              />
            </section>
          )}

          <PhotoProof disabled={busy} />

          {failOpen ? (
            <section className={styles.panelFlat}>
              <span className={styles.stepTag}>Why can you not deliver?</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                {FAIL_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => void onFail(reason)}
                    disabled={busy}
                  >
                    {reason}
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setFailOpen(false)}
                >
                  Never mind
                </button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setFailOpen(true)}
              disabled={busy}
            >
              I can&rsquo;t deliver this
            </button>
          )}

          <Dock>
            <PrimaryButton
              onClick={() => void onDeliver()}
              disabled={busy || locked || attempts === 0 || otp.length !== 4}
            >
              <IconCheck size={24} />
              {busy ? 'Confirming…' : 'Confirm delivery'}
            </PrimaryButton>
          </Dock>
        </>
      ) : null}

      {/* Honest about the PWA, once, at the bottom of the live step. */}
      {trackingActive && !wakeLock.supported ? (
        <p className={styles.lede} style={{ fontSize: '0.85rem' }}>
          This browser cannot keep the screen awake. Your phone may lock, and location
          updates stop when it does.
        </p>
      ) : null}
    </>
  );
}
