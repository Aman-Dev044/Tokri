'use client';

/**
 * THE APPROVALS INBOX
 *
 * An inbox, not a report. Everything here is sized to one question — "can this
 * one start trading?" — and the screen's job is to make that answer cheap:
 * enough of the application visible in the row to skip most of them, the whole
 * application one click away for the rest, and the row gone the moment it is
 * decided.
 *
 * ── THE ONE RULE THAT IS ENFORCED, NOT SUGGESTED ────────────────────────────
 * A rejection must carry a reason. It is the only record of why a business was
 * turned away, it is what the applicant is told, and it is what someone reads
 * six months later when they reapply. The reason is checked here before the
 * request is made, and if the server still answers 400 that message is shown
 * verbatim rather than swallowed — a client-side guard is a convenience, never
 * the authority.
 *
 * ── REJECTION IS A SUSPENSION, NOT A TERMINAL STATE ─────────────────────────
 * The API records a rejected vendor as `suspended` with a `statusReason`. There
 * is no `rejected` status and this screen never renders one; "Reject" is the
 * name of the ACTION, and the wording of the dialog says what actually happens.
 *
 * ── ROLE GATING ─────────────────────────────────────────────────────────────
 * There is none on this page, deliberately: approvals are the ADMIN role's core
 * work. The API's guard chain is what decides who may POST a decision; nothing
 * in this file is a security boundary.
 */

import { useMemo, useState } from 'react';

import { AdminPage, ConfirmDialog, DataTable, DetailDrawer } from '@/components/admin';
import { useAdminMutation } from '@/hooks';
import type { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import shared from '../_shared-pages/pages.module.css';
import { useNow } from '../_shared-pages/useNow';
import { safeArray, useSourcedOne } from '../_shared-pages/useSourced';
import { RiderApprovalDetail, VendorApprovalDetail } from './ApprovalDetail';
import styles from './approvals.module.css';
import { ToastDock, useToasts } from './Toasts';
import {
  APPROVALS_FIXTURE,
  VEHICLE_LABEL,
  type ApprovalsPayload,
  type RiderApprovalRow,
  type VendorApprovalRow,
} from './fixtures';

const ENDPOINT = '/admin/ops/approvals';

/** Past this, an application has been sitting long enough to be a problem. */
const STALE_HOURS = 48;

/** The API's own floor: `@Length(3, 500)` on the reason. */
const MIN_REASON = 3;

type Kind = 'vendors' | 'riders';
type Decision = 'approve' | 'reject';

interface DecisionBody {
  decision: Decision;
  reason?: string;
}

interface Target {
  kind: Kind;
  id: string;
  /** what the dialog and the toast call this applicant */
  label: string;
  decision: Decision;
}

const REJECT_PRESETS: readonly string[] = [
  'Licence documents missing or unreadable',
  'Address could not be verified',
  'Outside a serviced delivery zone',
  'Duplicate of an existing account',
];

function hoursWaiting(createdAt: string | null, now: number | null): number | null {
  if (createdAt === null || now === null) return null;
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return null;
  return (now - started) / 3_600_000;
}

/**
 * "3d 4h". Short enough for a narrow column, precise enough that an operator
 * can tell four hours from four days without doing arithmetic on a timestamp.
 */
function Waiting({ createdAt, now }: { createdAt: string | null; now: number | null }) {
  if (createdAt === null) return <span className={shared.muted}>unknown</span>;

  const hours = hoursWaiting(createdAt, now);
  if (hours === null) {
    // Pre-hydration: the deterministic absolute date, so server and client
    // render the same string. See `useNow`.
    return <span className={shared.mono}>{formatDate(createdAt, 'short')}</span>;
  }

  const days = Math.floor(hours / 24);
  const rest = Math.floor(hours % 24);
  const text = days > 0 ? `${days}d ${rest}h` : `${Math.max(0, Math.floor(hours))}h`;
  const stale = hours >= STALE_HOURS;
  return (
    <span
      className={`${styles.waiting} ${stale ? styles.waitingLong : ''}`}
      title={`Applied ${formatDate(createdAt, 'full')}${stale ? ' — waiting over two days' : ''}`}
    >
      {text}
      {stale ? <span className="adm-sr"> — waiting over two days</span> : null}
    </span>
  );
}

/**
 * The server's own words, not a paraphrase.
 *
 * A 400 from the decision endpoint names what was wrong — usually the missing
 * reason, occasionally a state conflict because somebody else decided this
 * application thirty seconds ago. Rewriting that into "something went wrong"
 * throws away the only useful part.
 */
function ServerError({ error }: { error: ApiError | null }) {
  if (error === null) return null;
  return (
    <p className={shared.fieldError} role="alert">
      {error.problem.detail ?? error.friendlyMessage} Nothing was changed.
    </p>
  );
}

export function ApprovalsView() {
  const [tab, setTab] = useState<Kind>('vendors');
  const [open, setOpen] = useState<{ kind: Kind; id: string } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  /**
   * Rows already decided in this session. The list is not refetched on every
   * approval — the row simply stops being rendered, which is what makes
   * clearing a queue of forty feel instant instead of like forty page loads.
   */
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set<string>());

  const now = useNow(60_000);
  const toasts = useToasts();

  const { value, loading, isSample, refetch } = useSourcedOne<ApprovalsPayload>(
    ENDPOINT,
    APPROVALS_FIXTURE,
  );

  const vendorDecision = useAdminMutation<DecisionBody, unknown>(
    '/admin/ops/approvals/vendors/:id',
    'POST',
  );
  const riderDecision = useAdminMutation<DecisionBody, unknown>(
    '/admin/ops/approvals/riders/:id',
    'POST',
  );

  const active = target?.kind === 'riders' ? riderDecision : vendorDecision;

  const vendors = useMemo(
    () => safeArray(value.vendors).filter((row) => !decided.has(row.id)),
    [value.vendors, decided],
  );
  const riders = useMemo(
    () => safeArray(value.riders).filter((row) => !decided.has(row.id)),
    [value.riders, decided],
  );

  /**
   * `counts` are TOTALS; the arrays are capped at 100 by the API. So the tab
   * badge reads the count, minus whatever this session has already cleared —
   * never `array.length`, which would quietly under-report a large queue.
   */
  const counts = useMemo(() => {
    const decidedVendors = safeArray(value.vendors).filter((row) => decided.has(row.id)).length;
    const decidedRiders = safeArray(value.riders).filter((row) => decided.has(row.id)).length;
    return {
      vendors: Math.max(0, (value.counts?.vendors ?? vendors.length) - decidedVendors),
      riders: Math.max(0, (value.counts?.riders ?? riders.length) - decidedRiders),
    };
  }, [value.counts, value.vendors, value.riders, decided, vendors.length, riders.length]);

  const openVendor = useMemo(
    () => (open?.kind === 'vendors' ? (vendors.find((row) => row.id === open.id) ?? null) : null),
    [open, vendors],
  );
  const openRider = useMemo(
    () => (open?.kind === 'riders' ? (riders.find((row) => row.id === open.id) ?? null) : null),
    [open, riders],
  );

  function ask(next: Target) {
    setTarget(next);
    setReason('');
    setReasonError(null);
    vendorDecision.reset();
    riderDecision.reset();
  }

  async function submit() {
    if (target === null) return;

    const trimmed = reason.trim();
    if (target.decision === 'reject' && trimmed.length < MIN_REASON) {
      // Client-side guard. The API rejects a short reason too (400); this only
      // saves a round trip and gives the operator the message in context.
      setReasonError('A reason is required. It is sent to the applicant and kept on the record.');
      return;
    }

    const hook = target.kind === 'riders' ? riderDecision : vendorDecision;
    const body: DecisionBody =
      target.decision === 'approve'
        ? { decision: 'approve' }
        : { decision: 'reject', reason: trimmed };

    const result = await hook.mutate(body, {
      params: { id: target.id },
      // The default invalidation prefix would be `/admin/ops/approvals/vendors`,
      // which does not match the list query's `/admin/ops/approvals`.
      invalidate: [ENDPOINT],
    });

    if (result === null) {
      // Left open, with the server's own message. The queue is refetched so the
      // screen cannot keep showing an application somebody else already cleared.
      refetch();
      return;
    }

    setDecided((current) => new Set(current).add(target.id));
    if (open?.id === target.id) setOpen(null);
    setTarget(null);
    toasts.push(
      target.decision === 'approve' ? 'good' : 'warn',
      target.decision === 'approve' ? `${target.label} approved` : `${target.label} rejected`,
      target.decision === 'approve'
        ? 'They can sign in and start trading now.'
        : 'The account is suspended with the reason you gave.',
    );
  }

  const decideButtons = (next: Omit<Target, 'decision'>) => (
    <span className={styles.decide}>
      <button
        type="button"
        className={`${shared.btn} ${shared.btnSmall}`}
        onClick={(event) => {
          event.stopPropagation();
          ask({ ...next, decision: 'approve' });
        }}
      >
        Approve
      </button>
      <button
        type="button"
        className={`${shared.btn} ${shared.btnSmall} ${shared.btnDanger}`}
        onClick={(event) => {
          event.stopPropagation();
          ask({ ...next, decision: 'reject' });
        }}
      >
        Reject
      </button>
    </span>
  );

  /**
   * The zero state. It has to read as FINISHED, not as broken or still loading
   * — with no pending riders in the system this is the default view of that
   * tab, and an operator who reads it as an error will go looking for a bug.
   */
  const inboxClear = (what: string) => (
    <div className={styles.clear}>
      <span className={styles.clearMark} aria-hidden="true">
        ✓
      </span>
      <p className={styles.clearTitle}>Inbox clear</p>
      <p className={styles.clearBody}>
        No {what} are waiting on a decision. New applications land here on their own — nothing to
        refresh.
      </p>
    </div>
  );

  return (
    <AdminPage
      title="Approvals"
      description="Vendors and delivery partners waiting to be let onto the platform. Decide, and the row leaves the queue."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Approvals', href: '/admin/approvals' },
      ]}
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={shared.tabs} role="tablist" aria-label="Approval queues">
        {(
          [
            { key: 'vendors' as const, label: 'Vendors' },
            { key: 'riders' as const, label: 'Delivery partners' },
          ] satisfies { key: Kind; label: string }[]
        ).map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`approvals-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`approvals-panel-${entry.key}`}
            className={shared.tab}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
            <span className={shared.tabCount}>{counts[entry.key]}</span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`approvals-panel-${tab}`}
        aria-labelledby={`approvals-tab-${tab}`}
        // Remounting on tab change restarts the row stagger, which is the whole
        // signal that the list underneath just changed.
        key={tab}
      >
        {tab === 'vendors' ? (
          <DataTable
            rowKey={(row: VendorApprovalRow) => row.id}
            rows={vendors}
            loading={loading}
            empty={inboxClear('vendor applications')}
            onRowClick={(row: VendorApprovalRow) => setOpen({ kind: 'vendors', id: row.id })}
            columns={[
              {
                key: 'storeName',
                header: 'Store',
                render: (row: VendorApprovalRow) => (
                  <span className={shared.twoLine}>
                    <span className={shared.strong}>{row.storeName}</span>
                    <span className={`${shared.subtle} ${shared.mono}`}>{row.slug}</span>
                  </span>
                ),
              },
              {
                key: 'city',
                header: 'Location',
                width: '13rem',
                render: (row: VendorApprovalRow) => (
                  <span className={shared.twoLine}>
                    <span>
                      {row.address.city}, {row.address.state}
                    </span>
                    <span className={`${shared.subtle} ${shared.mono}`}>
                      {row.address.pincode}
                      {row.location === null ? ' · no pin' : ''}
                    </span>
                  </span>
                ),
              },
              {
                key: 'radius',
                header: 'Radius',
                align: 'right',
                width: '6rem',
                numeric: true,
                render: (row: VendorApprovalRow) => (
                  <span className={shared.num}>{row.serviceRadiusKm} km</span>
                ),
              },
              {
                key: 'commission',
                header: 'Commission',
                align: 'right',
                width: '7rem',
                numeric: true,
                render: (row: VendorApprovalRow) => (
                  <span className={shared.num}>{row.commissionPct}%</span>
                ),
              },
              {
                key: 'cod',
                header: 'COD',
                width: '6rem',
                render: (row: VendorApprovalRow) =>
                  row.codEnabled ? (
                    <span className={shared.tag}>yes</span>
                  ) : (
                    <span className={shared.muted}>no</span>
                  ),
              },
              {
                key: 'waiting',
                header: 'Waiting',
                align: 'right',
                width: '7rem',
                render: (row: VendorApprovalRow) => (
                  <Waiting createdAt={row.createdAt} now={now} />
                ),
              },
              {
                key: 'decide',
                header: 'Decision',
                width: '11rem',
                render: (row: VendorApprovalRow) =>
                  decideButtons({ kind: 'vendors', id: row.id, label: row.storeName }),
              },
            ]}
          />
        ) : (
          <DataTable
            rowKey={(row: RiderApprovalRow) => row.id}
            rows={riders}
            loading={loading}
            empty={inboxClear('delivery partner applications')}
            onRowClick={(row: RiderApprovalRow) => setOpen({ kind: 'riders', id: row.id })}
            columns={[
              {
                key: 'name',
                header: 'Partner',
                render: (row: RiderApprovalRow) => (
                  <span className={shared.twoLine}>
                    <span className={shared.strong}>{row.name ?? 'Unnamed applicant'}</span>
                    <span className={`${shared.subtle} ${shared.mono}`}>
                      {row.phone ?? 'no phone on file'}
                    </span>
                  </span>
                ),
              },
              {
                key: 'vehicle',
                header: 'Vehicle',
                width: '12rem',
                render: (row: RiderApprovalRow) => VEHICLE_LABEL[row.vehicleType],
              },
              {
                key: 'email',
                header: 'Email',
                width: '14rem',
                render: (row: RiderApprovalRow) =>
                  row.email === null ? (
                    <span className={shared.muted}>none</span>
                  ) : (
                    <span className={shared.truncate}>{row.email}</span>
                  ),
              },
              {
                key: 'vendor',
                header: 'Attached to',
                width: '12rem',
                render: (row: RiderApprovalRow) =>
                  row.vendorId === null ? (
                    <span className={shared.muted}>platform pool</span>
                  ) : (
                    (row.vendorName ?? <span className={shared.mono}>{row.vendorId}</span>)
                  ),
              },
              {
                key: 'waiting',
                header: 'Waiting',
                align: 'right',
                width: '7rem',
                render: (row: RiderApprovalRow) => <Waiting createdAt={row.createdAt} now={now} />,
              },
              {
                key: 'decide',
                header: 'Decision',
                width: '11rem',
                render: (row: RiderApprovalRow) =>
                  decideButtons({
                    kind: 'riders',
                    id: row.id,
                    label: row.name ?? 'This applicant',
                  }),
              },
            ]}
          />
        )}
      </div>

      <DetailDrawer
        open={openVendor !== null || openRider !== null}
        onClose={() => setOpen(null)}
        title={openVendor?.storeName ?? openRider?.name ?? 'Application'}
        subtitle={(() => {
          const createdAt = openVendor?.createdAt ?? openRider?.createdAt ?? null;
          return createdAt === null ? undefined : `Applied ${formatDate(createdAt, 'long')}`;
        })()}
        width="34rem"
        actions={
          openVendor !== null
            ? decideButtons({ kind: 'vendors', id: openVendor.id, label: openVendor.storeName })
            : openRider !== null
              ? decideButtons({
                  kind: 'riders',
                  id: openRider.id,
                  label: openRider.name ?? 'This applicant',
                })
              : undefined
        }
      >
        {openVendor !== null ? (
          <VendorApprovalDetail row={openVendor} />
        ) : openRider !== null ? (
          <RiderApprovalDetail row={openRider} />
        ) : null}
      </DetailDrawer>

      <ConfirmDialog
        open={target !== null}
        title={
          target === null
            ? ''
            : target.decision === 'approve'
              ? `Approve ${target.label}?`
              : `Reject ${target.label}?`
        }
        confirmLabel={target?.decision === 'approve' ? 'Approve' : 'Reject'}
        destructive={target?.decision === 'reject'}
        loading={active.loading}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          void submit();
        }}
        body={
          target === null ? null : target.decision === 'approve' ? (
            <>
              <p>
                {target.kind === 'vendors'
                  ? 'The store goes live on its current terms and can start listing products immediately.'
                  : 'They can sign in to the partner app and be assigned deliveries immediately.'}
              </p>
              <ServerError error={active.error} />
            </>
          ) : (
            <>
              <p>
                {target.kind === 'vendors'
                  ? 'The account is suspended with the reason below, and the owner is told why. They can reapply.'
                  : 'The account is suspended with the reason below, and the applicant is told why. They can reapply.'}
              </p>

              <div className={styles.reasonField}>
                <label className={styles.reasonLabel} htmlFor="reject-reason">
                  Reason <span className={styles.reasonRequired}>— required</span>
                </label>
                <div className={styles.reasonPresets}>
                  {REJECT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={styles.preset}
                      onClick={() => {
                        setReason(preset);
                        setReasonError(null);
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <textarea
                  id="reject-reason"
                  className={`${shared.textarea} ${reasonError === null ? '' : shared.inputInvalid}`}
                  rows={3}
                  value={reason}
                  aria-invalid={reasonError !== null}
                  aria-describedby="reject-reason-hint"
                  placeholder="What would they have to fix to be approved?"
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (reasonError !== null) setReasonError(null);
                  }}
                />
                <p id="reject-reason-hint" className={shared.fieldHint}>
                  Stored on the account and shown to the applicant.
                </p>
                {reasonError === null ? null : (
                  <p className={shared.fieldError} role="alert">
                    {reasonError}
                  </p>
                )}
                <ServerError error={active.error} />
              </div>
            </>
          )
        }
      />

      <ToastDock toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </AdminPage>
  );
}
