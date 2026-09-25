'use client';

/**
 * Store settings — the screen a vendor touches twice a year, which is exactly
 * why it has to be forgiving.
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
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  Money,
} from '@/components/admin';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import type { OpeningHour, VendorProfile, VendorProfileUpdate } from '@/lib/vendor/types';
import { EndpointError, Field, RupeeInput } from '../primitives';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Draft = VendorProfileUpdate;

function toDraft(profile: VendorProfile): Draft {
  return {
    storeName: profile.storeName,
    description: profile.description,
    logoUrl: profile.logoUrl,
    bannerUrl: profile.bannerUrl,
    phone: profile.phone,
    address: { ...profile.address },
    location: {
      type: 'Point',
      coordinates: [profile.location.coordinates[0], profile.location.coordinates[1]],
    },
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
  if (draft.phone !== original.phone) changed.push('phone');
  if (JSON.stringify(draft.address) !== JSON.stringify(original.address)) changed.push('address');
  if (
    draft.location.coordinates[0] !== original.location.coordinates[0] ||
    draft.location.coordinates[1] !== original.location.coordinates[1]
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

export function SettingsView() {
  const profile = useVendorQuery<VendorProfile>('/vendor/profile');
  const save = useVendorMutation<Draft, VendorProfile>('/vendor/profile', 'PUT');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const original = useMemo(
    () => (profile.data ? toDraft(profile.data) : null),
    [profile.data],
  );

  // Seed once per server payload. Re-seeding on every render would throw away
  // whatever the vendor is in the middle of typing on each 20s refetch.
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
          onRetry={profile.refetch}
        />
      </AdminPage>
    );
  }

  if (!draft || !profile.data) {
    return (
      <AdminPage title="Store settings" description="Loading your shop's profile…">
        <div className="adm-skel adm-skel--chart" aria-busy="true" />
      </AdminPage>
    );
  }

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

  const [lng, lat] = draft.location.coordinates;

  return (
    <AdminPage
      title="Store settings"
      description="Profile, where you are, when you open, and how you take money."
      isFixture={profile.isFixture}
      fixturePaths={profile.isFixture ? ['/vendor/profile'] : undefined}
    >
      {save.error ? (
        <div className="adm-fixture" role="alert" style={{ marginBottom: 'var(--s-3)' }}>
          <div>
            <p className="adm-fixture__title">Nothing was saved</p>
            <p className="adm-fixture__body">{save.error.friendlyMessage}</p>
          </div>
        </div>
      ) : null}

      <div className="adm-grid adm-grid--split">
        <div className="adm-stack">
          {/* ------------------------------------------ profile ---- */}
          <AdminSection title="Profile" description="What customers see at the top of your shop.">
            <div className="ven-form">
              <Field label="Store name">
                {(id) => (
                  <input
                    id={id}
                    className="ven-input"
                    value={draft.storeName}
                    onChange={(event) => set('storeName', event.target.value)}
                    maxLength={80}
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
                    maxLength={400}
                  />
                )}
              </Field>

              <Field label="Shop phone" hint="Used by riders and by support. Not shown publicly.">
                {(id) => (
                  <input
                    id={id}
                    className="ven-input"
                    type="tel"
                    value={draft.phone}
                    onChange={(event) => set('phone', event.target.value)}
                    maxLength={16}
                  />
                )}
              </Field>
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
                  />
                )}
              </Field>

              <Field label="Address line 2">
                {(id) => (
                  <input
                    id={id}
                    className="ven-input"
                    value={draft.address.line2 ?? ''}
                    onChange={(event) =>
                      set('address', { ...draft.address, line2: event.target.value })
                    }
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
                    />
                  )}
                </Field>
                <Field
                  label="Pincode"
                  error={
                    /^\d{6}$/.test(draft.address.pincode) ? undefined : 'Six digits, no spaces.'
                  }
                >
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
                <Field
                  label="Latitude"
                  hint="−90 to 90"
                  error={lat < -90 || lat > 90 ? 'Out of range.' : undefined}
                >
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      type="number"
                      step="0.000001"
                      value={lat}
                      onChange={(event) =>
                        set('location', {
                          type: 'Point',
                          coordinates: [lng, Number(event.target.value)],
                        })
                      }
                    />
                  )}
                </Field>
                <Field
                  label="Longitude"
                  hint="−180 to 180"
                  error={lng < -180 || lng > 180 ? 'Out of range.' : undefined}
                >
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      type="number"
                      step="0.000001"
                      value={lng}
                      onChange={(event) =>
                        set('location', {
                          type: 'Point',
                          coordinates: [Number(event.target.value), lat],
                        })
                      }
                    />
                  )}
                </Field>
                <Field
                  label="Delivery radius (km)"
                  hint="Customers beyond this never see your shop."
                >
                  {(id) => (
                    <input
                      id={id}
                      className="ven-input"
                      data-num="true"
                      type="number"
                      min={0.5}
                      max={25}
                      step="0.5"
                      value={draft.serviceRadiusKm}
                      onChange={(event) =>
                        set('serviceRadiusKm', Number(event.target.value) || 0)
                      }
                    />
                  )}
                </Field>
              </div>

              <p className="ven-note">
                Stored as GeoJSON — <code>[longitude, latitude]</code>, in that order. The two
                boxes above are labelled the human way round; the swap happens once, here, which
                is why a shop in Chandigarh has never ended up in the Indian Ocean.
              </p>
            </div>
          </AdminSection>

          {/* -------------------------------------------- hours ---- */}
          <AdminSection
            title="Opening hours"
            description="Orders are only accepted inside these windows, on top of the open/closed switch in the top bar."
          >
            <div className="ven-hours">
              {draft.openingHours.map((hour, index) => (
                <div
                  className="ven-hours__row"
                  key={`${hour.day}-${index}`}
                  data-closed={hour.closed ? 'true' : 'false'}
                >
                  <span className="ven-hours__day">{DAYS[hour.day] ?? `Day ${hour.day}`}</span>
                  <input
                    className="ven-time"
                    type="time"
                    value={hour.open}
                    disabled={hour.closed === true}
                    onChange={(event) => setHour(index, { open: event.target.value })}
                    aria-label={`${DAYS[hour.day] ?? ''} opening time`}
                  />
                  <input
                    className="ven-time"
                    type="time"
                    value={hour.close}
                    disabled={hour.closed === true}
                    onChange={(event) => setHour(index, { close: event.target.value })}
                    aria-label={`${DAYS[hour.day] ?? ''} closing time`}
                  />
                  <label className="ven-switch">
                    <input
                      type="checkbox"
                      checked={hour.closed === true}
                      onChange={(event) => setHour(index, { closed: event.target.checked })}
                    />
                    <span>Closed all day</span>
                  </label>
                </div>
              ))}
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
                hint="Above this, the customer has to pay online. A cash order that is refused at the door costs you the delivery and the stock."
              >
                {(id) => (
                  <RupeeInput
                    id={id}
                    value={draft.codMaxAmount}
                    onChange={(paise) => set('codMaxAmount', paise)}
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
                <dd className="adm-num">{profile.data.commissionPct}%</dd>
                <dt>Approval</dt>
                <dd>{profile.data.status}</dd>
                <dt>Rating</dt>
                <dd className="adm-num">
                  {profile.data.rating.toFixed(1)} ★ from{' '}
                  {profile.data.ratingCount.toLocaleString('en-IN')}
                </dd>
                <dt>Shop URL</dt>
                <dd>
                  <code>/store/{profile.data.slug}</code>
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
              disabled={save.loading}
              onClick={() =>
                void save.mutate(draft, {
                  invalidate: ['/vendor/profile'],
                })
              }
            >
              {save.loading ? 'Saving…' : `Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`}
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
          if (original) setDraft(original);
          setConfirmDiscard(false);
        }}
        body={<p>{changes.join(', ')} will go back to what the server has.</p>}
      />
    </AdminPage>
  );
}
