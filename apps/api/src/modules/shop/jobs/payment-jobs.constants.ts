/**
 * ════════════════════════════════════════════════════════════════════════
 *  PAYMENT SWEEP TUNABLES
 * ════════════════════════════════════════════════════════════════════════
 *
 * Gathered in one file for the same reason
 * `modules/delivery/delivery.constants.ts` is: a change is one diff, not
 * a hunt through two services. Nothing secret lives here — these are
 * business/operational numbers straight from §8.2 and §8.3.
 */

/**
 * An ONLINE order still `payment.status: pending` this long after
 * `placedAt` has its reservation released (§8.2). Before releasing, the
 * sweeper makes one best-effort live check against the gateway — see
 * `stock-release-sweeper.service.ts` for why that is a safe addition to,
 * not a deviation from, the 15-minute deadline in the plan.
 */
export const PAYMENT_PENDING_RELEASE_MS = 15 * 60 * 1000;

/** How often the release sweeper looks for orders past that deadline. */
export const STOCK_RELEASE_SWEEP_INTERVAL_MS = 60 * 1000;

/** At most this many orders released per tick, so a backlog cannot stall. */
export const STOCK_RELEASE_SWEEP_BATCH = 50;

/**
 * §8.3's reconciliation threshold: an order pending longer than this is
 * checked directly against the gateway. Deliberately LATER than
 * `PAYMENT_PENDING_RELEASE_MS` — by the time an order reaches 20 minutes
 * pending, the release sweeper above should already have resolved it one
 * way or the other. This sweep is the backstop for the case where that
 * did not happen (the process was down, the sweeper threw, a webhook
 * handler swallowed an error to keep answering Razorpay 200 — see
 * `payments.service.ts`), not a step in the normal timeline.
 */
export const PAYMENT_RECONCILE_AFTER_MS = 20 * 60 * 1000;

/** The reconciliation sweep itself runs this often. */
export const PAYMENT_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

/** At most this many orders reconciled per tick. */
export const PAYMENT_RECONCILE_BATCH = 25;
