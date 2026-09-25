import { OrderStatus } from '../../common/constants/order-status.enum';
import {
  IssuePriority,
  IssueStatus,
  IssueType,
} from '../schemas/issue.schema';

/**
 * The static half of the OPERATIONS demo data.
 *
 * Kept out of `demo-catalogue.ts` because it is a different kind of
 * fixture: that file describes a catalogue that could plausibly exist,
 * this one describes a shift going wrong at a specific minute. Every
 * number here is chosen against a threshold in `ops/sla.util.ts`, so the
 * two files are read together when either changes.
 */

// ── Live operations fixtures ────────────────────────────────────────────

/**
 * A deterministic tail of LIVE orders, so the ADMIN operations console is
 * never empty and never accidentally healthy.
 *
 * The randomised 90-day generator does produce a live tail, but nothing
 * in it guarantees an unassigned order, a stuck one or an SLA breach on
 * any given run — and a demo of a work queue with no work in it
 * demonstrates nothing. These eleven are exact.
 *
 *   placedMinutesAgo  the order's age, which drives the SLA band
 *                     (30-minute default: warning from 24, breach past 30)
 *   inStatusMinutes   how long it has sat in its CURRENT status, which
 *                     drives the stuck thresholds
 *
 * Intermediate milestones are interpolated evenly between the two, so the
 * timeline always reads forwards and never lands in the future.
 */
export interface OpsFixtureSpec {
  status: OrderStatus;
  placedMinutesAgo: number;
  inStatusMinutes: number;
  /** Put a rider on it. Only meaningful from ASSIGNED onward. */
  withRider: boolean;
  /** Why this row exists. Not persisted — it documents the fixture. */
  note: string;
}

export const OPS_FIXTURES: readonly OpsFixtureSpec[] = [
  {
    status: OrderStatus.PLACED,
    placedMinutesAgo: 4,
    inStatusMinutes: 4,
    withRider: false,
    note: 'fresh — lane "new", SLA ok',
  },
  {
    status: OrderStatus.PLACED,
    placedMinutesAgo: 26,
    inStatusMinutes: 26,
    withRider: false,
    note: 'stuck (>10 in PLACED) + SLA warning',
  },
  {
    status: OrderStatus.ACCEPTED,
    placedMinutesAgo: 12,
    inStatusMinutes: 6,
    withRider: false,
    note: 'lane "preparing", healthy',
  },
  {
    status: OrderStatus.PACKING,
    placedMinutesAgo: 48,
    inStatusMinutes: 34,
    withRider: false,
    note: 'stuck (>25 in PACKING) + SLA breach',
  },
  {
    status: OrderStatus.READY_FOR_PICKUP,
    placedMinutesAgo: 9,
    inStatusMinutes: 3,
    withRider: false,
    note: 'unassigned, still inside every threshold',
  },
  {
    status: OrderStatus.READY_FOR_PICKUP,
    placedMinutesAgo: 38,
    inStatusMinutes: 22,
    withRider: false,
    note: 'unassigned + stuck (>15) + SLA breach',
  },
  {
    status: OrderStatus.READY_FOR_PICKUP,
    placedMinutesAgo: 62,
    inStatusMinutes: 45,
    withRider: false,
    note: 'unassigned + badly stuck + SLA breach',
  },
  {
    status: OrderStatus.ASSIGNED,
    placedMinutesAgo: 40,
    inStatusMinutes: 24,
    withRider: true,
    note: 'rider holds it but has not picked up — stuck (>15)',
  },
  {
    status: OrderStatus.PICKED_UP,
    placedMinutesAgo: 18,
    inStatusMinutes: 4,
    withRider: true,
    note: 'lane "assigned", healthy',
  },
  {
    status: OrderStatus.OUT_FOR_DELIVERY,
    placedMinutesAgo: 22,
    inStatusMinutes: 5,
    withRider: true,
    note: 'lane "in_transit", healthy',
  },
  {
    status: OrderStatus.OUT_FOR_DELIVERY,
    placedMinutesAgo: 95,
    inStatusMinutes: 55,
    withRider: true,
    note: 'stuck (>45) + heavy SLA breach',
  },
];

// ── Support queue ───────────────────────────────────────────────────────

/**
 * Which entity a ticket hangs off, so the detail view has something to
 * populate: an order-linked ticket resolves its order, customer and
 * vendor; a vendor ticket resolves only the store.
 */
export type IssueLink = 'order' | 'vendor' | 'rider' | 'none';

export interface DemoIssueSpec {
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  subject: string;
  description: string;
  /** Required by the schema invariant whenever `status` is resolved. */
  resolution: string | null;
  daysAgo: number;
  /** Put it in the demo ADMIN's own queue rather than the shared one. */
  assigned: boolean;
  /** Replies already on the thread. */
  thread: number;
  link: IssueLink;
}

/** 35 tickets across every type, priority and status. */
export const DEMO_ISSUES: readonly DemoIssueSpec[] = [
  {
    type: IssueType.DELIVERY_FAILED,
    priority: IssuePriority.URGENT,
    status: IssueStatus.OPEN,
    subject: 'Rider could not find the building',
    description:
      'Customer reports the rider called twice then marked the delivery failed. The address has no landmark and the gate is on the service road.',
    resolution: null,
    daysAgo: 0,
    assigned: true,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.MISSING_ITEM,
    priority: IssuePriority.HIGH,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Two items missing from a packed order',
    description:
      'Customer received four of six lines. The vendor says both were packed. Need the packing photo before a refund is authorised.',
    resolution: null,
    daysAgo: 0,
    assigned: true,
    thread: 3,
    link: 'order',
  },
  {
    type: IssueType.DAMAGED,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.OPEN,
    subject: 'Curd cup split in transit',
    description:
      'It leaked over the rest of the bag. The customer has sent a photo and is asking for a replacement rather than a refund.',
    resolution: null,
    daysAgo: 1,
    assigned: false,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.LATE,
    priority: IssuePriority.HIGH,
    status: IssueStatus.RESOLVED,
    subject: 'Delivery took 74 minutes',
    description:
      'The order sat at READY_FOR_PICKUP for 40 minutes with no rider in range during the evening peak.',
    resolution:
      'Refunded the delivery fee and apologised. Flagged the 19:00-21:00 rider shortfall to dispatch planning.',
    daysAgo: 1,
    assigned: true,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.PAYMENT,
    priority: IssuePriority.URGENT,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Card charged twice for one order',
    description:
      'Two authorisations against the same order id, one captured. The customer has sent their bank statement.',
    resolution: null,
    daysAgo: 2,
    assigned: true,
    thread: 4,
    link: 'order',
  },
  {
    type: IssueType.REFUND_REQUEST,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.OPEN,
    subject: 'Refund not received after five days',
    description:
      'The refund was raised on cancellation. The customer says nothing has landed. Needs the gateway reference.',
    resolution: null,
    daysAgo: 2,
    assigned: false,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.OTHER,
    priority: IssuePriority.LOW,
    status: IssueStatus.CLOSED,
    subject: 'Customer asking whether we deliver to Whitefield',
    description: 'That pincode is outside every current store radius.',
    resolution:
      'Told them no store covers that pincode yet and added them to the waitlist.',
    daysAgo: 3,
    assigned: false,
    thread: 1,
    link: 'none',
  },
  {
    type: IssueType.MISSING_ITEM,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.RESOLVED,
    subject: 'One line short-picked without notice',
    description:
      'The vendor dropped a line at packing but the customer was never told.',
    resolution:
      'Auto-refund confirmed for the dropped line. Reminded the store that a short-pick must be marked before dispatch.',
    daysAgo: 3,
    assigned: true,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.DAMAGED,
    priority: IssuePriority.HIGH,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Eggs broken on arrival, third time this week',
    description:
      'Same store, same rider bag. This looks like a packing problem rather than a riding one.',
    resolution: null,
    daysAgo: 4,
    assigned: true,
    thread: 3,
    link: 'vendor',
  },
  {
    type: IssueType.LATE,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.OPEN,
    subject: 'Consistently late from one store',
    description:
      'Four orders this week from the same vendor all breached the promise, every one of them at the packing step.',
    resolution: null,
    daysAgo: 4,
    assigned: false,
    thread: 0,
    link: 'vendor',
  },
  {
    type: IssueType.DELIVERY_FAILED,
    priority: IssuePriority.HIGH,
    status: IssueStatus.RESOLVED,
    subject: 'Customer unreachable at the door',
    description:
      'Phone off, no answer at the flat. The rider waited eleven minutes.',
    resolution:
      'Re-dispatched the same evening and delivered. Photo proof recorded on the second attempt.',
    daysAgo: 5,
    assigned: true,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.PAYMENT,
    priority: IssuePriority.HIGH,
    status: IssueStatus.RESOLVED,
    subject: 'COD collected but the order still shows unpaid',
    description: 'The rider took the cash and the payment status never moved.',
    resolution:
      'Reconciled against the rider cash sheet and corrected the payment status. Rider retrained on closing the order in the app.',
    daysAgo: 5,
    assigned: true,
    thread: 1,
    link: 'rider',
  },
  {
    type: IssueType.OTHER,
    priority: IssuePriority.LOW,
    status: IssueStatus.OPEN,
    subject: 'Product photo does not match the item',
    description:
      'The listing shows a 1kg pack; the item delivered is 500g. The price is right for 500g.',
    resolution: null,
    daysAgo: 6,
    assigned: false,
    thread: 0,
    link: 'vendor',
  },
  {
    type: IssueType.REFUND_REQUEST,
    priority: IssuePriority.URGENT,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Disputed refund on a high-value order',
    description:
      'The customer claims non-delivery; the rider has OTP proof. Escalated before any money moves.',
    resolution: null,
    daysAgo: 6,
    assigned: true,
    thread: 5,
    link: 'order',
  },
  {
    type: IssueType.MISSING_ITEM,
    priority: IssuePriority.LOW,
    status: IssueStatus.CLOSED,
    subject: 'Promotional sachet not included',
    description: 'The free item was missing from the bag.',
    resolution: 'Sent a coupon for the value. Not worth a rider trip.',
    daysAgo: 7,
    assigned: false,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.LATE,
    priority: IssuePriority.URGENT,
    status: IssueStatus.OPEN,
    subject: 'Order stuck at PLACED for 40 minutes',
    description:
      'The vendor has not accepted. The store shows open and nobody is answering the store phone.',
    resolution: null,
    daysAgo: 0,
    assigned: true,
    thread: 1,
    link: 'vendor',
  },
  {
    type: IssueType.DELIVERY_FAILED,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.OPEN,
    subject: 'Wrong flat number on the address',
    description:
      'The rider delivered to the wrong door in the same block. Goods recovered.',
    resolution: null,
    daysAgo: 7,
    assigned: false,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.DAMAGED,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.RESOLVED,
    subject: 'Bread crushed under a rice bag',
    description: 'A packing-order problem: heavy items went in on top.',
    resolution:
      'Refunded the bread and sent the store the packing-order guidance sheet.',
    daysAgo: 8,
    assigned: true,
    thread: 2,
    link: 'vendor',
  },
  {
    type: IssueType.PAYMENT,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.CLOSED,
    subject: 'Gateway timeout at checkout',
    description:
      'The payment page timed out. No order was created and the amount was debited.',
    resolution:
      'Auto-reversed by the gateway within 48 hours. Confirmed with the customer.',
    daysAgo: 8,
    assigned: false,
    thread: 1,
    link: 'none',
  },
  {
    type: IssueType.OTHER,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Rider behaviour complaint',
    description:
      'The customer reports the rider was rude on the phone about the parking.',
    resolution: null,
    daysAgo: 9,
    assigned: true,
    thread: 2,
    link: 'rider',
  },
  {
    type: IssueType.REFUND_REQUEST,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.RESOLVED,
    subject: 'Partial refund for an out-of-stock line',
    description:
      'The customer wants the difference back for a line the store could not supply.',
    resolution:
      'Partial refund issued against the unfulfilled line and confirmed to the customer.',
    daysAgo: 9,
    assigned: true,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.LATE,
    priority: IssuePriority.LOW,
    status: IssueStatus.CLOSED,
    subject: 'Five minutes past the promise',
    description: 'The customer noted it but did not want anything doing.',
    resolution: 'Acknowledged. No compensation requested.',
    daysAgo: 10,
    assigned: false,
    thread: 0,
    link: 'order',
  },
  {
    type: IssueType.MISSING_ITEM,
    priority: IssuePriority.HIGH,
    status: IssueStatus.OPEN,
    subject: 'Whole bag missing from a two-bag order',
    description:
      'The rider handed over one bag. The second is not on the scooter and not at the store.',
    resolution: null,
    daysAgo: 1,
    assigned: true,
    thread: 3,
    link: 'rider',
  },
  {
    type: IssueType.DELIVERY_FAILED,
    priority: IssuePriority.HIGH,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Second failed attempt on the same order',
    description: 'The customer was out both times, and perishables are involved.',
    resolution: null,
    daysAgo: 2,
    assigned: true,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.DAMAGED,
    priority: IssuePriority.LOW,
    status: IssueStatus.OPEN,
    subject: 'Dented tin',
    description: 'Cosmetic damage only; the contents are fine.',
    resolution: null,
    daysAgo: 11,
    assigned: false,
    thread: 0,
    link: 'order',
  },
  {
    type: IssueType.PAYMENT,
    priority: IssuePriority.LOW,
    status: IssueStatus.CLOSED,
    subject: 'Invoice request for a business account',
    description: 'The customer needs a GST invoice for reimbursement.',
    resolution: 'Invoice emailed. Noted the GSTIN on the account for next time.',
    daysAgo: 11,
    assigned: false,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.OTHER,
    priority: IssuePriority.HIGH,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Store taking orders while shut',
    description:
      'The vendor shutter is down but the store still shows open and is accepting orders.',
    resolution: null,
    daysAgo: 3,
    assigned: true,
    thread: 2,
    link: 'vendor',
  },
  {
    type: IssueType.REFUND_REQUEST,
    priority: IssuePriority.HIGH,
    status: IssueStatus.OPEN,
    subject: 'Refund requested after the delivery was accepted',
    description:
      'The customer signed the OTP then raised a quality complaint an hour later.',
    resolution: null,
    daysAgo: 4,
    assigned: false,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.LATE,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.IN_PROGRESS,
    subject: 'Rider idle with an order on board',
    description:
      'Out for delivery for 55 minutes with no movement on the last location ping.',
    resolution: null,
    daysAgo: 0,
    assigned: true,
    thread: 1,
    link: 'rider',
  },
  {
    type: IssueType.MISSING_ITEM,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.CLOSED,
    subject: 'Substitution without consent',
    description: 'The store swapped a brand without asking.',
    resolution:
      'Refunded the difference and reminded the store that a substitution needs the customer to agree first.',
    daysAgo: 12,
    assigned: true,
    thread: 2,
    link: 'vendor',
  },
  {
    type: IssueType.DAMAGED,
    priority: IssuePriority.URGENT,
    status: IssueStatus.OPEN,
    subject: 'Frozen items delivered thawed',
    description:
      'The whole frozen section of the order arrived at room temperature. This is a food safety issue.',
    resolution: null,
    daysAgo: 0,
    assigned: true,
    thread: 2,
    link: 'order',
  },
  {
    type: IssueType.DELIVERY_FAILED,
    priority: IssuePriority.LOW,
    status: IssueStatus.CLOSED,
    subject: 'Customer cancelled at the door',
    description: 'They changed their mind on arrival.',
    resolution:
      'Goods returned to the store and restocked. Order cancelled with the reason recorded.',
    daysAgo: 13,
    assigned: false,
    thread: 1,
    link: 'order',
  },
  {
    type: IssueType.OTHER,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.RESOLVED,
    subject: 'Coupon would not apply at checkout',
    description: 'WEEKEND15 was rejected on an order above the minimum.',
    resolution:
      'The coupon window had expired at midnight. Extended it and applied the discount manually for this customer.',
    daysAgo: 5,
    assigned: true,
    thread: 2,
    link: 'none',
  },
  {
    type: IssueType.PAYMENT,
    priority: IssuePriority.NORMAL,
    status: IssueStatus.OPEN,
    subject: 'COD limit blocked a legitimate order',
    description:
      'The customer tried to place a Rs 2,400 cash order and was refused at the cap.',
    resolution: null,
    daysAgo: 6,
    assigned: false,
    thread: 0,
    link: 'none',
  },
  {
    type: IssueType.LATE,
    priority: IssuePriority.HIGH,
    status: IssueStatus.OPEN,
    subject: 'Evening peak breaching across every store',
    description:
      'Every order placed between 19:00 and 20:00 today has breached. This looks like a fleet shortfall, not a store problem.',
    resolution: null,
    daysAgo: 0,
    assigned: true,
    thread: 1,
    link: 'none',
  },
];

/** Canned replies, cycled to build the demo threads. */
export const DEMO_ISSUE_REPLIES: readonly string[] = [
  'Called the customer and confirmed the details. Waiting on the store.',
  'Store has been contacted; they are checking the packing CCTV.',
  'Rider says the bag was handed over complete. Asking for the drop photo.',
  'Escalated to the vendor account manager.',
  'Customer has agreed to wait until end of day for an answer.',
  'Gateway reference requested from finance.',
  'Re-attempt scheduled for this evening.',
];
