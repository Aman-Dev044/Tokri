/**
 * The wallet, KYC, the confirm screen and live tracking.
 *
 * A separate module from `api.ts` on purpose: that file is the original
 * rider surface and is already 600 lines, and these four areas arrived
 * together as one feature. Everything still goes through the same shared
 * `api-client`, so the bearer token, the refresh cookie and the typed
 * `ApiError` are identical — this is a second file, not a second client.
 *
 * ── THE PATHS ARE NOT GUESSES ───────────────────────────────────────────────
 * Every path and every response shape below was read off the RUNNING API on
 * :4000 with a real rider token before it was written here. The paths live in
 * `DELIVERY_PATHS` (in `api.ts`) so there is still exactly one place a rider
 * URL is spelled.
 *
 * ── THE THREE NUMBERS THIS FILE NEVER HOLDS ─────────────────────────────────
 * Aadhaar, PAN and driving licence. `submitKyc` passes them straight into a
 * request body and keeps nothing; every response the API sends back is already
 * MASKED (`XXXX XXXX 1234`). There is no state, no cache and no log line in
 * this app that can contain a whole government identifier — the same
 * discipline `deliverOrder` applies to the OTP.
 *
 * ── DEFENSIVE DEFAULTS LEAN THE SAFE WAY ────────────────────────────────────
 * Where a field is missing, the fallback is the reading that protects the
 * rider rather than the one that flatters the screen: `lowBalance: true`,
 * `canAfford: false`, `status: 'not_started'`. A malformed payload tells a
 * rider to top up or to finish verification; it never tells them they are
 * ready when this build cannot know that.
 */

import { ApiError, api } from '@/lib/api-client';
import {
  DELIVERY_PATHS,
  HISTORY_PAGE_SIZE,
  normaliseItem,
  normaliseOffer,
  readStatus,
  bag,
  bool,
  latLng,
  nullableNum,
  nullableStr,
  num,
  str,
  unwrapList,
  waypoint,
} from './api';
import type {
  DeliveryTracking,
  InsuranceStanding,
  KycDocumentKind,
  KycDocumentRow,
  KycStatus,
  KycSubmission,
  OfferDetail,
  RiderKyc,
  VehicleSubmission,
  WalletLedgerRow,
  WalletSummary,
  WalletTxnType,
} from './types';

/* ================================================================== */
/* THE WALLET                                                          */
/* ================================================================== */

const WALLET_TXN_TYPES: readonly WalletTxnType[] = [
  'topup',
  'pick_fee',
  'earning',
  'adjustment',
  'refund',
];

/**
 * An unknown type reads as `adjustment`: a plain movement, with no claim
 * about where the money came from. Every other default would put a label on
 * a row this build does not understand.
 */
function readTxnType(value: unknown): WalletTxnType {
  const text = str(value);
  return WALLET_TXN_TYPES.find((type) => type === text) ?? 'adjustment';
}

export function normaliseWallet(raw: unknown): WalletSummary {
  const b = bag(raw);
  return {
    balancePaise: num(b['balancePaise'], 0),
    // The SERVER decides what "low" means — the threshold is its
    // configuration. Only a completely absent field falls back, and it falls
    // back to `true`: the reading that prompts a top-up rather than the one
    // that lets a rider discover the problem at the offer screen.
    lowBalance: bool(b['lowBalance'], true),
    warnThresholdPaise: num(b['warnThresholdPaise'], 0),
    lifetimeEarnedPaise: num(b['lifetimeEarnedPaise'], 0),
    lifetimeToppedUpPaise: num(b['lifetimeToppedUpPaise'], 0),
    lifetimeSpentPaise: num(b['lifetimeSpentPaise'], 0),
    totalDelivered: num(b['totalDelivered'], 0),
    pickFeeMinPaise: num(b['pickFeeMinPaise'], 0),
    pickFeeMaxPaise: num(b['pickFeeMaxPaise'], 0),
  };
}

function normaliseLedgerRow(raw: unknown): WalletLedgerRow | null {
  const b = bag(raw);
  const id = str(b['id']);
  if (id === '') return null;

  return {
    id,
    type: readTxnType(b['type']),
    // NOT `Math.abs`. The sign IS the direction, and a ledger that renders
    // every row as a credit is worse than no ledger at all.
    amountPaise: num(b['amountPaise'], 0),
    balanceAfterPaise: num(b['balanceAfterPaise'], 0),
    orderId: nullableStr(b['orderId']),
    reference: nullableStr(b['reference']),
    note: nullableStr(b['note']),
    createdAt: str(b['createdAt']),
  };
}

export async function fetchWallet(signal?: AbortSignal): Promise<WalletSummary> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.wallet, { signal });
  return normaliseWallet(raw);
}

export async function fetchWalletLedger(
  signal?: AbortSignal,
): Promise<WalletLedgerRow[]> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.walletTransactions, {
    query: { page: 1, limit: HISTORY_PAGE_SIZE },
    signal,
  });
  const out: WalletLedgerRow[] = [];
  for (const row of unwrapList(raw)) {
    const entry = normaliseLedgerRow(row);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** What a top-up attempt produced, or why it could not be made. */
export type TopupOutcome =
  | {
      kind: 'gateway';
      topupId: string;
      providerOrderId: string;
      keyId: string;
      amountPaise: number;
    }
  | { kind: 'unavailable'; message: string };

/**
 * Open a gateway order for `amountPaise`.
 *
 * On THIS deployment Razorpay has no keys, so the API answers 503 with
 * `errors.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED'` and writes nothing —
 * no pending attempt, no fabricated order id. That is returned as a
 * first-class `unavailable` outcome rather than thrown: it is not a failure
 * the rider caused, and the screen has something specific and true to say
 * about it.
 *
 * ── Why the message is read off the CODE, not the body ──────────────────────
 * The API's exception filter replaces `detail` with a generic "Internal
 * server error" for every status ≥ 500 — a 503 included — so the server's own
 * sentence never reaches the browser. The stable, machine-readable
 * `errors.code` does. Rendering `detail` here would print "Internal server
 * error" over a situation that is perfectly well understood.
 */
export async function startTopup(amountPaise: number): Promise<TopupOutcome> {
  try {
    const raw = await api.post<unknown>(DELIVERY_PATHS.walletTopup, {
      amountPaise,
    });
    const b = bag(raw);
    const gateway = bag(b['gatewayOrder']);
    const providerOrderId = str(gateway['providerOrderId']);
    const keyId = str(gateway['keyId']);

    if (providerOrderId === '' || keyId === '') {
      return {
        kind: 'unavailable',
        message:
          'The payment gateway did not return a usable order. Nothing has been charged.',
      };
    }

    return {
      kind: 'gateway',
      topupId: str(b['topupId']),
      providerOrderId,
      keyId,
      amountPaise: num(gateway['amount'], amountPaise),
    };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 503) {
      const code = str(bag(cause.problem.errors)['code']);
      if (code === 'PAYMENT_PROVIDER_NOT_CONFIGURED') {
        return {
          kind: 'unavailable',
          message:
            'Online top-up is not switched on yet — the payment gateway is not ' +
            'configured on this build. Nothing was charged. An administrator ' +
            'can credit your wallet in the meantime.',
        };
      }
      return {
        kind: 'unavailable',
        message:
          'The payment service is unavailable right now. Nothing was charged.',
      };
    }
    throw cause;
  }
}

/* ================================================================== */
/* KYC                                                                 */
/* ================================================================== */

const KYC_STATUSES: readonly KycStatus[] = [
  'not_started',
  'submitted',
  'verified',
  'rejected',
];

/**
 * An unknown status reads as `not_started` — the state in which the rider is
 * shown the form and is NOT told they may accept work. Any other default
 * would be a claim this build cannot support.
 */
export function readKycStatus(value: unknown): KycStatus {
  const text = str(value);
  return KYC_STATUSES.find((status) => status === text) ?? 'not_started';
}

const KYC_DOCUMENT_KINDS: readonly KycDocumentKind[] = [
  'aadhaar',
  'pan',
  'driving_licence',
  'selfie',
  'vehicle_rc',
  'vehicle_insurance',
];

const INSURANCE_STANDINGS: readonly InsuranceStanding[] = [
  'not_provided',
  'valid',
  'expiring_soon',
  'expired',
];

/**
 * An unknown standing reads as `not_provided` — never `valid`, which would
 * be a claim about a policy this build could not read.
 */
function readInsuranceStanding(value: unknown): InsuranceStanding {
  const text = str(value);
  return INSURANCE_STANDINGS.find((standing) => standing === text) ?? 'not_provided';
}

function normaliseKycDocument(raw: unknown): KycDocumentRow | null {
  const b = bag(raw);
  const kind = KYC_DOCUMENT_KINDS.find((value) => value === str(b['kind']));
  const url = str(b['url']);
  if (kind === undefined || url === '') return null;
  return { kind, url, uploadedAt: str(b['uploadedAt']) };
}

export function normaliseKyc(raw: unknown): RiderKyc {
  const b = bag(raw);
  const documents = Array.isArray(b['documents']) ? b['documents'] : [];
  const status = readKycStatus(b['status']);

  return {
    status,
    submittedAt: nullableStr(b['submittedAt']),
    verifiedAt: nullableStr(b['verifiedAt']),
    rejectedReason: nullableStr(b['rejectedReason']),
    slaDueAt: nullableStr(b['slaDueAt']),
    slaRemainingMs: nullableNum(b['slaRemainingMs']),
    // The promise, in hours, comes from the server. A constant here would be
    // a second copy of RIDER_KYC_SLA_HOURS that silently disagrees with the
    // countdown printed beside it.
    slaHours: num(b['slaHours'], 24),
    aadhaarNumberMasked: nullableStr(b['aadhaarNumberMasked']),
    panNumberMasked: nullableStr(b['panNumberMasked']),
    drivingLicenceNumberMasked: nullableStr(b['drivingLicenceNumberMasked']),
    vehicleRegistrationNumberMasked: nullableStr(b['vehicleRegistrationNumberMasked']),
    vehicleRcNumberMasked: nullableStr(b['vehicleRcNumberMasked']),
    vehicleInsurancePolicyNumberMasked: nullableStr(b['vehicleInsurancePolicyNumberMasked']),
    vehicleInsuranceExpiresOn: nullableStr(b['vehicleInsuranceExpiresOn']),
    vehicleInsuranceStatus: readInsuranceStanding(b['vehicleInsuranceStatus']),
    vehicleInsuranceDaysLeft: nullableNum(b['vehicleInsuranceDaysLeft']),
    documents: documents
      .map(normaliseKycDocument)
      .filter((row): row is KycDocumentRow => row !== null),
    canResubmit: bool(b['canResubmit'], status !== 'verified'),
  };
}

export async function fetchKyc(signal?: AbortSignal): Promise<RiderKyc> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.kyc, { signal });
  return normaliseKyc(raw);
}

/**
 * Submit the three numbers.
 *
 * They are passed straight into a request body and kept NOWHERE — no state,
 * no cache, no log. The response is already masked, so even the success path
 * never puts a whole identifier back on screen.
 */
export async function submitKyc(input: KycSubmission): Promise<RiderKyc> {
  const raw = await api.post<unknown>(DELIVERY_PATHS.kyc, {
    aadhaarNumber: input.aadhaarNumber,
    panNumber: input.panNumber,
    drivingLicenceNumber: input.drivingLicenceNumber,
    ...(input.vehicle === undefined ? {} : { vehicle: vehicleBody(input.vehicle) }),
  });
  return normaliseKyc(raw);
}

/**
 * Update the vehicle alone — the one part of KYC a VERIFIED rider may change.
 *
 * A change to a verified record sends it back for review (the response says
 * `submitted`); resending what is on file changes nothing. Same discipline
 * as `submitKyc`: the numbers go into the body and nowhere else.
 */
export async function updateKycVehicle(input: VehicleSubmission): Promise<RiderKyc> {
  const raw = await api.put<unknown>(DELIVERY_PATHS.kycVehicle, vehicleBody(input));
  return normaliseKyc(raw);
}

/** Exactly the four fields — `forbidNonWhitelisted` refuses anything else. */
function vehicleBody(input: VehicleSubmission): VehicleSubmission {
  return {
    vehicleRegistrationNumber: input.vehicleRegistrationNumber,
    vehicleRcNumber: input.vehicleRcNumber,
    vehicleInsurancePolicyNumber: input.vehicleInsurancePolicyNumber,
    vehicleInsuranceExpiresOn: input.vehicleInsuranceExpiresOn,
  };
}

/** What a document presign produced, or why it could not be made. */
export type KycUploadOutcome =
  | {
      kind: 'presigned';
      uploadUrl: string;
      publicUrl: string;
      headers: Record<string, string>;
    }
  | { kind: 'unavailable'; message: string };

/**
 * Ask for a presigned PUT for one document.
 *
 * Object storage is NOT configured on this deployment, so this answers 503
 * today. It is surfaced as an `unavailable` outcome with a true sentence
 * rather than an error: the rider can still be verified on their numbers
 * alone, and calling it a "failure" would invite them to retry something that
 * cannot succeed.
 */
export async function presignKycDocument(
  kind: KycDocumentKind,
  contentType: string,
  sizeBytes: number,
): Promise<KycUploadOutcome> {
  try {
    const raw = await api.post<unknown>(DELIVERY_PATHS.kycDocument, {
      kind,
      contentType,
      sizeBytes,
    });
    const b = bag(raw);
    const uploadUrl = str(b['uploadUrl']);
    const publicUrl = str(b['publicUrl']);
    if (uploadUrl === '' || publicUrl === '') {
      return {
        kind: 'unavailable',
        message: 'The upload service did not return a usable link.',
      };
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(bag(b['headers']))) {
      if (typeof value === 'string') headers[key] = value;
    }
    return { kind: 'presigned', uploadUrl, publicUrl, headers };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 503) {
      return {
        kind: 'unavailable',
        message:
          'Document upload is not switched on yet on this build — file storage ' +
          'is not configured. Your numbers are enough to be verified; nothing ' +
          'is waiting on a photo.',
      };
    }
    throw cause;
  }
}

/** Record an upload that has already landed in the bucket. */
export async function attachKycDocument(
  kind: KycDocumentKind,
  url: string,
): Promise<RiderKyc> {
  const raw = await api.post<unknown>(DELIVERY_PATHS.kycDocumentAttach, {
    kind,
    url,
  });
  return normaliseKyc(raw);
}

/* ================================================================== */
/* The confirm screen and live tracking                                */
/* ================================================================== */

export async function fetchOfferDetail(
  assignmentId: string,
  signal?: AbortSignal,
): Promise<OfferDetail | null> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.offerDetail(assignmentId), {
    signal,
  });
  const base = normaliseOffer(raw);
  if (base === null) return null;

  const b = bag(raw);
  const items = Array.isArray(b['items']) ? b['items'] : [];
  const pickFeeMinPaise = num(b['pickFeeMinPaise'], 0);

  return {
    ...base,
    items: items.map(normaliseItem),
    pickFeeMinPaise,
    pickFeeMaxPaise: num(b['pickFeeMaxPaise'], pickFeeMinPaise),
    walletBalancePaise: num(b['walletBalancePaise'], 0),
    // The safe default is `false`. Telling a rider they can afford a job they
    // cannot sends them into a 402 after the tap; the other way round costs
    // them one refresh.
    canAfford: bool(b['canAfford'], false),
    kycStatus: readKycStatus(b['kycStatus']),
  };
}

export async function fetchTracking(
  orderId: string,
  signal?: AbortSignal,
): Promise<DeliveryTracking | null> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.tracking(orderId), {
    signal,
  });
  const b = bag(raw);
  const id = str(b['orderId']);
  if (id === '') return null;

  const items = Array.isArray(b['items']) ? b['items'] : [];
  const rider = bag(b['rider']);
  const riderPoint = latLng(rider);
  const riderAt = str(rider['at']);

  return {
    orderId: id,
    orderNo: str(b['orderNo']),
    status: readStatus(b['status']),
    // A position with no timestamp is not a live fix — it is a point of
    // unknown age, and a map that draws it as "now" lies about how stale it
    // is. Both halves or nothing.
    rider:
      riderPoint === null || riderAt === ''
        ? null
        : { ...riderPoint, at: riderAt },
    pickup: waypoint(b['pickup'], 'Pickup'),
    drop: waypoint(b['drop'], 'Drop'),
    remainingKm: nullableNum(b['remainingKm']),
    etaMinutes: nullableNum(b['etaMinutes']),
    items: items.map(normaliseItem),
    itemCount: num(b['itemCount'], items.length),
    customerName: nullableStr(b['customerName']),
    customerPhone: str(b['customerPhone']),
    codAmountPaise: num(b['codAmountPaise'], 0),
  };
}
