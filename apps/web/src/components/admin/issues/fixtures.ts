/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Stands in for `/admin/ops/issues` while that endpoint is being built. Shown
 * only behind the amber <SampleBanner/>.
 *
 * The set is deliberately unbalanced: one urgent ticket three days old, a
 * couple of stale highs, a long tail of normals, and a handful already
 * resolved. A support queue where everything is the same age and the same
 * priority tests nothing — the whole design question on this page is whether
 * the one that has been burning for three days is impossible to miss.
 *
 * Timestamps are frozen literals, not `Date.now()` arithmetic: a fixture
 * computed at module scope renders differently on the server and in the
 * browser, and React reports that as a hydration mismatch.
 */

export type IssueType =
  | 'delivery_failed'
  | 'missing_item'
  | 'damaged'
  | 'late'
  | 'payment'
  | 'refund_request'
  | 'other';

export type IssuePriority = 'low' | 'normal' | 'high' | 'urgent';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface IssueMessage {
  byUserId: string;
  /** 'customer' | 'admin' | 'vendor' | 'rider' | 'system' — kept open, because
   *  the API may grow a role this UI has never heard of and a thread that
   *  refuses to render is worse than an unstyled author label. */
  byRole: string;
  body: string;
  at: string;
  /** optional denormalised display name; the id is the fallback */
  byName?: string;
}

export interface Issue {
  id: string;
  /** the short human handle — what support says out loud on a call */
  code: string;
  orderId?: string;
  customerId?: string;
  vendorId?: string;
  riderId?: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  subject: string;
  description: string;
  assignedToUserId?: string;
  resolution?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  messages: IssueMessage[];
  createdAt: string;
  updatedAt: string;

  /* Denormalised labels the API may or may not send. Every one of these is
     optional and every read site falls back to the id. */
  orderNo?: string;
  customerName?: string;
  vendorName?: string;
  riderName?: string;
  assignedToName?: string;
}

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  delivery_failed: 'Delivery failed',
  missing_item: 'Missing item',
  damaged: 'Damaged goods',
  late: 'Late delivery',
  payment: 'Payment',
  refund_request: 'Refund request',
  other: 'Other',
};

export const ISSUE_PRIORITY_LABEL: Record<IssuePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * The support bench, for the assignee filter.
 *
 * TODO: the API has no endpoint that lists assignable support staff yet, and
 * `/admin/team` is super-admin only — a plain ADMIN would get a 403 filling a
 * dropdown. Until Worker A exposes one, live rows fall back to showing the raw
 * `assignedToUserId`, and these names only appear on the fixture path.
 */
export const SUPPORT_AGENTS: readonly { id: string; name: string }[] = [
  { id: 'u-adm-01', name: 'Priya Nair' },
  { id: 'u-adm-02', name: 'Rahul Menon' },
  { id: 'u-adm-03', name: 'Zoya Ahmed' },
];

function agentName(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return SUPPORT_AGENTS.find((agent) => agent.id === id)?.name;
}

interface Seed {
  code: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  subject: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  assignedToUserId?: string;
  orderNo?: string;
  customerName?: string;
  vendorName?: string;
  riderName?: string;
  resolution?: string;
  resolvedAt?: string;
  messages: IssueMessage[];
}

const SEEDS: Seed[] = [
  {
    code: 'SUP-4417',
    type: 'delivery_failed',
    priority: 'urgent',
    status: 'open',
    subject: 'Order marked delivered but never arrived — ₹2,480 prepaid',
    description:
      'Customer says the rider marked the order delivered at 19:42 and nothing was left at the door. Building security has no record of an entry. Order was prepaid by UPI, full value ₹2,480. Customer has called three times and is asking for a refund today.',
    createdAt: '2026-09-21T14:12:00.000Z',
    updatedAt: '2026-09-23T09:05:00.000Z',
    assignedToUserId: 'u-adm-01',
    orderNo: 'MND-90114',
    customerName: 'Sneha Gopalan',
    vendorName: 'Anand Fresh Mart',
    riderName: 'Imran Qureshi',
    messages: [
      {
        byUserId: 'u-cust-771',
        byRole: 'customer',
        byName: 'Sneha Gopalan',
        body: 'The app says delivered. Nothing came. I have been home all evening.',
        at: '2026-09-21T14:12:00.000Z',
      },
      {
        byUserId: 'u-adm-01',
        byRole: 'admin',
        byName: 'Priya Nair',
        body: 'Raised with the vendor and pulled the rider trace. The last GPS ping is 400m from the drop point.',
        at: '2026-09-21T16:40:00.000Z',
      },
      {
        byUserId: 'u-cust-771',
        byRole: 'customer',
        byName: 'Sneha Gopalan',
        body: 'It has been two days. Please refund.',
        at: '2026-09-23T09:05:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4462',
    type: 'payment',
    priority: 'urgent',
    status: 'in_progress',
    subject: 'Double charge on a single order',
    description:
      'Two captures against the same order id, eleven seconds apart. The customer has both debit messages. One capture needs reversing and the gateway ledger has to be reconciled before the Monday settlement run.',
    createdAt: '2026-09-23T06:30:00.000Z',
    updatedAt: '2026-09-24T04:02:00.000Z',
    assignedToUserId: 'u-adm-02',
    orderNo: 'MND-90388',
    customerName: 'Vikram Shetty',
    vendorName: 'Green Basket Organics',
    messages: [
      {
        byUserId: 'u-cust-812',
        byRole: 'customer',
        byName: 'Vikram Shetty',
        body: 'Charged twice, ₹1,240 each. Screenshots attached in the app.',
        at: '2026-09-23T06:30:00.000Z',
      },
      {
        byUserId: 'u-adm-02',
        byRole: 'admin',
        byName: 'Rahul Menon',
        body: 'Confirmed two captures on the gateway. Reversal raised, reference RZP-REV-88213. Expect 3–5 working days.',
        at: '2026-09-24T04:02:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4431',
    type: 'missing_item',
    priority: 'high',
    status: 'open',
    subject: 'Two items missing from a six-item order',
    description:
      'Bread and eggs missing. Vendor says both were packed. Rider says the bag was sealed on pickup. Needs a decision on who absorbs the ₹310.',
    createdAt: '2026-09-22T11:48:00.000Z',
    updatedAt: '2026-09-22T11:48:00.000Z',
    orderNo: 'MND-90209',
    customerName: 'Nandini Rao',
    vendorName: 'Kadai Kirana Stores',
    messages: [
      {
        byUserId: 'u-cust-903',
        byRole: 'customer',
        byName: 'Nandini Rao',
        body: 'Paid for six things, four arrived.',
        at: '2026-09-22T11:48:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4448',
    type: 'damaged',
    priority: 'high',
    status: 'in_progress',
    subject: 'Cold chain broken — frozen items arrived thawed',
    description:
      'Four frozen SKUs delivered soft and leaking. Third report against this vendor in a week; the insulated bag allocation may be the root cause rather than any one rider.',
    createdAt: '2026-09-22T17:20:00.000Z',
    updatedAt: '2026-09-23T12:15:00.000Z',
    assignedToUserId: 'u-adm-03',
    orderNo: 'MND-90277',
    customerName: 'Arjun Pillai',
    vendorName: 'Coastal Catch & Greens',
    riderName: 'Deepak Yadav',
    messages: [
      {
        byUserId: 'u-cust-664',
        byRole: 'customer',
        byName: 'Arjun Pillai',
        body: 'Everything frozen was water by the time it got here.',
        at: '2026-09-22T17:20:00.000Z',
      },
      {
        byUserId: 'u-adm-03',
        byRole: 'admin',
        byName: 'Zoya Ahmed',
        body: 'Refunded the four SKUs. Flagging the vendor for a bag audit — this is the third in seven days.',
        at: '2026-09-23T12:15:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4470',
    type: 'refund_request',
    priority: 'normal',
    status: 'open',
    subject: 'Refund requested for a cancelled order still showing as paid',
    description:
      'Order cancelled by the vendor before packing. Payment shows captured, refund has not been initiated. Customer wants a date.',
    createdAt: '2026-09-23T13:55:00.000Z',
    updatedAt: '2026-09-23T13:55:00.000Z',
    orderNo: 'MND-90401',
    customerName: 'Farida Bano',
    vendorName: 'Daily Dairy Depot',
    messages: [
      {
        byUserId: 'u-cust-118',
        byRole: 'customer',
        byName: 'Farida Bano',
        body: 'Cancelled by the shop, money still not back.',
        at: '2026-09-23T13:55:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4474',
    type: 'late',
    priority: 'normal',
    status: 'open',
    subject: 'Delivery 90 minutes past the promised slot',
    description:
      'Promised 20:00–20:30, delivered 22:05. Customer is not asking for money, but wants to know it was noticed.',
    createdAt: '2026-09-23T17:10:00.000Z',
    updatedAt: '2026-09-23T17:10:00.000Z',
    orderNo: 'MND-90422',
    customerName: 'Joseph Mathew',
    vendorName: 'Anand Fresh Mart',
    riderName: 'Lalita Devi',
    messages: [
      {
        byUserId: 'u-cust-540',
        byRole: 'customer',
        byName: 'Joseph Mathew',
        body: 'Ninety minutes late with no message. Just so you know.',
        at: '2026-09-23T17:10:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4481',
    type: 'missing_item',
    priority: 'normal',
    status: 'in_progress',
    subject: 'Substituted brand without asking',
    description:
      'Vendor swapped the requested atta for a house brand. Customer wants the difference refunded or the correct item delivered.',
    createdAt: '2026-09-24T02:40:00.000Z',
    updatedAt: '2026-09-24T05:20:00.000Z',
    assignedToUserId: 'u-adm-01',
    orderNo: 'MND-90455',
    customerName: 'Ritu Malhotra',
    vendorName: 'Kadai Kirana Stores',
    messages: [
      {
        byUserId: 'u-cust-207',
        byRole: 'customer',
        byName: 'Ritu Malhotra',
        body: 'I ordered a specific brand. Got something else entirely.',
        at: '2026-09-24T02:40:00.000Z',
      },
      {
        byUserId: 'u-adm-01',
        byRole: 'admin',
        byName: 'Priya Nair',
        body: 'Asked the vendor to confirm the substitution policy on their listing.',
        at: '2026-09-24T05:20:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4402',
    type: 'other',
    priority: 'low',
    status: 'open',
    subject: 'Cannot change the saved delivery address label',
    description:
      'Minor app issue — the label on a saved address will not save as "Office". Logged for the product team; no money involved.',
    createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    customerName: 'Kabir Sen',
    messages: [
      {
        byUserId: 'u-cust-331',
        byRole: 'customer',
        byName: 'Kabir Sen',
        body: 'Small thing, the address label keeps reverting to Home.',
        at: '2026-09-20T08:00:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4487',
    type: 'delivery_failed',
    priority: 'high',
    status: 'open',
    subject: 'Rider could not find the address, order returned to store',
    description:
      'Pin dropped two streets away. Order came back to the vendor and the perishables are now unsellable. Decide whether to re-deliver at platform cost.',
    createdAt: '2026-09-24T06:05:00.000Z',
    updatedAt: '2026-09-24T06:05:00.000Z',
    orderNo: 'MND-90470',
    customerName: 'Aisha Kutty',
    vendorName: 'Green Basket Organics',
    riderName: 'Sathish Kumar M',
    messages: [
      {
        byUserId: 'u-rider-44',
        byRole: 'rider',
        byName: 'Sathish Kumar M',
        body: 'No such building at the pin. Called twice, no answer. Returning to store.',
        at: '2026-09-24T06:05:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4455',
    type: 'payment',
    priority: 'normal',
    status: 'resolved',
    subject: 'COD collected in cash but order shows unpaid',
    description:
      'Rider collected ₹860 in cash; the order stayed in an unpaid state because the app lost connectivity at the doorstep.',
    createdAt: '2026-09-22T19:30:00.000Z',
    updatedAt: '2026-09-24T03:10:00.000Z',
    assignedToUserId: 'u-adm-02',
    orderNo: 'MND-90301',
    customerName: 'Mahesh Barot',
    vendorName: 'Daily Dairy Depot',
    riderName: 'Imran Qureshi',
    resolution:
      'Cash confirmed against the rider float reconciliation for 22 Sep. Order marked paid manually; no customer action needed.',
    resolvedAt: '2026-09-24T03:10:00.000Z',
    messages: [
      {
        byUserId: 'u-cust-950',
        byRole: 'customer',
        byName: 'Mahesh Barot',
        body: 'I paid the rider in cash but the app still says payment pending.',
        at: '2026-09-22T19:30:00.000Z',
      },
      {
        byUserId: 'u-adm-02',
        byRole: 'admin',
        byName: 'Rahul Menon',
        body: 'Reconciled against the float. Marked paid — sorry for the worry.',
        at: '2026-09-24T03:10:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4460',
    type: 'damaged',
    priority: 'low',
    status: 'resolved',
    subject: 'Crushed bread loaf',
    description: 'Single item damaged in transit. Low value, refunded on sight.',
    createdAt: '2026-09-23T08:15:00.000Z',
    updatedAt: '2026-09-24T01:22:00.000Z',
    assignedToUserId: 'u-adm-03',
    orderNo: 'MND-90344',
    customerName: 'Leela Krishnan',
    vendorName: 'Anand Fresh Mart',
    resolution: 'Refunded ₹45 to the original payment method. Vendor notified about bag stacking.',
    resolvedAt: '2026-09-24T01:22:00.000Z',
    messages: [
      {
        byUserId: 'u-cust-402',
        byRole: 'customer',
        byName: 'Leela Krishnan',
        body: 'Loaf arrived flat.',
        at: '2026-09-23T08:15:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4390',
    type: 'refund_request',
    priority: 'normal',
    status: 'closed',
    subject: 'Refund chased after it had already landed',
    description: 'Customer opened a second ticket for a refund that had already been paid out.',
    createdAt: '2026-09-19T10:05:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
    assignedToUserId: 'u-adm-01',
    orderNo: 'MND-89902',
    customerName: 'Tanvi Desai',
    resolution: 'Duplicate of SUP-4371. Refund settled on 19 Sep; nothing outstanding.',
    resolvedAt: '2026-09-20T09:00:00.000Z',
    messages: [
      {
        byUserId: 'u-cust-615',
        byRole: 'customer',
        byName: 'Tanvi Desai',
        body: 'Still waiting on my refund.',
        at: '2026-09-19T10:05:00.000Z',
      },
      {
        byUserId: 'u-adm-01',
        byRole: 'admin',
        byName: 'Priya Nair',
        body: 'It landed on the 19th — check the statement line dated 19 Sep.',
        at: '2026-09-20T09:00:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4489',
    type: 'late',
    priority: 'low',
    status: 'open',
    subject: 'Slot times shown in the app do not match the confirmation email',
    description:
      'Cosmetic mismatch between the app and the email template. No delivery was actually late.',
    createdAt: '2026-09-24T07:30:00.000Z',
    updatedAt: '2026-09-24T07:30:00.000Z',
    customerName: 'Gautam Iyer',
    messages: [
      {
        byUserId: 'u-cust-778',
        byRole: 'customer',
        byName: 'Gautam Iyer',
        body: 'Email says 18:00, app says 18:30. Which one is it?',
        at: '2026-09-24T07:30:00.000Z',
      },
    ],
  },
  {
    code: 'SUP-4491',
    type: 'other',
    priority: 'normal',
    status: 'open',
    subject: 'Vendor asking to pause new orders for the afternoon',
    description:
      'Store has a power cut and cannot keep the chillers running. Wants to go offline until 17:00 without being penalised on the acceptance metric.',
    createdAt: '2026-09-24T08:10:00.000Z',
    updatedAt: '2026-09-24T08:10:00.000Z',
    vendorName: 'Coastal Catch & Greens',
    messages: [
      {
        byUserId: 'u-vend-12',
        byRole: 'vendor',
        byName: 'Coastal Catch & Greens',
        body: 'Power cut, chillers are off. Can we pause until 5pm?',
        at: '2026-09-24T08:10:00.000Z',
      },
    ],
  },
];

export const ISSUES_FIXTURE: Issue[] = SEEDS.map((seed, index) => ({
  id: `iss-${String(index + 1).padStart(4, '0')}`,
  code: seed.code,
  orderId: seed.orderNo === undefined ? undefined : `ord-${seed.orderNo.slice(-5)}`,
  customerId: seed.customerName === undefined ? undefined : `cus-${index + 100}`,
  vendorId: seed.vendorName === undefined ? undefined : `ven-${index + 300}`,
  riderId: seed.riderName === undefined ? undefined : `rid-${index + 500}`,
  type: seed.type,
  priority: seed.priority,
  status: seed.status,
  subject: seed.subject,
  description: seed.description,
  assignedToUserId: seed.assignedToUserId,
  assignedToName: agentName(seed.assignedToUserId),
  resolution: seed.resolution,
  resolvedAt: seed.resolvedAt,
  resolvedBy: seed.resolvedAt === undefined ? undefined : seed.assignedToUserId,
  messages: seed.messages,
  createdAt: seed.createdAt,
  updatedAt: seed.updatedAt,
  orderNo: seed.orderNo,
  customerName: seed.customerName,
  vendorName: seed.vendorName,
  riderName: seed.riderName,
}));

export function issueFixtureById(id: string): Issue {
  const found = ISSUES_FIXTURE.find((issue) => issue.id === id);
  if (found !== undefined) return found;
  // A detail page opened on an id the fixture has never heard of still has to
  // render something honest rather than crash the route.
  const first = ISSUES_FIXTURE[0];
  if (first === undefined) throw new Error('ISSUES_FIXTURE is empty');
  return { ...first, id, code: 'SUP-????' };
}
