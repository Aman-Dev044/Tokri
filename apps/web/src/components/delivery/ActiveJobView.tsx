'use client';

/**
 * The job in progress — one step, one screen, one action.
 *
 *   Go to store  →  Picked up  →  Out for delivery  →  Deliver
 *
 * Each step shows only what that step needs and exactly one bottom-anchored
 * primary action. "Can't deliver" exists, but it lives in the body as a quiet
 * outline button: it must never be reachable by the same thumb sweep that
 * confirms a delivery.
 *
 * ── THE FIVE THINGS THAT MUST NOT BE GOT WRONG ──────────────────────────────
 * 1. The COD amount is the largest thing on the delivery screen. A rider who
 *    collects the wrong cash has a problem no refund fixes cleanly. It comes
 *    from `payment.codAmountPaise`, and 0 means PREPAID.
 * 2. Location tracking runs ONLY while `OUT_FOR_DELIVERY`. It is started by
 *    the status, not by arriving on this screen.
 * 3. The OTP is typed, never displayed. This app does not know it. Attempt
 *    state is nested under `otp: { attemptsUsed, attemptsRemaining, locked }`
 *    on the active order, and the API is the authority on all three.
 * 4. Every transition is a request the API may reject with 409. The rider is
 *    told what happened rather than being left on a dead button.
 * 5. A wrong code is 400 with `errors: { attemptsRemaining, locked }`; the
 *    FIFTH wrong code is 423 LOCKED, not 429. Reading 429 as the lock (the
 *    previous build did) meant the rider hit the real lock with no warning.
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
import { CardSkeleton } from './Skeletons';
import { useHideNav } from './RiderShell';
import { useRider } from './RiderProvider';
import { IconBox, IconCheck, IconStore } from './icons';
import { ApiError } from '@/lib/api-client';
import {
  deliverOrder,
  failDelivery,
  markOutForDelivery,
  markPickedUp,
  readOtpFailure,
} from '@/lib/delivery/api';
import { distanceKm, etaMinutes, money, rupeesOnly } from '@/lib/delivery/format';
import { useLocationTracking, useTicker, useWakeLock } from '@/lib/delivery/tracking';
import {
  STEP_LABEL,
  STEP_ORDER,
  stepForStatus,
  type ActiveOrder,
  type JobStep,
} from '@/lib/delivery/types';

const FAIL_REASONS = [
  'Customer not reachable',
  'Wrong or incomplete address',
  'Customer refused the order',
  'Cannot reach the location',
] as const;

/** The OTP the customer reads out is four digits — `randomInt(0, 10_000)`. */
const OTP_LENGTH = 4;

export function ActiveJobView({ orderId }: { orderId: string }) {
  useHideNav();
  const router = useRouter();
  const {
    activeOrder,
    jobIsSample,
    jobFromCache,
    loading,
    refresh,
    sampleEndpoints,
    loadError,
    setActiveOrder,
  } = useRider();

  /**
   * "I'm at the store" is a LOCAL step. The API has no ASSIGNED→at-store
   * transition, so nothing is written until the pickup is confirmed — which is
   * the real transition. Keeping it local means a mis-tap costs a tap to undo,
   * not a 409.
   */
  const [arrived, setArrived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [otp, setOtp] = useState('');
  const [otpWrong, setOtpWrong] = useState(false);
  /** Overrides the server figure between a rejection and the next refresh. */
  const [attemptsOverride, setAttemptsOverride] = useState<number | null>(null);
  const [lockedOverride, setLockedOverride] = useState(false);

  const [failOpen, setFailOpen] = useState(false);
  const [done, setDone] = useState(false);

  const job: ActiveOrder | null = activeOrder;
  const status = job?.status;
  const step: JobStep = status === undefined ? 'GO_TO_STORE' : stepForStatus(status, arrived);

  /* Tracking runs on the STATUS, never on which screen is open. */
  const trackingActive = status === 'OUT_FOR_DELIVERY';
  const tracking = useLocationTracking(trackingActive);
  const wakeLock = useWakeLock(job !== null && !jobIsSample);
  const now = useTicker(trackingActive || step === 'DELIVER');

  // The nested OTP block. Guarded field by field, not just object by object:
  // `job && job.otp.locked` still throws when `otp` is missing.
  const otpState = job?.otp ?? null;
  const serverAttempts = otpState?.attemptsRemaining ?? null;
  const serverLocked = otpState?.locked ?? false;
  const attemptsRemaining = attemptsOverride ?? serverAttempts;
  const locked = lockedOverride || serverLocked || attemptsRemaining === 0;

  /* A fresh server figure supersedes anything this screen was holding. */
  useEffect(() => {
    setAttemptsOverride(null);
  }, [serverAttempts]);

  /* Moving forward clears the local "arrived" flag for the next job. */
  useEffect(() => {
    if (status !== 'ASSIGNED') setArrived(false);
  }, [status]);

  const advance = useCallback(
    async (action: () => Promise<ActiveOrder | null>) => {
      if (busy || job === null) return;
      setBusy(true);
      setProblem(null);
      try {
        // Every transition answers with the refreshed order, so the screen
        // moves to whatever the API says — not to what it hoped for.
        const next = await action();
        if (next !== null) setActiveOrder(next);
        refresh();
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          setProblem('This order has already moved on. Pulling the latest from Mandi…');
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
    [busy, job, refresh, setActiveOrder],
  );

  const onDeliver = useCallback(async () => {
    if (busy || job === null || otp.length !== OTP_LENGTH) return;
    setBusy(true);
    setProblem(null);
    setOtpWrong(false);
    try {
      // The OTP goes straight out and is cleared straight after. It is never
      // held, logged or compared locally.
      await deliverOrder(job.orderId, otp);
      setOtp('');
      setDone(true);
      setActiveOrder(null);
      refresh();
    } catch (cause) {
      setOtp('');
      const failure = readOtpFailure(cause);
      if (failure !== null) {
        setOtpWrong(!failure.locked);
        if (failure.attemptsRemaining !== null) {
          setAttemptsOverride(failure.attemptsRemaining);
        }
        if (failure.locked) {
          setLockedOverride(true);
          setProblem(null);
        } else {
          setProblem('That code did not match. Ask the customer to read it again.');
        }
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
  }, [busy, job, otp, refresh, setActiveOrder]);

  const onFail = useCallback(
    async (reason: string) => {
      if (busy || job === null) return;
      setBusy(true);
      try {
        await failDelivery(job.orderId, reason);
        setActiveOrder(null);
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
    [busy, job, refresh, router, setActiveOrder],
  );

  // 0 IS prepaid: the API sends 0, not null, for an order already paid for.
  const codAmount = job?.payment.codAmountPaise ?? 0;

  const stepIndex = useMemo(() => STEP_ORDER.indexOf(step), [step]);

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
    return <CardSkeleton />;
  }

  if (job === null) {
    return (
      <>
        {loadError === null ? null : (
          <Notice tone="crit" title="Mandi did not answer properly">
            {loadError}
          </Notice>
        )}
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

      {/* The rail pulses once on mount and is keyed on the step, so it pulses
          exactly once per real transition, then holds — never an ambient
          blink on a screen a rider is not browsing. */}
      <div className={styles.stepRail} key={step}>
        <div className={styles.stepPips} aria-hidden="true">
          {STEP_ORDER.map((s, index) => (
            <span
              key={s}
              className={[
                styles.stepPip,
                index < stepIndex ? styles.stepPipDone : '',
                index === stepIndex ? styles.stepPipNow : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>
        <div className={styles.stepRailText}>
          <span className={styles.stepRailNow}>{STEP_LABEL[step]}</span>
          <span className={styles.stepRailCount}>
            Step {stepIndex + 1} of {STEP_ORDER.length}
          </span>
        </div>
      </div>

      {problem === null ? null : (
        <Notice tone="crit" title="Something went wrong">
          {problem}
        </Notice>
      )}

      {/*
        Keyed on the step, so a real transition remounts the pane and slides it
        forward exactly once. The Dock is deliberately OUTSIDE this element: it
        is `position: fixed`, and a `transform` mid-animation on an ancestor
        would make it fixed to the ANIMATING box instead of the viewport for
        the length of the transition — a fixed dock that is not actually fixed
        for 280ms. Keeping the pane's motion scoped to the scrolling content
        above the dock avoids that entirely.
      */}
      <div className={styles.stepPane} key={step}>
        {step === 'GO_TO_STORE' ? (
          <>
            <div className={styles.etaRow}>
              <span className={styles.mega}>{etaMinutes(job.etaMinutes)}</span>
              <span className={styles.megaUnit}>min to the door</span>
            </div>
            <p className={styles.lede}>
              {distanceKm(job.distanceKm)} total · you earn {money(job.payoutPaise)}
            </p>

            <PlaceCard kind="pickup" place={job.pickup} showMap />
          </>
        ) : null}

        {step === 'AT_STORE' ? (
          <>
            <h1 className={styles.h1}>
              Collect {job.itemCount} item{job.itemCount === 1 ? '' : 's'}
            </h1>
            <section className={styles.panel}>
              <ul className={styles.items}>
                {job.items.map((item, index) => (
                  // The API sends no item id — name, qty, unit and image only.
                  // The index is the right key for a list that never reorders.
                  <li key={`${item.name}-${index}`} className={styles.item}>
                    <span className={styles.itemQty}>
                      {item.qty}
                      {item.unit === '' ? '' : ` ${item.unit}`}
                    </span>
                    <span className={styles.itemName}>{item.name}</span>
                  </li>
                ))}
                {job.items.length === 0 ? (
                  <li className={styles.item}>
                    <span className={styles.itemName}>
                      The order list did not load. Check the packed bag against order{' '}
                      {job.orderNo === '' ? 'number' : job.orderNo} with the store.
                    </span>
                  </li>
                ) : null}
              </ul>
            </section>

            <button type="button" className={styles.ghost} onClick={() => setArrived(false)}>
              Not at the store yet
            </button>
          </>
        ) : null}

        {step === 'TO_CUSTOMER' ? (
          <>
            <h1 className={styles.h1}>Ready to go</h1>
            <p className={styles.lede}>
              Starting the delivery tells the customer you are on the way and begins
              sharing your location.
            </p>

            <PlaceCard
              kind="drop"
              place={job.drop}
              phone={job.customerPhone}
              phoneLabel={job.customerName === null ? 'Call' : 'Call customer'}
            />
          </>
        ) : null}

        {step === 'DELIVER' ? (
          <>
            <LocationBadge tracking={tracking} now={now} />

            <PlaceCard
              kind="drop"
              place={job.drop}
              showMap
              phone={job.customerPhone}
              phoneLabel={job.customerName === null ? 'Call' : `Call ${job.customerName}`}
            />

            {codAmount <= 0 ? (
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

            {locked ? (
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
                  attemptsRemaining={attemptsRemaining}
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
          </>
        ) : null}
      </div>

      {step === 'GO_TO_STORE' ? (
        <Dock>
          <PrimaryButton onClick={() => setArrived(true)}>
            <IconStore size={24} /> I&rsquo;m at the store
          </PrimaryButton>
        </Dock>
      ) : null}

      {step === 'AT_STORE' ? (
        <Dock>
          <PrimaryButton
            onClick={() => void advance(() => markPickedUp(job.orderId))}
            disabled={busy}
          >
            <IconCheck size={24} /> {busy ? 'Saving…' : 'Picked up'}
          </PrimaryButton>
        </Dock>
      ) : null}

      {step === 'TO_CUSTOMER' ? (
        <Dock>
          <PrimaryButton
            onClick={() => void advance(() => markOutForDelivery(job.orderId))}
            disabled={busy}
          >
            {busy ? 'Starting…' : 'Start delivery'}
          </PrimaryButton>
        </Dock>
      ) : null}

      {step === 'DELIVER' ? (
        <Dock>
          <PrimaryButton
            onClick={() => void onDeliver()}
            disabled={busy || locked || otp.length !== OTP_LENGTH}
          >
            <IconCheck size={24} />
            {busy ? 'Confirming…' : 'Confirm delivery'}
          </PrimaryButton>
        </Dock>
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
