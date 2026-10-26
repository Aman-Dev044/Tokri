'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  DataTable,
  KpiTile,
  Money,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation } from '@/hooks';
import { formatCount, formatDate, formatPaise, formatPct, humanise } from '@/lib/admin/format';
import { useAdminRole } from '@/lib/admin/session';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { safeArray, useSourcedOne } from '../_shared-pages/useSourced';
import { Presence } from './Presence';
import {
  riderDetailFixture,
  vehicleLabel,
  type RiderDeliveryRow,
  type RiderDetail,
  type RiderKyc,
  type RiderRow,
} from './fixtures';

interface StatusBody {
  status: 'active' | 'suspended';
  reason: string;
}

interface RejectBody {
  reason: string;
}

interface CreditBody {
  amountPaise: number;
  note: string;
}

/**
 * A live payload is not the type just because the type says so.
 *
 * The row half of this endpoint has shipped for a while; the detail half
 * (performance, runs, KYC, wallet) is newer. Reading those as optional means
 * an API that has not been redeployed yet degrades to "not available" panels
 * instead of a TypeError in the route error boundary — which is exactly how
 * this screen used to fail.
 */
type RiderDetailPayload = RiderRow & Partial<Omit<RiderDetail, keyof RiderRow>>;

/** Mirrors `RejectRiderKycDto` / `CreditRiderWalletDto`. The API re-checks all of it. */
const REASON_MIN = 5;
const NOTE_MIN = 3;
const TEXT_MAX = 300;
const CREDIT_MAX_PAISE = 10_000_000;

/**
 * "1,250.50" or "1250.5" in rupees -> 125050 paise, or null.
 *
 * Parsed as a string, never through a float: `0.29 * 100` is
 * 28.999999999999996, and a wallet is exactly where a lost paisa is a bug
 * report. At most two decimals — a third would be a fraction of a paisa.
 */
function rupeesToPaise(input: string): number | null {
  const text = input.replace(/[,\s₹]/g, '');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? '').padEnd(2, '0'));
  return rupees * 100 + paise;
}

/**
 * The KYC and wallet writes live on the riders controller while this screen
 * reads the delivery-partners one, so a write refreshes both prefixes.
 */
const INVALIDATE = ['/admin/delivery-partners', '/admin/riders'] as const;

const DOCUMENT_LABEL: Readonly<Record<string, string>> = {
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  driving_licence: 'Driving licence',
  selfie: 'Selfie',
};

export function RiderDetailView({ riderId }: { riderId: string }) {
  const router = useRouter();
  const endpoint = `/admin/delivery-partners/${riderId}`;
  const { isSuperAdmin } = useAdminRole();

  // Memoised: a fresh fixture object every render would hand `useSourcedOne`
  // a new dependency each time.
  const fixture = useMemo(() => riderDetailFixture(riderId), [riderId]);
  const { value, loading, isSample, refetch } = useSourcedOne<RiderDetailPayload>(
    endpoint,
    fixture,
  );

  /* ── Status ───────────────────────────────────────────────────────── */

  const [confirming, setConfirming] = useState(false);
  const { mutate, loading: saving, error } = useAdminMutation<StatusBody, RiderDetail>(
    `${endpoint}/status`,
    'PATCH',
  );

  /* ── KYC ──────────────────────────────────────────────────────────── */

  const [kycAction, setKycAction] = useState<'verify' | 'reject' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const verify = useAdminMutation<Record<string, never>, unknown>(
    `/admin/riders/${riderId}/kyc/verify`,
    'POST',
  );
  const reject = useAdminMutation<RejectBody, unknown>(
    `/admin/riders/${riderId}/kyc/reject`,
    'POST',
  );
  const kycBusy = verify.loading || reject.loading;
  const kycError = kycAction === 'verify' ? verify.error : reject.error;
  const reasonOk =
    rejectReason.trim().length >= REASON_MIN && rejectReason.trim().length <= TEXT_MAX;

  function closeKyc() {
    setKycAction(null);
    setRejectReason('');
    verify.reset();
    reject.reset();
  }

  async function applyKyc() {
    const result =
      kycAction === 'verify'
        ? await verify.mutate({}, { invalidate: INVALIDATE })
        : await reject.mutate({ reason: rejectReason.trim() }, { invalidate: INVALIDATE });
    // A failed decision keeps the dialog open with the API's reason in it.
    if (result === null) return;
    closeKyc();
    refetch();
  }

  /* ── Wallet credit (SUPER_ADMIN) ──────────────────────────────────── */

  const [creditStep, setCreditStep] = useState<'closed' | 'form' | 'confirm'>('closed');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const credit = useAdminMutation<CreditBody, { balancePaise: number; transactionId: string }>(
    `/admin/riders/${riderId}/wallet/credit`,
    'POST',
  );
  const creditPaise = rupeesToPaise(creditAmount);
  const amountOk = creditPaise !== null && creditPaise >= 1 && creditPaise <= CREDIT_MAX_PAISE;
  const noteOk =
    creditNote.trim().length >= NOTE_MIN && creditNote.trim().length <= TEXT_MAX;

  function closeCredit() {
    setCreditStep('closed');
    setCreditAmount('');
    setCreditNote('');
    credit.reset();
  }

  async function applyCredit() {
    if (creditPaise === null) return;
    const result = await credit.mutate(
      { amountPaise: creditPaise, note: creditNote.trim() },
      { invalidate: INVALIDATE },
    );
    if (result === null) return;
    closeCredit();
    refetch();
  }

  /* ── Derived ──────────────────────────────────────────────────────── */

  const name = value.name ?? 'Unnamed rider';
  const performance = value.performance ?? null;
  const currentAssignment = value.currentAssignment ?? null;
  const kyc: RiderKyc | null = value.kyc ?? null;
  const deliveries = safeArray(value.deliveries);
  const walletPaise = value.walletBalancePaise ?? null;
  const suspended = value.status === 'suspended';
  const onARun = value.activeOrderId !== null;
  const kycDecidable = kyc !== null && (kyc.status === 'submitted' || kyc.status === 'rejected');

  async function applyStatus() {
    await mutate({
      status: suspended ? 'active' : 'suspended',
      reason: suspended ? 'Reinstated by admin' : 'Suspended by admin',
    });
    setConfirming(false);
    refetch();
  }

  return (
    <AdminPage
      title={name}
      description={`${vehicleLabel(value.vehicleType)} · ${value.vendorName ?? 'platform pool'}`}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Riders', href: '/admin/riders' },
        { label: name, href: `/admin/riders/${riderId}` },
      ]}
      actions={
        <button
          type="button"
          className={`${styles.btn} ${suspended ? '' : styles.btnDanger}`}
          onClick={() => setConfirming(true)}
          disabled={saving}
        >
          {suspended ? 'Reinstate rider' : 'Suspend rider'}
        </button>
      }
    >
      {isSample ? <SampleBanner endpoint={endpoint} onRetry={refetch} /> : null}

      {performance === null ? (
        loading ? null : (
          <p className={styles.readOnlyNote}>
            Performance, delivery history and KYC are not in this response — the API serving
            it predates them. Nothing below is estimated in their place.
          </p>
        )
      ) : (
        <div className={styles.kpiRow}>
          <KpiTile
            index={0}
            isFixture={isSample}
            label="Delivered"
            value={performance.deliveredCount}
            spark={performance.weeklyDelivered}
            deltaLabel="per week, last 8 weeks"
            loading={loading}
          />
          <KpiTile
            index={1}
            isFixture={isSample}
            label="Failed deliveries"
            value={performance.failedCount}
            tone={performance.failedCount > 5 ? 'warn' : 'neutral'}
            loading={loading}
          />
          <KpiTile
            index={2}
            isFixture={isSample}
            label="Offers answered"
            value={
              performance.offers.accepted + performance.offers.rejected + performance.offers.expired
            }
            deltaLabel={
              performance.acceptRatePct === null
                ? 'no offer answered yet'
                : `${formatPct(performance.acceptRatePct)} accepted`
            }
            loading={loading}
          />
          <KpiTile
            index={3}
            isFixture={isSample}
            label="Wallet balance"
            value={walletPaise ?? 0}
            unit="paise"
            tone={walletPaise === 0 ? 'warn' : 'neutral'}
            loading={loading}
          />
        </div>
      )}

      <div className={`${styles.split} ${styles.split2}`}>
        <div className={styles.stack}>
          <AdminSection title="Current assignment">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                {currentAssignment === null ? (
                  <p className={styles.subtle}>
                    {value.activeOrderId !== null
                      ? 'This rider holds an order id that no longer resolves to an order.'
                      : value.isOnline
                        ? 'Online and waiting for an offer. No order is assigned.'
                        : 'Offline. The assignment engine will not offer this rider anything.'}
                  </p>
                ) : (
                  <dl className={styles.defList}>
                    <dt className={styles.dt}>Order</dt>
                    <dd className={styles.dd}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall} ${styles.mono}`}
                        onClick={() => router.push(`/admin/orders/${currentAssignment.orderId}`)}
                      >
                        {currentAssignment.orderNo}
                      </button>
                    </dd>

                    <dt className={styles.dt}>Status</dt>
                    <dd className={styles.dd}>
                      <StatusPill status={currentAssignment.status} kind="order" />
                    </dd>

                    <dt className={styles.dt}>Customer</dt>
                    <dd className={styles.dd}>
                      {currentAssignment.customerName ?? (
                        <span className={styles.nullish}>not resolved</span>
                      )}
                    </dd>

                    <dt className={styles.dt}>Pickup</dt>
                    <dd className={styles.dd}>
                      {currentAssignment.pickup ?? (
                        <span className={styles.nullish}>store not resolved</span>
                      )}
                    </dd>

                    <dt className={styles.dt}>Drop</dt>
                    <dd className={styles.dd}>
                      {currentAssignment.dropCity}{' '}
                      <span className={styles.mono}>{currentAssignment.dropPincode}</span>
                    </dd>

                    <dt className={styles.dt}>Assigned</dt>
                    <dd className={styles.dd}>
                      <RelativeTime value={currentAssignment.assignedAt} />
                    </dd>
                  </dl>
                )}
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Delivery history">
            <DataTable
              rowKey={(row: RiderDeliveryRow) => row.id}
              rows={deliveries}
              loading={loading}
              empty="No finished delivery yet."
              onRowClick={(row: RiderDeliveryRow) => router.push(`/admin/orders/${row.id}`)}
              columns={[
                {
                  key: 'orderNo',
                  header: 'Order',
                  render: (row: RiderDeliveryRow) => (
                    <span className={styles.mono}>{row.orderNo}</span>
                  ),
                },
                {
                  key: 'vendorName',
                  header: 'Vendor',
                  render: (row: RiderDeliveryRow) =>
                    row.vendorName ?? <span className={styles.nullish}>not resolved</span>,
                },
                {
                  key: 'runMinutes',
                  header: 'Run',
                  align: 'right',
                  width: '6rem',
                  render: (row: RiderDeliveryRow) =>
                    row.runMinutes === null ? (
                      <span className={styles.muted}>—</span>
                    ) : (
                      <span
                        className={`${styles.num} ${row.runMinutes > 30 ? styles.warn : ''}`}
                        title="Picked up → delivered"
                      >
                        {row.runMinutes} min
                      </span>
                    ),
                },
                {
                  key: 'status',
                  header: 'Outcome',
                  width: '10rem',
                  render: (row: RiderDeliveryRow) => (
                    <StatusPill status={row.status} kind="order" />
                  ),
                },
                {
                  key: 'endedAt',
                  header: 'When',
                  width: '9rem',
                  render: (row: RiderDeliveryRow) => <RelativeTime value={row.endedAt} />,
                },
              ]}
            />
          </AdminSection>
        </div>

        <div className={styles.stack}>
          <AdminSection title="Rider">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                <dl className={styles.defList}>
                  <dt className={styles.dt}>Presence</dt>
                  <dd className={styles.dd}>
                    <Presence online={value.isOnline} available={value.isAvailable} />
                  </dd>

                  <dt className={styles.dt}>Account</dt>
                  <dd className={styles.dd}>
                    <StatusPill status={value.status} kind="user" />
                    {value.statusReason === null ? null : (
                      <span className={styles.subtle}> {value.statusReason}</span>
                    )}
                  </dd>

                  <dt className={styles.dt}>Phone</dt>
                  <dd className={`${styles.dd} ${styles.mono}`}>{value.phone ?? '—'}</dd>

                  <dt className={styles.dt}>Email</dt>
                  <dd className={styles.dd}>
                    {value.email ?? <span className={styles.nullish}>not provided</span>}
                  </dd>

                  <dt className={styles.dt}>Vehicle</dt>
                  <dd className={styles.dd}>{vehicleLabel(value.vehicleType)}</dd>

                  <dt className={styles.dt}>Fleet</dt>
                  <dd className={styles.dd}>
                    {value.vendorName ?? <span className={styles.tag}>platform pool</span>}
                  </dd>

                  <dt className={styles.dt}>Rating</dt>
                  <dd className={`${styles.dd} ${styles.num}`}>
                    {value.rating === 0 ? '—' : `${value.rating.toFixed(1)} / 5`}
                  </dd>

                  <dt className={styles.dt}>Joined</dt>
                  <dd className={styles.dd}>{formatDate(value.createdAt, 'long')}</dd>

                  <dt className={styles.dt}>Last ping</dt>
                  <dd className={styles.dd}>
                    {value.locationAt === null ? (
                      <span className={styles.nullish}>never</span>
                    ) : (
                      <RelativeTime value={value.locationAt} />
                    )}
                  </dd>
                </dl>
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Identity (KYC)">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                {kyc === null ? (
                  <p className={styles.subtle}>Not in this response.</p>
                ) : (
                  <>
                    <dl className={styles.defList}>
                      <dt className={styles.dt}>Status</dt>
                      <dd className={styles.dd}>
                        <StatusPill status={kyc.status} kind="kyc" />
                      </dd>

                      {kyc.submittedAt === null ? null : (
                        <>
                          <dt className={styles.dt}>Submitted</dt>
                          <dd className={styles.dd}>
                            <RelativeTime value={kyc.submittedAt} />
                          </dd>
                        </>
                      )}

                      {kyc.status === 'submitted' && kyc.slaDueAt !== null ? (
                        <>
                          <dt className={styles.dt}>Decide by</dt>
                          <dd className={`${styles.dd} ${kyc.breached ? styles.crit : ''}`}>
                            {formatDate(kyc.slaDueAt, 'short')}
                            {kyc.breached ? ` — the ${kyc.slaHours}-hour promise is missed` : ''}
                          </dd>
                        </>
                      ) : null}

                      {kyc.verifiedAt === null ? null : (
                        <>
                          <dt className={styles.dt}>Verified</dt>
                          <dd className={styles.dd}>{formatDate(kyc.verifiedAt, 'long')}</dd>
                        </>
                      )}

                      {kyc.rejectedReason === null ? null : (
                        <>
                          <dt className={styles.dt}>Rejected for</dt>
                          <dd className={styles.dd}>{kyc.rejectedReason}</dd>
                        </>
                      )}

                      {/*
                        Masked by the API with the same function the rider's
                        own screen uses. The whole numbers exist on exactly one
                        audited route, and this screen does not call it.
                      */}
                      <dt className={styles.dt}>Aadhaar</dt>
                      <dd className={`${styles.dd} ${styles.mono}`}>
                        {kyc.aadhaarNumberMasked ?? (
                          <span className={styles.nullish}>not provided</span>
                        )}
                      </dd>

                      <dt className={styles.dt}>PAN</dt>
                      <dd className={`${styles.dd} ${styles.mono}`}>
                        {kyc.panNumberMasked ?? (
                          <span className={styles.nullish}>not provided</span>
                        )}
                      </dd>

                      <dt className={styles.dt}>Licence</dt>
                      <dd className={`${styles.dd} ${styles.mono}`}>
                        {kyc.drivingLicenceNumberMasked ?? (
                          <span className={styles.nullish}>not provided</span>
                        )}
                      </dd>

                      <dt className={styles.dt}>Documents</dt>
                      <dd className={styles.dd}>
                        {safeArray(kyc.documents).length === 0 ? (
                          <span className={styles.nullish}>none uploaded</span>
                        ) : (
                          <span className={styles.rowWrap}>
                            {safeArray(kyc.documents).map((doc) =>
                              /^https?:\/\//.test(doc.url) ? (
                                <a
                                  key={doc.kind}
                                  className={styles.tag}
                                  href={doc.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Uploaded ${formatDate(doc.uploadedAt, 'long')}`}
                                >
                                  {DOCUMENT_LABEL[doc.kind] ?? humanise(doc.kind)}
                                </a>
                              ) : (
                                <span key={doc.kind} className={styles.tag}>
                                  {DOCUMENT_LABEL[doc.kind] ?? humanise(doc.kind)}
                                </span>
                              ),
                            )}
                          </span>
                        )}
                      </dd>
                    </dl>

                    {kycDecidable ? (
                      <div className={styles.rowWrap}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                          onClick={() => setKycAction('verify')}
                          disabled={kycBusy || isSample}
                        >
                          Verify
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                          onClick={() => setKycAction('reject')}
                          disabled={kycBusy || isSample}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <p className={styles.fieldHint}>
                        {kyc.status === 'verified'
                          ? 'Verified. To stop this rider taking work, suspend them instead.'
                          : 'Nothing submitted yet — there is nothing to verify.'}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Performance">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                {performance === null ? (
                  <p className={styles.subtle}>Not in this response.</p>
                ) : (
                  <dl className={styles.defList}>
                    <dt className={styles.dt}>Average run</dt>
                    <dd className={`${styles.dd} ${styles.num}`}>
                      {performance.avgRunMinutes === null
                        ? '—'
                        : `${performance.avgRunMinutes} min`}
                    </dd>

                    <dt className={styles.dt}>Accept rate</dt>
                    <dd className={`${styles.dd} ${styles.num}`}>
                      {performance.acceptRatePct === null
                        ? '—'
                        : formatPct(performance.acceptRatePct)}
                      <span className={styles.subtle}>
                        {' '}
                        {formatCount(performance.offers.accepted)} accepted ·{' '}
                        {formatCount(performance.offers.rejected)} declined ·{' '}
                        {formatCount(performance.offers.expired)} let expire
                      </span>
                    </dd>

                    <dt className={styles.dt}>Delivered</dt>
                    <dd className={`${styles.dd} ${styles.num}`}>
                      {formatCount(performance.deliveredCount)}
                    </dd>

                    <dt className={styles.dt}>Failed</dt>
                    <dd className={`${styles.dd} ${styles.num}`}>
                      {formatCount(performance.failedCount)}
                    </dd>
                  </dl>
                )}
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Wallet">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                <dl className={styles.defList}>
                  <dt className={styles.dt}>Balance</dt>
                  <dd className={styles.dd}>
                    {walletPaise === null ? '—' : <Money value={walletPaise} />}
                  </dd>
                </dl>
                {/*
                  UX only. `POST /admin/riders/:id/wallet/credit` is
                  @Roles(SUPER_ADMIN) on the API, which is what refuses an
                  ADMIN — hiding the button just keeps it from 403ing.
                */}
                {isSuperAdmin ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSmall}`}
                    onClick={() => setCreditStep('form')}
                    disabled={credit.loading || isSample}
                  >
                    Credit wallet
                  </button>
                ) : (
                  <p className={styles.fieldHint}>
                    Crediting a wallet moves money, so it is restricted to super-admins.
                  </p>
                )}
              </div>
            </div>
          </AdminSection>
        </div>
      </div>

      {error === null || error === undefined ? null : (
        <p className={styles.fieldError} role="alert">
          The status change did not go through. Nothing was saved.
        </p>
      )}

      {/*
        Showing or hiding this button is UX. The API's RolesGuard decides
        whether a suspension is actually allowed.
      */}
      <ConfirmDialog
        open={confirming}
        title={suspended ? 'Reinstate this rider?' : 'Suspend this rider?'}
        body={
          suspended
            ? `${name} will be able to go online and accept offers again.`
            : onARun
              ? `${name} is mid-delivery on ${
                  value.activeOrderNo ?? 'an order'
                }. Suspending now takes them offline; that order must be reassigned by hand.`
              : `${name} will be taken offline and will stop receiving offers.`
        }
        confirmLabel={suspended ? 'Reinstate' : 'Suspend'}
        destructive={!suspended}
        loading={saving}
        onConfirm={() => {
          void applyStatus();
        }}
        onCancel={() => setConfirming(false)}
      />

      {/* ------------------------------------------------ KYC ------- */}
      <ConfirmDialog
        open={kycAction !== null}
        loading={kycBusy}
        // A rejection is shown to the rider verbatim, so it needs a reason
        // they can act on. The API enforces the same 5–300 characters.
        confirmDisabled={kycAction === 'reject' && !reasonOk}
        destructive={kycAction === 'reject'}
        title={kycAction === 'verify' ? `Verify ${name}?` : `Reject ${name}'s documents?`}
        confirmLabel={kycAction === 'verify' ? 'Verify' : 'Reject'}
        onCancel={closeKyc}
        onConfirm={() => void applyKyc()}
        body={
          kycAction === 'verify' ? (
            <>
              <p>
                Verification is what lets {name} accept orders at all. Only confirm once the
                uploaded documents match the person and the numbers on file.
              </p>
              {kycError !== null ? (
                <p className="adm-dialog__error">{kycError.friendlyMessage}</p>
              ) : null}
            </>
          ) : (
            <>
              <p>
                {name} will be notified with your reason and can submit again. They cannot accept
                orders until a submission is verified.
              </p>
              <label className="adm-field">
                <span className="adm-field__label">
                  Reason (required, {REASON_MIN}–{TEXT_MAX} characters — the rider sees this)
                </span>
                <textarea
                  className="adm-input"
                  rows={3}
                  maxLength={TEXT_MAX}
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="The licence photo is cropped — upload the full card."
                  disabled={kycBusy}
                  required
                />
              </label>
              {kycError !== null ? (
                <p className="adm-dialog__error">{kycError.friendlyMessage}</p>
              ) : null}
            </>
          )
        }
      />

      {/* ------------------------------------------------ wallet ---- */}
      <ConfirmDialog
        open={creditStep === 'form'}
        confirmDisabled={!amountOk || !noteOk}
        title={`Credit ${name}'s wallet`}
        confirmLabel="Review"
        onCancel={closeCredit}
        onConfirm={() => setCreditStep('confirm')}
        body={
          <>
            <p>
              Record money that has already reached the platform some other way — a bank transfer,
              cash at the office. It is written as an audited adjustment under your name.
            </p>
            <label className="adm-field">
              <span className="adm-field__label">Amount (₹)</span>
              <input
                className="adm-input"
                inputMode="decimal"
                value={creditAmount}
                onChange={(event) => setCreditAmount(event.target.value)}
                placeholder="500"
                required
              />
            </label>
            {creditAmount !== '' && !amountOk ? (
              <p className="adm-dim">
                Enter rupees with at most two decimals, between ₹0.01 and{' '}
                {formatPaise(CREDIT_MAX_PAISE)}.
              </p>
            ) : null}
            <label className="adm-field">
              <span className="adm-field__label">
                Note (required, {NOTE_MIN}–{TEXT_MAX} characters)
              </span>
              <textarea
                className="adm-input"
                rows={2}
                maxLength={TEXT_MAX}
                value={creditNote}
                onChange={(event) => setCreditNote(event.target.value)}
                placeholder="UPI transfer ref 4471…, received 26 Oct"
                required
              />
            </label>
          </>
        }
      />

      <ConfirmDialog
        open={creditStep === 'confirm'}
        loading={credit.loading}
        title={`Credit ${creditPaise === null ? '' : formatPaise(creditPaise)} to ${name}?`}
        confirmLabel="Credit wallet"
        onCancel={() => {
          credit.reset();
          setCreditStep('form');
        }}
        cancelLabel="Back"
        onConfirm={() => void applyCredit()}
        body={
          <>
            <p>
              The balance goes from {walletPaise === null ? '—' : formatPaise(walletPaise)} to{' '}
              {walletPaise === null || creditPaise === null
                ? '—'
                : formatPaise(walletPaise + creditPaise)}
              . There is no reversal in the console, so check the amount.
            </p>
            <p className="adm-dim">Note: {creditNote.trim()}</p>
            {credit.error !== null ? (
              <p className="adm-dialog__error">{credit.error.friendlyMessage}</p>
            ) : null}
          </>
        }
      />
    </AdminPage>
  );
}
