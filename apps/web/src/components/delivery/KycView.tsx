'use client';

/**
 * Verification — the gate on everything else.
 *
 * A rider cannot accept a single order until this says VERIFIED. That is the
 * whole reason this screen is direct about what it wants, what happens next,
 * and when: the promise is in hours, it is stated as a sentence, and the
 * countdown beside it runs against the deadline the SERVER stamped on the
 * submission.
 *
 * ── THIS SCREEN NEVER SEES A WHOLE IDENTIFIER ───────────────────────────────
 * The three numbers are typed into the form and posted. They are not stored in
 * state after submission, not cached, not logged, and the API answers with
 * them already MASKED (`XXXX XXXX 1234`). Once submitted, the only version
 * that exists in this app is the masked one — exactly the discipline the OTP
 * entry uses. The full number is readable on precisely one screen in the whole
 * platform, the admin verification view, which exists so a human can compare
 * it against the uploaded card.
 *
 * The form fields are `inputMode` + `autoComplete="off"` for the same reason:
 * a browser storing an Aadhaar number in its autofill database is a copy
 * nobody asked for.
 *
 * ── THE VEHICLE IS THE ONE PART A VERIFIED RIDER MAY CHANGE ─────────────────
 * Plate, RC, insurance policy and its expiry get the same treatment — typed,
 * posted, cleared, shown back masked. On a first submission they travel with
 * the identity (all four or none: a bicycle has no plate). After that they
 * have their own form, because vehicles get replaced and insurance renews
 * every year. The API sends a VERIFIED record back for review when they
 * CHANGE, and this screen says so before the rider presses the button rather
 * than after. An expired policy is accepted and flagged, never refused.
 *
 * ── THE SLA IS A PROMISE, SO IT IS SHOWN AS ONE ─────────────────────────────
 * `slaHours` and `slaDueAt` both come from the API. The hours are the
 * platform's configured promise; the deadline is the absolute instant it
 * applies to THIS submission, so changing the setting later never moves a
 * promise already made. A breached deadline is shown as breached, not hidden —
 * a rider waiting past the promise should be told they are waiting past it.
 *
 * ── DOCUMENT UPLOAD IS 503 TODAY, AND SAYS SO ───────────────────────────────
 * Object storage has no credentials on this deployment. The presign really is
 * called; it really does answer 503; and the screen says the upload is not
 * switched on, that the numbers alone are enough to be verified, and does not
 * invite a pointless retry.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import styles from './delivery.module.css';
import { Notice } from './Banners';
import { CardSkeleton } from './Skeletons';
import { useRider } from './RiderProvider';
import { IconCheck, IconShield, IconX } from './icons';
import { ApiError } from '@/lib/api-client';
import {
  presignKycDocument,
  submitKyc,
  updateKycVehicle,
  type KycUploadOutcome,
} from '@/lib/delivery/wallet-api';
import { useTicker } from '@/lib/delivery/tracking';
import type {
  KycDocumentKind,
  KycStatus,
  RiderKyc,
  VehicleSubmission,
} from '@/lib/delivery/types';

const STATUS_TITLE: Record<KycStatus, string> = {
  not_started: 'Verify your identity',
  submitted: 'Checking your documents',
  verified: 'You are verified',
  rejected: 'We could not verify these documents',
};

const DOCUMENT_LABEL: Record<KycDocumentKind, string> = {
  aadhaar: 'Aadhaar card',
  pan: 'PAN card',
  driving_licence: 'Driving licence',
  selfie: 'Photo of you',
  vehicle_rc: 'Vehicle RC',
  vehicle_insurance: 'Insurance policy',
};

const IDENTITY_DOCUMENTS = ['aadhaar', 'pan', 'driving_licence'] as const;
const VEHICLE_DOCUMENTS = ['vehicle_rc', 'vehicle_insurance'] as const;

/**
 * The same three formats the API validates, checked here first so a typo
 * costs a keystroke rather than a round trip — and so a malformed number
 * never consumes a human reviewer's SLA.
 */
const AADHAAR_RE = /^\d{12}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DL_RE = /^[A-Z0-9]{8,20}$/;

/**
 * The vehicle formats, after the same normalisation the API applies. The
 * plate check is the SHAPE only; the API also holds the list of real state
 * codes, and its 400 is shown verbatim if this lets one through.
 */
const PLATE_RE = /^(?:[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/;
const RC_RE = /^[A-Z0-9]{6,20}$/;
const POLICY_RE = /^[A-Z0-9][A-Z0-9/-]{4,28}[A-Z0-9]$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface VehicleDraft {
  plate: string;
  rc: string;
  policy: string;
  expiresOn: string;
}

const EMPTY_VEHICLE: VehicleDraft = { plate: '', rc: '', policy: '', expiresOn: '' };

/** "23h 41m left" / "4m left" / "overdue". */
function countdown(ms: number): string {
  if (ms <= 0) return 'overdue';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m left`;
  return `${minutes}m left`;
}

/**
 * A draft → the API body, or the sentence explaining what is wrong.
 * `null` means "nothing typed", which only a first submission accepts.
 */
function readVehicle(
  draft: VehicleDraft,
): { ok: true; value: VehicleSubmission | null } | { ok: false; problem: string } {
  const plate = draft.plate.replace(/[\s-]+/g, '').toUpperCase();
  const rc = draft.rc.replace(/[\s-]+/g, '').toUpperCase();
  const policy = draft.policy.replace(/\s+/g, '').toUpperCase();
  const expiresOn = draft.expiresOn.trim();

  if (plate === '' && rc === '' && policy === '' && expiresOn === '') {
    return { ok: true, value: null };
  }
  if (!PLATE_RE.test(plate)) {
    return {
      ok: false,
      problem: 'A number plate looks like DL 8S AB 2048, or 22 BH 1234 AA for BH series.',
    };
  }
  if (!RC_RE.test(rc)) {
    return { ok: false, problem: 'An RC number is 6 to 20 letters and digits.' };
  }
  if (!POLICY_RE.test(policy)) {
    return {
      ok: false,
      problem: 'A policy number is 6 to 30 letters and digits; slashes and dashes are fine.',
    };
  }
  if (!DAY_RE.test(expiresOn)) {
    return { ok: false, problem: 'Choose the last day your insurance covers.' };
  }
  return {
    ok: true,
    value: {
      vehicleRegistrationNumber: plate,
      vehicleRcNumber: rc,
      vehicleInsurancePolicyNumber: policy,
      vehicleInsuranceExpiresOn: expiresOn,
    },
  };
}

export function KycView() {
  const { kyc, setKyc, loading, refresh, loadError } = useRider();
  const now = useTicker(kyc?.status === 'submitted');

  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const [licence, setLicence] = useState('');
  const [vehicle, setVehicle] = useState<VehicleDraft>(EMPTY_VEHICLE);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [upload, setUpload] = useState<KycUploadOutcome | null>(null);

  // The vehicle-only form, for a record that has been submitted at least once.
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [vehicleProblem, setVehicleProblem] = useState<string | null>(null);
  const [vehicleSaved, setVehicleSaved] = useState<string | null>(null);

  // Whenever the record becomes VERIFIED the typed values are dropped from
  // state. They should not outlive the form that needed them.
  useEffect(() => {
    if (kyc?.status === 'verified') {
      setAadhaar('');
      setPan('');
      setLicence('');
      setVehicle(EMPTY_VEHICLE);
    }
  }, [kyc?.status]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy || kyc === null) return;

      const cleanAadhaar = aadhaar.replace(/\s+/g, '');
      const cleanPan = pan.replace(/\s+/g, '').toUpperCase();
      const cleanLicence = licence.replace(/\s+/g, '').toUpperCase();

      if (!AADHAAR_RE.test(cleanAadhaar)) {
        setProblem('An Aadhaar number is 12 digits. Spaces are fine.');
        return;
      }
      if (!PAN_RE.test(cleanPan)) {
        setProblem('A PAN looks like ABCDE1234F — five letters, four digits, one letter.');
        return;
      }
      if (!DL_RE.test(cleanLicence)) {
        setProblem('A licence number is 8 to 20 letters and digits.');
        return;
      }

      // The vehicle rides along only on a FIRST submission; after that it
      // has its own form below, so resending the identity leaves it alone.
      const withVehicle = kyc.status === 'not_started';
      const parsed = withVehicle ? readVehicle(vehicle) : { ok: true as const, value: null };
      if (!parsed.ok) {
        setProblem(parsed.problem);
        return;
      }

      setBusy(true);
      setProblem(null);
      try {
        const updated = await submitKyc({
          aadhaarNumber: cleanAadhaar,
          panNumber: cleanPan,
          drivingLicenceNumber: cleanLicence,
          ...(parsed.value === null ? {} : { vehicle: parsed.value }),
        });
        // Cleared IMMEDIATELY. From this point the only copy in the app is
        // the masked one the server just sent back.
        setAadhaar('');
        setPan('');
        setLicence('');
        setVehicle(EMPTY_VEHICLE);
        setKyc(updated);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          setProblem(
            'Your documents are already verified. Contact support if they need changing.',
          );
        } else if (cause instanceof ApiError && !cause.isNetworkError) {
          setProblem(cause.friendlyMessage);
        } else {
          setProblem('Could not send your documents. Check your connection and try again.');
        }
      } finally {
        setBusy(false);
      }
    },
    [aadhaar, pan, licence, vehicle, busy, kyc, setKyc],
  );

  const onVehicleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (vehicleBusy || kyc === null) return;

      const parsed = readVehicle(vehicle);
      if (!parsed.ok || parsed.value === null) {
        setVehicleProblem(parsed.ok ? 'Fill in all four vehicle details.' : parsed.problem);
        return;
      }

      const wasVerified = kyc.status === 'verified';
      setVehicleBusy(true);
      setVehicleProblem(null);
      setVehicleSaved(null);
      try {
        const updated = await updateKycVehicle(parsed.value);
        setVehicle(EMPTY_VEHICLE);
        setEditingVehicle(false);
        setKyc(updated);
        setVehicleSaved(
          wasVerified && updated.status === 'submitted'
            ? `Your new vehicle details are with our team. We check them within ${updated.slaHours} hours; until then you cannot accept new orders.`
            : wasVerified
              ? 'Those are the details we already hold — nothing changed, and you are still verified.'
              : 'Saved. Our team will check them with the rest of your documents.',
        );
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          setVehicleProblem('Send your identity details first — your vehicle goes with them.');
        } else if (cause instanceof ApiError && !cause.isNetworkError) {
          setVehicleProblem(cause.friendlyMessage);
        } else {
          setVehicleProblem('Could not save your vehicle. Check your connection and try again.');
        }
      } finally {
        setVehicleBusy(false);
      }
    },
    [vehicle, vehicleBusy, kyc, setKyc],
  );

  const onUpload = useCallback(async (kind: KycDocumentKind) => {
    setUpload(null);
    try {
      // A representative size: the presign SIGNS `content-length`, so the
      // real upload would use the file's actual byte length. On this build
      // the call never gets that far — it 503s first.
      setUpload(await presignKycDocument(kind, 'image/jpeg', 512 * 1024));
    } catch {
      setUpload({
        kind: 'unavailable',
        message: 'Could not reach the upload service.',
      });
    }
  }, []);

  if (loading && kyc === null) {
    return (
      <>
        <h1 className={styles.h1}>Verification</h1>
        <CardSkeleton />
      </>
    );
  }

  if (kyc === null) {
    return (
      <>
        <h1 className={styles.h1}>Verification</h1>
        <Notice tone="crit" title="Could not load your verification status">
          {loadError ?? 'This screen could not read your record.'}
          <div>
            <button type="button" className={styles.ghost} onClick={refresh}>
              Try again
            </button>
          </div>
        </Notice>
      </>
    );
  }

  const breached =
    kyc.status === 'submitted' &&
    kyc.slaRemainingMs !== null &&
    kyc.slaRemainingMs <= 0;

  // Recomputed from the absolute deadline on every tick rather than
  // decremented locally — a backgrounded tab must not make the promise look
  // longer than it is.
  const remainingMs =
    kyc.slaDueAt === null
      ? kyc.slaRemainingMs
      : new Date(kyc.slaDueAt).getTime() - now;

  const vehicleOnFile =
    kyc.vehicleRegistrationNumberMasked !== null || kyc.vehicleInsuranceExpiresOn !== null;
  const showVehicleForm =
    kyc.status !== 'not_started' && (editingVehicle || !vehicleOnFile);

  // A verified rider may still send vehicle documents — the API reopens the
  // review when one lands, exactly as it does for changed numbers.
  const uploadKinds: readonly KycDocumentKind[] = kyc.canResubmit
    ? [...IDENTITY_DOCUMENTS, ...VEHICLE_DOCUMENTS]
    : kyc.status === 'verified'
      ? VEHICLE_DOCUMENTS
      : [];

  return (
    <>
      <h1 className={styles.h1}>{STATUS_TITLE[kyc.status]}</h1>

      {/* ── Status ───────────────────────────────────────────────────── */}
      <section className={styles.panel} aria-label="Verification status">
        <div className={styles.feeHead}>
          {kyc.status === 'verified' ? (
            <IconCheck size={20} />
          ) : kyc.status === 'rejected' ? (
            <IconX size={20} />
          ) : (
            <IconShield size={20} />
          )}
          <h2 className={styles.h2}>
            {kyc.status === 'verified'
              ? 'Verified'
              : kyc.status === 'submitted'
                ? 'With our team'
                : kyc.status === 'rejected'
                  ? 'Not accepted'
                  : 'Not started'}
          </h2>
        </div>

        {kyc.status === 'verified' ? (
          <p className={styles.lede}>
            You can accept orders. Your wallet is charged a pick fee on each
            one.
          </p>
        ) : kyc.status === 'submitted' ? (
          <>
            <p className={styles.lede}>
              Verification is completed within {kyc.slaHours} hours of
              submitting. We will tell you as soon as it is done — you do not
              need to do anything else.
            </p>
            {remainingMs === null ? null : (
              <div className={styles.feeRow}>
                <span className={styles.feeRowLabel}>
                  {breached ? 'Past our promise' : 'Decision due'}
                </span>
                <span className={styles.feeRowValue}>
                  {countdown(remainingMs)}
                </span>
              </div>
            )}
            {breached ? (
              <Notice tone="warn" title="This is taking longer than promised">
                We said {kyc.slaHours} hours and have not met that. Your
                submission is still in the queue — contact support if you need
                it moved along.
              </Notice>
            ) : null}
          </>
        ) : kyc.status === 'rejected' ? (
          <Notice tone="crit" title="What needs fixing">
            {kyc.rejectedReason ?? 'No reason was recorded. Please submit again.'}
          </Notice>
        ) : (
          <p className={styles.lede}>
            Send your Aadhaar, PAN and driving licence numbers, and your
            vehicle&apos;s details. Verification is completed within{' '}
            {kyc.slaHours} hours. You cannot accept orders until it is done.
          </p>
        )}
      </section>

      {/* ── What we hold, masked ─────────────────────────────────────── */}
      {kyc.aadhaarNumberMasked === null ? null : (
        <section className={styles.panel} aria-label="Documents on file">
          <h2 className={styles.h2}>What we hold</h2>
          <div className={styles.feeRow}>
            <span className={styles.feeRowLabel}>Aadhaar</span>
            <span className={styles.feeRowValue}>{kyc.aadhaarNumberMasked}</span>
          </div>
          <div className={styles.feeRow}>
            <span className={styles.feeRowLabel}>PAN</span>
            <span className={styles.feeRowValue}>
              {kyc.panNumberMasked ?? '—'}
            </span>
          </div>
          <div className={styles.feeRow}>
            <span className={styles.feeRowLabel}>Driving licence</span>
            <span className={styles.feeRowValue}>
              {kyc.drivingLicenceNumberMasked ?? '—'}
            </span>
          </div>
          <p className={styles.lede}>
            Only the last four characters are shown here, and that is all this
            app ever receives. The full numbers are readable only by the person
            checking them against your documents.
          </p>
        </section>
      )}

      {/* ── The form ─────────────────────────────────────────────────── */}
      {kyc.canResubmit ? (
        <form className={styles.panel} onSubmit={(event) => void onSubmit(event)}>
          <h2 className={styles.h2}>
            {kyc.status === 'not_started' ? 'Your details' : 'Send them again'}
          </h2>

          <label className={styles.fieldLabel} htmlFor="kyc-aadhaar">
            Aadhaar number
          </label>
          <input
            id="kyc-aadhaar"
            className={styles.field}
            value={aadhaar}
            onChange={(event) => setAadhaar(event.target.value)}
            inputMode="numeric"
            // Never offered to the browser's autofill store: an Aadhaar
            // number saved there is a copy nobody asked for.
            autoComplete="off"
            spellCheck={false}
            maxLength={14}
            placeholder="1234 5678 9012"
            disabled={busy}
          />

          <label className={styles.fieldLabel} htmlFor="kyc-pan">
            PAN
          </label>
          <input
            id="kyc-pan"
            className={styles.field}
            value={pan}
            onChange={(event) => setPan(event.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            placeholder="ABCDE1234F"
            disabled={busy}
          />

          <label className={styles.fieldLabel} htmlFor="kyc-dl">
            Driving licence number
          </label>
          <input
            id="kyc-dl"
            className={styles.field}
            value={licence}
            onChange={(event) => setLicence(event.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            placeholder="KA0120210012345"
            disabled={busy}
          />

          {kyc.status === 'not_started' ? (
            <>
              <h2 className={styles.h2}>Your vehicle</h2>
              <p className={styles.lede}>
                All four, or leave them empty if you ride a bicycle.
              </p>
              <VehicleFields
                idPrefix="kyc"
                draft={vehicle}
                onChange={setVehicle}
                disabled={busy}
              />
            </>
          ) : null}

          {problem === null ? null : (
            <Notice tone="crit" title="Check what you typed">
              {problem}
            </Notice>
          )}

          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? 'Sending…' : 'Send for verification'}
          </button>

          <p className={styles.lede}>
            We check these within {kyc.slaHours} hours. Your numbers are stored
            for that check only and are never shown back to you in full.
          </p>
        </form>
      ) : null}

      {/* ── Vehicle ──────────────────────────────────────────────────── */}
      {kyc.status === 'not_started' ? null : (
        <section className={styles.panel} aria-label="Vehicle">
          <h2 className={styles.h2}>Your vehicle</h2>

          {vehicleOnFile ? (
            <>
              <div className={styles.feeRow}>
                <span className={styles.feeRowLabel}>Number plate</span>
                <span className={styles.feeRowValue}>
                  {kyc.vehicleRegistrationNumberMasked ?? '—'}
                </span>
              </div>
              <div className={styles.feeRow}>
                <span className={styles.feeRowLabel}>RC</span>
                <span className={styles.feeRowValue}>
                  {kyc.vehicleRcNumberMasked ?? '—'}
                </span>
              </div>
              <div className={styles.feeRow}>
                <span className={styles.feeRowLabel}>Insurance policy</span>
                <span className={styles.feeRowValue}>
                  {kyc.vehicleInsurancePolicyNumberMasked ?? '—'}
                </span>
              </div>
              <div className={styles.feeRow}>
                <span className={styles.feeRowLabel}>Insured until</span>
                <span className={styles.feeRowValue}>
                  {dayOrDash(kyc.vehicleInsuranceExpiresOn)}
                </span>
              </div>
              <InsuranceNotice kyc={kyc} />
            </>
          ) : (
            <p className={styles.lede}>
              No vehicle on file. Add it if you ride anything with a number
              plate.
            </p>
          )}

          {vehicleSaved === null ? null : (
            <Notice tone="neutral" title="Vehicle updated">
              {vehicleSaved}
            </Notice>
          )}

          {showVehicleForm ? (
            <form onSubmit={(event) => void onVehicleSubmit(event)}>
              {kyc.status === 'verified' ? (
                <Notice tone="warn" title="This sends you back for review">
                  Changing your vehicle means our team checks it again, within{' '}
                  {kyc.slaHours} hours. You can finish a delivery you are on,
                  but cannot accept new orders until it is done.
                </Notice>
              ) : null}

              <VehicleFields
                idPrefix="vehicle"
                draft={vehicle}
                onChange={setVehicle}
                disabled={vehicleBusy}
              />

              {vehicleProblem === null ? null : (
                <Notice tone="crit" title="Check what you typed">
                  {vehicleProblem}
                </Notice>
              )}

              <button type="submit" className={styles.primary} disabled={vehicleBusy}>
                {vehicleBusy
                  ? 'Saving…'
                  : kyc.status === 'verified'
                    ? 'Save and send for review'
                    : 'Save vehicle'}
              </button>
              {vehicleOnFile ? (
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setEditingVehicle(false);
                    setVehicle(EMPTY_VEHICLE);
                    setVehicleProblem(null);
                  }}
                  disabled={vehicleBusy}
                >
                  Cancel
                </button>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                setEditingVehicle(true);
                setVehicleSaved(null);
              }}
            >
              Change vehicle details
            </button>
          )}
        </section>
      )}

      {/* ── Documents ────────────────────────────────────────────────── */}
      <section className={styles.panel} aria-label="Document photos">
        <h2 className={styles.h2}>Photos of your documents</h2>

        {kyc.documents.length === 0 ? (
          <p className={styles.lede}>Nothing uploaded yet.</p>
        ) : (
          <ul className={styles.rows}>
            {kyc.documents.map((doc) => (
              <li key={doc.kind} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>{DOCUMENT_LABEL[doc.kind]}</div>
                  <div className={styles.rowMeta}>
                    Uploaded {timeOrDash(doc.uploadedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {uploadKinds.length === 0 ? null : (
          <div className={styles.topupRow}>
            {uploadKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={styles.topupChip}
                onClick={() => void onUpload(kind)}
              >
                {DOCUMENT_LABEL[kind]}
              </button>
            ))}
          </div>
        )}

        {upload?.kind === 'unavailable' ? (
          <Notice tone="warn" title="Uploads are not switched on yet">
            {upload.message}
          </Notice>
        ) : null}

        {upload?.kind === 'presigned' ? (
          <Notice tone="neutral" title="Ready to upload">
            The upload link is ready. Choose the photo to send.
          </Notice>
        ) : null}
      </section>
    </>
  );
}

/**
 * The four vehicle inputs, shared by the first submission and the
 * vehicle-only form. Same `autoComplete="off"` rule as the identity numbers:
 * a policy number in the browser's autofill store is a copy nobody asked for.
 */
function VehicleFields({
  idPrefix,
  draft,
  onChange,
  disabled,
}: {
  idPrefix: string;
  draft: VehicleDraft;
  onChange: (next: VehicleDraft) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-plate`}>
        Number plate
      </label>
      <input
        id={`${idPrefix}-plate`}
        className={styles.field}
        value={draft.plate}
        onChange={(event) => onChange({ ...draft, plate: event.target.value.toUpperCase() })}
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        placeholder="DL 8S AB 2048"
        disabled={disabled}
      />

      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-rc`}>
        RC number
      </label>
      <input
        id={`${idPrefix}-rc`}
        className={styles.field}
        value={draft.rc}
        onChange={(event) => onChange({ ...draft, rc: event.target.value.toUpperCase() })}
        autoComplete="off"
        spellCheck={false}
        maxLength={24}
        placeholder="DL0820230012345"
        disabled={disabled}
      />

      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-policy`}>
        Insurance policy number
      </label>
      <input
        id={`${idPrefix}-policy`}
        className={styles.field}
        value={draft.policy}
        onChange={(event) => onChange({ ...draft, policy: event.target.value.toUpperCase() })}
        autoComplete="off"
        spellCheck={false}
        maxLength={34}
        placeholder="3005/123456789/00/000"
        disabled={disabled}
      />

      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-expiry`}>
        Insurance valid until
      </label>
      <input
        id={`${idPrefix}-expiry`}
        type="date"
        className={styles.field}
        value={draft.expiresOn}
        onChange={(event) => onChange({ ...draft, expiresOn: event.target.value })}
        autoComplete="off"
        disabled={disabled}
      />
    </>
  );
}

/** Expired or about to be — said plainly, with what to do about it. */
function InsuranceNotice({ kyc }: { kyc: RiderKyc }) {
  const days = kyc.vehicleInsuranceDaysLeft;
  if (kyc.vehicleInsuranceStatus === 'expired') {
    return (
      <Notice tone="crit" title="Your insurance has expired">
        It ended on {dayOrDash(kyc.vehicleInsuranceExpiresOn)}. Riding without
        cover is illegal — renew it, then update the policy here.
      </Notice>
    );
  }
  if (kyc.vehicleInsuranceStatus === 'expiring_soon') {
    return (
      <Notice tone="warn" title="Your insurance ends soon">
        {days === 0
          ? 'Today is the last day it covers you.'
          : `${days ?? 'A few'} day${days === 1 ? '' : 's'} of cover left.`}{' '}
        Renew it and update the policy here before it lapses.
      </Notice>
    );
  }
  return null;
}

/** `2027-03-31` → "31 Mar 2027", or a dash. A calendar day, so read in UTC. */
function dayOrDash(day: string | null): string {
  if (day === null || !DAY_RE.test(day)) return '—';
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** A timestamp, or a dash. Never a fabricated "just now". */
function timeOrDash(iso: string): string {
  if (iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
