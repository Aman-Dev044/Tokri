import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../common/constants/order-status.enum';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
} from '../../database/schemas/delivery-partner.schema';
import {
  DeliveryAssignment,
  DeliveryAssignmentDocument,
  AssignmentStatus,
} from '../../database/schemas/delivery-assignment.schema';
import { Vendor, VendorDocument } from '../../database/schemas/vendor.schema';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  MAX_ASSIGNMENT_ATTEMPTS,
  MAX_OTP_ATTEMPTS,
  OFFER_TTL_MS,
  SWEEP_BATCH,
} from './delivery.constants';
import { GeoService } from './geo.service';
import { applyTransition } from './order-transition.util';
import { RiderWalletService } from './rider-wallet.service';
import { OfferDetail, OfferRow, Waypoint } from './types';

/** Why a dispatch attempt ended, for the sweeper's log line. */
export type DispatchOutcome =
  | { result: 'offered'; assignmentId: string; partnerId: string }
  | { result: 'no_rider' }
  | { result: 'already_offered' }
  | { result: 'not_dispatchable' }
  | { result: 'escalated'; attempts: number };

interface GeoRiderRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  distanceMeters: number;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE ASSIGNMENT ENGINE (§8.5, Challenge #7)
 * ════════════════════════════════════════════════════════════════════════
 *
 *   READY_FOR_PICKUP
 *      ↓  $geoNear — nearest AVAILABLE rider inside the store's radius
 *   DeliveryAssignment { status:'offered', expiresAt: now + 45s }
 *   emit delivery.assigned → user:{riderUserId}
 *      ├─ accepted → order ASSIGNED, partner.activeOrderId set
 *      ├─ rejected → next rider, attemptNo++
 *      └─ expired  → next rider, attemptNo++
 *      ↓
 *   after 3 attempts → the vendor and the admins are told, and the
 *                      algorithm STOPS
 *
 * ── Why it stops ────────────────────────────────────────────────────────
 * An engine that keeps offering forever produces an order that has been
 * "being assigned" for forty minutes while everybody assumes somebody
 * else is looking at it. Three attempts is roughly two and a quarter
 * minutes — long enough to route around one rider on a lunch break, short
 * enough that a human still has time to fix it before the customer
 * notices.
 *
 * ── What is transactional and what is not ───────────────────────────────
 * Creating an offer is a single insert: nothing else changes, so there is
 * nothing to tear. ACCEPTING is two documents — the order gains a rider
 * and a status, the rider gains an active order and loses availability —
 * and both go in ONE transaction, exactly as `AdminOpsDispatchService`
 * does it. Half of that landing is either a rider who does not know they
 * have a job, or a rider held against an order that never moved.
 *
 * ── Events are emitted AFTER the commit, never inside it ────────────────
 * An emit inside `withTransaction` is delivered even when the transaction
 * then aborts, and the rider's phone rings for an order that does not
 * exist. Every method here builds its payload inside the transaction and
 * emits once it has returned.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(DeliveryAssignment.name)
    private readonly assignments: Model<DeliveryAssignmentDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly geo: GeoService,
    private readonly realtime: RealtimeService,
    private readonly wallet: RiderWalletService,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  //  Offering
  // ══════════════════════════════════════════════════════════════════

  /**
   * Offer an order to the nearest available rider.
   *
   * The entry point other modules call: the vendor module invokes it the
   * moment an order reaches READY_FOR_PICKUP. It is also idempotent and
   * safe to call repeatedly — a live offer short-circuits — which is what
   * lets the sweeper use it as a self-healing retry.
   */
  async dispatch(orderId: Types.ObjectId): Promise<DispatchOutcome> {
    const now = new Date();

    const order = await this.orders.findById(orderId).exec();
    if (!order) return { result: 'not_dispatchable' };

    // Only an order that is packed, ready and on nobody's scooter.
    if (
      order.status !== OrderStatus.READY_FOR_PICKUP ||
      order.deliveryPartnerId
    ) {
      return { result: 'not_dispatchable' };
    }

    const latest = await this.latestAssignment(orderId);

    if (
      latest?.status === AssignmentStatus.OFFERED &&
      latest.expiresAt > now
    ) {
      return { result: 'already_offered' };
    }

    const attemptNo = (latest?.attemptNo ?? 0) + 1;
    if (attemptNo > MAX_ASSIGNMENT_ATTEMPTS) {
      // Already escalated when the last attempt failed; do not do it
      // again on every sweep.
      return { result: 'escalated', attempts: latest?.attemptNo ?? 0 };
    }

    const vendor = await this.vendors
      .findById(order.vendorId)
      .select('storeName location serviceRadiusKm address')
      .exec();
    if (!vendor) return { result: 'not_dispatchable' };

    // Nobody who has already seen this order gets to see it twice: a
    // rider who declined once would otherwise be re-offered instantly
    // and the engine would spin through its three attempts on one person.
    const alreadyAsked = await this.assignments
      .find({ orderId })
      .select('partnerId')
      .lean<{ partnerId: Types.ObjectId }[]>()
      .exec();

    const rider = await this.nearestAvailableRider(
      vendor,
      alreadyAsked.map((row) => row.partnerId),
    );

    if (!rider) {
      // No attempt is burned. Nobody declined — there was simply nobody
      // to ask, and spending an attempt on an empty pool would escalate
      // an order that has never actually been offered to anyone.
      return { result: 'no_rider' };
    }

    const assignment = await this.assignments.create({
      orderId,
      partnerId: rider._id,
      status: AssignmentStatus.OFFERED,
      offeredAt: now,
      expiresAt: new Date(now.getTime() + OFFER_TTL_MS),
      attemptNo,
      isDemo: order.isDemo,
    });

    // ── After the write. Nothing above is in a transaction. ──
    const view = this.toOfferRow(assignment, order, vendor, now);
    this.realtime.emitToUser(rider.userId.toString(), 'delivery.assigned', {
      assignmentId: view.id,
      orderId: view.orderId,
      orderNo: view.orderNo,
      pickup: {
        label: view.pickup.label,
        lat: view.pickup.lat ?? 0,
        lng: view.pickup.lng ?? 0,
      },
      drop: {
        label: view.drop.label,
        lat: view.drop.lat ?? 0,
        lng: view.drop.lng ?? 0,
      },
      payout: view.payoutPaise,
      distanceKm: view.distanceKm ?? 0,
      expiresAt: view.expiresAt,
    });

    this.logger.log(
      `Order ${order.orderNo} offered to partner ${rider._id.toString()} ` +
        `(attempt ${attemptNo}/${MAX_ASSIGNMENT_ATTEMPTS})`,
    );

    return {
      result: 'offered',
      assignmentId: assignment._id.toString(),
      partnerId: rider._id.toString(),
    };
  }

  /**
   * `$geoNear` against the `currentLocation` 2dsphere index — the same
   * approach the admin dispatch console uses, and for the same reason:
   * MongoDB does the distance maths and the sort on an index instead of
   * this process scanning the fleet.
   *
   * `$geoNear` MUST be the first pipeline stage. That is a hard
   * constraint of the operator, which is why the availability filter
   * travels inside `query` rather than as a preceding `$match`.
   */
  private async nearestAvailableRider(
    vendor: VendorDocument,
    exclude: Types.ObjectId[],
  ): Promise<GeoRiderRow | null> {
    const coords = vendor.location?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;

    const radiusKm = vendor.serviceRadiusKm > 0 ? vendor.serviceRadiusKm : 0;
    if (radiusKm <= 0) return null;

    const near: [number, number] = [coords[0], coords[1]];

    const rows = await this.partners
      .aggregate<GeoRiderRow>([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: near },
            distanceField: 'distanceMeters',
            maxDistance: radiusKm * 1000,
            spherical: true,
            key: 'currentLocation',
            query: {
              status: PartnerStatus.ACTIVE,
              isOnline: true,
              isAvailable: true,
              activeOrderId: null,
              _id: { $nin: exclude },
              // A store's own riders plus the shared platform pool.
              // Another vendor's rider is not a candidate.
              $or: [{ vendorId: vendor._id }, { vendorId: null }],
            },
          },
        },
        { $limit: 1 },
        { $project: { userId: 1, distanceMeters: 1 } },
      ])
      .exec();

    return rows[0] ?? null;
  }

  // ══════════════════════════════════════════════════════════════════
  //  Rider responses
  // ══════════════════════════════════════════════════════════════════

  /** The rider's live offers: still `offered`, not yet expired. */
  async listOffers(partnerId: Types.ObjectId): Promise<OfferRow[]> {
    const now = new Date();

    const offers = await this.assignments
      .find({
        partnerId,
        status: AssignmentStatus.OFFERED,
        expiresAt: { $gt: now },
      })
      .sort({ offeredAt: 1 })
      .limit(20)
      .exec();

    if (offers.length === 0) return [];

    const orders = await this.orders
      .find({ _id: { $in: offers.map((offer) => offer.orderId) } })
      .exec();
    const orderById = new Map(
      orders.map((order) => [order._id.toString(), order]),
    );

    const vendors = await this.vendors
      .find({ _id: { $in: orders.map((order) => order.vendorId) } })
      .select('storeName location address serviceRadiusKm')
      .exec();
    const vendorById = new Map(
      vendors.map((vendor) => [vendor._id.toString(), vendor]),
    );

    const rows: OfferRow[] = [];
    for (const offer of offers) {
      const order = orderById.get(offer.orderId.toString());
      const vendor = order && vendorById.get(order.vendorId.toString());
      // An order that moved on (cancelled, or assigned elsewhere) is not
      // shown. The offer row is stale, not the order.
      if (!order || !vendor) continue;
      if (order.status !== OrderStatus.READY_FOR_PICKUP) continue;

      rows.push(this.toOfferRow(offer, order, vendor, now));
    }

    return rows;
  }

  /**
   * ════════════════════════════════════════════════════════════════
   *  THE CONFIRM SCREEN — what accepting will cost, BEFORE it costs it
   * ════════════════════════════════════════════════════════════════
   *
   * One live offer in full: the item list, both ends of the trip, the
   * payout, the rider's current balance and the bounds the pick fee
   * will be drawn from.
   *
   * ── Why a RANGE and not the exact fee ───────────────────────────────
   * The fee is drawn at ACCEPT time, inside the transaction that takes
   * it (§1.5). Drawing it here instead would mean either holding a
   * quoted fee somewhere between two requests — a reservation with no
   * expiry, on money — or quoting one number and charging another.
   * Showing `₹25–₹50` is the only statement that is true at the moment
   * it is made, and it is still the difference between a rider knowing
   * what accepting costs and discovering it afterwards.
   *
   * Scoped by partner in the same query that loads it: another rider's
   * offer is 404.
   */
  async offerDetail(
    assignmentId: Types.ObjectId,
    partner: DeliveryPartnerDocument,
  ): Promise<OfferDetail> {
    const now = new Date();

    const assignment = await this.assignments
      .findOne({ _id: assignmentId, partnerId: partner._id })
      .exec();
    if (!assignment) throw new NotFoundException('Offer not found');

    const order = await this.orders.findById(assignment.orderId).exec();
    if (!order) throw new NotFoundException('Offer not found');

    const vendor = await this.vendors
      .findById(order.vendorId)
      .select('storeName location address serviceRadiusKm')
      .exec();
    if (!vendor) throw new NotFoundException('Offer not found');

    const row = this.toOfferRow(assignment, order, vendor, now);
    const wallet = await this.wallet.ensureWallet(partner._id);
    const pickFeeMinPaise = this.wallet.pickFeeMinPaise;

    return {
      ...row,
      items: order.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        image: item.image ?? null,
      })),
      pickFeeMinPaise,
      pickFeeMaxPaise: this.wallet.pickFeeMaxPaise,
      walletBalancePaise: wallet.balancePaise,
      // Against the MINIMUM: a balance that covers ₹25 but not ₹50 can
      // still succeed, and telling the rider "you cannot afford this"
      // when they might would send them to top up for nothing.
      canAfford: wallet.balancePaise >= pickFeeMinPaise,
      kycStatus: partner.kycStatus,
    };
  }

  /**
   * The rider takes the job — and pays for it.
   *
   * Everything that can say no says no BEFORE anything is written: the
   * rider must be KYC-VERIFIED, the offer must be live, it must be
   * theirs, the order must still be in the pool, the rider must not
   * already be carrying something, and their wallet must cover the pick
   * fee.
   *
   * ── THE PICK FEE ────────────────────────────────────────────────────
   * Accepting costs the rider a fee drawn at RANDOM per order in
   * `[RIDER_PICK_FEE_MIN_PAISE, RIDER_PICK_FEE_MAX_PAISE]`. The draw,
   * the balance check, the debit and the ledger row all happen INSIDE
   * the same transaction that moves the order, so there is no state in
   * which the rider has been charged for an order they did not get, or
   * has an order they did not pay for.
   *
   * The wallet row is created BEFORE the transaction opens: an upsert is
   * idempotent and safe to repeat, and keeping it out leaves the
   * transaction to the writes that genuinely have to be atomic.
   */
  async accept(
    assignmentId: Types.ObjectId,
    partner: DeliveryPartnerDocument,
    riderUserId: string,
  ): Promise<{
    orderId: Types.ObjectId;
    assignmentId: Types.ObjectId;
    pickFeePaise: number;
    balancePaise: number;
  }> {
    const now = new Date();

    await this.wallet.ensureWallet(partner._id);

    const session = await this.connection.startSession();

    let orderId: Types.ObjectId | null = null;
    let from: OrderStatus = OrderStatus.READY_FOR_PICKUP;
    let charge: { pickFeePaise: number; balanceAfterPaise: number } | null =
      null;

    try {
      await session.withTransaction(async () => {
        // 1. Identity first. A rider nobody has verified must not be
        //    able to spend money or take custody of a customer's goods,
        //    and finding that out AFTER the debit would mean refunding
        //    a fee that should never have been charged.
        this.wallet.assertKycVerified(partner);

        const assignment = await this.assignments
          .findById(assignmentId)
          .session(session)
          .exec();

        // Not theirs reads as "no such offer". A rider must not be able
        // to discover another rider's offers by trying ids.
        if (!assignment || !assignment.partnerId.equals(partner._id)) {
          throw new NotFoundException('Offer not found');
        }

        if (assignment.status !== AssignmentStatus.OFFERED) {
          throw new ConflictException(
            `This offer was already ${assignment.status}`,
          );
        }

        if (assignment.expiresAt <= now) {
          throw new ConflictException('This offer has expired');
        }

        const order = await this.orders
          .findById(assignment.orderId)
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Order not found');

        if (partner.activeOrderId && !partner.activeOrderId.equals(order._id)) {
          throw new ConflictException(
            'You are already carrying another order',
          );
        }

        // 'system': the rider accepted an OFFER; the platform performs
        // the assignment. See `order-transition.util.ts`.
        from = applyTransition(order, OrderStatus.ASSIGNED, 'system', {
          byUserId: riderUserId,
          reason: 'Offer accepted by rider',
          at: now,
        });
        order.deliveryPartnerId = partner._id;
        await order.save({ session });

        // 2-6. Draw the fee, read the balance, take the money under a
        //       guard, and write the ledger row — all in this
        //       transaction. Throws 402 INSUFFICIENT_WALLET_BALANCE if
        //       the rider cannot cover it, which aborts everything
        //       above: the order stays in the pool for someone else.
        charge = await this.wallet.chargePickFee(
          partner._id,
          order._id,
          session,
        );

        assignment.status = AssignmentStatus.ACCEPTED;
        assignment.respondedAt = now;
        // 7. The exact amount taken, on the attempt it was taken for.
        //    A random charge that is not written down is a charge
        //    nobody can reproduce or refund.
        assignment.pickFeePaise = charge.pickFeePaise;
        await assignment.save({ session });

        // Any other live offer on this order is dead the moment one
        // rider takes it — otherwise a second rider accepts and finds
        // the order gone.
        await this.assignments
          .updateMany(
            {
              orderId: order._id,
              _id: { $ne: assignment._id },
              status: AssignmentStatus.OFFERED,
            },
            {
              $set: {
                status: AssignmentStatus.CANCELLED,
                respondedAt: now,
              },
            },
            { session },
          )
          .exec();

        await this.partners
          .updateOne(
            { _id: partner._id },
            { $set: { activeOrderId: order._id, isAvailable: false } },
            { session },
          )
          .exec();

        orderId = order._id;
      });
    } finally {
      await session.endSession();
    }

    if (!orderId) throw new NotFoundException('Order not found');

    // ── Committed. Now, and only now, tell the world. ──
    this.emitStatusChanged(orderId, from, OrderStatus.ASSIGNED, now);

    // TypeScript narrows `charge` to `null` inside the closure above and
    // cannot see that `withTransaction` ran it — the same reason
    // `PaymentsService` re-casts its committed order. The `orderId`
    // guard three lines up already proves the body completed.
    const applied = charge as unknown as {
      pickFeePaise: number;
      balanceAfterPaise: number;
    };

    // `wallet.updated`, plus `wallet.low_balance` and a notification when
    // the balance is at or under the threshold. Never inside the
    // transaction: an emit from an aborted transaction is a balance the
    // database does not have.
    await this.wallet.announceBalance(riderUserId, applied.balanceAfterPaise);

    return {
      orderId,
      assignmentId,
      pickFeePaise: applied.pickFeePaise,
      balancePaise: applied.balanceAfterPaise,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Refunding a pick fee
  // ══════════════════════════════════════════════════════════════════

  /**
   * Gives back the pick fee on an order that was taken AWAY from the
   * rider, rather than handed back by them.
   *
   * A rider must not pay for an order the platform or the vendor
   * cancelled. Idempotent on `pickFeeRefundedAt`, which is claimed
   * atomically: two sweeps, or a sweep racing an admin action, cannot
   * both pay.
   *
   * Returns the number of assignments actually refunded — 0 is the
   * normal answer, and means there was nothing to give back.
   */
  async refundPickFeeForOrder(orderId: Types.ObjectId, note: string): Promise<number> {
    const chargeable = await this.assignments
      .find({
        orderId,
        status: AssignmentStatus.ACCEPTED,
        pickFeePaise: { $gt: 0 },
        pickFeeRefundedAt: null,
      })
      .exec();

    let refunded = 0;

    for (const assignment of chargeable) {
      // The claim: whoever flips `pickFeeRefundedAt` from null owns the
      // refund. A second caller matches nothing and does not pay again.
      const claimed = await this.assignments
        .findOneAndUpdate(
          { _id: assignment._id, pickFeeRefundedAt: null },
          { $set: { pickFeeRefundedAt: new Date() } },
          { new: true },
        )
        .exec();
      if (!claimed) continue;

      const amountPaise = assignment.pickFeePaise ?? 0;
      if (amountPaise <= 0) continue;

      try {
        const balancePaise = await this.wallet.refundPickFee(
          assignment.partnerId,
          orderId,
          amountPaise,
          note,
        );
        refunded += 1;

        const partner = await this.partners
          .findById(assignment.partnerId)
          .select('userId')
          .lean<{ userId: Types.ObjectId } | null>()
          .exec();

        if (partner) {
          await this.wallet.announceBalance(
            partner.userId.toString(),
            balancePaise,
          );
        }
      } catch (error) {
        // Hand the claim back so the next sweep retries, rather than
        // leaving a rider permanently out of pocket because one credit
        // failed.
        await this.assignments
          .updateOne(
            { _id: assignment._id },
            { $set: { pickFeeRefundedAt: null } },
          )
          .exec();
        this.logger.error(
          `Failed to refund pick fee on assignment ${assignment._id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return refunded;
  }

  /**
   * Every accepted assignment whose order has since been CANCELLED and
   * whose fee has not been given back.
   *
   * Driven by the sweeper rather than wired into each cancellation site:
   * orders are cancelled from the admin console, the vendor console and
   * the payment-timeout sweep — three modules this one does not own —
   * and a refund that depends on all three remembering to call it is a
   * refund that will be missed. Reading the outcome instead of listening
   * for the event also means it self-heals after a crash.
   *
   * A rider who handed the order back themselves is NOT refunded: the
   * assignment is CANCELLED by `returnToPool`, not ACCEPTED, so it never
   * matches the filter above.
   */
  async refundCancelledOrderFees(limit = SWEEP_BATCH): Promise<number> {
    const candidates = await this.assignments
      .find({
        status: AssignmentStatus.ACCEPTED,
        pickFeePaise: { $gt: 0 },
        pickFeeRefundedAt: null,
      })
      .sort({ updatedAt: 1 })
      .limit(limit)
      .select('orderId')
      .lean<{ orderId: Types.ObjectId }[]>()
      .exec();

    if (candidates.length === 0) return 0;

    const cancelled = await this.orders
      .find({
        _id: { $in: candidates.map((row) => row.orderId) },
        status: OrderStatus.CANCELLED,
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();

    let refunded = 0;
    for (const order of cancelled) {
      refunded += await this.refundPickFeeForOrder(
        order._id,
        'Order cancelled — pick fee refunded',
      );
    }

    return refunded;
  }

  /** The rider declines. The next rider is asked immediately. */
  async reject(
    assignmentId: Types.ObjectId,
    partner: DeliveryPartnerDocument,
    reason: string | null,
  ): Promise<void> {
    const now = new Date();

    const assignment = await this.assignments.findById(assignmentId).exec();
    if (!assignment || !assignment.partnerId.equals(partner._id)) {
      throw new NotFoundException('Offer not found');
    }

    if (assignment.status !== AssignmentStatus.OFFERED) {
      throw new ConflictException(
        `This offer was already ${assignment.status}`,
      );
    }

    assignment.status = AssignmentStatus.REJECTED;
    assignment.respondedAt = now;
    assignment.rejectionReason = reason;
    await assignment.save();

    await this.advanceAfterFailedOffer(assignment);
  }

  // ══════════════════════════════════════════════════════════════════
  //  The timer: expiry and self-healing
  // ══════════════════════════════════════════════════════════════════

  /**
   * Claims every offer whose 45 seconds are up and moves each order on.
   *
   * ── Why a claim rather than a read-then-write ───────────────────────
   * `findOneAndUpdate` is ATOMIC: two API replicas sweeping the same
   * collection at the same instant cannot both win the same row, so the
   * order is re-offered exactly once. A `find()` followed by a `save()`
   * would double-offer under exactly the load that makes a second replica
   * necessary, which is the worst possible time to find out.
   */
  async expireDueOffers(now = new Date()): Promise<number> {
    let expired = 0;

    for (let i = 0; i < SWEEP_BATCH; i += 1) {
      const claimed = await this.assignments
        .findOneAndUpdate(
          { status: AssignmentStatus.OFFERED, expiresAt: { $lte: now } },
          {
            $set: {
              status: AssignmentStatus.EXPIRED,
              respondedAt: now,
            },
          },
          { new: true, sort: { expiresAt: 1 } },
        )
        .exec();

      if (!claimed) break;
      expired += 1;

      this.logger.debug(
        `Offer ${claimed._id.toString()} expired (attempt ${claimed.attemptNo})`,
      );
      await this.advanceAfterFailedOffer(claimed);
    }

    return expired;
  }

  /**
   * Orders sitting in READY_FOR_PICKUP with nobody looking at them.
   *
   * Covers the two cases the happy path misses: nobody was available
   * when the order became ready, and the dispatch call was lost to a
   * process restart mid-flight. Attempts already spent are respected, so
   * this retries but never escalates twice.
   */
  async redispatchIdleOrders(now = new Date()): Promise<number> {
    const candidates = await this.orders
      .find({
        status: OrderStatus.READY_FOR_PICKUP,
        deliveryPartnerId: null,
      })
      .sort({ placedAt: 1 })
      .limit(SWEEP_BATCH)
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();

    let dispatched = 0;

    for (const candidate of candidates) {
      const live = await this.assignments
        .countDocuments({
          orderId: candidate._id,
          status: AssignmentStatus.OFFERED,
          expiresAt: { $gt: now },
        })
        .exec();
      if (live > 0) continue;

      const outcome = await this.dispatch(candidate._id);
      if (outcome.result === 'offered') dispatched += 1;
    }

    return dispatched;
  }

  /** Rejected or expired: next rider, or the humans. */
  private async advanceAfterFailedOffer(
    assignment: DeliveryAssignmentDocument,
  ): Promise<void> {
    if (assignment.attemptNo >= MAX_ASSIGNMENT_ATTEMPTS) {
      await this.escalate(assignment.orderId, assignment.attemptNo);
      return;
    }

    await this.dispatch(assignment.orderId);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Rider failure (§8.5)
  // ══════════════════════════════════════════════════════════════════

  /**
   * A rider stopped answering the heartbeat.
   *
   * Marked offline, and then the ONE decision that matters:
   *
   *   • Not yet PICKED_UP → the order goes back to the pool and is
   *     re-offered. Nothing physical has happened yet, so this is free.
   *
   *   • PICKED_UP or later → a human is told, and the order is left
   *     exactly where it is. The goods are on a scooter that is no longer
   *     reporting its position, and no state transition fixes that. An
   *     algorithm that "reassigned" the order here would be sending a
   *     second rider to collect goods that are not in the shop.
   */
  async recoverFromOfflineRider(riderUserId: string): Promise<void> {
    const partner = await this.partners
      .findOne({ userId: new Types.ObjectId(riderUserId) })
      .exec();
    if (!partner) return;

    partner.isOnline = false;
    partner.isAvailable = false;
    await partner.save();

    this.logger.warn(
      `Rider ${riderUserId} missed two heartbeats and was marked offline`,
    );

    if (!partner.activeOrderId) {
      // No job in hand: cancel any live offer so it is not answered by a
      // phone that is no longer there.
      await this.cancelLiveOffersForPartner(partner._id);
      return;
    }

    const order = await this.orders.findById(partner.activeOrderId).exec();
    if (!order) {
      await this.partners
        .updateOne({ _id: partner._id }, { $set: { activeOrderId: null } })
        .exec();
      return;
    }

    if (order.status !== OrderStatus.ASSIGNED) {
      this.escalateNotification(
        order,
        'delivery.rider_unreachable',
        'Rider unreachable mid-delivery',
        `Order ${order.orderNo} is ${order.status} and its rider has stopped ` +
          'reporting. The goods are already out — this needs a phone call, ' +
          'not a reassignment.',
        { orderId: order._id.toString(), status: order.status },
      );
      return;
    }

    await this.returnToPool(order, partner, 'Rider went offline');
  }

  /**
   * Puts an ASSIGNED order back in the pool and frees the rider.
   *
   * `ASSIGNED → READY_FOR_PICKUP` exists on the state machine precisely
   * for this. Both writes go in one transaction: an order back in the
   * pool while the rider is still held against it is a rider who can
   * never be offered anything again.
   */
  private async returnToPool(
    order: OrderDocument,
    partner: DeliveryPartnerDocument,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const orderId = order._id;
    const session = await this.connection.startSession();
    let from: OrderStatus = OrderStatus.ASSIGNED;

    try {
      await session.withTransaction(async () => {
        const fresh = await this.orders.findById(orderId).session(session).exec();
        if (!fresh || fresh.status !== OrderStatus.ASSIGNED) return;

        from = applyTransition(fresh, OrderStatus.READY_FOR_PICKUP, 'system', {
          reason,
          at: now,
        });
        fresh.deliveryPartnerId = null;
        await fresh.save({ session });

        await this.partners
          .updateOne(
            { _id: partner._id, activeOrderId: orderId },
            { $set: { activeOrderId: null } },
            { session },
          )
          .exec();

        await this.assignments
          .updateMany(
            {
              orderId,
              partnerId: partner._id,
              status: {
                $in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED],
              },
            },
            { $set: { status: AssignmentStatus.CANCELLED, respondedAt: now } },
            { session },
          )
          .exec();
      });
    } finally {
      await session.endSession();
    }

    this.emitStatusChanged(orderId, from, OrderStatus.READY_FOR_PICKUP, now);

    // Back in the pool — ask the next rider.
    await this.dispatch(orderId);
  }

  private async cancelLiveOffersForPartner(
    partnerId: Types.ObjectId,
  ): Promise<void> {
    const now = new Date();
    const live = await this.assignments
      .find({ partnerId, status: AssignmentStatus.OFFERED })
      .exec();

    for (const offer of live) {
      offer.status = AssignmentStatus.CANCELLED;
      offer.respondedAt = now;
      await offer.save();
      await this.dispatch(offer.orderId);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Escalation
  // ══════════════════════════════════════════════════════════════════

  /** Three riders asked, nobody took it. Hand it to people. */
  private async escalate(
    orderId: Types.ObjectId,
    attempts: number,
  ): Promise<void> {
    const order = await this.orders.findById(orderId).exec();
    if (!order || order.status !== OrderStatus.READY_FOR_PICKUP) return;

    this.logger.warn(
      `Order ${order.orderNo} found no rider after ${attempts} attempts — ` +
        'escalated to the vendor and the admin console',
    );

    this.escalateNotification(
      order,
      'delivery.assignment_failed',
      'No rider accepted this order',
      `Order ${order.orderNo} was offered to ${attempts} riders and none ` +
        'accepted. It needs a manual assignment from the dispatch board.',
      { orderId: order._id.toString(), attempts },
    );
  }

  /**
   * The escalation channel.
   *
   * `notification.created` carries it, addressed to the vendor's room and
   * the admin room — the two places where somebody is actually looking at
   * a screen. There is no separate "escalation" event because there is no
   * separate escalation UI: it is a notification, and it lands in the
   * notification tray of the people who can act on it.
   */
  private escalateNotification(
    order: OrderDocument,
    type: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): void {
    const payload = {
      id: `${type}:${order._id.toString()}`,
      type,
      title,
      body,
      data: { ...data, orderNo: order.orderNo },
    };

    this.realtime.emitToVendor(
      order.vendorId.toString(),
      'notification.created',
      payload,
    );
    this.realtime.emitToAdmin('notification.created', payload);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Shared helpers
  // ══════════════════════════════════════════════════════════════════

  /** The rider's current attempt on an order, whatever state it is in. */
  async currentAssignment(
    orderId: Types.ObjectId,
    partnerId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DeliveryAssignmentDocument | null> {
    const query = this.assignments
      .findOne({
        orderId,
        partnerId,
        status: AssignmentStatus.ACCEPTED,
      })
      .sort({ attemptNo: -1 });

    if (session) query.session(session);
    return query.exec();
  }

  /**
   * The accepted assignment for an order, created if it is missing.
   *
   * An order assigned from the ADMIN dispatch board never went through an
   * offer, so it has no assignment document — and the OTP attempt counter
   * lives on that document. Rather than scattering null checks through
   * the delivery flow, the record is materialised on first use with the
   * next attempt number, so every delivery in the system has exactly one
   * canonical attempt record regardless of how the rider got it.
   */
  async ensureAcceptedAssignment(
    orderId: Types.ObjectId,
    partnerId: Types.ObjectId,
    isDemo: boolean,
  ): Promise<DeliveryAssignmentDocument> {
    const existing = await this.currentAssignment(orderId, partnerId);
    if (existing) return existing;

    const now = new Date();
    const latest = await this.latestAssignment(orderId);

    return this.assignments.create({
      orderId,
      partnerId,
      status: AssignmentStatus.ACCEPTED,
      offeredAt: now,
      respondedAt: now,
      // Already accepted, so this never expires into anything. The field
      // is required by the schema and reads as "decided at".
      expiresAt: now,
      attemptNo: (latest?.attemptNo ?? 0) + 1,
      isDemo,
    });
  }

  private latestAssignment(
    orderId: Types.ObjectId,
  ): Promise<DeliveryAssignmentDocument | null> {
    return this.assignments
      .findOne({ orderId })
      .sort({ attemptNo: -1 })
      .exec();
  }

  private emitStatusChanged(
    orderId: Types.ObjectId,
    from: OrderStatus,
    to: OrderStatus,
    at: Date,
  ): void {
    this.realtime.emitToOrder(orderId.toString(), 'order.status_changed', {
      orderId: orderId.toString(),
      from,
      to,
      at: at.toISOString(),
      actorRole: 'system',
    });
  }

  /** The offer as the rider app sees it. */
  private toOfferRow(
    assignment: DeliveryAssignmentDocument,
    order: OrderDocument,
    vendor: VendorDocument,
    now: Date,
  ): OfferRow {
    const pickupPoint = vendor.location ?? null;
    const dropPoint = order.address.location ?? null;
    const distanceKm = this.geo.distanceKm(pickupPoint, dropPoint);

    const pickup: Waypoint = {
      label: vendor.storeName,
      address: [vendor.address?.line1, vendor.address?.city]
        .filter(Boolean)
        .join(', '),
      ...coords(this.geo.toLatLng(pickupPoint)),
    };

    const drop: Waypoint = {
      label: order.address.label ?? order.address.city,
      address: [order.address.line1, order.address.city, order.address.pincode]
        .filter(Boolean)
        .join(', '),
      ...coords(this.geo.toLatLng(dropPoint)),
    };

    return {
      id: assignment._id.toString(),
      orderId: order._id.toString(),
      orderNo: order.orderNo,
      attemptNo: assignment.attemptNo,
      offeredAt: assignment.offeredAt.toISOString(),
      expiresAt: assignment.expiresAt.toISOString(),
      expiresInMs: Math.max(0, assignment.expiresAt.getTime() - now.getTime()),
      pickup,
      drop,
      distanceKm,
      itemCount: order.items.length,
      codAmountPaise: codAmountOf(order),
      payoutPaise: this.geo.payoutPaise(distanceKm),
    };
  }
}

/** Cash the rider must collect: zero unless this is an unpaid COD order. */
export const codAmountOf = (order: OrderDocument): number =>
  order.payment.method === PaymentMethod.COD &&
  order.payment.status !== PaymentStatus.PAID
    ? order.pricing.grandTotal
    : 0;

/** The OTP state the rider app renders, from the attempt record. */
export const otpStateOf = (
  assignment: DeliveryAssignmentDocument | null,
): { attemptsUsed: number; attemptsRemaining: number; locked: boolean } => {
  const used = assignment?.otpAttempts ?? 0;
  return {
    attemptsUsed: used,
    attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - used),
    locked: !!assignment?.otpLockedAt,
  };
};

const coords = (
  value: { lat: number; lng: number } | null,
): { lat: number | null; lng: number | null } => ({
  lat: value?.lat ?? null,
  lng: value?.lng ?? null,
});
