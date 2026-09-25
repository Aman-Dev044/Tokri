'use client';

/**
 * ONE SUPPORT ISSUE, ON ITS OWN ROUTE.
 *
 * ── WHY A PAGE AND NOT A DRAWER ─────────────────────────────────────────────
 * Every other detail surface in this console is a drawer, and that is right for
 * them: you glance at a customer, you close it, you carry on down the list. A
 * support issue is not a glance. It is minutes of work — read the description,
 * read a thread, open the order it is about, write a reply, change the status,
 * and hand it to someone else.
 *
 * Four things follow from that, and a drawer gets none of them:
 *
 *   1. It has a URL. Support hands tickets to each other in chat all day; a
 *      link that opens the ticket is the whole handover.
 *   2. Following the linked order out and coming Back returns here, with the
 *      queue still one more Back away. Inside a drawer, navigating away closes
 *      it and loses the place.
 *   3. The thread and the reply box need real vertical room. A 34rem drawer
 *      with a scrolling conversation inside a scrolling body is a worse reading
 *      experience than the page it is standing in for.
 *   4. Two tickets can be open in two tabs, which is exactly what someone
 *      cross-referencing a duplicate does.
 *
 * The cost is that the queue unmounts — paid off by the module-scoped view
 * cache in IssuesView, so Back lands on the same filters and page.
 *
 * ── THE RESOLUTION GATE ─────────────────────────────────────────────────────
 * An issue cannot be resolved without a resolution. This is not politeness: the
 * resolution is the answer to "what did we actually do", it is what the next
 * person reads when the customer comes back a week later, and a queue full of
 * `status: resolved, resolution: null` is a queue with no memory. The control
 * explains itself before it blocks anything.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { AdminPage, AdminSection, EmptyState } from '@/components/admin';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminMutation } from '@/hooks';
import { formatDate, humanise } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import shared from '../_shared-pages/pages.module.css';
import { useNow } from '../_shared-pages/useNow';
import { safeArray, useSourcedOne } from '../_shared-pages/useSourced';
import styles from './issues.module.css';
import { AgeCell, IssueStatusChip, PriorityChip, TypeChip } from './severity';
import {
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_LABEL,
  SUPPORT_AGENTS,
  issueFixtureById,
  type Issue,
  type IssueMessage,
  type IssuePriority,
  type IssueStatus,
} from './fixtures';

const UNASSIGNED = '__none__';

interface PatchBody {
  status?: IssueStatus;
  priority?: IssuePriority;
  assignedToUserId?: string | null;
  resolution?: string;
}

interface MessageBody {
  body: string;
}

/** A link to another admin screen, or a plain id when there is nothing to link. */
function Ref({
  label,
  href,
  text,
}: {
  label: string;
  href: string | null;
  text: string | undefined;
}) {
  if (text === undefined) return null;
  return (
    <div className={styles.linkRow}>
      <span className={shared.dt}>{label}</span>
      {href === null ? <span className={shared.mono}>{text}</span> : <Link href={href}>{text}</Link>}
    </div>
  );
}

function Message({ message, index, meId }: { message: IssueMessage; index: number; meId: string | null }) {
  const system = message.byRole === 'system';
  const mine = !system && (message.byRole === 'admin' || message.byUserId === meId);
  return (
    <div
      className={`${styles.msg} ${system ? styles.msgSystem : mine ? styles.msgMine : ''}`}
      style={{ ['--adm-i' as string]: String(Math.min(index, 14)) }}
    >
      <div className={styles.msgHead}>
        <span className={styles.msgAuthor}>{message.byName ?? message.byUserId}</span>
        <span className={styles.msgRole}>{humanise(message.byRole)}</span>
        <span>{formatDate(message.at, 'short')}</span>
      </div>
      <p className={styles.msgBody}>{message.body}</p>
    </div>
  );
}

export function IssueDetailView({ issueId }: { issueId: string }) {
  const endpoint = `/admin/ops/issues/${issueId}`;
  const { user } = useAuth();
  const now = useNow(60_000);

  const fixture = useMemo(() => issueFixtureById(issueId), [issueId]);
  const { value, loading, isSample, refetch } = useSourcedOne<Issue>(endpoint, fixture);

  const patch = useAdminMutation<PatchBody, Issue>(endpoint, 'PATCH');
  const postMessage = useAdminMutation<MessageBody, IssueMessage>(`${endpoint}/messages`, 'POST');

  /* ---- editable copy of the fields the controls own ---- */
  const [status, setStatus] = useState<IssueStatus>(value.status);
  const [priority, setPriority] = useState<IssuePriority>(value.priority);
  const [assignee, setAssignee] = useState<string>(value.assignedToUserId ?? UNASSIGNED);
  const [resolution, setResolution] = useState<string>(value.resolution ?? '');
  const [blocked, setBlocked] = useState<string | null>(null);

  /**
   * Re-seed the controls when a different issue lands.
   *
   * Keyed on the id rather than on the whole value: re-seeding on every refetch
   * would wipe a half-typed resolution out from under the person writing it.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === value.id) return;
    seededFor.current = value.id;
    setStatus(value.status);
    setPriority(value.priority);
    setAssignee(value.assignedToUserId ?? UNASSIGNED);
    setResolution(value.resolution ?? '');
  }, [value]);

  /* ---- thread ---- */
  const [reply, setReply] = useState('');
  /**
   * Replies posted in this session, held locally.
   *
   * The live endpoint returns the thread on the next refetch, but the fixture
   * path never will — and a reply box that appears to swallow what you typed is
   * the worst possible thing to ship on a support tool. Merged by timestamp so
   * a refetch that DOES include the message does not double it.
   */
  const [posted, setPosted] = useState<IssueMessage[]>([]);

  const messages = useMemo(() => {
    const base = safeArray(value.messages);
    const seen = new Set(base.map((message) => `${message.at}|${message.body}`));
    const extra = posted.filter((message) => !seen.has(`${message.at}|${message.body}`));
    return [...base, ...extra].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [value.messages, posted]);

  const threadRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = threadRef.current;
    if (node === null) return;
    // The newest message is the one you came here to read. `scroll-behavior` is
    // smooth in CSS and `auto` under prefers-reduced-motion, so this is one
    // assignment either way.
    node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  /* ---- dirty / gate ---- */
  const dirty =
    status !== value.status ||
    priority !== value.priority ||
    assignee !== (value.assignedToUserId ?? UNASSIGNED) ||
    (status === 'resolved' && resolution.trim() !== (value.resolution ?? '').trim());

  const needsResolution = status === 'resolved' && resolution.trim().length < 10;

  async function save() {
    if (needsResolution) {
      setBlocked(
        'Write what was actually done before resolving. It is the only record of the outcome, and the next person to hear from this customer will read it.',
      );
      return;
    }
    setBlocked(null);

    const body: PatchBody = {};
    if (status !== value.status) body.status = status;
    if (priority !== value.priority) body.priority = priority;
    if (assignee !== (value.assignedToUserId ?? UNASSIGNED)) {
      body.assignedToUserId = assignee === UNASSIGNED ? null : assignee;
    }
    if (resolution.trim() !== '' && (status === 'resolved' || status === 'closed')) {
      body.resolution = resolution.trim();
    }

    const result = await patch.mutate(body, { invalidate: ['/admin/ops/issues'] });
    if (result !== null) refetch();
  }

  async function send() {
    const text = reply.trim();
    if (text === '') return;
    const result = await postMessage.mutate({ body: text }, { invalidate: ['/admin/ops/issues'] });
    if (result === null) return;

    setPosted((list) => [
      ...list,
      {
        byUserId: user?.id ?? 'me',
        byRole: 'admin',
        byName: user?.name ?? 'You',
        body: text,
        // The server's own timestamp when it sends one back, so the merge above
        // can recognise this message after a refetch.
        at: result.at ?? new Date().toISOString(),
      },
    ]);
    setReply('');
    refetch();
  }

  const meId = user?.id ?? null;

  return (
    <AdminPage
      title={value.subject}
      description={`${value.code} · raised ${formatDate(value.createdAt, 'long')}`}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Support', href: '/admin/issues' },
        { label: value.code, href: `/admin/issues/${issueId}` },
      ]}
      actions={
        <span className={shared.rowWrap}>
          <TypeChip type={value.type} />
          <PriorityChip priority={value.priority} />
          <IssueStatusChip status={value.status} />
        </span>
      }
    >
      {isSample ? <SampleBanner endpoint={endpoint} onRetry={refetch} /> : null}

      <div className={`${shared.split} ${shared.split2}`}>
        <div className={shared.stack}>
          <AdminSection title="What was reported">
            <div className={shared.panel}>
              <div className={shared.panelBody}>
                <p className={styles.description}>{value.description}</p>
              </div>
            </div>
          </AdminSection>

          {value.resolution === undefined || value.resolution === '' ? null : (
            <AdminSection title="Resolution">
              <div className={styles.resolutionBox}>
                <p style={{ margin: 0 }}>{value.resolution}</p>
                <p className={shared.subtle} style={{ margin: 0 }}>
                  {value.resolvedAt === undefined
                    ? 'Recorded'
                    : `Resolved ${formatDate(value.resolvedAt, 'long')}`}
                  {value.resolvedBy === undefined ? '' : ` by ${value.resolvedBy}`}
                </p>
              </div>
            </AdminSection>
          )}

          <AdminSection title={`Conversation (${messages.length})`}>
            <div className={shared.panel}>
              <div className={styles.thread} ref={threadRef}>
                {messages.length === 0 ? (
                  <EmptyState
                    title="No messages yet"
                    body="Nobody has written on this issue. A first reply tells the reporter it was seen."
                  />
                ) : (
                  messages.map((message, index) => (
                    <Message
                      key={`${message.at}-${index}`}
                      message={message}
                      index={index}
                      meId={meId}
                    />
                  ))
                )}
              </div>

              <div className={styles.replyBar}>
                <label className="adm-sr" htmlFor="issue-reply">
                  Reply to this issue
                </label>
                <textarea
                  id="issue-reply"
                  className={shared.textarea}
                  rows={3}
                  value={reply}
                  placeholder="Reply — the reporter sees this."
                  onChange={(event) => setReply(event.target.value)}
                />
                <div className={styles.replyRow}>
                  <span className={shared.fieldHint}>
                    Sent as {user?.name ?? 'support'} and kept on the issue forever.
                  </span>
                  <span className={shared.pushRight}>
                    <button
                      type="button"
                      className={`${shared.btn} ${shared.btnPrimary}`}
                      disabled={reply.trim() === '' || postMessage.loading}
                      onClick={() => {
                        void send();
                      }}
                    >
                      {postMessage.loading ? 'Sending…' : 'Send reply'}
                    </button>
                  </span>
                </div>
                {postMessage.error === null ? null : (
                  <p className={shared.fieldError} role="alert">
                    {postMessage.error.problem.detail ?? postMessage.error.friendlyMessage} Your
                    reply was not sent — the text is still in the box.
                  </p>
                )}
              </div>
            </div>
          </AdminSection>
        </div>

        <div className={shared.stack}>
          <AdminSection title="Triage">
            <div className={shared.panel}>
              <div className={`${shared.panelBody} ${styles.controls}`}>
                <div className={shared.field}>
                  <label className={shared.label} htmlFor="issue-status">
                    Status
                  </label>
                  <select
                    id="issue-status"
                    className={shared.select}
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value as IssueStatus);
                      setBlocked(null);
                    }}
                  >
                    {Object.entries(ISSUE_STATUS_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* The gate appears the moment "Resolved" is chosen — before the
                    click it would have blocked, not after. */}
                {status === 'resolved' || status === 'closed' ? (
                  <div className={status === 'resolved' ? styles.gate : shared.field}>
                    <label className={styles.gateTitle} htmlFor="issue-resolution">
                      Resolution
                      {status === 'resolved' ? (
                        <span className={shared.crit}> — required to resolve</span>
                      ) : (
                        <span className={shared.labelHint}> — optional when closing</span>
                      )}
                    </label>
                    <textarea
                      id="issue-resolution"
                      className={`${shared.textarea} ${
                        blocked === null ? '' : shared.inputInvalid
                      }`}
                      rows={4}
                      value={resolution}
                      aria-invalid={blocked !== null}
                      placeholder="What was actually done, and what the reporter was told."
                      onChange={(event) => {
                        setResolution(event.target.value);
                        if (blocked !== null) setBlocked(null);
                      }}
                    />
                    {status === 'resolved' ? (
                      <p className={shared.fieldHint}>
                        Read by whoever picks this up if the customer comes back. At least a
                        sentence.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className={shared.field}>
                  <label className={shared.label} htmlFor="issue-priority-edit">
                    Priority
                  </label>
                  <select
                    id="issue-priority-edit"
                    className={shared.select}
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as IssuePriority)}
                  >
                    {Object.entries(ISSUE_PRIORITY_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={shared.field}>
                  <label className={shared.label} htmlFor="issue-assignee">
                    Assigned to
                  </label>
                  <select
                    id="issue-assignee"
                    className={shared.select}
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                  >
                    <option value={UNASSIGNED}>Unassigned</option>
                    {SUPPORT_AGENTS.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                    {/* An assignee the roster does not know about — a live row
                        pointing at a real admin this fixture has never seen. */}
                    {value.assignedToUserId !== undefined &&
                    !SUPPORT_AGENTS.some((agent) => agent.id === value.assignedToUserId) ? (
                      <option value={value.assignedToUserId}>
                        {value.assignedToName ?? value.assignedToUserId}
                      </option>
                    ) : null}
                  </select>
                </div>

                {blocked === null ? null : (
                  <p className={shared.fieldError} role="alert">
                    {blocked}
                  </p>
                )}
                {patch.error === null ? null : (
                  <p className={shared.fieldError} role="alert">
                    {patch.error.problem.detail ?? patch.error.friendlyMessage} Nothing was changed.
                  </p>
                )}

                <div className={shared.rowWrap}>
                  <button
                    type="button"
                    className={`${shared.btn} ${shared.btnPrimary}`}
                    // Disabled only for "nothing to save" or "already saving".
                    // A missing resolution is NOT disabled — it is refused with
                    // a sentence, because a dead button teaches nothing.
                    disabled={!dirty || patch.loading}
                    onClick={() => {
                      void save();
                    }}
                  >
                    {patch.loading ? 'Saving…' : 'Save changes'}
                  </button>
                  {dirty ? (
                    <span className={shared.subtle}>Unsaved changes</span>
                  ) : (
                    <span className={shared.muted}>Up to date</span>
                  )}
                </div>
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Linked records">
            <div className={shared.panel}>
              <div className={`${shared.panelBody} ${styles.linkList}`}>
                <Ref
                  label="Order"
                  href={value.orderId === undefined ? null : `/admin/orders/${value.orderId}`}
                  text={value.orderNo ?? value.orderId}
                />
                <Ref
                  label="Customer"
                  href={
                    value.customerId === undefined ? null : `/admin/customers/${value.customerId}`
                  }
                  text={value.customerName ?? value.customerId}
                />
                <Ref
                  label="Vendor"
                  href={value.vendorId === undefined ? null : `/admin/vendors/${value.vendorId}`}
                  text={value.vendorName ?? value.vendorId}
                />
                <Ref
                  label="Rider"
                  href={value.riderId === undefined ? null : `/admin/riders/${value.riderId}`}
                  text={value.riderName ?? value.riderId}
                />
                {value.orderId === undefined &&
                value.customerId === undefined &&
                value.vendorId === undefined &&
                value.riderId === undefined ? (
                  <p className={shared.muted}>
                    Nothing linked. This issue stands on its own — add an order id if one turns up.
                  </p>
                ) : null}
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Timing">
            <div className={shared.panel}>
              <div className={shared.panelBody}>
                <dl className={shared.defList}>
                  <dt className={shared.dt}>Age</dt>
                  <dd className={shared.dd}>
                    <AgeCell issue={value} now={now} />
                  </dd>

                  <dt className={shared.dt}>Raised</dt>
                  <dd className={shared.dd}>{formatDate(value.createdAt, 'long')}</dd>

                  <dt className={shared.dt}>Last touched</dt>
                  <dd className={shared.dd}>{formatDate(value.updatedAt, 'long')}</dd>

                  <dt className={shared.dt}>Messages</dt>
                  <dd className={`${shared.dd} ${shared.num}`}>{messages.length}</dd>
                </dl>
              </div>
            </div>
          </AdminSection>
        </div>
      </div>

      {loading ? <span className="adm-sr">Loading issue {value.code}</span> : null}
    </AdminPage>
  );
}
