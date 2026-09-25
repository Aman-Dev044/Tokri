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
 * Two accounts are created by migration: one owns the audit trail, one runs the
 * settlement jobs. Suspending either breaks the platform in ways that are hard
 * to diagnose from the symptom, so they render with their actions removed and a
 * plain explanation — not with a button that fails.
 */

import { useMemo, useState } from 'react';
import { useAdminMutation, useAdminQuery } from '@/hooks';
import { useAuth } from '@/components/auth/AuthProvider';
import { ADMIN_LEVEL_LABEL, adminLevelOf } from '@/lib/admin/session';
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
            <span className="adm-table__sub">{row.email}</span>
          </span>
        ),
      },
      {
        key: 'level',
        header: 'Access',
        render: (row) => (
          <span className="adm-rolepill" data-level={row.level}>
            {ADMIN_LEVEL_LABEL[row.level]}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <span className="adm-row">
            <StatusPill status={row.status} kind="user" />
            {row.isSystem ? (
              <span className="adm-pill" data-tone="neutral" title="Created by a migration">
                <span className="adm-pill__glyph" aria-hidden="true" />
                system
              </span>
            ) : null}
          </span>
        ),
      },
      { key: 'phone', header: 'Phone', numeric: true },
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
        render: (row) => <RelativeTime value={row.createdAt} live={false} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) =>
          row.isSystem ? (
            <span
              className="adm-row"
              style={{ justifyContent: 'flex-end', color: 'var(--adm-dim)' }}
              title="System accounts are created by a migration and cannot be edited here."
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
                {row.status === 'active' ? 'Suspend' : 'Reinstate'}
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
          {rows.length} accounts · {rows.filter((row) => row.isSystem).length} of them system
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

interface CreateBody {
  name: string;
  email: string;
  phone: string;
  level: AdminLevel;
}

/**
 * Creating an admin, with no password field anywhere.
 *
 * The API issues an invitation; the new admin sets their own credential through
 * the normal flow. An admin console that lets one person type another person's
 * password is an admin console where one person knows another person's
 * password, and the audit log stops meaning anything.
 */
function CreateAdminDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<CreateBody>({
    name: '',
    email: '',
    phone: '',
    level: 'ADMIN',
  });

  const mutation = useAdminMutation<CreateBody, TeamMember>('/admin/team', 'POST');

  const valid = form.name.trim().length > 1 && /.+@.+\..+/.test(form.email);
  const fieldErrors = mutation.error?.fieldErrors ?? {};

  const submit = () => {
    if (!valid) return;
    void mutation.mutate(form, {
      invalidate: ['/admin/team'],
      onSuccess: () => {
        setForm({ name: '', email: '', phone: '', level: 'ADMIN' });
        onClose();
      },
    });
  };

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title="Add an admin"
      subtitle="They receive an invitation and set their own password. No password is set here."
      actions={
        <>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            onClick={submit}
            disabled={!valid || mutation.loading}
          >
            {mutation.loading ? 'Sending…' : 'Send the invitation'}
          </button>
          <button type="button" className="adm-btn" onClick={onClose} disabled={mutation.loading}>
            Cancel
          </button>
        </>
      }
    >
      <div className="adm-stack">
        <Field
          label="Full name"
          value={form.name}
          error={fieldErrors.name}
          onChange={(value) => setForm((f) => ({ ...f, name: value }))}
        />
        <Field
          label="Work email"
          type="email"
          value={form.email}
          error={fieldErrors.email}
          onChange={(value) => setForm((f) => ({ ...f, email: value }))}
        />
        <Field
          label="Phone"
          type="tel"
          value={form.phone}
          error={fieldErrors.phone}
          onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
        />

        <div className="adm-field">
          <span className="adm-field__label">Access level</span>
          <div className="adm-segmented" style={{ alignSelf: 'flex-start' }}>
            {(['ADMIN', 'SUPER_ADMIN'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="adm-segmented__btn"
                aria-pressed={form.level === option}
                onClick={() => setForm((f) => ({ ...f, level: option }))}
              >
                {ADMIN_LEVEL_LABEL[option]}
              </button>
            ))}
          </div>
          <p className="adm-section__desc" style={{ maxWidth: '46ch' }}>
            {form.level === 'SUPER_ADMIN'
              ? 'Super admins can manage the team, run settlements, change platform settings and edit vendor commission. Grant it deliberately.'
              : 'Admins can operate orders, vendors, catalogue and support. They cannot touch money settings or the team.'}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string;
}) {
  const id = `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="adm-field">
      <label className="adm-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="adm-input"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <span id={`${id}-error`} style={{ color: 'var(--crit-ink)', fontSize: 'var(--adm-fs-sm)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
