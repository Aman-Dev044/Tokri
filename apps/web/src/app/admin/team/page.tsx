'use client';

/**
 * Team — who can operate this console.
 *
 * ── SUPER-ADMIN ONLY, AND THAT IS STILL ONLY THE UI ─────────────────────────
 * A plain ADMIN gets the locked panel below instead of the table. That stops a
 * colleague stumbling into a screen full of controls that will all 403; it does
 * not stop anybody who wants to call `GET /admin/team` directly, and it is not
 * meant to. The API's RolesGuard is the enforcement (plan §4.2).
 *
 * ── SYSTEM ACCOUNTS ARE IMMUTABLE ───────────────────────────────────────────
 * The seed script provisions the bootstrap accounts from `.env` and flags them
 * `isSystemAccount`. They are the break-glass identities, and the API refuses
 * to suspend or delete them, so they render with their actions removed and a
 * plain explanation — not with a button that fails.
 *
 * ── THE ROW IS THE API'S `TeamMemberRow` ────────────────────────────────────
 * Access level comes from `role` ('admin' | 'super_admin') via
 * `parseAdminRole`, and `status` can be null for an account written outside
 * the app. Both used to be read as fixture fields that the API never sent,
 * and one hand-made account with no status took the whole page down.
 */

import { useMemo, useState } from 'react';
import { useAdminMutation, useAdminQuery } from '@/hooks';
import { useAuth } from '@/components/auth/AuthProvider';
import { ADMIN_LEVEL_LABEL, adminLevelOf, parseAdminRole } from '@/lib/admin/session';
import type { AdminLevel, Paginated, TeamMember } from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  IconLock,
  IconPlus,
  RelativeTime,
  StatusPill,
  Toolbar,
  type Column,
} from '@/components/admin';

type Pending =
  | { kind: 'suspend' | 'reinstate' | 'delete'; member: TeamMember }
  | null;

export default function AdminTeamPage() {
  const { user } = useAuth();
  const level = adminLevelOf(user);
  // `null` is preview mode — no session at all. See AdminShell.
  const allowed = level === 'SUPER_ADMIN' || level === null;

  const query = useAdminQuery<Paginated<TeamMember>>('/admin/team', undefined, {
    enabled: allowed,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const statusMutation = useAdminMutation<{ status: string }, TeamMember>(
    '/admin/team/:id/status',
    'PATCH',
  );
  const deleteMutation = useAdminMutation<never, void>('/admin/team/:id', 'DELETE');

  const rows = query.data?.data ?? [];

  const columns: Column<TeamMember>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (row) => (
          <span style={{ minWidth: 0 }}>
            <strong>{row.name}</strong>
            {row.email ? <span className="adm-table__sub">{row.email}</span> : null}
          </span>
        ),
      },
      {
        key: 'role',
        header: 'Access',
        render: (row) => {
          const rowLevel = parseAdminRole(row.role);
          return rowLevel ? (
            <span className="adm-rolepill" data-level={rowLevel}>
              {ADMIN_LEVEL_LABEL[rowLevel]}
            </span>
          ) : (
            <span style={{ color: 'var(--adm-dim)' }}>{row.role}</span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <span className="adm-row">
            {row.status ? (
              <StatusPill status={row.status} kind="user" />
            ) : (
              <span
                className="adm-pill"
                data-tone="warn"
                title="The stored account has no status. Sign-in refuses anything that is not active."
              >
                <span className="adm-pill__glyph" aria-hidden="true" />
                no status
              </span>
            )}
            {row.isSystemAccount ? (
              <span className="adm-pill" data-tone="neutral" title="Provisioned by the seed script">
                <span className="adm-pill__glyph" aria-hidden="true" />
                system
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'phone',
        header: 'Phone',
        numeric: true,
        render: (row) => row.phone || <span style={{ color: 'var(--adm-dim)' }}>—</span>,
      },
      {
        key: 'lastLoginAt',
        header: 'Last seen',
        align: 'right',
        render: (row) =>
          row.lastLoginAt ? (
            <RelativeTime value={row.lastLoginAt} live={false} />
          ) : (
            <span style={{ color: 'var(--adm-dim)' }}>never</span>
          ),
      },
      {
        key: 'createdAt',
        header: 'Added',
        align: 'right',
        render: (row) =>
          row.createdAt ? (
            <RelativeTime value={row.createdAt} live={false} />
          ) : (
            <span style={{ color: 'var(--adm-dim)' }}>—</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) =>
          row.isSystemAccount ? (
            <span
              className="adm-row"
              style={{ justifyContent: 'flex-end', color: 'var(--adm-dim)' }}
              title="System accounts are provisioned by the seed script and cannot be edited here."
            >
              <IconLock style={{ width: 14, height: 14 }} />
              immutable
            </span>
          ) : (
            <span className="adm-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="adm-btn adm-btn--sm"
                onClick={() =>
                  setPending({
                    kind: row.status === 'active' ? 'suspend' : 'reinstate',
                    member: row,
                  })
                }
              >
                {row.status === 'active'
                  ? 'Suspend'
                  : row.status === 'suspended'
                    ? 'Reinstate'
                    : 'Activate'}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--sm adm-btn--danger"
                onClick={() => setPending({ kind: 'delete', member: row })}
              >
                Delete
              </button>
            </span>
          ),
      },
    ],
    [],
  );

  if (!allowed) {
    return (
      <AdminPage
        title="Team"
        description="Admin accounts and what each of them may do."
      >
        <div className="adm-panel adm-panel--pad">
          <div className="adm-row" style={{ alignItems: 'flex-start' }}>
            <IconLock style={{ width: 20, height: 20, color: 'var(--adm-dim)' }} />
            <div>
              <h2 className="adm-section__title">Super admins only</h2>
              <p className="adm-section__desc" style={{ maxWidth: '60ch' }}>
                Your account is a <strong>{ADMIN_LEVEL_LABEL[(level ?? 'ADMIN') as AdminLevel]}</strong>.
                Managing admin accounts — who exists, who is suspended, who is elevated — is
                restricted to super admins. Ask one if you need a change made.
              </p>
              <p className="adm-gate__note">
                This screen simply is not drawn for your account. The API enforces the same rule on
                every `/admin/team` request, which is the part that actually matters.
              </p>
            </div>
          </div>
        </div>
      </AdminPage>
    );
  }

  const confirmCopy = () => {
    if (!pending) return { title: '', body: null as React.ReactNode, label: '' };
    const name = pending.member.name;
    if (pending.kind === 'delete') {
      return {
        title: 'Delete this admin?',
        label: 'Delete',
        body: (
          <>
            <strong>{name}</strong> loses access immediately and their sessions are revoked. Their
            entries in the audit log <em>remain</em> — deleting an operator never deletes the record
            of what they did.
          </>
        ),
      };
    }
    if (pending.kind === 'suspend') {
      return {
        title: 'Suspend this admin?',
        label: 'Suspend',
        body: (
          <>
            <strong>{name}</strong> is signed out everywhere and cannot sign back in until
            reinstated. The account and its history are kept.
          </>
        ),
      };
    }
    return {
      title: 'Reinstate this admin?',
      label: 'Reinstate',
      body: (
        <>
          <strong>{name}</strong> can sign in again with the same access level they had before.
        </>
      ),
    };
  };

  const copy = confirmCopy();
  const busy = statusMutation.loading || deleteMutation.loading;

  return (
    <AdminPage
      title="Team"
      description="Admin accounts and what each of them may do. Every change here is written to the audit log."
      isFixture={query.isFixture}
      fixturePaths={query.isFixture ? ['/admin/team'] : undefined}
      actions={
        <button
          type="button"
          className="adm-btn adm-btn--primary adm-btn--sm"
          onClick={() => setCreateOpen(true)}
        >
          <IconPlus />
          Add an admin
        </button>
      }
    >
      <Toolbar>
        <span style={{ color: 'var(--adm-dim)' }}>
          {rows.length} accounts · {rows.filter((row) => row.isSystemAccount).length} of them system
        </span>
        <Toolbar.Spacer />
        {statusMutation.error || deleteMutation.error ? (
          <span className="adm-pill" data-tone="crit">
            <span className="adm-pill__glyph" aria-hidden="true" />
            {(statusMutation.error ?? deleteMutation.error)?.friendlyMessage}
          </span>
        ) : null}
      </Toolbar>

      <AdminSection>
        <DataTable
          columns={columns}
          rows={rows}
          loading={query.loading && !query.hasLoadedOnce}
          rowKey={(row) => row.id}
          skeletonRows={5}
        />
      </AdminSection>

      <CreateAdminDrawer open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={pending !== null}
        destructive={pending?.kind !== 'reinstate'}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.label}
        loading={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          const done = { onSuccess: () => setPending(null), invalidate: ['/admin/team'] };
          if (pending.kind === 'delete') {
            void deleteMutation.mutate(undefined, { params: { id: pending.member.id }, ...done });
          } else {
            void statusMutation.mutate(
              { status: pending.kind === 'suspend' ? 'suspended' : 'active' },
              { params: { id: pending.member.id }, ...done },
            );
          }
        }}
      />
    </AdminPage>
  );
}

/* ================================================================== */
/* Create                                                              */
/* ================================================================== */

/** `CreateTeamMemberDto` — the body, all of it. */
interface CreateBody {
  name: string;
  email: string;
  phone: string;
  password: string;
}

const EMPTY_CREATE: CreateBody = { name: '', email: '', phone: '', password: '' };

/** `CreateTeamMemberDto.password` — 12 to 128 characters, length over composition. */
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

/**
 * Twenty characters from an alphabet with the look-alikes (0/O, 1/l/I) taken
 * out, because this password is read aloud or retyped from a chat message at
 * least once. `crypto.getRandomValues` with rejection sampling, so no
 * character is likelier than another — `Math.random()` is not a source of
 * secrets.
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_.!@#';
function generatePassword(length = 20): string {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  const out: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit && out.length < length) {
        out.push(PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length));
      }
    }
  }
  return out.join('');
}

/**
 * Creating an admin, with their first password set here.
 *
 * There is no invitation flow behind this form — the platform has no email
 * provider — so the account is created complete, the same way a store adds
 * its own rider in the vendor panel: the super admin chooses (or generates) a
 * first password and hands it over themselves. It is sent once, stored as an
 * argon2id hash, and no endpoint returns it, so the drawer says plainly that
 * this is the only time anybody sees it. The audit entry records who created
 * the account and never the password.
 *
 * The new account is always an ADMIN. `POST /admin/team` takes no role at
 * all and the API refuses to mint a SUPER_ADMIN by any route, so this form no
 * longer offers the choice — a `level` field in the body was itself a 400.
 */
function CreateAdminDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<CreateBody>(EMPTY_CREATE);

  const mutation = useAdminMutation<CreateBody, TeamMember>('/admin/team', 'POST');

  const phoneOk = /^\d{10}$/.test(form.phone.trim());
  const passwordOk = form.password.length >= MIN_PASSWORD && form.password.length <= MAX_PASSWORD;
  const valid =
    form.name.trim().length > 1 && /.+@.+\..+/.test(form.email) && phoneOk && passwordOk;
  const fieldErrors = mutation.error?.fieldErrors ?? {};

  const close = () => {
    // The password must not survive a closed drawer for the next person to
    // find on this screen.
    setForm(EMPTY_CREATE);
    onClose();
  };

  const submit = () => {
    if (!valid) return;
    void mutation.mutate(
      { ...form, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() },
      { invalidate: ['/admin/team'], onSuccess: close },
    );
  };

  return (
    <DetailDrawer
      open={open}
      onClose={close}
      title="Add an admin"
      subtitle="Creates the account now, with a first password you hand to them yourself."
      actions={
        <>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            onClick={submit}
            disabled={!valid || mutation.loading}
          >
            {mutation.loading ? 'Creating…' : 'Create the admin'}
          </button>
          <button type="button" className="adm-btn" onClick={close} disabled={mutation.loading}>
            Cancel
          </button>
        </>
      }
    >
      <div className="adm-stack">
        <Field
          label="Full name"
          value={form.name}
          maxLength={80}
          error={fieldErrors.name}
          onChange={(value) => setForm((f) => ({ ...f, name: value }))}
        />
        <Field
          label="Work email"
          type="email"
          value={form.email}
          maxLength={120}
          error={fieldErrors.email}
          hint="They sign in with this email, or with the phone below."
          onChange={(value) => setForm((f) => ({ ...f, email: value }))}
        />
        <Field
          label="Phone"
          type="tel"
          value={form.phone}
          maxLength={10}
          error={
            fieldErrors.phone ??
            (form.phone !== '' && !phoneOk ? 'Ten digits, no spaces and no country code.' : undefined)
          }
          onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
        />

        <Field
          label="First password"
          value={form.password}
          maxLength={MAX_PASSWORD}
          autoComplete="off"
          error={
            fieldErrors.password ??
            (form.password !== '' && form.password.length < MIN_PASSWORD
              ? `Too short — ${MIN_PASSWORD} characters minimum.`
              : undefined)
          }
          hint={`At least ${MIN_PASSWORD} characters. Length is what matters, not symbols.`}
          onChange={(value) => setForm((f) => ({ ...f, password: value }))}
          trailing={
            <button
              type="button"
              className="adm-btn adm-btn--sm"
              onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}
            >
              Generate a strong one
            </button>
          }
        />

        <div className="adm-notice" role="note">
          <IconLock style={{ width: 16, height: 16, flex: '0 0 auto' }} />
          <span>
            Share this password with the new admin <strong>once</strong>, directly, and never
            again. It is stored only as a hash: after you press Create there is no screen,
            anywhere, that can show it to you. If it is lost, delete the account and create it
            again.
          </span>
        </div>

        <div className="adm-field">
          <span className="adm-field__label">Access level</span>
          <span className="adm-rolepill" data-level="ADMIN" style={{ alignSelf: 'flex-start' }}>
            {ADMIN_LEVEL_LABEL.ADMIN}
          </span>
          <p className="adm-section__desc" style={{ maxWidth: '46ch' }}>
            Every account created here is an admin: they can operate orders, vendors, catalogue
            and support, but cannot touch money settings or the team. Super admin is never granted
            through the console — the API refuses it.
          </p>
        </div>

        {mutation.error && Object.keys(fieldErrors).length === 0 ? (
          <p style={{ color: 'var(--crit-ink)' }}>{mutation.error.friendlyMessage}</p>
        ) : null}
      </div>
    </DetailDrawer>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  error,
  hint,
  maxLength,
  autoComplete,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string;
  hint?: string;
  maxLength?: number;
  autoComplete?: string;
  /** a control that sits beside the input — the password generator */
  trailing?: React.ReactNode;
}) {
  const id = `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  const input = (
    <input
      id={id}
      className="adm-input"
      type={type}
      value={value}
      maxLength={maxLength}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      style={trailing ? { flex: '1 1 auto', minWidth: 0 } : undefined}
    />
  );
  return (
    <div className="adm-field">
      <label className="adm-field__label" htmlFor={id}>
        {label}
      </label>
      {trailing ? (
        <div className="adm-row">
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
      {hint ? (
        <span id={`${id}-hint`} className="adm-section__desc">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} style={{ color: 'var(--crit-ink)', fontSize: 'var(--adm-fs-sm)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
