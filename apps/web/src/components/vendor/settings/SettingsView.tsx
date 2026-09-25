'use client';

/**
 * Store settings — the screen a vendor touches twice a year, which is exactly
 * why it has to be forgiving.
 *
 * ── ★ TWO ENDPOINTS, NOT ONE ────────────────────────────────────────────────
 * The profile and the opening hours are separate writes, because the API keeps
 * them separate:
 *
 *     PUT /vendor/profile      → UpdateStoreProfileDto
 *     PUT /vendor/store/hours  → UpdateStoreHoursDto  ({ hours: [...] })
 *
 * `UpdateStoreProfileDto` does NOT accept `openingHours`, and with
 * `forbidNonWhitelisted: true` sending it is a 400 that rejects the WHOLE
 * save — address, radius and COD cap included. This screen used to post one
 * combined body and could therefore never save anything at all.
 *
 * Hours are a full REPLACEMENT, not a merge: partial hour updates are how a
 * store ends up advertising two overlapping Tuesday windows.
 *
 * ── ★ DIRTY-STATE TRACKING ──────────────────────────────────────────────────
 * Nothing saves as you type. The form holds a draft, compares it field by field
 * with what the server returned, and a save/discard dock appears only once
 * something genuinely differs — naming the fields, so "3 changes" can be
 * checked before it is committed.
 *
 * Two reasons this is not auto-save:
 *   1. A half-typed pincode is a valid string and an invalid pincode. Saving on
 *      every keystroke means the shop is briefly unreachable at "16002".
 *   2. Opening hours and a delivery radius are the sort of thing a person
 *      fiddles with to see what it looks like. There has to be a way back, and
 *      "Discard" is it.
 *
 * `beforeunload` is wired to the same dirty flag, so closing the tab mid-edit
 * asks first.
 *
 * ── WHAT IS READ-ONLY, AND WHY IT IS SHOWN ANYWAY ───────────────────────────
 * Commission and approval status are set by the platform, not the shop. They
 * are on screen because a vendor who cannot see their commission rate cannot
 * check their own payouts — but they are plainly marked as not editable here
 * rather than being omitted and quietly wondered about.
 *
 * The store's rating is shown as a number and nothing else. The API sends
 * `rating`; it does not send a vote count, and printing one would be inventing
 * it.
 */

import { useEffect, useMemo, useState } from 'react';
import { AdminPage, AdminSection, ConfirmDialog, Money } from '@/components/admin';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import type {
  OpeningHour,
  VendorHoursUpdate,
  VendorProfile,
  VendorProfileUpdate,
} from '@/lib/vendor/types';
import { EndpointError, Field, RupeeInput } from '../primitives';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Exactly the editable slice of the profile, with hours alongside it. */
interface Draft {
  storeName: string;
  description: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
  };
  location: { lat: number; lng: number };
  serviceRadiusKm: number;
  codEnabled: boolean;
  codMaxAmount: number;
  /** Written through `PUT /vendor/store/hours`, never through the profile. */
  openingHours: OpeningHour[];
}

function toDraft(profile: VendorProfile): Draft {
  return {
    storeName: profile.storeName,
    // `description` and `line2` are nullable on the wire and must be strings
    // in a controlled input — React logs a warning and drops the caret the
    // moment an input's value goes from null to a string.
    description: profile.description ?? '',
    address: {
      line1: profile.address.line1,
      line2: profile.address.line2 ?? '',
      city: profile.address.city,
      state: profile.address.state,
      pincode: profile.address.pincode,
    },
    location: { lat: profile.location.lat, lng: profile.location.lng },
    serviceRadiusKm: profile.serviceRadiusKm,
    codEnabled: profile.codEnabled,
    codMaxAmount: profile.codMaxAmount,
    openingHours: profile.openingHours.map((hour) => ({ ...hour })),
  };
}

/** The list of what actually differs — so the dock can name it, not just count it. */
function diffOf(draft: Draft, original: Draft): string[] {
  const changed: string[] = [];
  if (draft.storeName !== original.storeName) changed.push('store name');
  if (draft.description !== original.description) changed.push('description');
  if (JSON.stringify(draft.address) !== JSON.stringify(original.address)) changed.push('address');
  if (
    draft.location.lat !== original.location.lat ||
    draft.location.lng !== original.location.lng
  ) {
    changed.push('map position');
  }
  if (draft.serviceRadiusKm !== original.serviceRadiusKm) changed.push('delivery radius');
  if (draft.codEnabled !== original.codEnabled) changed.push('cash on delivery');
  if (draft.codMaxAmount !== original.codMaxAmount) changed.push('COD cap');
  if (JSON.stringify(draft.openingHours) !== JSON.stringify(original.openingHours)) {
    changed.push('opening hours');
  }
  return changed;
}

/** Everything except the hours — that is a different endpoint. */
function toProfileBody(draft: Draft): VendorProfileUpdate {
  return {
    storeName: draft.storeName.trim(),
    // The validator is `/^.{0,1000}$/s`, so an empty description is legal —
    // but `null` is not a string and would be rejected.
    description: draft.description,
    address: {
      line1: draft.address.line1.trim(),
      // `line2` is optional; omitted rather than sent blank when there is none.
      ...(draft.address.line2.trim() === '' ? {} : { line2: draft.address.line2.trim() }),
      city: draft.address.city.trim(),
      state: draft.address.state.trim(),
      pincode: draft.address.pincode.trim(),
    },
    location: draft.location,
    // `serviceRadiusKm` is @IsInt() with min 1 and max 25. A 4.5 km radius is
    // a 400, so the control below steps in whole kilometres.
    serviceRadiusKm: Math.min(25, Math.max(1, Math.round(draft.serviceRadiusKm))),
    codEnabled: draft.codEnabled,
    codMaxAmount: draft.codMaxAmount,
  };
}

export function SettingsView() {
  const profile = useVendorQuery<VendorProfile>('/vendor/profile');
  const saveProfile = useVendorMutation<VendorProfileUpdate, VendorProfile>(
    '/vendor/profile',
    'PUT',
  );
  const saveHours = useVendorMutation<VendorHoursUpdate, VendorProfile>(
    '/vendor/store/hours',
    'PUT',
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const original = useMemo(() => (profile.data ? toDraft(profile.data) : null), [profile.data]);

  // Seed once per server payload. Re-seeding on every render would throw away
  // whatever the vendor is in the middle of typing on each refetch.
  useEffect(() => {
    if (original) setDraft(original);
  }, [original]);

  const changes = draft && original ? diffOf(draft, original) : [];
  const dirty = changes.length > 0;

  /* ---- the browser's own guard ---- */
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome ignores custom strings, but assigning returnValue is still what
      // triggers the native prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (profile.error && !profile.data) {
    return (
      <AdminPage title="Store settings" description="Your shop's profile could not be loaded.">
        <EndpointError
          path="/vendor/profile"
          message={profile.error.friendlyMessage}
          status={profile.error.status}
          onRetry={profile.refetch}
        />
      </AdminPage>
    );
  }

  if (!draft || !profile.data || !original) {
    return (
      <AdminPage title="Store settings" description="Loading your shop's profile…">
        <div className="adm-skel adm-skel--chart" aria-busy="true" />
      </AdminPage>
    );
  }

  const server = profile.data;
  const saving = saveProfile.loading || saveHours.loading;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  const setHour = (index: number, patch: Partial<OpeningHour>) => {
    setDraft({
      ...draft,
      openingHours: draft.openingHours.map((hour, i) =>
        i === index ? { ...hour, ...patch } : hour,
      ),
    });
  };

  /** A day with no row is a day the shop does not open. There is no flag. */
  const removeDay = (index: number) => {
    setDraft({
      ...draft,
      openingHours: draft.openingHours.filter((_, i) => i !== index),
    });
  };

  const addDay = (day: number) => {
    setDraft({
      ...draft,
      openingHours: [...draft.openingHours, { day, open: '09:00', close: '21:00' }].sort(
        (a, b) => a.day - b.day,
      ),
    });
  };

  const missingDays = DAYS.map((_, day) => day).filter(
    (day) => !draft.openingHours.some((hour) => hour.day === day),
  );

  /**
   * Save the two halves independently, hours last.
   *
   * Only what actually changed is sent. If the hours failed and the profile
   * succeeded the screen says so rather than claiming a clean save — a
   * settings page that reports success over a half-applied write is how a shop
   * ends up open at hours it never set.
   */
  const onSave = async () => {
    setFailure(null);
    const profileChanged = changes.some((change) => change !== 'opening hours');
    const hoursChanged = changes.includes('opening hours');

    if (profileChanged) {
      const result = await saveProfile.mutate(toProfileBody(draft), {
        invalidate: ['/vendor/profile', '/vendor/dashboard'],
        onError: (error) => setFailure(error.friendlyMessage),
      });
      if (result === null) return;
    }

    if (hoursChanged) {
      await saveHours.mutate(
        { hours: draft.openingHours },
        {
          invalidate: ['/vendor/profile', '/vendor/dashboard'],
          onError: (error) =>
            setFailure(
              profileChanged
                ? `The profile saved, but the opening hours did not: ${error.friendlyMessage}`
                : error.friendlyMessage,
            ),
        },
      );
    }
  };

  const pincodeValid = /^\d{6}$/.test(draft.address.pincode);
  const latValid = draft.location.lat >= -90 && draft.location.lat <= 90;
  const lngValid = draft.location.lng >= -180 && draft.location.lng <= 180;
  const canSave = pincodeValid && latValid && lngValid && draft.storeName.trim().length >= 2;

  return (
    <AdminPage
      title="Store settings"
      description="Profile, where you are, when you open, and how you take money."
      isFixture={profile.isFixture}
      fixturePaths={profile.isFixture ? ['/vendor/profile'] : undefined}
    >
      {failure ? (
        <div className="adm-fixture" role="alert" style={{ marginBottom: 'var(--s-3)' }}>
          <div>
            <p className="adm-fixture__title">Not everything was saved</p>
            <p className="adm-fixture__body">{failure}</p>
          </div>
        </div>
      ) : null}

      <div className="adm-grid adm-grid--split">
        <div className="adm-stack">
          {/* ------------------------------------------ profile ---- */}
          <AdminSection title="Profile" description="What customers see at the top of your shop.">
            <div className="ven-form">
              <Field
                label="Store name"
                error={draft.storeName.trim().length < 2 ? 'At least two characters.' : undefined}
              >
                {(id) => (
                  <input
                    id={id}
                    className="ven-input"
                    value={draft.storeName}
                    onChange={(event) => set('storeName', event.target.value)}
                    maxLength={120}
                  />
                )}
              </Field>

              <Field
                label="Description"
                hint="One or two lines. This is the first thing a new customer reads about you."
              >
                {(id) => (
                  <textarea
                    id={id}
                    className="ven-textarea"
                    value={draft.description}
                    onChange={(event) => set('description', event.target.value)}
                    maxLength={1000}
                  />
                )}
              </Field>

              {/*
                There is no shop phone here, and that is not an omission. The
                store profile carries no phone field — the contact number lives
                on the owner's User account, which this panel does not edit.
              */}
            </div>
          </AdminSection>

          {/* ------------------------------------------ address ---- */}
          <AdminSection
            title="Address and map position"
            description="The address is for the rider to read. The coordinates are what the app actually searches on."
          >
            <div className="ven-form">
              <Field label="Address line 1">
                {(id) => (
                  <input
                    id={id}
                    className="ven-input"
                    value={draft.address.line1}
                    onChange={(event) =>
                      set('address', { ...draft.address, line1: event.target.value })
                    }
                    maxLength={160}
                  />
                )}
              </Field>

              <Field label="Address line 2" hint="Optional.">
                {(id) => (
                  <input
                    id={id}
                    className="ven-input"
                    value={draft.address.line2}
                    onChange={(event) =>
                      set('address', { ...draft.address, line2: event.target.value })
                    }
                    maxLength={160}
                  />
                )}
              </Field>

              <div className="ven-form__row">
                <Field label="City">
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      value={draft.address.city}
                      onChange={(event) =>
                        set('address', { ...draft.address, city: event.target.value })
                      }
                      maxLength={80}
                    />
                  )}
                </Field>
                <Field label="State">
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      value={draft.address.state}
                      onChange={(event) =>
                        set('address', { ...draft.address, state: event.target.value })
                      }
                      maxLength={80}
                    />
                  )}
                </Field>
                <Field label="Pincode" error={pincodeValid ? undefined : 'Six digits, no spaces.'}>
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      inputMode="numeric"
                      value={draft.address.pincode}
                      onChange={(event) =>
                        set('address', { ...draft.address, pincode: event.target.value })
                      }
                      maxLength={6}
                    />
                  )}
                </Field>
              </div>

              <div className="ven-form__row">
                <Field label="Latitude" hint="−90 to 90" error={latValid ? undefined : 'Out of range.'}>
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      type="number"
                      step="0.000001"
                      value={draft.location.lat}
                      onChange={(event) =>
                        set('location', {
                          ...draft.location,
                          lat: Number(event.target.value),
                        })
                      }
                    />
                  )}
                </Field>
                <Field
                  label="Longitude"
                  hint="−180 to 180"
                  error={lngValid ? undefined : 'Out of range.'}
                >
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      type="number"
                      step="0.000001"
                      value={draft.location.lng}
                      onChange={(event) =>
                        set('location', {
                          ...draft.location,
                          lng: Number(event.target.value),
                        })
                      }
                    />
                  )}
                </Field>
                <Field
                  label="Delivery radius (km)"
                  hint="Whole kilometres, 1 to 25. Customers beyond this never see your shop."
                >
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      type="number"
                      min={1}
                      max={25}
                      step="1"
                      value={draft.serviceRadiusKm}
                      onChange={(event) =>
                        set(
                          'serviceRadiusKm',
                          Math.min(25, Math.max(1, Math.round(Number(event.target.value) || 1))),
                        )
                      }
                    />
                  )}
                </Field>
              </div>

              <p className="ven-note">
                The API takes and returns plain <code>{'{ lat, lng }'}</code> and converts to
                GeoJSON at its own boundary. The two boxes above are labelled the human way round
                and travel that way too — there is no coordinate swap to get wrong here.
              </p>
            </div>
          </AdminSection>

          {/* -------------------------------------------- hours ---- */}
          <AdminSection
            title="Opening hours"
            description="Orders are only accepted inside these windows, on top of the open/closed switch in the top bar. A day with no row is a day you do not open."
          >
            <div className="ven-hours">
              {draft.openingHours.map((hour, index) => (
                <div className="ven-hours__row" key={`${hour.day}-${index}`} data-closed="false">
                  <span className="ven-hours__day">{DAYS[hour.day] ?? `Day ${hour.day}`}</span>
                  <input
                    className="ven-time"
                    type="time"
                    value={hour.open}
                    onChange={(event) => setHour(index, { open: event.target.value })}
                    aria-label={`${DAYS[hour.day] ?? ''} opening time`}
                  />
                  <input
                    className="ven-time"
                    type="time"
                    value={hour.close}
                    onChange={(event) => setHour(index, { close: event.target.value })}
                    aria-label={`${DAYS[hour.day] ?? ''} closing time`}
                  />
                  <button
                    type="button"
                    className="adm-btn adm-btn--sm adm-btn--ghost"
                    onClick={() => removeDay(index)}
                  >
                    Closed all day
                  </button>
                </div>
              ))}

              {draft.openingHours.length === 0 ? (
                <p className="ven-note">
                  No opening hours set — your shop is treated as closed every day.
                </p>
              ) : null}

              {missingDays.length > 0 ? (
                <div className="adm-row" style={{ flexWrap: 'wrap', gap: 'var(--s-2)' }}>
                  {missingDays.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className="adm-btn adm-btn--sm"
                      onClick={() => addDay(day)}
                    >
                      Open on {DAYS[day]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </AdminSection>
        </div>

        {/* ---------------------------------------------- side ---- */}
        <div className="adm-stack">
          <AdminSection title="Cash on delivery" description="Who carries the risk, and up to what.">
            <div className="ven-form">
              <label className="ven-switch">
                <input
                  type="checkbox"
                  checked={draft.codEnabled}
                  onChange={(event) => set('codEnabled', event.target.checked)}
                />
                <span>
                  <strong>Accept cash on delivery</strong>
                </span>
              </label>

              <Field
                label="Maximum COD order (₹)"
                hint="Above this, the customer has to pay online. The platform ceiling is ₹2,000. A cash order that is refused at the door costs you the delivery and the stock."
                error={draft.codMaxAmount > 200000 ? 'The platform caps this at ₹2,000.' : undefined}
              >
                {(id) => (
                  <RupeeInput
                    id={id}
                    value={draft.codMaxAmount}
                    onChange={(paise) => set('codMaxAmount', Math.min(200000, Math.max(0, paise)))}
                    disabled={!draft.codEnabled}
                  />
                )}
              </Field>
            </div>
          </AdminSection>

          <AdminSection
            title="Set by Mandi"
            description="Platform settings. Visible here so you can check your own payouts — changed only by an admin."
            panel
          >
            <div className="adm-panel--pad">
              <dl className="adm-dl">
                <dt>Commission</dt>
                <dd className="adm-num">{server.commissionPct}%</dd>
                <dt>Approval</dt>
                <dd>{server.status}</dd>
                <dt>Rating</dt>
                {/*
                  `rating` and nothing else. There is no vote count on this
                  payload — reading one is what used to crash the dashboard.
                */}
                <dd className="adm-num">
                  {server.rating > 0 ? `${server.rating.toFixed(1)} ★` : 'not rated yet'}
                </dd>
                <dt>Shop URL</dt>
                <dd>
                  <code>/store/{server.slug}</code>
                </dd>
                <dt>COD cap</dt>
                <dd>
                  <Money value={draft.codMaxAmount} />
                </dd>
              </dl>
            </div>
          </AdminSection>
        </div>
      </div>

      {/* ------------------------------------------- dirty bar ---- */}
      {dirty ? (
        <div className="ven-dirty" role="status">
          <span className="ven-dirty__text">
            Unsaved changes
            <span className="ven-dirty__count"> · {changes.join(', ')}</span>
          </span>
          <span className="ven-dirty__actions">
            <button type="button" className="adm-btn" onClick={() => setConfirmDiscard(true)}>
              Discard
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              disabled={saving || !canSave}
              title={canSave ? undefined : 'Fix the highlighted fields first.'}
              onClick={() => {
                void onSave();
              }}
            >
              {saving
                ? 'Saving…'
                : `Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`}
            </button>
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDiscard}
        destructive
        title="Discard your changes?"
        confirmLabel="Discard"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setDraft(original);
          setFailure(null);
          setConfirmDiscard(false);
        }}
        body={<p>{changes.join(', ')} will go back to what the server has.</p>}
      />
    </AdminPage>
  );
}
