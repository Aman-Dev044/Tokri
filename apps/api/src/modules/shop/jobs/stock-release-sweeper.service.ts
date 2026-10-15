import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';
import { PaymentsService } from '../payments/payments.service';
import {
  PAYMENT_PENDING_RELEASE_MS,
  STOCK_RELEASE_SWEEP_BATCH,
  STOCK_RELEASE_SWEEP_INTERVAL_MS,
} from './payment-jobs.constants';

/** The minimal projection this sweeper needs per candidate. */
interface ReleaseCandidate {
  _id: Types.ObjectId;
  payment: { providerOrderId?: string | null };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE 15-MINUTE RELEASE SWEEP (§8.2)
 * ════════════════════════════════════════════════════════════════════════
 *
 * An interval sweeper, not BullMQ — the same choice and the same
 * reasoning as `modules/delivery/assignment-sweeper.service.ts`, copied
 * deliberately rather than reinvented:
 *
 * `bullmq` is not a dependency of `apps/api`. There is no queue, no
 * worker process, no processor registry and no dashboard anywhere in
 * this codebase. Standing all of that up for one 15-minute timer would
 * mean a second runtime to deploy and monitor, and a new failure mode —
 * "the worker is down, so nothing ever releases and every stuck order is
 * invisible until someone notices the shelf never refills" — that a
 * five-times-a-minute database query does not have.
 *
 * ── Safe across replicas, without a lock ─────────────────────────────────
 * Every release is a full ACID transaction (`PaymentsService.
 * releasePendingOrder`) that re-checks `payment.status === PENDING`
 * INSIDE the transaction before writing anything. Two replicas racing the
 * same order either serialize (one wins, one gets a write conflict that
 * `withTransaction` retries, and the retry sees `PENDING` is already gone
 * and no-ops) or interleave safely — there is no window where both can
 * release the same reservation. Nothing here takes an explicit lock,
 * exactly like the assignment sweeper's `findOneAndUpdate` claim: the
 * database's own conflict detection IS the lock.
 *
 * ── A live check before the axe falls ────────────────────────────────────
 * §8.2 describes an unconditional timeout release. This sweeper adds one
 * safe refinement on top of it: when Razorpay is configured and the
 * order actually reached the gateway, it asks Razorpay directly
 * (`PaymentsService.reconcileOrder`) before releasing — so a customer
 * whose payment succeeded but whose webhook is merely slow is confirmed,
 * never force-cancelled. The 15-minute DEADLINE is not softened: if the
 * gateway cannot be reached, does not recognise the order, or reports
 * anything other than "paid", the release proceeds on schedule. This is
 * a strict improvement over a blind timeout, not a deviation from it.
 */
@Injectable()
export class StockReleaseSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockReleaseSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Same reasoning as AssignmentSweeperService: a live interval would
    // hold the Jest process open and race every integration spec's own
    // fixtures. The sweep logic is exercised directly by
    // `test/unit/stock-release.spec.ts` and via `PaymentsService` in
    // `test/integration/payments.spec.ts` instead.
    if (this.config.getOrThrow<string>('env') === 'test') return;

    this.timer = setInterval(() => {
      void this.tick();
    }, STOCK_RELEASE_SWEEP_INTERVAL_MS);
    this.timer.unref();

    this.logger.log(
      `Stock-release sweeper started (every ${STOCK_RELEASE_SWEEP_INTERVAL_MS / 1000}s, ` +
        `${PAYMENT_PENDING_RELEASE_MS / 60_000}min deadline)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so a test can drive it without waiting on a clock. */
  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const cutoff = new Date(now.getTime() - PAYMENT_PENDING_RELEASE_MS);

      const candidates = await this.orders
        .find({
          'payment.method': PaymentMethod.ONLINE,
          'payment.status': PaymentStatus.PENDING,
          placedAt: { $lte: cutoff },
          // Only statuses from which CANCELLED is still a legal
          // transition (§5.3) — see `PaymentsService.releasePendingOrder`
          // for what happens to the rest.
          status: {
            $in: [
              OrderStatus.PLACED,
              OrderStatus.ACCEPTED,
              OrderStatus.PACKING,
              OrderStatus.READY_FOR_PICKUP,
            ],
          },
        })
        .sort({ placedAt: 1 })
        .limit(STOCK_RELEASE_SWEEP_BATCH)
        .select('_id payment.providerOrderId')
        .lean<ReleaseCandidate[]>()
        .exec();

      let resolved = 0;
      for (const candidate of candidates) {
        const outcome = await this.payments.reconcileOrder(
          candidate._id,
          candidate.payment.providerOrderId ?? null,
          `Payment window expired (${PAYMENT_PENDING_RELEASE_MS / 60_000} minutes)`,
          'timeout',
        );
        if (outcome !== 'skipped') resolved += 1;
      }

      if (resolved > 0) {
        this.logger.log(`Stock-release sweep: resolved ${resolved} order(s)`);
      }
      return resolved;
    } catch (error) {
      // Mirrors AssignmentSweeperService: an uncaught error inside
      // setInterval is an unhandled rejection that kills the process and
      // stops every future sweep. The tick is idempotent, so log and
      // retry next tick rather than die.
      this.logger.error(
        `Stock-release sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
