'use client';

import { useEffect, useMemo, useState } from 'react';

import { AdminPage, AdminSection, ConfirmDialog, Money } from '@/components/admin';
import { useAdminMutation } from '@/hooks';

import { useAdminRole } from '../_shared-pages/role';
import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { useSourcedOne } from '../_shared-pages/useSourced';
import {
  KEY_LABEL,
  MONEY_KEYS,
  SETTINGS_FIXTURE,
  type PlatformSettings,
  type SettingKey,
} from './fixtures';

const ENDPOINT = '/admin/settings';

type Errors = Partial<Record<SettingKey, string>>;

/** Mirrors the server's constraints. The API re-validates all of them. */
function validate(draft: PlatformSettings): Errors {
  const errors: Errors = {};

  if (draft.platformName.trim().length < 2) {
    errors.platformName = 'The platform needs a name.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.supportEmail)) {
    errors.supportEmail = 'A working email address customers can reach.';
  }
  if (draft.supportPhone.replace(/\D/g, '').length < 8) {
    errors.supportPhone = 'A dialable phone number.';
  }
  if (!Number.isInteger(draft.deliveryFeePaise) || draft.deliveryFeePaise < 0) {
    errors.deliveryFeePaise = 'A whole number of paise, zero or more.';
  }
  if (
    !Number.isInteger(draft.freeDeliveryThresholdPaise) ||
    draft.freeDeliveryThresholdPaise < 0
  ) {
    errors.freeDeliveryThresholdPaise = 'A whole number of paise, zero or more.';
  }
  if (!Number.isFinite(draft.serviceRadiusKm) || draft.serviceRadiusKm <= 0) {
    errors.serviceRadiusKm = 'Greater than zero.';
  } else if (draft.serviceRadiusKm > 50) {
    errors.serviceRadiusKm = 'Above 50 km the delivery promise stops being credible.';
  }
  if (
    !Number.isFinite(draft.defaultCommissionPct) ||
    draft.defaultCommissionPct < 0 ||
    draft.defaultCommissionPct > 100
  ) {
    errors.defaultCommissionPct = 'A percentage between 0 and 100.';
  }
  if (!Number.isInteger(draft.codMaxAmountPaise) || draft.codMaxAmountPaise < 0) {
    errors.codMaxAmountPaise = 'A whole number of paise, zero or more.';
  }

  return errors;
}

function changedKeys(a: PlatformSettings, b: PlatformSettings): SettingKey[] {
  return (Object.keys(a) as SettingKey[]).filter((key) => a[key] !== b[key]);
}

export function SettingsView() {
  const { isSuperAdmin, restrictedNote } = useAdminRole();

  const { value, loading, isSample, refetch } = useSourcedOne<PlatformSettings>(
    ENDPOINT,
    SETTINGS_FIXTURE,
  );

  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Re-seed the form whenever a fresh copy lands, but never on top of edits in
  // progress — silently discarding what someone has typed is worse than a
  // slightly stale baseline.
  useEffect(() => {
    if (draft === null) setDraft(value);
  }, [value, draft]);

  const current = draft ?? value;
  const errors = useMemo(() => validate(current), [current]);
  const dirty = useMemo(() => changedKeys(current, value), [current, value]);
  const dirtyMoney = dirty.filter((key) => MONEY_KEYS.includes(key));
  const valid = Object.keys(errors).length === 0;

  const save = useAdminMutation<PlatformSettings, PlatformSettings>(ENDPOINT, 'PUT');

  const editable = isSuperAdmin && !isSample;

  function patch(next: Partial<PlatformSettings>) {
    setDraft((prev) => ({ ...(prev ?? value), ...next }));
  }

  function discard() {
    setDraft(value);
  }

  async function submit() {
    if (!valid || dirty.length === 0) return;
    await save.mutate(current);
    setConfirming(false);
    setDraft(null);
    refetch();
  }

  function attemptSave() {
    // Anything that reprices the platform gets an explicit confirmation naming
    // the fields. Everything else saves straight away.
    if (dirtyMoney.length > 0) setConfirming(true);
    else void submit();
  }

  const num = (raw: string) => Number.parseInt(raw, 10) || 0;

  function field(
    key: SettingKey,
    label: string,
    input: React.ReactNode,
    hint?: React.ReactNode,
  ) {
    const error = errors[key];
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`set-${key}`}>
          {label}
          {dirty.includes(key) ? <span className={styles.labelHint}> — edited</span> : null}
        </label>
        {input}
        {error === undefined ? (
          hint === undefined ? null : (
            <span className={styles.fieldHint}>{hint}</span>
          )
        ) : (
          <span className={styles.fieldError}>{error}</span>
        )}
      </div>
    );
  }

  return (
    <AdminPage
      title="Settings"
      description="Platform-wide configuration. Every value here is read by the API on the next request — there is no separate deploy."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Settings', href: '/admin/settings' },
      ]}
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      {/*
        Locking the form for a plain admin is UX, not security. The API's
        RolesGuard refuses the PUT regardless of what this component renders —
        see the note in `_shared-pages/role.ts`.
      */}
      {isSuperAdmin ? null : <p className={styles.readOnlyNote}>{restrictedNote}</p>}

      {isSuperAdmin && isSample ? (
        <p className={styles.readOnlyNote}>
          Editing is disabled while this page is showing sample data — saving would write fixture
          values over whatever the real settings are.
        </p>
      ) : null}

      <div className={`${styles.split} ${styles.splitEven}`}>
        <AdminSection title="Platform">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <div className={styles.formGrid}>
                {field(
                  'platformName',
                  KEY_LABEL.platformName,
                  <input
                    id="set-platformName"
                    className={`${styles.input} ${
                      errors.platformName === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.platformName}
                    disabled={!editable || loading}
                    onChange={(event) => patch({ platformName: event.target.value })}
                  />,
                  'Appears in emails, receipts and the browser title.',
                )}
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Support">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <div className={styles.formGrid}>
                {field(
                  'supportEmail',
                  KEY_LABEL.supportEmail,
                  <input
                    id="set-supportEmail"
                    type="email"
                    className={`${styles.input} ${
                      errors.supportEmail === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.supportEmail}
                    disabled={!editable || loading}
                    onChange={(event) => patch({ supportEmail: event.target.value })}
                  />,
                  'Printed on every order confirmation.',
                )}
                {field(
                  'supportPhone',
                  KEY_LABEL.supportPhone,
                  <input
                    id="set-supportPhone"
                    type="tel"
                    className={`${styles.input} ${styles.inputNum} ${
                      errors.supportPhone === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.supportPhone}
                    disabled={!editable || loading}
                    onChange={(event) => patch({ supportPhone: event.target.value })}
                  />,
                  'Shown to customers and to riders mid-delivery.',
                )}
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Delivery">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <div className={styles.formGrid}>
                {field(
                  'deliveryFeePaise',
                  `${KEY_LABEL.deliveryFeePaise} (paise)`,
                  <input
                    id="set-deliveryFeePaise"
                    type="number"
                    min={0}
                    step={100}
                    className={`${styles.input} ${styles.inputNum} ${
                      errors.deliveryFeePaise === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.deliveryFeePaise}
                    disabled={!editable || loading}
                    onChange={(event) => patch({ deliveryFeePaise: num(event.target.value) })}
                  />,
                  <>
                    Charged on every order below the threshold —{' '}
                    <Money value={current.deliveryFeePaise} />
                  </>,
                )}
                {field(
                  'freeDeliveryThresholdPaise',
                  `${KEY_LABEL.freeDeliveryThresholdPaise} (paise)`,
                  <input
                    id="set-freeDeliveryThresholdPaise"
                    type="number"
                    min={0}
                    step={100}
                    className={`${styles.input} ${styles.inputNum} ${
                      errors.freeDeliveryThresholdPaise === undefined
                        ? ''
                        : styles.inputInvalid
                    }`}
                    value={current.freeDeliveryThresholdPaise}
                    disabled={!editable || loading}
                    onChange={(event) =>
                      patch({ freeDeliveryThresholdPaise: num(event.target.value) })
                    }
                  />,
                  <>
                    Baskets at or above <Money value={current.freeDeliveryThresholdPaise} /> ship
                    free
                  </>,
                )}
                {field(
                  'serviceRadiusKm',
                  `${KEY_LABEL.serviceRadiusKm} (km)`,
                  <input
                    id="set-serviceRadiusKm"
                    type="number"
                    min={1}
                    max={50}
                    step={0.5}
                    className={`${styles.input} ${styles.inputNum} ${
                      errors.serviceRadiusKm === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.serviceRadiusKm}
                    disabled={!editable || loading}
                    onChange={(event) =>
                      patch({ serviceRadiusKm: Number.parseFloat(event.target.value) || 0 })
                    }
                  />,
                  'Default for a new vendor. Each store can narrow it.',
                )}
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Commission">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <div className={styles.formGrid}>
                {field(
                  'defaultCommissionPct',
                  `${KEY_LABEL.defaultCommissionPct} (%)`,
                  <input
                    id="set-defaultCommissionPct"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    className={`${styles.input} ${styles.inputNum} ${
                      errors.defaultCommissionPct === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.defaultCommissionPct}
                    disabled={!editable || loading}
                    onChange={(event) =>
                      patch({ defaultCommissionPct: Number.parseFloat(event.target.value) || 0 })
                    }
                  />,
                  'Applied to new vendors only. Existing orders keep the rate snapshotted onto them at creation, so changing this never rewrites history.',
                )}
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Payments">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <div className={styles.formGrid}>
                {field(
                  'codMaxAmountPaise',
                  `${KEY_LABEL.codMaxAmountPaise} (paise)`,
                  <input
                    id="set-codMaxAmountPaise"
                    type="number"
                    min={0}
                    step={1000}
                    className={`${styles.input} ${styles.inputNum} ${
                      errors.codMaxAmountPaise === undefined ? '' : styles.inputInvalid
                    }`}
                    value={current.codMaxAmountPaise}
                    disabled={!editable || loading}
                    onChange={(event) => patch({ codMaxAmountPaise: num(event.target.value) })}
                  />,
                  <>
                    Cash on delivery is refused above <Money value={current.codMaxAmountPaise} />,
                    which caps what a rider carries
                  </>,
                )}
              </div>
            </div>
          </div>
        </AdminSection>

        <AdminSection title="Maintenance mode">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <span className={styles.checkRow}>
                <input
                  id="set-maintenanceMode"
                  type="checkbox"
                  checked={current.maintenanceMode}
                  disabled={!editable || loading}
                  onChange={(event) => patch({ maintenanceMode: event.target.checked })}
                />
                <label htmlFor="set-maintenanceMode" className={styles.label}>
                  {KEY_LABEL.maintenanceMode}
                  <span className={styles.labelHint}>
                    {' '}
                    — customers see a holding page and no new order can be placed. Orders already
                    in flight continue to their end state.
                  </span>
                </label>
              </span>
              {current.maintenanceMode ? (
                <p className={`${styles.fieldError} ${styles.rowWrap}`} role="alert">
                  Maintenance mode is on. The storefront is closed to customers.
                </p>
              ) : null}
            </div>
          </div>
        </AdminSection>
      </div>

      {dirty.length > 0 && editable ? (
        <div className={styles.saveBar} role="region" aria-label="Unsaved changes">
          <span className={styles.saveBarText}>
            {dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}:{' '}
            <span className={styles.strong}>
              {dirty.map((key) => KEY_LABEL[key]).join(', ')}
            </span>
          </span>
          <span className={styles.pushRight} />
          <button type="button" className={styles.btn} onClick={discard} disabled={save.loading}>
            Discard
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={attemptSave}
            disabled={!valid || save.loading}
          >
            {save.loading ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      ) : null}

      {save.error === null || save.error === undefined ? null : (
        <p className={styles.fieldError} role="alert">
          The settings were not saved. Nothing changed — your edits are still in the form.
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Save changes that affect money?"
        body={`This changes ${dirtyMoney
          .map((key) => KEY_LABEL[key])
          .join(', ')}. It takes effect on the very next order — no deploy, no delay. Existing orders keep the commission rate snapshotted onto them at creation.`}
        confirmLabel="Save"
        destructive
        loading={save.loading}
        onConfirm={() => {
          void submit();
        }}
        onCancel={() => setConfirming(false)}
      />
    </AdminPage>
  );
}
