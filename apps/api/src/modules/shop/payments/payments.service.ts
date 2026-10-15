import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import {
  IdempotencyKey,
  IdempotencyKeyDocument,
} from '../../../database/schemas/idempotency-key.schema';
import {
  canTransition,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';
import { RealtimeService } from '../../../realtime/realtime.service';
import { AuditService } from '../../admin/audit/audit.service';
import { applyTransition } from '../../delivery/order-transition.util';
import { problem } from '../common/problem';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';
import { VerifyPaymentDto } from './dto';

/** Who — or what — triggered a payment resolution. Audit context only. */
export type PaymentResolutionSource =
  | 'webhook'
  | 'client'
  | 'timeout'
  | 'reconciliation';

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string;
}

interface RazorpayWebhookEvent {
  id: string;
  event: string;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
  };
}

/** Mongo duplicate-key error, without importing the `mongodb` package. */
const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  PAYMENTS — the source of truth, and the two ways it gets confirmed
 * ════════════════════════════════════════════════════════════════════════
 *
 * §8.3: "the webhook is the source of truth; the browser callback is an
 * optimisation." Both paths below funnel into the SAME two transactional
 * primitives — `confirmPaidOrder` and `releasePendingOrder` — so there is
 * exactly one place that ever moves money-adjacent state, no matter which
 * of the four callers (webhook, client callback, the 15-minute sweeper,
 * the 20-minute reconciliation sweep) triggered it.
 *
 * Both primitives are IDEMPOTENT by construction: each one loads the
 * order inside a transaction, checks `payment.status === PENDING` before
 * doing anything, and is a harmless no-op the second time it is asked to
 * resolve the same order. That is what lets a duplicated webhook, a
 * client callback racing the webhook, and a sweeper re-running after a
 * crash all land on the same final state without double-crediting or
 * double-refunding a single unit of stock.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(IdempotencyKey.name)
    private readonly idempotencyKeys: Model<IdempotencyKeyDocument>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  //  1. THE WEBHOOK — the authority (§8.3)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Verifies, dedupes and applies one Razorpay webhook delivery.
   *
   * Throws `UnauthorizedException` ONLY when the signature itself is
   * missing, unverifiable (no webhook secret configured) or wrong — that
   * is the one case the controller must answer with something other than
   * 200, because Razorpay never sends an invalid signature and an
   * attacker retrying one is not a case that needs "retry forever".
   *
   * Every other failure (malformed JSON, an event for an order we do not
   * recognise, an internal error applying the transition) is caught by
   * the controller and swallowed behind a 200 — per §8.3, a non-2xx here
   * makes Razorpay retry the SAME event indefinitely, which is worse than
   * losing one event to a bug a human will see in the logs. The
   * reconciliation sweep (§8.3) is the backstop for exactly that case.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Checked explicitly, and BEFORE calling the provider: `verifyWebhookSignature`
    // itself throws a 503 when unconfigured (the right answer for a
    // customer-facing payment call, where "retry later" is meaningful).
    // A webhook delivery is different — "cannot verify" must never fall
    // through to the controller's catch-all, which swallows everything
    // else into a 200. That would silently accept an unverifiable event
    // instead of rejecting it.
    if (!this.provider.isWebhookConfigured()) {
      throw new UnauthorizedException('Webhook is not configured');
    }
    if (!this.provider.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let event: RazorpayWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookEvent;
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    if (!event?.id || !event.event) {
      throw new BadRequestException('Malformed webhook payload');
    }

    // Dedupe on RAZORPAY'S event id, not ours — Razorpay redelivers on
    // any non-2xx and on its own retry schedule, and will send the same
    // `event.id` again.
    const fresh = await this.claimWebhookEvent(event.id);
    if (!fresh) {
      this.logger.debug(`Webhook event ${event.id} already processed — skipped`);
      return;
    }

    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id) {
      this.logger.warn(
        `Webhook event ${event.id} (${event.event}) carried no payment/order — ignored`,
      );
      return;
    }

    const order = await this.orders
      .findOne({ 'payment.providerOrderId': payment.order_id })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();

    if (!order) {
      this.logger.warn(
        `Webhook event ${event.id} referenced unknown provider order ${payment.order_id}`,
      );
      return;
    }

    if (event.event === 'payment.captured') {
      await this.confirmPaidOrder(
        order._id,
        payment.order_id,
        payment.id,
        'webhook',
      );
    } else if (event.event === 'payment.failed') {
      await this.releasePendingOrder(
        order._id,
        'Payment failed at the gateway',
        'webhook',
      );
    } else {
      // e.g. `order.paid`, `refund.processed` — nothing this platform
      // currently acts on. Claimed and logged, never retried.
      this.logger.debug(
        `Webhook event ${event.id} (${event.event}) — no handler, ignored`,
      );
    }
  }

  /** `create()` racing the unique index IS the claim — see IdempotencyKey. */
  private async claimWebhookEvent(eventId: string): Promise<boolean> {
    try {
      await this.idempotencyKeys.create({
        key: `rzp:evt:${eventId}`,
        scope: 'payments.webhook',
        userId: null,
        completed: true,
        statusCode: 200,
        response: null,
      });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  2. THE CLIENT CALLBACK — an optimisation, never the authority
  // ══════════════════════════════════════════════════════════════════

  /**
   * `POST /payments/:orderId/verify`. Ownership of `orderId` is already
   * enforced by `ResourceOwnerGuard` (`@Owns`) before this runs.
   */
  async verifyClientCallback(
    orderId: string,
    dto: VerifyPaymentDto,
  ): Promise<{ status: PaymentStatus }> {
    const order = await this.orders
      .findById(orderId)
      .select('payment')
      .lean<{ payment: Order['payment'] } | null>()
      .exec();
    if (!order) throw new NotFoundException('Order not found');

    if (order.payment.method !== PaymentMethod.ONLINE) {
      throw new ConflictException(
        problem('NOT_ONLINE_PAYMENT', 'This order is not paid online'),
      );
    }

    if (order.payment.providerOrderId !== dto.providerOrderId) {
      throw new ConflictException(
        problem(
          'ORDER_MISMATCH',
          'This payment does not belong to this order',
        ),
      );
    }

    // §8.3: if the webhook already landed, this call is a no-op that
    // reports the state the webhook already established — it never
    // re-derives or re-applies anything.
    if (order.payment.status === PaymentStatus.PAID) {
      return { status: PaymentStatus.PAID };
    }

    const valid = this.provider.verifySignature({
      providerOrderId: dto.providerOrderId,
      providerPaymentId: dto.providerPaymentId,
      signature: dto.signature,
    });
    if (!valid) {
      throw new UnauthorizedException('Invalid payment signature');
    }

    const outcome = await this.confirmPaidOrder(
      new Types.ObjectId(orderId),
      dto.providerOrderId,
      dto.providerPaymentId,
      'client',
    );

    return {
      status: outcome === 'confirmed' ? PaymentStatus.PAID : order.payment.status,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  3. RECONCILIATION — the gateway is asked directly (§8.3)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Resolves ONE pending order by asking Razorpay what actually happened
   * to it, falling back to a timeout-based release when the gateway
   * cannot be asked (not configured, no gateway order was ever created,
   * or the lookup itself fails).
   *
   * Shared by both sweepers: the 15-minute stock-release sweep calls this
   * so it never force-releases stock for an order that was, in fact,
   * paid — and the 20-minute reconciliation sweep calls it as its entire
   * job. See `jobs/payment-jobs.constants.ts` for why the two thresholds
   * are ordered the way they are.
   */
  async reconcileOrder(
    orderId: Types.ObjectId,
    providerOrderId: string | null,
    releaseReason: string,
    source: PaymentResolutionSource,
  ): Promise<'confirmed' | 'released' | 'skipped'> {
    if (this.provider.isConfigured() && providerOrderId) {
      try {
        const status = await this.provider.fetchOrderStatus(providerOrderId);
        if (status.state === 'paid' && status.providerPaymentId) {
          const outcome = await this.confirmPaidOrder(
            orderId,
            providerOrderId,
            status.providerPaymentId,
            source,
          );
          return outcome === 'confirmed' ? 'confirmed' : 'skipped';
        }
        if (status.state === 'pending') {
          // The gateway itself has nothing conclusive yet. Only the
          // reconciliation sweep (20 minutes) should give up at this
          // point; the 15-minute release sweep passes a reason that
          // still means "go ahead and release" because a genuinely
          // abandoned checkout looks identical to this from the
          // gateway's side.
          this.logger.debug(
            `Order ${orderId.toString()}: gateway reports pending, proceeding to release`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Reconciliation lookup failed for order ${orderId.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Fall through to the timeout-based release below.
      }
    }

    const outcome = await this.releasePendingOrder(orderId, releaseReason, source);
    return outcome === 'released' ? 'released' : 'skipped';
  }

  // ══════════════════════════════════════════════════════════════════
  //  The two transactional primitives
  // ══════════════════════════════════════════════════════════════════

  /**
   * `payment.captured`: order confirmed, reservation committed.
   *
   * `$inc { reserved: -qty }` ONLY — `stock` was already decremented at
   * checkout (§8.2), so a captured payment does not touch it again. The
   * qty is now permanently sold.
   */
  async confirmPaidOrder(
    orderId: Types.ObjectId,
    providerOrderId: string,
    providerPaymentId: string,
    source: PaymentResolutionSource,
  ): Promise<'confirmed' | 'skipped'> {
    const session = await this.connection.startSession();
    let confirmed: OrderDocument | null = null;

    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findById(orderId).session(session).exec();
        if (!order) return;

        if (
          order.payment.method !== PaymentMethod.ONLINE ||
          order.payment.providerOrderId !== providerOrderId
        ) {
          this.logger.warn(
            `confirmPaidOrder(${orderId.toString()}) called with a mismatched ` +
              `provider order id — ignored`,
          );
          return;
        }

        // Idempotent: already paid (webhook and client callback raced,
        // or this is a replayed event) — nothing to do.
        if (order.payment.status === PaymentStatus.PAID) return;

        if (order.payment.status !== PaymentStatus.PENDING) {
          // FAILED/REFUNDED: a capture arriving after we already released
          // the stock (an abandoned-looking checkout that paid late).
          // Money moved but the reservation is gone — this needs a human,
          // not a silent oversell of stock that may already be sold to
          // someone else.
          this.logger.error(
            `payment.captured for order ${orderId.toString()} arrived while ` +
              `payment.status=${order.payment.status} — needs manual reconciliation`,
          );
          return;
        }

        await this.commitReservation(order, session);

        order.payment.status = PaymentStatus.PAID;
        order.payment.providerPaymentId = providerPaymentId;
        order.payment.paidAt = new Date();
        await order.save({ session });

        confirmed = order;
      });
    } finally {
      await session.endSession();
    }

    if (!confirmed) return 'skipped';
    const order = confirmed as OrderDocument;

    await this.audit.record({
      action: 'payments.confirm',
      entity: 'Order',
      entityId: order._id.toString(),
      before: { paymentStatus: PaymentStatus.PENDING },
      after: {
        paymentStatus: PaymentStatus.PAID,
        providerPaymentId,
        source,
      },
    });

    this.emitPaymentUpdated(order);
    return 'confirmed';
  }

  /**
   * Timeout / `payment.failed`: reservation released, order cancelled.
   *
   * Only orders whose CURRENT status can still legally move to
   * `CANCELLED` (§5.3's `TRANSITIONS` map — `PLACED`, `ACCEPTED`,
   * `PACKING`, `READY_FOR_PICKUP`) are touched. An order that somehow
   * progressed to `ASSIGNED` or beyond while payment was still pending is
   * left alone and logged loudly — cancelling goods already on a
   * scooter is not a job for a timer.
   */
  async releasePendingOrder(
    orderId: Types.ObjectId,
    reason: string,
    source: PaymentResolutionSource,
  ): Promise<'released' | 'skipped'> {
    const session = await this.connection.startSession();
    let released: OrderDocument | null = null;
    let previousStatus: OrderStatus | null = null;

    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findById(orderId).session(session).exec();
        if (!order) return;

        if (
          order.payment.method !== PaymentMethod.ONLINE ||
          order.payment.status !== PaymentStatus.PENDING
        ) {
          // Already resolved (paid, already released, or COD) — no-op.
          return;
        }

        if (!canTransition(order.status, OrderStatus.CANCELLED)) {
          this.logger.error(
            `Order ${orderId.toString()} has payment.status=pending past its ` +
              `window but is already ${order.status} — cannot auto-cancel; ` +
              `needs manual review`,
          );
          return;
        }

        const at = new Date();
        previousStatus = applyTransition(order, OrderStatus.CANCELLED, 'system', {
          reason,
          at,
        });
        order.payment.status = PaymentStatus.FAILED;
        order.cancellation = { by: null, byUserId: null, reason, at };

        await this.releaseReservation(order, session);
        await order.save({ session });

        released = order;
      });
    } finally {
      await session.endSession();
    }

    if (!released) return 'skipped';
    const order = released as OrderDocument;

    await this.audit.record({
      action: 'payments.release',
      entity: 'Order',
      entityId: order._id.toString(),
      before: { paymentStatus: PaymentStatus.PENDING, status: previousStatus },
      after: {
        paymentStatus: PaymentStatus.FAILED,
        status: OrderStatus.CANCELLED,
        reason,
        source,
      },
    });

    this.emitPaymentUpdated(order);
    this.realtime.emitToOrder(order._id.toString(), 'order.status_changed', {
      orderId: order._id.toString(),
      from: previousStatus,
      to: OrderStatus.CANCELLED,
      at: new Date().toISOString(),
      actorRole: 'system',
    });

    return 'released';
  }

  // ── Stock movement, always inside the caller's transaction ─────────

  private async commitReservation(
    order: OrderDocument,
    session: ClientSession,
  ): Promise<void> {
    for (const item of order.items) {
      await this.inventory
        .updateOne(
          { productId: item.productId },
          { $inc: { reserved: -item.qty } },
          { session },
        )
        .exec();
    }

    await this.inventoryLogs.create(
      order.items.map((item) => ({
        vendorId: order.vendorId,
        productId: item.productId,
        // The reserved hold is cleared; `stock` does not move again —
        // it was already decremented at checkout (§8.2).
        delta: -item.qty,
        reason: InventoryReason.ORDER_COMMIT,
        refId: order._id,
        byUserId: null,
        at: new Date(),
      })),
      // `ordered: true` — see `checkout.service.ts`. Without it a
      // failed payment on a multi-line order never releases its
      // reserved stock.
      { session, ordered: true },
    );
  }

  private async releaseReservation(
    order: OrderDocument,
    session: ClientSession,
  ): Promise<void> {
    for (const item of order.items) {
      await this.inventory
        .updateOne(
          { productId: item.productId },
          { $inc: { stock: item.qty, reserved: -item.qty } },
          { session },
        )
        .exec();
    }

    await this.inventoryLogs.create(
      order.items.map((item) => ({
        vendorId: order.vendorId,
        productId: item.productId,
        delta: item.qty,
        reason: InventoryReason.ORDER_RELEASE,
        refId: order._id,
        byUserId: null,
        at: new Date(),
      })),
      // `ordered: true` — see `checkout.service.ts`.
      { session, ordered: true },
    );
  }

  private emitPaymentUpdated(order: OrderDocument): void {
    const payload = {
      orderId: order._id.toString(),
      status: order.payment.status,
      amount: order.pricing.grandTotal,
      at: new Date().toISOString(),
    };
    this.realtime.emitToOrder(order._id.toString(), 'payment.updated', payload);
    this.realtime.emitToAdmin('payment.updated', payload);
  }
}
