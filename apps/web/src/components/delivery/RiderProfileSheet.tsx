'use client';

/**
 * ★ Who is signed in, and the way out.
 *
 * Opened from the header, covering the screen. It is a sheet rather than a
 * fifth nav tab on purpose: the dock has four slots and a rider needs every
 * one of them for the job, while "who am I signed in as" is something they
 * look at roughly never — until the moment it matters, when it must be
 * findable in one tap.
 *
 * ── WHAT IS ON IT ───────────────────────────────────────────────────────────
 *   the signed-in name, the phone, the vehicle, a DELIVERY role pill,
 *   today's deliveries and today's earnings, and Sign out.
 *
 * Everything but the role pill comes from `GET /delivery/me`. Nothing is
 * invented: when the profile has not loaded, the sheet says so and still
 * offers the way out — a rider who cannot reach the API is exactly the rider
 * who most needs to be able to sign out of a handset.
 *
 * ── SIGN OUT IS DELIBERATE ──────────────────────────────────────────────────
 * Two taps, never one, and the confirm names the consequence. A rider who
 * signs out by a mis-tap mid-delivery is a real operational problem: the job
 * stays assigned to them server-side while they stand in the street unable to
 * see the address. So when a delivery IS in progress the confirm says that
 * explicitly, in the crit tone, before the button that does it.
 *
 * The sign-out itself is `AuthProvider.logout()` — `POST /auth/logout`, which
 * revokes the whole refresh-token family server-side, then clears the
 * in-memory access token. It clears the client EVEN IF the POST fails, because
 * leaving a live token in memory on a handset someone is handing back is worse
 * than a stale server session that expires on its own.
 *
 * Touch targets are 64px and the destructive action sits at the BOTTOM, in the
 * thumb, alone.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from './delivery.module.css';
import { IconExit, IconUser, IconX } from './icons';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRider } from './RiderProvider';
import { money, telHref } from '@/lib/delivery/format';
import { VEHICLE_LABEL } from '@/lib/delivery/types';
import { APP_NAME } from '@/config/brand';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.profileRow}>
      <span className={styles.profileRowLabel}>{label}</span>
      <span className={styles.profileRowValue}>{value}</span>
    </div>
  );
}

export function RiderProfileSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { logout } = useAuth();
  const { profile, activeOrder, jobIsSample } = useRider();

  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const midDelivery = activeOrder !== null && !jobIsSample;
  const tel = telHref(profile?.phone);

  const signOut = useCallback(() => {
    if (signingOut) return;
    setSigningOut(true);
    // `logout()` never rejects — it clears the client in a `finally`. The
    // redirect is unconditional for the same reason: whatever the network did,
    // this handset no longer holds a session.
    void logout().finally(() => {
      router.replace('/login');
    });
  }, [logout, router, signingOut]);

  return (
    <div className={styles.profileSheet} role="dialog" aria-modal="true" aria-label="Your account">
      <div className={styles.profileScroll}>
        <div className={styles.profileHead}>
          <span className={styles.profileMark} aria-hidden="true">
            <IconUser size={28} />
          </span>
          <div className={styles.profileWho}>
            <h1 className={styles.profileName}>
              {profile === null || profile.name === '' ? 'Signed in' : profile.name}
            </h1>
            <span className={styles.rolePill}>DELIVERY</span>
          </div>
          <button
            type="button"
            className={styles.profileClose}
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={24} />
          </button>
        </div>

        {profile === null ? (
          <p className={styles.lede}>
            Your profile has not loaded. You can still sign out below.
          </p>
        ) : (
          <>
            <section className={styles.panel}>
              {profile.phone === '' ? (
                <Row label="Phone" value="—" />
              ) : tel === null ? (
                <Row label="Phone" value={profile.phone} />
              ) : (
                <div className={styles.profileRow}>
                  <span className={styles.profileRowLabel}>Phone</span>
                  <a className={styles.profileRowValue} href={tel}>
                    {profile.phone}
                  </a>
                </div>
              )}
              <Row label="Vehicle" value={VEHICLE_LABEL[profile.vehicleType]} />
              <Row
                label="Account"
                value={
                  profile.status === 'active'
                    ? 'Active'
                    : profile.status === 'pending'
                      ? 'Pending approval'
                      : 'Suspended'
                }
              />
              <Row
                label="Fleet"
                value={profile.vendorId === null ? `${APP_NAME} platform pool` : 'Store fleet'}
              />
              <Row label="Lifetime deliveries" value={String(profile.completedCount)} />
            </section>

            <div className={styles.summaryGrid}>
              <div className={styles.summaryTile}>
                <div className={styles.summaryValue}>{profile.today.deliveries}</div>
                <div className={styles.summaryLabel}>Deliveries today</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryValue}>
                  {money(profile.today.earningsPaise)}
                </div>
                <div className={styles.summaryLabel}>Earned today</div>
              </div>
            </div>
          </>
        )}

        {confirming ? (
          <div
            className={`${styles.banner} ${midDelivery ? styles.bannerCrit : ''}`}
            role="alert"
          >
            <div>
              <strong className={styles.bannerTitle}>Sign out of this phone?</strong>
              {midDelivery
                ? 'You are carrying a delivery. Signing out does not hand it back — the order stays assigned to you, and you will not be able to see the address or confirm the code until you sign in again.'
                : 'You will stop receiving offers on this phone until you sign in again.'}
            </div>
          </div>
        ) : null}
      </div>

      {/* The one action, at the bottom, in the thumb. */}
      <div className={styles.dock}>
        {confirming ? (
          <div className={styles.choiceRow}>
            <button
              type="button"
              className={styles.decline}
              onClick={() => setConfirming(false)}
              disabled={signingOut}
            >
              Stay
            </button>
            <button
              type="button"
              className={`${styles.primary} ${styles.primaryCrit}`}
              onClick={signOut}
              disabled={signingOut}
            >
              <IconExit size={24} />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.signOut}
            onClick={() => setConfirming(true)}
          >
            <IconExit size={24} /> Sign out
          </button>
        )}
      </div>
    </div>
  );
}
