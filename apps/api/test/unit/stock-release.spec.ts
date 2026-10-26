import 'reflect-metadata';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { PaymentsService } from '../../src/modules/shop/payments/payments.service';
import {
  PaymentProvider,
  ProviderOrderStatus,
} from '../../src/modules/shop/payments/payment-provider';
import { OrderDocument } from '../../src/database/schemas/order.schema';
import { InventoryDocument } from '../../src/database/schemas/inventory.schema';
import {
  InventoryLogDocument,
  InventoryReason,
} from '../../src/database/schemas/inventory-log.schema';
import { IdempotencyKeyDocument } from '../../src/database/schemas/idempotency-key.schema';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { AuditService } from '../../src/modules/admin/audit/audit.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  §8.2 — THE STOCK-RELEASE SWEEP: UNIT
 * ════════════════════════════════════════════════════════════════════════
 *
 * `StockReleaseSweeperService` itself is a thin loop (find candidates,
 * call `PaymentsService.reconcileOrder` for each) — the actual release
 * logic, and the idempotency guarantee that matters, lives in
 * `PaymentsService.releasePendingOrder`. This exercises that directly,
 * against stubbed models exactly like `test/unit/assignment.spec.ts`
 * does for the delivery sweeper: no database, because none of the three
 * properties under test is a question about MongoDB.
 *
 *   1. A pending online order past its window is released EXACTLY ONCE:
 *      stock restored, reservation cleared, order cancelled, one audit
 *      row, one inventory-log row.
 *   2. Running the release again on the SAME order is a no-op — no
 *      second stock increment, no second audit row. This is what makes
 *      the sweeper safe to run from N replicas and safe to retry after a
 *      crash.
 *   3. An order that was already PAID is never touched, regardless of
 *      how long ago it was placed.
 */

/** A chainable query stub, mirroring assignment.spec.ts's `Q<T>`. */
class Q<T> {
  constructor(private readonly value: T) {}
  select(): this {
    return this;
  }
  session(): this {
    return this;
  }
  lean(): this {
    return this;
  }
  exec(): Promise<T> {
    return Promise.resolve(this.value);
  }
}
const q = <T>(value: T): Q<T> => new Q(value);

const oid = (): Types.ObjectId => new Types.ObjectId();

interface FakeOrder {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  status: OrderStatus;
  statusHistory: unknown[];
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    provider: string | null;
    providerOrderId: string | null;
    providerPaymentId: string | null;
    paidAt: Date | null;
    refundedAmount: number;
  };
  items: { productId: Types.ObjectId; qty: number }[];
  pricing: { grandTotal: number };
  cancellation: Record<string, unknown>;
  placedAt: Date;
  save: (opts?: unknown) => Promise<FakeOrder>;
}

function makeOrder(over: Partial<FakeOrder> = {}): FakeOrder {
  const order: FakeOrder = {
    _id: oid(),
    vendorId: oid(),
    status: OrderStatus.PLACED,
    statusHistory: [],
    payment: {
      method: PaymentMethod.ONLINE,
      status: PaymentStatus.PENDING,
      provider: 'razorpay',
      providerOrderId: 'order_abc123',
      providerPaymentId: null,
      paidAt: null,
      refundedAmount: 0,
    },
    items: [{ productId: oid(), qty: 3 }],
    pricing: { grandTotal: 30_000 },
    cancellation: {},
    placedAt: new Date(Date.now() - 20 * 60 * 1000),
    save: async function (this: FakeOrder) {
      return this;
    },
    ...over,
  };
  return order;
}

/** Tracks every `$inc` applied, keyed by productId. */
class InventoryStub {
  private readonly rows = new Map<string, { stock: number; reserved: number }>();
  updateCalls: { productId: string; inc: Record<string, number> }[] = [];

  seed(productId: Types.ObjectId, stock: number, reserved: number): void {
    this.rows.set(productId.toString(), { stock, reserved });
  }

  get(productId: Types.ObjectId): { stock: number; reserved: number } {
    const row = this.rows.get(productId.toString());
    if (!row) throw new Error('no such product seeded');
    return row;
  }

  asModel(): Model<InventoryDocument> {
    return {
      updateOne: (filter: { productId: Types.ObjectId }, update: { $inc: Record<string, number> }) => {
        const key = filter.productId.toString();
        const row = this.rows.get(key) ?? { stock: 0, reserved: 0 };
        for (const [field, delta] of Object.entries(update.$inc)) {
          (row as unknown as Record<string, number>)[field] =
            ((row as unknown as Record<string, number>)[field] ?? 0) + delta;
        }
        this.rows.set(key, row);
        this.updateCalls.push({ productId: key, inc: update.$inc });
        return q({ acknowledged: true, modifiedCount: 1 });
      },
    } as unknown as Model<InventoryDocument>;
  }
}

class InventoryLogStub {
  created: unknown[] = [];
  asModel(): Model<InventoryLogDocument> {
    return {
      create: (docs: unknown[]) => {
        this.created.push(...docs);
        return Promise.resolve(docs);
      },
    } as unknown as Model<InventoryLogDocument>;
  }
}

function fakeSession(): ClientSession {
  return {
    withTransaction: async (fn: () => Promise<void>) => {
      await fn();
    },
    endSession: async () => undefined,
  } as unknown as ClientSession;
}

function fakeConnection(): Connection {
  return {
    startSession: async () => fakeSession(),
  } as unknown as Connection;
}

function noopProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: 'razorpay',
    isConfigured: () => false,
    isWebhookConfigured: () => false,
    createOrder: () => Promise.reject(new Error('not used in this test')),
    verifySignature: () => false,
    verifyWebhookSignature: () => false,
    fetchOrderStatus: (): Promise<ProviderOrderStatus> =>
      Promise.resolve({ state: 'pending', providerPaymentId: null }),
    refundPayment: () => Promise.reject(new Error('not used in this test')),
    ...overrides,
  };
}

function noopRealtime(): RealtimeService {
  return { emitToOrder: () => undefined, emitToAdmin: () => undefined } as unknown as RealtimeService;
}

function buildService(
  order: FakeOrder,
  inventory: InventoryStub,
  logs: InventoryLogStub,
  audit: { record: jest.Mock },
  provider: PaymentProvider = noopProvider(),
): PaymentsService {
  const ordersModel = {
    findById: () => q(order),
    findOne: () => q(null),
  } as unknown as Model<OrderDocument>;

  return new PaymentsService(
    fakeConnection(),
    ordersModel,
    inventory.asModel(),
    logs.asModel(),
    {} as unknown as Model<IdempotencyKeyDocument>,
    provider,
    noopRealtime(),
    audit as unknown as AuditService,
  );
}

describe('§8.2 stock release — PaymentsService.releasePendingOrder', () => {
  it('releases a pending online order exactly once: stock restored, reserved cleared, order cancelled', async () => {
    const productId = oid();
    const order = makeOrder({ items: [{ productId, qty: 3 }] });
    const inventory = new InventoryStub();
    inventory.seed(productId, 5, 3); // 5 available, 3 held by this order's reservation
    const logs = new InventoryLogStub();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };

    const service = buildService(order, inventory, logs, audit);

    const outcome = await service.releasePendingOrder(
      order._id,
      'Payment window expired (15 minutes)',
      'timeout',
    );

    expect(outcome).toBe('released');
    expect(inventory.get(productId)).toEqual({ stock: 8, reserved: 0 });
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(order.payment.status).toBe(PaymentStatus.FAILED);
    expect(logs.created).toHaveLength(1);
    expect((logs.created[0] as { reason: InventoryReason }).reason).toBe(
      InventoryReason.ORDER_RELEASE,
    );
    expect((logs.created[0] as { delta: number }).delta).toBe(3);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].action).toBe('payments.release');
  });

  it('is a no-op on a second pass over the same (now-cancelled) order', async () => {
    const productId = oid();
    const order = makeOrder({ items: [{ productId, qty: 3 }] });
    const inventory = new InventoryStub();
    inventory.seed(productId, 5, 3);
    const logs = new InventoryLogStub();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(order, inventory, logs, audit);

    const first = await service.releasePendingOrder(order._id, 'reason', 'timeout');
    expect(first).toBe('released');
    const afterFirst = { ...inventory.get(productId) };

    // The SAME order object is "re-read" from the model on the second
    // call — its payment.status is now FAILED, exactly as a real
    // `findById` would see after the first transaction committed.
    const second = await service.releasePendingOrder(order._id, 'reason', 'timeout');

    expect(second).toBe('skipped');
    expect(inventory.get(productId)).toEqual(afterFirst); // NOT double-released
    expect(logs.created).toHaveLength(1); // still just the one row
    expect(audit.record).toHaveBeenCalledTimes(1); // still just the one row
  });

  it('never touches an order that was already paid', async () => {
    const productId = oid();
    const order = makeOrder({
      items: [{ productId, qty: 3 }],
      payment: {
        method: PaymentMethod.ONLINE,
        status: PaymentStatus.PAID,
        provider: 'razorpay',
        providerOrderId: 'order_abc123',
        providerPaymentId: 'pay_xyz789',
        paidAt: new Date(),
        refundedAmount: 0,
      },
    });
    const inventory = new InventoryStub();
    inventory.seed(productId, 5, 0); // already committed: nothing reserved
    const logs = new InventoryLogStub();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(order, inventory, logs, audit);

    const outcome = await service.releasePendingOrder(
      order._id,
      'Payment window expired (15 minutes)',
      'timeout',
    );

    expect(outcome).toBe('skipped');
    expect(inventory.get(productId)).toEqual({ stock: 5, reserved: 0 });
    expect(order.status).toBe(OrderStatus.PLACED); // untouched
    expect(order.payment.status).toBe(PaymentStatus.PAID); // untouched
    expect(logs.created).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never touches a COD order, even if it is somehow still "pending"', async () => {
    const productId = oid();
    const order = makeOrder({
      items: [{ productId, qty: 2 }],
      payment: {
        method: PaymentMethod.COD,
        status: PaymentStatus.PENDING,
        provider: null,
        providerOrderId: null,
        providerPaymentId: null,
        paidAt: null,
        refundedAmount: 0,
      },
    });
    const inventory = new InventoryStub();
    inventory.seed(productId, 5, 2);
    const logs = new InventoryLogStub();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(order, inventory, logs, audit);

    const outcome = await service.releasePendingOrder(order._id, 'reason', 'timeout');

    expect(outcome).toBe('skipped');
    expect(inventory.get(productId)).toEqual({ stock: 5, reserved: 2 });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('§8.3 payment capture — PaymentsService.confirmPaidOrder', () => {
  it('commits the reservation (reserved cleared, stock untouched) and marks the order paid, exactly once', async () => {
    const productId = oid();
    const order = makeOrder({ items: [{ productId, qty: 4 }] });
    const inventory = new InventoryStub();
    inventory.seed(productId, 6, 4);
    const logs = new InventoryLogStub();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(order, inventory, logs, audit);

    const first = await service.confirmPaidOrder(
      order._id,
      'order_abc123',
      'pay_xyz789',
      'webhook',
    );

    expect(first).toBe('confirmed');
    expect(inventory.get(productId)).toEqual({ stock: 6, reserved: 0 }); // stock NOT touched
    expect(order.payment.status).toBe(PaymentStatus.PAID);
    expect(order.status).toBe(OrderStatus.PLACED); // order itself is not cancelled
    expect(logs.created).toHaveLength(1);
    expect((logs.created[0] as { reason: InventoryReason }).reason).toBe(
      InventoryReason.ORDER_COMMIT,
    );

    const second = await service.confirmPaidOrder(
      order._id,
      'order_abc123',
      'pay_xyz789',
      'webhook',
    );
    expect(second).toBe('skipped'); // replayed webhook event — no double-commit
    expect(inventory.get(productId)).toEqual({ stock: 6, reserved: 0 });
    expect(logs.created).toHaveLength(1);
  });

  it('refuses a capture for a provider order id that does not match this order', async () => {
    const productId = oid();
    const order = makeOrder({ items: [{ productId, qty: 1 }] });
    const inventory = new InventoryStub();
    inventory.seed(productId, 5, 1);
    const logs = new InventoryLogStub();
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(order, inventory, logs, audit);

    const outcome = await service.confirmPaidOrder(
      order._id,
      'order_SOME_OTHER_ORDER',
      'pay_xyz789',
      'client',
    );

    expect(outcome).toBe('skipped');
    expect(order.payment.status).toBe(PaymentStatus.PENDING);
    expect(inventory.get(productId)).toEqual({ stock: 5, reserved: 1 });
  });
});
