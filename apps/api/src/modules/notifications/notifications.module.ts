import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { User, UserSchema } from '../../database/schemas/user.schema';
import {
  Notification,
  NotificationSchema,
} from '../../database/schemas/notification.schema';
import {
  NotificationOutbox,
  NotificationOutboxSchema,
} from '../../database/schemas/notification-outbox.schema';
import { RealtimeModule } from '../../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationOutboxSweeperService } from './outbox-sweeper.service';
import {
  EMAIL_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
} from './providers/provider.interfaces';
import { SendGridEmailProvider } from './providers/sendgrid-email.provider';
import { Msg91SmsProvider } from './providers/msg91-sms.provider';
import { FcmPushProvider } from './providers/fcm-push.provider';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  NOTIFICATIONS
 * ════════════════════════════════════════════════════════════════════════
 *
 * In-app (always works, no configuration needed) plus three optional
 * external channels bound behind `EmailProvider` / `SmsProvider` /
 * `PushProvider` — SendGrid, MSG91 and FCM respectively. Swapping a
 * provider is a different class bound to the same token here, exactly
 * like `PAYMENT_PROVIDER` in `ShopModule`.
 *
 * Imports `RealtimeModule` rather than reimplementing anything about the
 * gateway — `NotificationsService` emits through the existing
 * `RealtimeService.emitToUser`, which already carries
 * `notification.created` in its type map (`realtime.events.ts`).
 */
@Module({
  imports: [
    RealtimeModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationOutbox.name, schema: NotificationOutboxSchema },
      // Read-only here: the sweeper resolves an email/phone to send to.
      { name: User.name, schema: UserSchema },
    ]),
  ],

  controllers: [NotificationsController],

  providers: [
    NotificationsService,
    NotificationOutboxSweeperService,
    { provide: EMAIL_PROVIDER, useClass: SendGridEmailProvider },
    { provide: SMS_PROVIDER, useClass: Msg91SmsProvider },
    { provide: PUSH_PROVIDER, useClass: FcmPushProvider },
  ],

  exports: [NotificationsService],
})
export class NotificationsModule {}
