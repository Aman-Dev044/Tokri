import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AssignmentService } from './assignment.service';
import { SWEEP_INTERVAL_MS } from './delivery.constants';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE OFFER TIMER
 * ════════════════════════════════════════════════════════════════════════
 *
 * §8.5 sketches "BullMQ delayed job at expiresAt". This is a single
 * interval-driven sweeper instead, and the choice is deliberate.
 *
 * ── Why not BullMQ ──────────────────────────────────────────────────────
 * `bullmq` is not a dependency of `apps/api` — there is no queue, no
 * worker process, no processor registry and no dashboard. Introducing all
 * of that for ONE 45-second timer would mean a second runtime to deploy,
 * monitor and restart, and a class of failure ("the worker is down, so
 * offers never expire and every order silently stalls") that is invisible
 * until someone notices orders not moving. Half-building it — a queue
 * with no supervised worker — would be worse than either choice.
 *
 * ── Why a sweeper is sufficient here ────────────────────────────────────
 * The work is a single indexed query against `{ expiresAt: 1 }` every
 * five seconds, and it is SAFE ACROSS REPLICAS without a lock: the claim
 * is an atomic `findOneAndUpdate` that flips `offered → expired`, so two
 * replicas sweeping simultaneously cannot both take the same row. It also
 * recovers on its own — a process restart loses no timer, because the
 * deadline lives in the database rather than in a scheduler's memory,
 * which is the one thing a delayed job genuinely cannot claim.
 *
 * The honest trade: up to `SWEEP_INTERVAL_MS` of extra latency on an
 * expiry (5s on a 45s offer), and a query per replica per tick. When
 * notifications and settlements need real queues, an expiry job moves
 * into that infrastructure — with the database deadline still there as
 * the backstop.
 *
 * Each tick does two things:
 *   1. expire offers whose 45 seconds are up, and offer the next rider;
 *   2. re-offer orders sitting ready with nobody looking at them, which
 *      is what makes the engine self-healing after a restart or an empty
 *      rider pool.
 */
@Injectable()
export class AssignmentSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Guards against a slow tick overlapping the next one. */
  private running = false;

  constructor(
    private readonly assignments: AssignmentService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Jest holds the process open for a live interval and every
    // integration spec would carry a background writer racing its
    // fixtures. The sweep itself is asserted directly instead — see
    // `test/unit/assignment.spec.ts`.
    if (this.config.getOrThrow<string>('env') === 'test') return;

    this.timer = setInterval(() => {
      void this.tick();
    }, SWEEP_INTERVAL_MS);

    // Do not hold the event loop open on shutdown for a timer whose work
    // the next boot will redo anyway.
    this.timer.unref();

    this.logger.log(
      `Assignment sweeper started (every ${SWEEP_INTERVAL_MS / 1000}s)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so a test can drive it without waiting on a clock. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const now = new Date();
      const expired = await this.assignments.expireDueOffers(now);
      const dispatched = await this.assignments.redispatchIdleOrders(now);
      // A rider must not pay for an order that was taken away from them.
      // Read from the ORDER's outcome rather than wired into each of the
      // three modules that can cancel one — a refund that depends on
      // every caller remembering it is a refund that gets missed.
      const refunded = await this.assignments.refundCancelledOrderFees();

      if (expired > 0 || dispatched > 0 || refunded > 0) {
        this.logger.log(
          `Sweep: ${expired} offer(s) expired, ${dispatched} order(s) offered, ` +
            `${refunded} pick fee(s) refunded`,
        );
      }
    } catch (error) {
      // A thrown error inside setInterval is an unhandled rejection that
      // takes the process down and stops every future sweep. The tick is
      // idempotent, so swallowing and retrying in five seconds is
      // strictly better than dying.
      this.logger.error(
        `Assignment sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
