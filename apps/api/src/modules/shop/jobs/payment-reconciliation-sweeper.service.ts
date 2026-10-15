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
  PAYMENT_RECONCILE_AFTER_MS,
  PAYMENT_RECONCILE_BATCH,
  PAYMENT_RECONCILE_INTERVAL_MS,
} from './payment-jobs.constants';

interface ReconcileCandidate {
  _id: Types.ObjectId;
  payment: { providerOrderId?: string | null };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE 20-MINUTE RECONCILIATION SWEEP (§8.3)
 * ════════════════════════════════════════════════════════════════════════
 *
 * "This catches the webhook that never arrived — and it is the one thing
 * that makes the whole design safe."
 *
 * Same interval-sweeper shape as `StockReleaseSweeperService`, for the
 * same reasons (no BullMQ in this codebase; safe across replicas because
 * every resolution is a re-checked transaction, not a claimed lock).
 *
 * ── What this sweep is FOR ────────────────────────────────────────────
 * In the ordinary timeline, `StockReleaseSweeperService` (15 minutes)
 * already resolves every stale online order — and it does so by asking
 * the gateway too (`PaymentsService.reconcileOrder`), not just by
 * timing out. By the time an order reaches THIS sweep's 20-minute
 * threshold, it should almost always be gone already.
 *
 * This sweep exists for when that did not happen: the process was down
 * or mid-deploy when the 15-minute window passed, the release sweeper's
 * tick threw and the order slipped through, or a webhook handler caught
 * an internal error and swallowed it behind the required 200 (see the
 * comment on `PaymentsService.handleWebhook`). Those are exactly the
 * failure modes a periodic, independent, re-entrant sweep is for — it
 * does not need to know WHY an order is still pending, only that it has
 * been too long, and it resolves it the same safe way either sweep
 * would: ask Razorpay first, release only if the gateway cannot say the
 * order was paid.
 */
@Injectable()
export class PaymentReconciliationSweeperService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentReconciliationSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // See StockReleaseSweeperService for why this is skipped in `test`.
    if (this.config.getOrThrow<string>('env') === 'test') return;

    this.timer = setInterval(() => {
      void this.tick();
    }, PAYMENT_RECONCILE_INTERVAL_MS);
    this.timer.unref();

    this.logger.log(
      `Payment reconciliation sweeper started (every ` +
        `${PAYMENT_RECONCILE_INTERVAL_MS / 60_000}min, ` +
        `${PAYMENT_RECONCILE_AFTER_MS / 60_000}min threshold)`,
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
      const cutoff = new Date(now.getTime() - PAYMENT_RECONCILE_AFTER_MS);

      const candidates = await this.orders
        .find({
          'payment.method': PaymentMethod.ONLINE,
          'payment.status': PaymentStatus.PENDING,
          placedAt: { $lte: cutoff },
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
        .limit(PAYMENT_RECONCILE_BATCH)
        .select('_id payment.providerOrderId')
        .lean<ReconcileCandidate[]>()
        .exec();

      let resolved = 0;
      for (const candidate of candidates) {
        const outcome = await this.payments.reconcileOrder(
          candidate._id,
          candidate.payment.providerOrderId ?? null,
          `Reconciliation: payment still pending after ` +
            `${PAYMENT_RECONCILE_AFTER_MS / 60_000} minutes`,
          'reconciliation',
        );
        if (outcome !== 'skipped') resolved += 1;
      }

      if (resolved > 0) {
        this.logger.warn(
          `Reconciliation sweep resolved ${resolved} order(s) the release ` +
            `sweeper missed — investigate why they were not caught at 15 minutes`,
        );
      }
      return resolved;
    } catch (error) {
      this.logger.error(
        `Reconciliation sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
