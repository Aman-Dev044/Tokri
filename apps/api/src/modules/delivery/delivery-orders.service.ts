import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { Role } from '../../common/constants/roles.enum';
import { OrderStatus } from '../../common/constants/order-status.enum';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../database/schemas/delivery-partner.schema';
import { DeliveryAssignmentDocument } from '../../database/schemas/delivery-assignment.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Vendor, VendorDocument } from '../../database/schemas/vendor.schema';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  AssignmentService,
  codAmountOf,
  otpStateOf,
} from './assignment.service';
import { MAX_OTP_ATTEMPTS } from './delivery.constants';
import { DeliverOrderDto, FailDeliveryDto, ProofPhotoPresignDto } from './dto';
import { GeoService } from './geo.service';
import { DeliveryService } from './delivery.service';
import { DeliveryOtpService } from './otp.service';
import {
  DeliveryProofPhotoService,
  PresignedUpload,
} from './proof-photo.service';
import { applyTransition } from './order-transition.util';
import { ActiveOrder, DeliveryTracking, Waypoint } from './types';

/** RFC 4918 423 Locked — absent from Nest's HttpStatus enum. */
const HTTP_STATUS_LOCKED = 423;

/** The statuses that mean "this rider is currently working on it". */
export const RIDER_ACTIVE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.ASSIGNED,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
];

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER'S ORDER
 * ════════════════════════════════════════════════════════════════════════
 *
 * Pick up, set off, deliver, or fail. Four transitions, all of them
 * through `order-transition.util.ts`, none of them reachable for an order
 * that is not this rider's.
 *
 * ── Why every lookup is `{ _id, deliveryPartnerId }` ────────────────────
 * The filter carries the ownership check, so there is no window between
 * "found" and "authorised" and no code path where the second was
 * forgotten. A miss is 404 — never 403 — for the same reason
 * `ResourceOwnerGuard` gives: a 403 confirms the order exists and is
 * simply somebody else's, which turns the endpoint into an enumeration
 * oracle for order ids.
 */
@Injectable()
export class DeliveryOrdersService {
  private readonly logger = new Logger(DeliveryOrdersService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly delivery: DeliveryService,
    private readonly assignments: AssignmentService,
    private readonly otp: DeliveryOtpService,
    private readonly geo: GeoService,
    private readonly realtime: RealtimeService,
    private readonly proofPhoto: DeliveryProofPhotoService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Read
  // ──────────────────────────────────────────────────────────────────

  /**
   * Everything the rider needs on the road: both ends of the trip with
   * coordinates, the customer's phone, the items to check, and the cash
   * to collect. `null` when they have no job.
   */
  async active(user: JwtUser): Promise<ActiveOrder | null> {
    const partner = await this.delivery.requirePartner(user);

    const order = await this.orders
      .findOne({
        deliveryPartnerId: partner._id,
        status: { $in: [...RIDER_ACTIVE_STATUSES] },
      })
      .sort({ placedAt: 1 })
      .exec();

    if (!order) return null;

    const assignment = await this.assignments.currentAssignment(
      order._id,
      partner._id,
    );

    return this.toActiveOrder(order, assignment);
  }

  /**
   * ════════════════════════════════════════════════════════════════
   *  LIVE TRACKING — both parties on one map
   * ════════════════════════════════════════════════════════════════
   *
   * `GET /delivery/orders/:id/tracking`. What an Ola or Uber screen
   * shows: where the rider is RIGHT NOW, where the customer is, where
   * the store is, how far is left, and what is in the bag.
   *
   * The rider's position comes from `DeliveryPartner.currentLocation`,
   * which the existing location-ping stream already rewrites every ten
   * seconds — this endpoint is the initial paint, and
   * `delivery.location_updated` on the order room is what moves the
   * marker afterwards. Polling this in a loop would be a second,
   * slower copy of a stream that already exists.
   *
   * `remainingKm` is measured from the RIDER to the DROP, not pickup to
   * drop: a map that says "2.4 km" while the rider is 200 m from the
   * door is describing the trip, not the wait. The payout, which must
   * stay pickup-to-drop so the statement and the offer agree, is
   * deliberately not re-derived from this number.
   *
   * Scoped by `{ _id, deliveryPartnerId }` like every other read here,
   * so another rider's order is 404 rather than 403.
   */
  async tracking(user: JwtUser, orderId: string): Promise<DeliveryTracking> {
    const partner = await this.delivery.requirePartner(user);
    const order = await this.riderOrder(orderId, partner._id);

    const [vendor, customer] = await Promise.all([
      this.vendors
        .findById(order.vendorId)
        .select('storeName location address')
        .lean<{
          storeName: string;
          location?: VendorDocument['location'] | null;
          address?: { line1?: string; city?: string } | null;
        } | null>()
        .exec(),
      this.users
        .findById(order.customerId)
        .select('name')
        .lean<{ name: string } | null>()
        .exec(),
    ]);

    const pickupPoint = vendor?.location ?? null;
    const dropPoint = order.address.location ?? null;
    const riderPoint = partner.currentLocation ?? null;

    const pickup: Waypoint = {
      label: vendor?.storeName ?? 'Store',
      address: [vendor?.address?.line1, vendor?.address?.city]
        .filter(Boolean)
        .join(', '),
      ...this.coords(pickupPoint),
    };

    const drop: Waypoint = {
      label: order.address.label ?? order.address.city,
      address: [
        order.address.line1,
        order.address.line2,
        order.address.city,
        order.address.pincode,
      ]
        .filter(Boolean)
        .join(', '),
      ...this.coords(dropPoint),
    };

    const riderLatLng = this.geo.toLatLng(riderPoint);
    // Before pickup the rider is heading to the STORE, so what is left
    // of the journey is rider → pickup → drop. After it, it is rider →
    // drop. Quoting the second while the rider is still at home would
    // under-report the wait by the whole first leg.
    const remainingKm =
      order.status === OrderStatus.ASSIGNED
        ? sumKm(
            this.geo.distanceKm(riderPoint, pickupPoint),
            this.geo.distanceKm(pickupPoint, dropPoint),
          )
        : this.geo.distanceKm(riderPoint, dropPoint);

    return {
      orderId: order._id.toString(),
      orderNo: order.orderNo,
      status: order.status,
      rider:
        riderLatLng && partner.locationAt
          ? { ...riderLatLng, at: partner.locationAt.toISOString() }
          : null,
      pickup,
      drop,
      remainingKm,
      etaMinutes: this.geo.etaMinutes(remainingKm),
      items: order.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        image: item.image ?? null,
      })),
      itemCount: order.items.length,
      customerName: customer?.name ?? null,
      customerPhone: order.address.phone,
      codAmountPaise: codAmountOf(order),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Transitions
  // ──────────────────────────────────────────────────────────────────

  /** ASSIGNED → PICKED_UP. The goods have left the store. */
  pickedUp(user: JwtUser, orderId: string): Promise<ActiveOrder> {
    return this.transition(user, orderId, OrderStatus.PICKED_UP, null);
  }

  /** PICKED_UP → OUT_FOR_DELIVERY. Location pings start here. */
  outForDelivery(user: JwtUser, orderId: string): Promise<ActiveOrder> {
    return this.transition(user, orderId, OrderStatus.OUT_FOR_DELIVERY, null);
  }

  /**
   * OUT_FOR_DELIVERY → DELIVERY_FAILED.
   *
   * The rider is released so dispatch can give them other work; the order
   * becomes somebody's problem at a desk. The state machine allows
   * `DELIVERY_FAILED → ASSIGNED`, so a second attempt is a reassignment
   * rather than a new order.
   */
  failed(
    user: JwtUser,
    orderId: string,
    dto: FailDeliveryDto,
  ): Promise<ActiveOrder> {
    return this.transition(
      user,
      orderId,
      OrderStatus.DELIVERY_FAILED,
      dto.reason,
    );
  }

  private async transition(
    user: JwtUser,
    orderId: string,
    to: OrderStatus,
    reason: string | null,
  ): Promise<ActiveOrder> {
    const partner = await this.delivery.requirePartner(user);
    const order = await this.riderOrder(orderId, partner._id);
    const now = new Date();

    // Throws 409 if the transition is not on the map, 403 if the state
    // machine reserves it for another actor.
    const from = applyTransition(order, to, Role.DELIVERY, {
      byUserId: user.sub,
      reason,
      at: now,
    });
    await order.save();

    // A failed delivery frees the rider: they are standing in the street
    // with nothing to do, and leaving them held would take them out of
    // the pool for the rest of the shift.
    if (to === OrderStatus.DELIVERY_FAILED) {
      await this.releasePartner(partner._id, order._id, { completed: false });
    }

    this.emitStatusChanged(order, from, to, now, Role.DELIVERY);

    const assignment = await this.assignments.currentAssignment(
      order._id,
      partner._id,
    );
    return this.toActiveOrder(order, assignment);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Proof of delivery
  // ──────────────────────────────────────────────────────────────────

  /**
   * `POST /delivery/orders/:id/proof-photo` — a presigned S3 PUT for an
   * optional handover photo, exactly like the vendor's product-image
   * presign (`VendorImagesService`). The resulting `publicUrl` is what
   * the rider app then sends back as `photoUrl` on `POST …/deliver` —
   * `DeliverOrderDto.photoUrl` already accepts it; that half of the
   * contract needed no change.
   *
   * Ownership FIRST: `riderOrder` throws 404 before object storage is
   * even consulted, so an unconfigured bucket is never the reason a
   * caller learns whether another rider's order id exists — the same
   * ordering `VendorCatalogController.presignImage` uses.
   */
  async presignProofPhoto(
    user: JwtUser,
    orderId: string,
    dto: ProofPhotoPresignDto,
  ): Promise<PresignedUpload> {
    const partner = await this.delivery.requirePartner(user);
    const order = await this.riderOrder(orderId, partner._id);

    return this.proofPhoto.presignProofPhoto(
      order._id.toString(),
      dto.contentType,
      dto.sizeBytes,
    );
  }

  /**
   * OUT_FOR_DELIVERY → DELIVERED, gated on the customer's OTP.
   *
   * ── The order of the checks matters ─────────────────────────────────
   * Ownership, then the state machine, then the lock, then the code. A
   * wrong-state request is answered 409 without ever touching the OTP
   * counter, so a stale screen cannot burn a rider's attempts; and the
   * attempt is only spent once the request was otherwise valid.
   *
   * ── The cap ─────────────────────────────────────────────────────────
   * Five wrong codes and this delivery is LOCKED (423). Not
   * rate-limited — locked. 10,000 possibilities and an unlimited retry
   * loop is a rider marking somebody else's order delivered in an
   * afternoon, and the counter lives in the database rather than in
   * memory so restarting the API does not reset it. Clearing the lock is
   * deliberately a human decision at the admin console.
   */
  async deliver(
    user: JwtUser,
    orderId: string,
    dto: DeliverOrderDto,
  ): Promise<ActiveOrder> {
    const partner = await this.delivery.requirePartner(user);

    // `+deliveryOtpHash` — the field is `select: false`, so it is absent
    // from every other query in the codebase by default.
    const order = await this.riderOrder(orderId, partner._id, true);
    const now = new Date();

    // The state machine first: an order that is not out for delivery
    // cannot be delivered, whatever code is presented.
    applyTransition(order, OrderStatus.DELIVERED, Role.DELIVERY, {
      byUserId: user.sub,
      at: now,
    });
    // `applyTransition` has already mutated the in-memory document; it is
    // not saved until the OTP is verified below, and nothing between here
    // and there persists it.

    const assignment = await this.assignments.ensureAcceptedAssignment(
      order._id,
      partner._id,
      order.isDemo,
    );

    if (assignment.otpLockedAt) {
      throw new HttpException(
        {
          message:
            'This delivery is locked after too many incorrect codes. ' +
            'Contact support to complete it.',
          // `errors` is the ONE extra key `AllExceptionsFilter` forwards
          // into the RFC 7807 body. Anything outside it is dropped, so
          // the counter the rider app renders has to live here.
          errors: { attemptsRemaining: 0, locked: true },
        },
        // 423 LOCKED. Nest's HttpStatus enum stops short of it, so the
        // code is written out: a locked delivery is neither a 400 (the
        // request is fine) nor a 409 (nothing conflicts) — the resource
        // itself is held until a human releases it.
        HTTP_STATUS_LOCKED,
      );
    }

    const ok = await this.otp.verify(order.deliveryOtpHash, dto.otp);

    if (!ok) {
      assignment.otpAttempts += 1;
      const remaining = Math.max(0, MAX_OTP_ATTEMPTS - assignment.otpAttempts);
      if (remaining === 0) assignment.otpLockedAt = now;
      await assignment.save();

      // The order number identifies the event; the code never appears in
      // a log line, an error message or a response body.
      this.logger.warn(
        `Incorrect delivery OTP for ${order.orderNo} (${assignment.otpAttempts}/${MAX_OTP_ATTEMPTS})`,
      );

      throw new BadRequestException({
        message: 'Incorrect delivery code',
        errors: { attemptsRemaining: remaining, locked: remaining === 0 },
      });
    }

    const from = OrderStatus.OUT_FOR_DELIVERY;
    order.proof.otpVerifiedAt = now;
    if (dto.photoUrl) order.proof.photoUrl = dto.photoUrl;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await order.save({ session });

        // Freed and credited in the SAME transaction as the delivery: a
        // rider still held against a delivered order can never be
        // offered anything again.
        await this.partners
          .updateOne(
            { _id: partner._id },
            {
              $set: { activeOrderId: null, isAvailable: true },
              $inc: { completedCount: 1 },
            },
            { session },
          )
          .exec();
      });
    } finally {
      await session.endSession();
    }

    this.emitStatusChanged(
      order,
      from,
      OrderStatus.DELIVERED,
      now,
      Role.DELIVERY,
    );

    return this.toActiveOrder(order, assignment);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────

  /** This rider's order, or 404. Never another rider's, never a 403. */
  private async riderOrder(
    orderId: string,
    partnerId: Types.ObjectId,
    withOtpHash = false,
  ): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('Order not found');
    }

    const query = this.orders.findOne({
      _id: new Types.ObjectId(orderId),
      deliveryPartnerId: partnerId,
    });

    if (withOtpHash) query.select('+deliveryOtpHash');

    const order = await query.exec();
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async releasePartner(
    partnerId: Types.ObjectId,
    orderId: Types.ObjectId,
    options: { completed: boolean },
  ): Promise<void> {
    await this.partners
      .updateOne(
        { _id: partnerId, activeOrderId: orderId },
        {
          $set: { activeOrderId: null, isAvailable: true },
          ...(options.completed ? { $inc: { completedCount: 1 } } : {}),
        },
      )
      .exec();
  }

  private emitStatusChanged(
    order: OrderDocument,
    from: OrderStatus,
    to: OrderStatus,
    at: Date,
    actorRole: Role,
  ): void {
    // Emitted after `save()` has returned — never from inside the
    // transaction, where a later abort would leave the customer's screen
    // showing a status the database does not have.
    this.realtime.emitToOrder(order._id.toString(), 'order.status_changed', {
      orderId: order._id.toString(),
      from,
      to,
      at: at.toISOString(),
      actorRole,
    });
  }

  private async toActiveOrder(
    order: OrderDocument,
    assignment: DeliveryAssignmentDocument | null,
  ): Promise<ActiveOrder> {
    const [vendor, customer] = await Promise.all([
      this.vendors
        .findById(order.vendorId)
        .select('storeName location address')
        .lean<{
          storeName: string;
          location?: VendorDocument['location'] | null;
          address?: { line1?: string; city?: string } | null;
        } | null>()
        .exec(),
      this.users
        .findById(order.customerId)
        .select('name')
        .lean<{ name: string } | null>()
        .exec(),
    ]);

    const pickupPoint = vendor?.location ?? null;
    const dropPoint = order.address.location ?? null;
    const distanceKm = this.geo.distanceKm(pickupPoint, dropPoint);

    const pickup: Waypoint = {
      label: vendor?.storeName ?? 'Store',
      address: [vendor?.address?.line1, vendor?.address?.city]
        .filter(Boolean)
        .join(', '),
      ...this.coords(pickupPoint),
    };

    const drop: Waypoint = {
      label: order.address.label ?? order.address.city,
      address: [
        order.address.line1,
        order.address.line2,
        order.address.city,
        order.address.pincode,
      ]
        .filter(Boolean)
        .join(', '),
      ...this.coords(dropPoint),
    };

    return {
      orderId: order._id.toString(),
      orderNo: order.orderNo,
      status: order.status,
      assignmentId: assignment ? assignment._id.toString() : null,
      placedAt: order.placedAt.toISOString(),
      pickup,
      drop,
      customerName: customer?.name ?? null,
      // The delivery contact from the order, not the account phone: the
      // person at the door is who the rider needs to reach.
      customerPhone: order.address.phone,
      items: order.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        image: item.image ?? null,
      })),
      itemCount: order.items.length,
      payment: {
        method: order.payment.method,
        status: order.payment.status,
        codAmountPaise: codAmountOf(order),
      },
      distanceKm,
      etaMinutes: this.geo.etaMinutes(distanceKm),
      payoutPaise: this.geo.payoutPaise(distanceKm),
      otp: otpStateOf(assignment),
    };
  }

  private coords(
    geo: Parameters<GeoService['toLatLng']>[0],
  ): { lat: number | null; lng: number | null } {
    const value = this.geo.toLatLng(geo);
    return { lat: value?.lat ?? null, lng: value?.lng ?? null };
  }
}

/**
 * Adds two distances that may each be unknown.
 *
 * `null` propagates: a leg whose coordinates are missing makes the WHOLE
 * remaining distance unknown, and pretending otherwise would quote an ETA
 * that is confidently short by however long that leg is.
 */
const sumKm = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : Math.round((a + b) * 100) / 100;
