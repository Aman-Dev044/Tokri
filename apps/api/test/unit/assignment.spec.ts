import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, Types } from 'mongoose';

import {
  AssignmentService,
  otpStateOf,
} from '../../src/modules/delivery/assignment.service';
import { OrderDocument } from '../../src/database/schemas/order.schema';
import { DeliveryPartnerDocument } from '../../src/database/schemas/delivery-partner.schema';
import { DeliveryAssignmentDocument } from '../../src/database/schemas/delivery-assignment.schema';
import { VendorDocument } from '../../src/database/schemas/vendor.schema';
import { GeoService } from '../../src/modules/delivery/geo.service';
import {
  MAX_ASSIGNMENT_ATTEMPTS,
  MAX_OTP_ATTEMPTS,
  OFFER_TTL_MS,
} from '../../src/modules/delivery/delivery.constants';
import { OrderStatus } from '../../src/common/constants/order-status.enum';
import { AssignmentStatus } from '../../src/database/schemas/delivery-assignment.schema';
import { RealtimeService } from '../../src/realtime/realtime.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE ASSIGNMENT ENGINE — UNIT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three properties from §8.5, asserted without a database:
 *
 *   1. An expired offer moves to the NEXT rider, with `attemptNo`
 *      incremented and the previous rider excluded.
 *   2. After three attempts the engine ESCALATES instead of offering a
 *      fourth — the property that stops an order being "assigned" for
 *      forty minutes while nobody looks at it.
 *   3. An empty rider pool costs NO attempt. Nobody declined, so nobody
 *      should be escalated to.
 *
 * The Mongoose models are stubbed because none of the above is a question
 * about MongoDB — they are questions about the engine's decisions, and a
 * replica set would only make the test slower and less specific. The
 * transactional paths (accept, return-to-pool) are asserted against a
 * real database in `test/integration/delivery.spec.ts`, where the
 * transaction is the point.
 */

/** A chainable query stub: every builder method returns itself. */
class Q<T> {
  constructor(private readonly value: T) {}
  select(): this {
    return this;
  }
  sort(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  skip(): this {
    return this;
  }
  lean(): this {
    return this;
  }
  session(): this {
    return this;
  }
  exec(): Promise<T> {
    return Promise.resolve(this.value);
  }
}

const q = <T>(value: T): Q<T> => new Q(value);

const oid = (): Types.ObjectId => new Types.ObjectId();

interface StubAssignment {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  partnerId: Types.ObjectId;
  status: AssignmentStatus;
  offeredAt: Date;
  expiresAt: Date;
  attemptNo: number;
  otpAttempts: number;
  otpLockedAt: Date | null;
}

const assignmentFixture = (
  over: Partial<StubAssignment> & { orderId: Types.ObjectId },
): StubAssignment => ({
  _id: oid(),
  partnerId: oid(),
  status: AssignmentStatus.EXPIRED,
  offeredAt: new Date(),
  expiresAt: new Date(),
  attemptNo: 1,
  otpAttempts: 0,
  otpLockedAt: null,
  ...over,
});

const orderFixture = (id: Types.ObjectId, vendorId: Types.ObjectId) => ({
  _id: id,
  orderNo: 'MND-20260925-0001',
  vendorId,
  status: OrderStatus.READY_FOR_PICKUP,
  deliveryPartnerId: null,
  isDemo: false,
  items: [{ name: 'Tomatoes', qty: 2, unit: 'kg', image: null }],
  pricing: { grandTotal: 42_000 },
  payment: { method: 'cod', status: 'pending' },
  address: {
    label: 'Home',
    line1: '12 Residency Road',
    city: 'Bengaluru',
    pincode: '560025',
    phone: '9000000000',
    location: { type: 'Point' as const, coordinates: [77.6033, 12.9719] },
  },
});

const vendorFixture = (id: Types.ObjectId) => ({
  _id: id,
  storeName: 'Ramesh Fresh',
  serviceRadiusKm: 5,
  address: { line1: '4 Church Street', city: 'Bengaluru' },
  location: { type: 'Point' as const, coordinates: [77.5946, 12.9716] },
});

interface Harness {
  service: AssignmentService;
  createAssignment: jest.Mock;
  findOneAndUpdate: jest.Mock;
  /** `latestAssignment` — re-point it to control the next attempt number. */
  findLatestAssignment: jest.Mock;
  aggregate: jest.Mock;
  emitToUser: jest.Mock;
  emitToVendor: jest.Mock;
  emitToAdmin: jest.Mock;
  orderId: Types.ObjectId;
  vendorId: Types.ObjectId;
  previousPartnerId: Types.ObjectId;
  nextPartnerId: Types.ObjectId;
  nextRiderUserId: Types.ObjectId;
}

/**
 * Wires the real service to stub models.
 *
 * `latestAssignment` is what the engine reads to decide the next attempt
 * number, so it is the one stub whose value each test controls.
 */
function harness(options: {
  latest: StubAssignment | null;
  riders?: { _id: Types.ObjectId; userId: Types.ObjectId }[];
  alreadyAsked?: Types.ObjectId[];
  orderStatus?: OrderStatus;
}): Harness {
  const orderId = oid();
  const vendorId = oid();
  const previousPartnerId = options.alreadyAsked?.[0] ?? oid();
  const nextPartnerId = options.riders?.[0]?._id ?? oid();
  const nextRiderUserId = options.riders?.[0]?.userId ?? oid();

  const order = {
    ...orderFixture(orderId, vendorId),
    status: options.orderStatus ?? OrderStatus.READY_FOR_PICKUP,
  };

  const createAssignment = jest.fn((doc: Record<string, unknown>) =>
    Promise.resolve({
      ...doc,
      _id: oid(),
    }),
  );
  const findOneAndUpdate = jest.fn(() => q(null));
  const aggregate = jest.fn(() =>
    q(
      (options.riders ?? []).map((rider) => ({
        _id: rider._id,
        userId: rider.userId,
        distanceMeters: 900,
      })),
    ),
  );

  const findLatestAssignment = jest.fn(() => q(options.latest));

  const assignments = {
    findOne: findLatestAssignment,
    find: jest.fn(() =>
      q((options.alreadyAsked ?? []).map((partnerId) => ({ partnerId }))),
    ),
    findById: jest.fn(() => q(null)),
    findOneAndUpdate,
    countDocuments: jest.fn(() => q(0)),
    updateMany: jest.fn(() => q(null)),
    create: createAssignment,
  } as unknown as Model<DeliveryAssignmentDocument>;

  const orders = {
    findById: jest.fn(() => q(order)),
    find: jest.fn(() => q([])),
  } as unknown as Model<OrderDocument>;

  const vendors = {
    findById: jest.fn(() => q(vendorFixture(vendorId))),
    find: jest.fn(() => q([vendorFixture(vendorId)])),
  } as unknown as Model<VendorDocument>;

  const partners = {
    aggregate,
    findOne: jest.fn(() => q(null)),
    updateOne: jest.fn(() => q(null)),
  } as unknown as Model<DeliveryPartnerDocument>;

  const emitToUser = jest.fn();
  const emitToVendor = jest.fn();
  const emitToAdmin = jest.fn();
  const realtime = {
    emitToUser,
    emitToVendor,
    emitToAdmin,
    emitToOrder: jest.fn(),
  } as unknown as RealtimeService;

  // No key configured: `GeoService` then computes distance, ETA and
  // payout from the stored points and never reaches for the network,
  // which is exactly the §8.7 behaviour under test everywhere else.
  const geo = new GeoService({
    get: () => undefined,
  } as unknown as ConfigService);

  const service = new AssignmentService(
    {} as unknown as Connection,
    orders,
    partners,
    assignments,
    vendors,
    geo,
    realtime,
  );

  return {
    service,
    createAssignment,
    findOneAndUpdate,
    findLatestAssignment,
    aggregate,
    emitToUser,
    emitToVendor,
    emitToAdmin,
    orderId,
    vendorId,
    previousPartnerId,
    nextPartnerId,
    nextRiderUserId,
  };
}

describe('Assignment engine (unit)', () => {
  // ══════════════════════════════════════════════════════════════════
  //  Offer expiry
  // ══════════════════════════════════════════════════════════════════

  describe('offer expiry', () => {
    it('claims a due offer atomically and marks it expired', async () => {
      const h = harness({ latest: null, riders: [] });
      const now = new Date('2026-09-25T10:00:00.000Z');

      await h.service.expireDueOffers(now);

      expect(h.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update] = h.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, Record<string, unknown>>,
      ];

      // The claim is a single atomic operation. Two API replicas sweeping
      // at the same instant cannot both take the same row — a find()
      // followed by a save() would double-offer the order.
      expect(filter).toEqual({
        status: AssignmentStatus.OFFERED,
        expiresAt: { $lte: now },
      });
      expect(update.$set.status).toBe(AssignmentStatus.EXPIRED);
    });

    it('leaves offers that still have time on them alone', async () => {
      const h = harness({ latest: null });
      const count = await h.service.expireDueOffers(new Date());

      // The stub returns null: nothing was due, so nothing was claimed.
      expect(count).toBe(0);
      expect(h.createAssignment).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  attemptNo
  // ══════════════════════════════════════════════════════════════════

  describe('attemptNo', () => {
    it('offers the next rider with attemptNo incremented', async () => {
      const previousPartnerId = oid();
      const nextPartnerId = oid();
      const nextRiderUserId = oid();

      const h = harness({
        latest: null,
        riders: [{ _id: nextPartnerId, userId: nextRiderUserId }],
        alreadyAsked: [previousPartnerId],
      });

      const expired = assignmentFixture({
        orderId: h.orderId,
        partnerId: previousPartnerId,
        attemptNo: 1,
      });

      h.findOneAndUpdate
        .mockReturnValueOnce(q(expired))
        .mockReturnValue(q(null));

      // The state the database is in once the claim has landed: the
      // latest attempt on this order is the one that just expired.
      h.findLatestAssignment.mockReturnValue(q(expired));

      const before = Date.now();
      await h.service.expireDueOffers(new Date());

      expect(h.createAssignment).toHaveBeenCalledTimes(1);
      const created = h.createAssignment.mock.calls[0][0] as {
        attemptNo: number;
        status: AssignmentStatus;
        expiresAt: Date;
        partnerId: Types.ObjectId;
      };

      expect(created.attemptNo).toBe(2);
      expect(created.status).toBe(AssignmentStatus.OFFERED);
      expect(created.partnerId).toEqual(nextPartnerId);

      // 45 seconds, from §8.5. A generous tolerance because the service
      // reads its own clock.
      const ttl = created.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(OFFER_TTL_MS - 2_000);
      expect(ttl).toBeLessThan(OFFER_TTL_MS + 2_000);
    });

    it('never re-offers to a rider who has already seen this order', async () => {
      const previousPartnerId = oid();
      const h = harness({
        latest: null,
        riders: [{ _id: oid(), userId: oid() }],
        alreadyAsked: [previousPartnerId],
      });

      h.findOneAndUpdate
        .mockReturnValueOnce(
          q(
            assignmentFixture({
              orderId: h.orderId,
              partnerId: previousPartnerId,
              attemptNo: 1,
            }),
          ),
        )
        .mockReturnValue(q(null));

      await h.service.expireDueOffers(new Date());

      const pipeline = h.aggregate.mock.calls[0][0] as {
        $geoNear: { query: { _id: { $nin: Types.ObjectId[] } } };
      }[];
      const excluded = pipeline[0].$geoNear.query._id.$nin.map((id) =>
        id.toString(),
      );

      // Without this, the rider who just let the offer lapse is the
      // nearest one again and burns all three attempts on their own.
      expect(excluded).toContain(previousPartnerId.toString());
    });

    it('notifies the rider who receives the offer', async () => {
      const nextRiderUserId = oid();
      const h = harness({
        latest: null,
        riders: [{ _id: oid(), userId: nextRiderUserId }],
      });

      h.findOneAndUpdate
        .mockReturnValueOnce(
          q(assignmentFixture({ orderId: h.orderId, attemptNo: 1 })),
        )
        .mockReturnValue(q(null));

      await h.service.expireDueOffers(new Date());

      expect(h.emitToUser).toHaveBeenCalledTimes(1);
      const [userId, event, payload] = h.emitToUser.mock.calls[0] as [
        string,
        string,
        { payout: number; expiresAt: string; orderId: string },
      ];

      // `delivery.assigned` goes to the RIDER'S USER ROOM (§6.3) — the
      // partner id is in the payload, not in the room name.
      expect(userId).toBe(nextRiderUserId.toString());
      expect(event).toBe('delivery.assigned');
      expect(payload.orderId).toBe(h.orderId.toString());
      expect(payload.payout).toBeGreaterThan(0);
      expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Escalation
  // ══════════════════════════════════════════════════════════════════

  describe('escalation', () => {
    it(`escalates instead of offering a ${MAX_ASSIGNMENT_ATTEMPTS + 1}th time`, async () => {
      const h = harness({
        latest: null,
        riders: [{ _id: oid(), userId: oid() }],
      });

      h.findOneAndUpdate
        .mockReturnValueOnce(
          q(
            assignmentFixture({
              orderId: h.orderId,
              attemptNo: MAX_ASSIGNMENT_ATTEMPTS,
            }),
          ),
        )
        .mockReturnValue(q(null));

      await h.service.expireDueOffers(new Date());

      // The engine STOPS. An order that has been offered to three riders
      // needs a person, not a fourth round of the same algorithm.
      expect(h.createAssignment).not.toHaveBeenCalled();
      expect(h.emitToUser).not.toHaveBeenCalled();

      expect(h.emitToVendor).toHaveBeenCalledTimes(1);
      expect(h.emitToAdmin).toHaveBeenCalledTimes(1);

      const [vendorId, vendorEvent, payload] = h.emitToVendor.mock.calls[0] as [
        string,
        string,
        { type: string; data: Record<string, unknown> },
      ];

      expect(vendorId).toBe(h.vendorId.toString());
      expect(vendorEvent).toBe('notification.created');
      expect(payload.type).toBe('delivery.assignment_failed');
      expect(payload.data.attempts).toBe(MAX_ASSIGNMENT_ATTEMPTS);

      const [adminEvent] = h.emitToAdmin.mock.calls[0] as [string];
      expect(adminEvent).toBe('notification.created');
    });

    it('does not escalate again once the attempts are spent', async () => {
      // A later sweep finds the same order: `latestAssignment` already
      // reports the final attempt, so dispatch short-circuits.
      const h = harness({
        latest: assignmentFixture({
          orderId: oid(),
          attemptNo: MAX_ASSIGNMENT_ATTEMPTS,
          status: AssignmentStatus.EXPIRED,
        }),
        riders: [{ _id: oid(), userId: oid() }],
      });

      const outcome = await h.service.dispatch(h.orderId);

      expect(outcome.result).toBe('escalated');
      expect(h.createAssignment).not.toHaveBeenCalled();
      expect(h.emitToVendor).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  The pool
  // ══════════════════════════════════════════════════════════════════

  describe('dispatch preconditions', () => {
    it('spends no attempt when nobody is available', async () => {
      const h = harness({ latest: null, riders: [] });

      const outcome = await h.service.dispatch(h.orderId);

      // Nobody declined — there was nobody to ask. Burning an attempt
      // here would escalate an order that has never been offered to a
      // single rider.
      expect(outcome.result).toBe('no_rider');
      expect(h.createAssignment).not.toHaveBeenCalled();
      expect(h.emitToVendor).not.toHaveBeenCalled();
    });

    it('does nothing while an offer is still live', async () => {
      const h = harness({
        latest: assignmentFixture({
          orderId: oid(),
          status: AssignmentStatus.OFFERED,
          expiresAt: new Date(Date.now() + 30_000),
          attemptNo: 1,
        }),
        riders: [{ _id: oid(), userId: oid() }],
      });

      const outcome = await h.service.dispatch(h.orderId);

      // Idempotence is what lets the sweeper call dispatch freely.
      expect(outcome.result).toBe('already_offered');
      expect(h.createAssignment).not.toHaveBeenCalled();
    });

    it('refuses an order that is not ready for pickup', async () => {
      const h = harness({
        latest: null,
        riders: [{ _id: oid(), userId: oid() }],
        orderStatus: OrderStatus.PICKED_UP,
      });

      const outcome = await h.service.dispatch(h.orderId);

      expect(outcome.result).toBe('not_dispatchable');
      expect(h.createAssignment).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  OTP attempt accounting
  // ══════════════════════════════════════════════════════════════════

  describe('OTP attempt state', () => {
    it('counts down and locks at the cap', () => {
      const base = assignmentFixture({ orderId: oid() });

      expect(otpStateOf(null)).toEqual({
        attemptsUsed: 0,
        attemptsRemaining: MAX_OTP_ATTEMPTS,
        locked: false,
      });

      expect(
        otpStateOf({ ...base, otpAttempts: 2 } as never),
      ).toEqual({
        attemptsUsed: 2,
        attemptsRemaining: MAX_OTP_ATTEMPTS - 2,
        locked: false,
      });

      expect(
        otpStateOf({
          ...base,
          otpAttempts: MAX_OTP_ATTEMPTS,
          otpLockedAt: new Date(),
        } as never),
      ).toEqual({
        attemptsUsed: MAX_OTP_ATTEMPTS,
        attemptsRemaining: 0,
        locked: true,
      });
    });
  });
});
