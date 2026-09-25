/**
 * ════════════════════════════════════════════════════════════════════════
 *  DELIVERY TUNABLES
 * ════════════════════════════════════════════════════════════════════════
 *
 * Operational numbers, gathered in one file so a change is one diff and
 * one review rather than a hunt through five services.
 *
 * NOTHING SECRET LIVES HERE. These are business constants — visible,
 * wrong in an obvious way if wrong at all — which is precisely the
 * distinction §4.1 draws between a default and a fallback credential.
 */

/** An offer is live for 45 seconds, then the next rider gets it (§8.5). */
export const OFFER_TTL_MS = 45_000;

/**
 * After this many riders have declined or ignored an order, the algorithm
 * stops and a human is told. Looping forever produces an order that is
 * "being assigned" for an hour while nobody is looking at it.
 */
export const MAX_ASSIGNMENT_ATTEMPTS = 3;

/**
 * How often the sweeper looks for expired offers.
 *
 * Five seconds: an offer is 45 seconds long, so the worst-case extra wait
 * is ~11% of one attempt, and the query is a single indexed
 * `findOneAndUpdate` on `{ expiresAt: 1 }`.
 */
export const SWEEP_INTERVAL_MS = 5_000;

/** One tick claims at most this many expiries, so a backlog cannot stall. */
export const SWEEP_BATCH = 25;

/**
 * Proof-of-delivery OTP attempts before the delivery is LOCKED.
 *
 * A 4-digit OTP is 10,000 possibilities. Unlimited attempts is a rider
 * with a phone and two minutes marking someone else's order delivered, so
 * the fifth failure ends the rider's ability to complete it at all and
 * requires the console.
 */
export const MAX_OTP_ATTEMPTS = 5;

// ── Rider payout ────────────────────────────────────────────────────────
//
// INTEGER PAISE, both of them. The payout is DERIVED, never stored on the
// order: it is a pure function of the pickup→drop distance, which itself
// comes from two stored 2dsphere points. That keeps `GET /delivery/offers`
// and `GET /delivery/earnings` in agreement by construction — a rider who
// is shown Rs 42 on the offer is paid Rs 42 in the statement.

/** Flat component of every delivery. Rs 20.00. */
export const PAYOUT_BASE_PAISE = 2_000;

/** Distance component. Rs 5.00 per kilometre, pickup to drop. */
export const PAYOUT_PER_KM_PAISE = 500;

/** Riders in city traffic. Used for every ETA the platform quotes. */
export const AVERAGE_SPEED_KMPH = 18;

/** Handover, lifts, finding the door. Added to every ETA. */
export const ETA_FIXED_MINUTES = 4;

/**
 * Location pings accepted per rider per minute.
 *
 * The handset sends one every ten seconds (§6.2), so six is the expected
 * rate and thirty is generous headroom for a retrying client — while
 * still being three orders of magnitude below what it would take to write
 * a meaningful amount of rubbish into `location_pings`.
 */
export const LOCATION_PING_LIMIT_PER_MINUTE = 30;
