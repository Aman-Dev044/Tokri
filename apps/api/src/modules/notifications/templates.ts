import { NotificationType } from '../../database/schemas/notification.schema';

/** What `notify()` needs beyond the target user: type, title, body, data. */
export interface NotificationEvent {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  TEMPLATES — order placed, accepted, ready, out for delivery, delivered,
 *  cancelled, refunded
 * ════════════════════════════════════════════════════════════════════════
 *
 * Pure functions: `orderNo` and (where relevant) an amount in, an
 * `NotificationEvent` out. Nothing here reads a database or calls a
 * service, so they are trivially unit-testable and trivially safe —
 * there is no code path by which one of these could end up interpolating
 * an OTP, a password or a token, because none of them accept one as an
 * argument.
 *
 * Wiring these into the order/checkout/vendor-order lifecycle (calling
 * `NotificationsService.notify()` at each transition) is deliberately
 * NOT done here: that touches `shop/checkout`, `shop/orders` and
 * `vendor/orders`, none of which are in this task's scope, and two of
 * those areas have other work in flight concurrently. This file is the
 * ready-to-call surface for whoever wires it up next.
 */
export const NotificationTemplates = {
  orderPlaced(orderNo: string): NotificationEvent {
    return {
      type: NotificationType.ORDER_PLACED,
      title: 'Order placed',
      body: `Your order ${orderNo} has been placed and is waiting for the store to accept it.`,
      data: { orderNo },
    };
  },

  orderAccepted(orderNo: string): NotificationEvent {
    return {
      type: NotificationType.ORDER_ACCEPTED,
      title: 'Order accepted',
      body: `The store has accepted your order ${orderNo} and is preparing it.`,
      data: { orderNo },
    };
  },

  orderReady(orderNo: string): NotificationEvent {
    return {
      type: NotificationType.ORDER_READY,
      title: 'Order ready',
      body: `Your order ${orderNo} is packed and waiting for a delivery partner.`,
      data: { orderNo },
    };
  },

  orderOutForDelivery(orderNo: string): NotificationEvent {
    return {
      type: NotificationType.ORDER_OUT_FOR_DELIVERY,
      title: 'Out for delivery',
      body: `Your order ${orderNo} is on its way.`,
      data: { orderNo },
    };
  },

  orderDelivered(orderNo: string): NotificationEvent {
    return {
      type: NotificationType.ORDER_DELIVERED,
      title: 'Order delivered',
      body: `Your order ${orderNo} has been delivered. Enjoy!`,
      data: { orderNo },
    };
  },

  orderCancelled(orderNo: string, reason?: string | null): NotificationEvent {
    return {
      type: NotificationType.ORDER_CANCELLED,
      title: 'Order cancelled',
      body: reason
        ? `Your order ${orderNo} was cancelled: ${reason}`
        : `Your order ${orderNo} was cancelled.`,
      data: { orderNo },
    };
  },

  /** `amountPaise` — INTEGER PAISE, rendered here only as data, never math. */
  orderRefunded(orderNo: string, amountPaise: number): NotificationEvent {
    return {
      type: NotificationType.ORDER_REFUNDED,
      title: 'Refund processed',
      body: `A refund of ₹${(amountPaise / 100).toFixed(2)} for order ${orderNo} has been initiated.`,
      data: { orderNo, amountPaise },
    };
  },

  // ══════════════════════════════════════════════════════════════════
  //  RIDER WALLET & KYC
  // ══════════════════════════════════════════════════════════════════
  //
  //  Each one takes an amount, a status or a reason — never an Aadhaar
  //  number, a PAN, a driving-licence number or an OTP. There is no code
  //  path by which one of these could interpolate a government
  //  identifier, because none of them accepts one as an argument. That
  //  is deliberate: a notification body is persisted, fanned out to
  //  email/SMS/push and rendered in an app, which is four more places an
  //  identifier would exist than the one it is allowed to.

  /** `balancePaise` and `thresholdPaise` — INTEGER PAISE. */
  walletLowBalance(
    balancePaise: number,
    thresholdPaise: number,
  ): NotificationEvent {
    return {
      type: NotificationType.WALLET_LOW_BALANCE,
      title: 'Wallet running low',
      body:
        `Your wallet balance is ₹${rupees(balancePaise)}. ` +
        `Below ₹${rupees(thresholdPaise)} you may not be able to accept ` +
        'your next order — top up to keep working.',
      data: { balancePaise, thresholdPaise },
    };
  },

  /** A top-up or an admin credit landed. INTEGER PAISE both. */
  walletCredited(amountPaise: number, balancePaise: number): NotificationEvent {
    return {
      type: NotificationType.WALLET_CREDITED,
      title: 'Wallet topped up',
      body:
        `₹${rupees(amountPaise)} has been added to your wallet. ` +
        `Your balance is now ₹${rupees(balancePaise)}.`,
      data: { amountPaise, balancePaise },
    };
  },

  /** The rider has sent their documents in. `slaHours` is the promise. */
  kycSubmitted(slaHours: number): NotificationEvent {
    return {
      type: NotificationType.KYC_SUBMITTED,
      title: 'Documents received',
      body:
        'We have received your verification documents. Verification is ' +
        `completed within ${slaHours} hours — we will tell you as soon as ` +
        'it is done.',
      data: { slaHours },
    };
  },

  kycVerified(): NotificationEvent {
    return {
      type: NotificationType.KYC_VERIFIED,
      title: 'Verification complete',
      body: 'Your documents have been verified. You can now accept orders.',
      data: {},
    };
  },

  kycRejected(reason: string): NotificationEvent {
    return {
      type: NotificationType.KYC_REJECTED,
      title: 'Verification could not be completed',
      body: `Your documents were not accepted: ${reason} You can submit again.`,
      data: { reason },
    };
  },
} as const;

/**
 * Integer paise → a rupee string for display ONLY.
 *
 * Never fed back into arithmetic, and never stored — the `data` block
 * beside every body above carries the integer paise, which is what a
 * client should render from if it wants to format differently.
 */
const rupees = (paise: number): string => (paise / 100).toFixed(2);
