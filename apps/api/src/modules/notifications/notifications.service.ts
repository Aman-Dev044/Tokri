import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Paginated, paginate } from '../../common/dto/paginated';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../../database/schemas/notification.schema';
import {
  NotificationChannel,
  NotificationOutbox,
  NotificationOutboxDocument,
  OutboxStatus,
} from '../../database/schemas/notification-outbox.schema';
import { RealtimeService } from '../../realtime/realtime.service';
import { ListNotificationsQueryDto } from './dto';
import { NotificationEvent } from './templates';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationLean {
  _id: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt?: Date | null;
  createdAt?: Date;
}

/**
 * Every channel this deployment fans a notification out to.
 *
 * There is deliberately no per-user preference store: no endpoint in
 * this task's spec manages one, and a schema nothing ever writes to
 * would be a fake capability rather than a real one (see the same
 * reasoning in `FcmPushProvider`). The channel gate that actually exists
 * today is per-PROVIDER configuration — `SendGridEmailProvider`,
 * `Msg91SmsProvider` and `FcmPushProvider` each no-op on their own when
 * unconfigured. This constant is the one place a future
 * `NotificationPreference` lookup would plug in, narrowing the list per
 * user instead of always fanning out to all three.
 */
const ALL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<NotificationDocument>,
    @InjectModel(NotificationOutbox.name)
    private readonly outbox: Model<NotificationOutboxDocument>,
    private readonly realtime: RealtimeService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  THE fan-out
  // ──────────────────────────────────────────────────────────────────

  /**
   * Fans one event out to every channel this user has available.
   *
   * IN-APP is unconditional and finishes before this resolves: the
   * `Notification` row is written and `notification.created` is emitted
   * to `user:{userId}` through the existing `RealtimeService` — no new
   * gateway, no new room, both already shaped for this event (see
   * `realtime.events.ts`).
   *
   * EMAIL / SMS / PUSH are queued as `NotificationOutbox` rows and
   * returned to immediately — nothing here calls a provider or awaits a
   * network round trip. `NotificationOutboxSweeperService` drains them
   * on its own interval. That split is what keeps a slow SendGrid call
   * from ever holding an order API open.
   *
   * Never throws: a broken notification path must not be the reason an
   * order placement, an accept, or a delivery transition fails. Errors
   * are logged and swallowed, exactly as `RealtimeService.emit` already
   * does one layer down.
   */
  async notify(userId: string, event: NotificationEvent): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      this.logger.error(`notify() called with a malformed userId: "${userId}"`);
      return;
    }

    try {
      const doc = await this.notifications.create({
        userId: new Types.ObjectId(userId),
        type: event.type,
        title: event.title,
        body: event.body,
        data: event.data ?? null,
      });

      this.realtime.emitToUser(userId, 'notification.created', {
        id: doc._id.toString(),
        type: doc.type,
        title: doc.title,
        body: doc.body,
        data: doc.data ?? {},
      });

      await this.enqueueOutbox(doc);
    } catch (error) {
      this.logger.error(
        `notify() failed for user ${userId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async enqueueOutbox(doc: NotificationDocument): Promise<void> {
    const payload = {
      title: doc.title,
      body: doc.body,
      data: doc.data ?? null,
    };
    const now = new Date();

    try {
      await this.outbox.insertMany(
        ALL_CHANNELS.map((channel) => ({
          userId: doc.userId,
          notificationId: doc._id,
          channel,
          status: OutboxStatus.PENDING,
          attempts: 0,
          nextAttemptAt: now,
          payload,
        })),
        { ordered: false },
      );
    } catch (error) {
      // The in-app row above already landed and was already emitted —
      // losing the outbox rows means email/SMS/push miss this one event,
      // not that the customer never hears about it at all.
      this.logger.error(
        `Failed to enqueue outbox rows for notification ${doc._id.toString()}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Customer-facing API
  // ──────────────────────────────────────────────────────────────────

  /** `GET /notifications?page=&limit=` — the caller's own, newest first. */
  async list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = { userId: new Types.ObjectId(userId) };

    const [docs, total] = await Promise.all([
      this.notifications
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<NotificationLean[]>()
        .exec(),
      this.notifications.countDocuments(filter).exec(),
    ]);

    return paginate(docs.map(toRow), total, page, limit);
  }

  /** `GET /notifications/unread-count`. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notifications
      .countDocuments({ userId: new Types.ObjectId(userId), readAt: null })
      .exec();
    return { count };
  }

  /**
   * `PATCH /notifications/:id/read`.
   *
   * The controller already carries `@Owns({ model: 'Notification', field:
   * 'userId' })`, so `ResourceOwnerGuard` has already turned another
   * user's notification id into a 404 before this runs. The `userId`
   * clause here is kept anyway — the same defence-in-depth every other
   * service in this codebase applies at its own filter (see
   * `VendorInventoryService.applyAdjustment`), so ownership is never
   * enforced in exactly one place.
   */
  async markRead(userId: string, id: string): Promise<NotificationRow> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Notification not found');
    }

    const doc = await this.notifications
      .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) })
      .exec();

    if (!doc) throw new NotFoundException('Notification not found');

    if (!doc.readAt) {
      doc.readAt = new Date();
      await doc.save();
    }

    return toRow(doc);
  }

  /** `POST /notifications/read-all`. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications
      .updateMany(
        { userId: new Types.ObjectId(userId), readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();

    return { updated: result.modifiedCount };
  }
}

function toRow(doc: NotificationLean | NotificationDocument): NotificationRow {
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    data: doc.data ?? null,
    readAt: doc.readAt ? new Date(doc.readAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
  };
}
