import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument } from '../../database/schemas/user.schema';
import {
  NotificationChannel,
  NotificationOutbox,
  NotificationOutboxDocument,
  OutboxStatus,
} from '../../database/schemas/notification-outbox.schema';
import {
  EMAIL_PROVIDER,
  EmailProvider,
  PUSH_PROVIDER,
  PushProvider,
  SMS_PROVIDER,
  SmsProvider,
} from './providers/provider.interfaces';

/** How often the sweeper looks for claimable rows. */
const TICK_INTERVAL_MS = 5_000;
/** How many rows one tick will drain, so a backlog cannot starve the event loop. */
const BATCH_SIZE = 20;
/** A claim older than this is presumed abandoned by a dead process. */
const STALE_CLAIM_MS = 5 * 60_000;

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
/** Five retries past the first attempt, then it is a human's problem. */
const MAX_ATTEMPTS = 6;

const nextBackoff = (attempts: number): number =>
  Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE OUTBOX SWEEPER
 * ════════════════════════════════════════════════════════════════════════
 *
 * Drains `NotificationOutbox`, the same interval-plus-atomic-claim
 * pattern as `AssignmentSweeperService` — see that file for the full
 * "why not BullMQ" reasoning, which applies here without change: no
 * queue infrastructure exists in `apps/api`, and adding one for this
 * would mean a second runtime to deploy and monitor, with a failure mode
 * ("the worker is down, so notifications silently never send") that is
 * invisible until someone notices.
 *
 * Each row is claimed with an atomic `findOneAndUpdate` that flips
 * `PENDING → PROCESSING`, which is what makes draining SAFE ACROSS
 * REPLICAS without a lock: two sweepers ticking at once cannot both
 * claim the same row. A row whose claim is older than `STALE_CLAIM_MS`
 * is reclaimed too, so a process that dies mid-send cannot strand a row
 * forever — the same problem a queue's "visibility timeout" solves,
 * solved here with the claim timestamp already on the document.
 */
@Injectable()
export class NotificationOutboxSweeperService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationOutboxSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectModel(NotificationOutbox.name)
    private readonly outbox: Model<NotificationOutboxDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  onModuleInit(): void {
    // Same reasoning as AssignmentSweeperService: a live interval would
    // hold every integration test's process open and race its fixtures.
    // The drain logic is exercised directly through `tick()` instead.
    if (this.config.getOrThrow<string>('env') === 'test') return;

    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.timer.unref();

    this.logger.log(
      `Notification outbox sweeper started (every ${TICK_INTERVAL_MS / 1000}s)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: claim and drain up to `BATCH_SIZE` rows. Public for tests. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let drained = 0;

    try {
      for (let i = 0; i < BATCH_SIZE; i += 1) {
        const claimed = await this.claimNext();
        if (!claimed) break;
        await this.drainOne(claimed);
        drained += 1;
      }
    } catch (error) {
      // Never let one bad row or a transient DB hiccup take the timer
      // down — the same defence `AssignmentSweeperService.tick` applies.
      this.logger.error(
        `Notification outbox sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }

    return drained;
  }

  private async claimNext(): Promise<NotificationOutboxDocument | null> {
    const now = new Date();
    return this.outbox
      .findOneAndUpdate(
        {
          $or: [
            { status: OutboxStatus.PENDING, nextAttemptAt: { $lte: now } },
            {
              status: OutboxStatus.PROCESSING,
              claimedAt: { $lte: new Date(now.getTime() - STALE_CLAIM_MS) },
            },
          ],
        },
        { $set: { status: OutboxStatus.PROCESSING, claimedAt: now } },
        { new: true, sort: { nextAttemptAt: 1 } },
      )
      .exec();
  }

  private async drainOne(row: NotificationOutboxDocument): Promise<void> {
    try {
      const result = await this.send(row);

      if (result === 'skipped') {
        row.status = OutboxStatus.SKIPPED;
      } else {
        row.status = OutboxStatus.SENT;
        row.sentAt = new Date();
      }
      row.lastError = null;
      await row.save();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      row.attempts += 1;
      row.lastError = message.slice(0, 500);

      if (row.attempts >= MAX_ATTEMPTS) {
        row.status = OutboxStatus.FAILED;
        this.logger.error(
          `Outbox row ${row._id.toString()} (${row.channel}) failed permanently after ${row.attempts} attempts: ${message}`,
        );
      } else {
        row.status = OutboxStatus.PENDING;
        row.nextAttemptAt = new Date(Date.now() + nextBackoff(row.attempts));
        this.logger.warn(
          `Outbox row ${row._id.toString()} (${row.channel}) attempt ${row.attempts} failed, retrying at ${row.nextAttemptAt.toISOString()}: ${message}`,
        );
      }

      await row.save();
    }
  }

  private async send(row: NotificationOutboxDocument): Promise<'sent' | 'skipped'> {
    if (row.channel === NotificationChannel.EMAIL) {
      const user = await this.users
        .findById(row.userId)
        .select('email')
        .lean<{ email?: string } | null>()
        .exec();
      if (!user?.email) return 'skipped';
      return this.email.send({
        to: user.email,
        subject: row.payload.title,
        body: row.payload.body,
      });
    }

    if (row.channel === NotificationChannel.SMS) {
      const user = await this.users
        .findById(row.userId)
        .select('phone')
        .lean<{ phone?: string } | null>()
        .exec();
      if (!user?.phone) return 'skipped';
      return this.sms.send({ to: user.phone, body: row.payload.body });
    }

    // PUSH
    return this.push.send({
      userId: row.userId.toString(),
      title: row.payload.title,
      body: row.payload.body,
      data: row.payload.data,
    });
  }
}
