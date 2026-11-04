'use client';

/**
 * The people who work in this shop, and what each of them may do.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING ON THIS SCREEN IS THE ACCESS CHECK.                              │
 * │                                                                          │
 * │ Every write goes to `/vendor/staff/*`, where the API enforces the rules  │
 * │ that matter: `staff.manage` on the route, and in the service — nobody     │
 * │ grants what they do not hold, nobody edits themselves or the owner, and   │
 * │ nobody acts on a colleague who holds more than they do. The screen       │
 * │ greys those options out so a manager is not offered a button that can    │
 * │ only 403; it does not decide anything.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE PASSWORD ────────────────────────────────────────────────────────────
 * Same contract as a rider's: typed (or generated) here, sent once, hashed on
 * the server, never readable again. After a successful create the screen shows
 * it ONE more time with the phone number so it can be handed over, and forgets
 * it the moment that panel is closed.
 */

import { useMemo, useState } from 'react';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import { STAFF_ROLE_LABEL, useVendorSession } from '@/lib/vendor/session';
import {
  PERMISSION_LABEL,
  STAFF_ROLES,
  STAFF_ROLE_HINT,
  generatePassword,
} from '@/lib/vendor/staff';
import type {
  Paged,
  StaffCatalogue,
  StaffCreate,
  StaffMember,
  StaffRole,
  StaffStatusUpdate,
  StaffUpdate,
  StorePermission,
} from '@/lib/vendor/types';
import { IconInbox, IconPlus, IconRefresh } from '../icons';
import { ConfirmDialog, Drawer } from '../overlay';
import { VenPage, VenSection } from '../Page';
import { Btn, EmptyState, EndpointError, Field, Pill, RelativeTime } from '../primitives';
import { VenTable, type Column } from '../table';

const MIN_PASSWORD = 12;

interface Draft {
  name: string;
  phone: string;
  email: string;
  password: string;
  shiftLabel: string;
  staffRole: StaffRole;
  permissions: StorePermission[];
}

const EMPTY: Draft = {
  name: '',
  phone: '',
  email: '',
  password: '',
  shiftLabel: '',
  staffRole: 'BILLER',
  permissions: [],
};

export function StaffView() {
  const session = useVendorSession();
  const staff = useVendorQuery<Paged<StaffMember>>('/vendor/staff', { limit: 100 });
  const catalogue = useVendorQuery<StaffCatalogue>('/vendor/staff/roles');

  const create = useVendorMutation<StaffCreate, StaffMember>('/vendor/staff', 'POST');
  const update = useVendorMutation<StaffUpdate, StaffMember>('/vendor/staff/:id', 'PATCH');
  const setStatus = useVendorMutation<StaffStatusUpdate, StaffMember>(
    '/vendor/staff/:id/status',
    'PATCH',
  );
  const remove = useVendorMutation<never, void>('/vendor/staff/:id', 'DELETE');

  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [handover, setHandover] = useState<{ name: string; phone: string; password: string } | null>(
    null,
  );
  const [suspending, setSuspending] = useState<StaffMember | null>(null);
  const [deleting, setDeleting] = useState<StaffMember | null>(null);

  const grantable = useMemo(
    () => new Set<StorePermission>(catalogue.data?.grantable ?? []),
    [catalogue.data],
  );

  /** What a draft would confer — the preset's set, or the checklist. */
  const effective = (role: StaffRole, list: readonly StorePermission[]): StorePermission[] =>
    role === 'CUSTOM' ? [...list] : [...(catalogue.data?.presets[role] ?? [])];

  const beyondMe = (permissions: readonly StorePermission[]): StorePermission[] =>
    session.isOwner ? [] : permissions.filter((permission) => !grantable.has(permission));

  const draftPermissions = effective(draft.staffRole, draft.permissions);
  const draftBeyond = beyondMe(draftPermissions);

  const openCreate = () => {
    setEditing(null);
    setDraft({ ...EMPTY, password: generatePassword() });
    create.reset();
    setDrawerOpen(true);
  };

  const openEdit = (member: StaffMember) => {
    setEditing(member);
    setDraft({
      ...EMPTY,
      name: member.name,
      phone: member.phone,
      email: member.email ?? '',
      shiftLabel: member.shiftLabel ?? '',
      staffRole: member.staffRole,
      permissions: [...member.permissions],
    });
    update.reset();
    setDrawerOpen(true);
  };

  const save = () => {
    const permissions = draft.staffRole === 'CUSTOM' ? draft.permissions : undefined;
    if (editing) {
      const body: StaffUpdate = {
        name: draft.name.trim(),
        staffRole: draft.staffRole,
        permissions,
        shiftLabel: draft.shiftLabel.trim() || null,
        ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      };
      void update.mutate(body, {
        params: { id: editing.id },
        invalidate: ['/vendor/staff'],
        onSuccess: () => setDrawerOpen(false),
      });
      return;
    }

    const body: StaffCreate = {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      password: draft.password,
      staffRole: draft.staffRole,
      ...(permissions ? { permissions } : {}),
      ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      ...(draft.shiftLabel.trim() ? { shiftLabel: draft.shiftLabel.trim() } : {}),
    };
    void create.mutate(body, {
      invalidate: ['/vendor/staff'],
      onSuccess: (member) => {
        setDrawerOpen(false);
        setHandover({ name: member.name, phone: member.phone, password: draft.password });
        setDraft(EMPTY);
      },
    });
  };

  /** The owner and anyone with more access than the caller are read-only here. */
  const lockedReason = (member: StaffMember): string | null => {
    if (member.id === session.userId) {
      return 'This is you — ask the owner or another manager to change your account';
    }
    const beyond = beyondMe(member.permissions);
    return beyond.length > 0
      ? `Has access you do not hold (${beyond.join(', ')}) — only the owner can change them`
      : null;
  };

  const rows = staff.data?.data ?? [];

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: 'Person',
      render: (row) => (
        <span>
          <strong>{row.name}</strong>
          <br />
          <span className="ven-dim">
            <a href={`tel:${row.phone}`}>{row.phone}</a>
            {row.email ? ` · ${row.email}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <span className="ven-row">
          <Pill tone="info" title={STAFF_ROLE_HINT[row.staffRole]}>
            {STAFF_ROLE_LABEL[row.staffRole]}
          </Pill>
          {row.shiftLabel ? <span className="ven-dim">{row.shiftLabel}</span> : null}
        </span>
      ),
    },
    {
      key: 'permissions',
      header: 'Can',
      render: (row) => (
        <span className="ven-permchips" title={row.permissions.join(', ')}>
          {row.permissions.map((permission) => (
            <span key={permission} className="ven-permchip">
              {PERMISSION_LABEL[permission]?.label ?? permission}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.status === 'active' ? (
          <Pill tone="good">Active</Pill>
        ) : (
          <Pill tone="crit">Suspended</Pill>
        ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last signed in',
      render: (row) =>
        row.lastLoginAt ? <RelativeTime value={row.lastLoginAt} /> : <span className="ven-dim">never</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => {
        const locked = lockedReason(row);
        return (
          <span className="ven-row" style={{ justifyContent: 'flex-end' }}>
            <Btn size="sm" disabled={locked !== null} title={locked ?? 'Change role, permissions or shift'} onClick={() => openEdit(row)}>
              Edit
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              disabled={locked !== null || setStatus.loading}
              title={locked ?? undefined}
              onClick={() =>
                row.status === 'active'
                  ? setSuspending(row)
                  : void setStatus.mutate(
                      { status: 'active' },
                      { params: { id: row.id }, invalidate: ['/vendor/staff'] },
                    )
              }
            >
              {row.status === 'active' ? 'Suspend' : 'Reinstate'}
            </Btn>
            <Btn
              size="sm"
              variant="danger"
              disabled={locked !== null}
              title={locked ?? 'Remove this person and their login'}
              onClick={() => setDeleting(row)}
            >
              Delete
            </Btn>
          </span>
        );
      },
    },
  ];

  const draftValid =
    draft.name.trim().length >= 2 &&
    (editing !== null ||
      (/^\d{10}$/.test(draft.phone.trim()) && draft.password.length >= MIN_PASSWORD)) &&
    (draft.staffRole !== 'CUSTOM' || draft.permissions.length > 0) &&
    draftBeyond.length === 0;

  const writeError = (editing ? update.error : create.error)?.friendlyMessage ?? null;

  return (
    <VenPage
      title="Staff"
      description="Everyone who signs in to run this shop, and exactly what each of them can do. The API checks these permissions on every request."
      actions={
        <Btn variant="primary" onClick={openCreate}>
          <IconPlus />
          Add staff
        </Btn>
      }
    >
      {staff.error && staff.data === null ? (
        <EndpointError
          path="/vendor/staff"
          message={staff.error.friendlyMessage}
          status={staff.error.status}
          onRetry={staff.refetch}
        />
      ) : null}

      {handover ? (
        <div className="ven-handover" role="status">
          <p className="ven-handover__title">
            {handover.name} can sign in now — this is the only time you will see the password.
          </p>
          <dl className="ven-handover__creds">
            <dt>Phone</dt>
            <dd className="ven-mono">{handover.phone}</dd>
            <dt>Password</dt>
            <dd className="ven-mono">{handover.password}</dd>
          </dl>
          <p className="ven-note">
            Give it to them in person. It is stored only as a hash — nobody, including you and the
            platform, can look it up later. If it is lost, delete the account and add them again.
          </p>
          <div className="ven-row">
            <Btn
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(handover.password)}
              title="Copy the password"
            >
              Copy password
            </Btn>
            <Btn size="sm" variant="primary" onClick={() => setHandover(null)}>
              I have handed it over
            </Btn>
          </div>
        </div>
      ) : null}

      <VenSection
        description={`${rows.filter((row) => row.status === 'active').length} active · ${rows.length} in total`}
      >
        <VenTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={staff.loading && !staff.hasLoadedOnce}
          empty={
            <EmptyState
              title="Nobody but you yet"
              body="Add a biller for the counter, someone for the order board, or a manager to run the shift."
              icon={<IconInbox />}
            />
          }
        />
      </VenSection>

      {/* ------------------------------------------- add / edit ---- */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add a staff member'}
        subtitle={editing ? `Signs in with ${editing.phone}` : 'This creates their login for the store panel'}
        width="min(620px, 96vw)"
        actions={
          <>
            <span style={{ flex: '1 1 auto' }} />
            <Btn onClick={() => setDrawerOpen(false)}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={!draftValid || create.loading || update.loading}
              onClick={save}
            >
              {create.loading || update.loading ? 'Saving…' : editing ? 'Save changes' : 'Create login'}
            </Btn>
          </>
        }
      >
        <div className="ven-form">
          {writeError ? (
            <p className="ven-field__error" role="alert">
              {writeError}
            </p>
          ) : null}

          <Field label="Name">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                value={draft.name}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            )}
          </Field>

          {editing ? null : (
            <Field
              label="Phone"
              hint="Ten digits — this is what they type to sign in."
              error={
                draft.phone !== '' && !/^\d{10}$/.test(draft.phone.trim())
                  ? 'Ten digits, no spaces and no country code.'
                  : undefined
              }
            >
              {(id) => (
                <input
                  id={id}
                  className="ven-input"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={draft.phone}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                />
              )}
            </Field>
          )}

          <Field label="Email (optional)" hint="They can sign in with this instead of the phone.">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
            )}
          </Field>

          <Field label="Shift (optional)" hint="Display only, e.g. “Morning counter”.">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                maxLength={40}
                value={draft.shiftLabel}
                onChange={(event) => setDraft({ ...draft, shiftLabel: event.target.value })}
              />
            )}
          </Field>

          {editing ? null : (
            <Field
              label="First password"
              hint="Generated for you; at least 12 characters. You will see it once more after saving, then never again."
              error={
                draft.password !== '' && draft.password.length < MIN_PASSWORD
                  ? `Too short — ${MIN_PASSWORD} characters minimum.`
                  : undefined
              }
            >
              {(id) => (
                <span className="ven-row">
                  <input
                    id={id}
                    className="ven-input ven-mono"
                    type="text"
                    autoComplete="off"
                    value={draft.password}
                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                  />
                  <Btn size="sm" onClick={() => setDraft({ ...draft, password: generatePassword() })}>
                    <IconRefresh />
                    Generate
                  </Btn>
                </span>
              )}
            </Field>
          )}

          <fieldset className="ven-fieldset">
            <legend className="ven-field__label">Role</legend>
            <div className="ven-rolepick" role="radiogroup" aria-label="Role">
              {STAFF_ROLES.map((role) => {
                const conferred = effective(role, draft.permissions);
                const outOfReach =
                  role !== 'CUSTOM' && catalogue.data !== null && beyondMe(conferred).length > 0;
                return (
                  <label key={role} className="ven-rolepick__opt" data-disabled={outOfReach ? 'true' : undefined}>
                    <input
                      type="radio"
                      name="staff-role"
                      value={role}
                      checked={draft.staffRole === role}
                      disabled={outOfReach}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          staffRole: role,
                          // Switching to CUSTOM starts from what they had.
                          permissions:
                            role === 'CUSTOM'
                              ? effective(draft.staffRole, draft.permissions).filter(
                                  (permission) => session.isOwner || grantable.has(permission),
                                )
                              : draft.permissions,
                        })
                      }
                    />
                    <span>
                      <strong>{STAFF_ROLE_LABEL[role]}</strong>
                      <span className="ven-field__hint">
                        {outOfReach ? 'Includes access you do not hold' : STAFF_ROLE_HINT[role]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="ven-fieldset">
            <legend className="ven-field__label">
              {draft.staffRole === 'CUSTOM' ? 'Permissions' : 'What this role can do'}
            </legend>
            {catalogue.error && catalogue.data === null ? (
              <p className="ven-field__error">{catalogue.error.friendlyMessage}</p>
            ) : null}
            <div className="ven-permgrid">
              {(catalogue.data?.permissions ?? []).map((permission) => {
                const custom = draft.staffRole === 'CUSTOM';
                const checked = draftPermissions.includes(permission);
                const reachable = session.isOwner || grantable.has(permission);
                return (
                  <label
                    key={permission}
                    className="ven-permgrid__item"
                    data-disabled={!custom || !reachable ? 'true' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!custom || !reachable}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          permissions: checked
                            ? draft.permissions.filter((value) => value !== permission)
                            : [...draft.permissions, permission],
                        })
                      }
                    />
                    <span>
                      <strong>{PERMISSION_LABEL[permission]?.label ?? permission}</strong>
                      <span className="ven-field__hint">
                        {reachable ? PERMISSION_LABEL[permission]?.hint : 'You do not hold this one'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {draftBeyond.length > 0 ? (
              <p className="ven-field__error" role="alert">
                You cannot grant {draftBeyond.join(', ')} — you do not hold it yourself.
              </p>
            ) : null}
          </fieldset>
        </div>
      </Drawer>

      {/* ------------------------------------------------ suspend ---- */}
      <ConfirmDialog
        open={suspending !== null}
        title={`Suspend ${suspending?.name ?? 'this person'}?`}
        body="They are signed out everywhere at once and cannot sign back in until you reinstate them."
        confirmLabel="Suspend"
        destructive
        loading={setStatus.loading}
        onCancel={() => setSuspending(null)}
        onConfirm={() => {
          if (!suspending) return;
          void setStatus.mutate(
            { status: 'suspended', reason: 'Suspended by the store' },
            {
              params: { id: suspending.id },
              invalidate: ['/vendor/staff'],
              onSuccess: () => setSuspending(null),
            },
          );
        }}
      />

      {/* ------------------------------------------------- delete ---- */}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this person'}?`}
        body="Their login is removed for good. Sales they rang up keep their name on the invoice."
        confirmLabel="Delete"
        destructive
        loading={remove.loading}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          void remove.mutate(undefined, {
            params: { id: deleting.id },
            invalidate: ['/vendor/staff'],
            onSuccess: () => setDeleting(null),
          });
        }}
      />
    </VenPage>
  );
}
