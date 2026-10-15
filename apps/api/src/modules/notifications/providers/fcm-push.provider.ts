import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderResult, PushMessage, PushProvider } from './provider.interfaces';

/**
 * FCM HTTP v1 push — currently ALWAYS a no-op, and honestly so.
 *
 * Two independent things are both required before a push can be sent,
 * and this deployment has neither:
 *
 *  1. `FCM_SERVICE_ACCOUNT_JSON` — the Google service-account credential
 *     the v1 API signs its OAuth2 bearer token from. Optional in the Joi
 *     schema for the same reason as the other two providers: a
 *     deployment with no push vendor contracted must still boot.
 *
 *  2. A per-device FCM registration token to send TO. There is no
 *     `DeviceToken` collection or `/devices/register` endpoint in this
 *     codebase yet — registering one is a client-side (web push / app)
 *     feature that was not part of this task's scope, and inventing a
 *     schema nothing writes to would be a fake capability, not a real
 *     one.
 *
 * So this adapter checks its own config for the day #1 is resolved, logs
 * the concrete reason it is skipping, and returns 'skipped' — never
 * throws, exactly like the other two providers when unconfigured. Wiring
 * up an actual signed JWT exchange and an HTTP v1 send belongs to the
 * commit that also adds device-token registration; doing it here first
 * would be code with no caller that could ever reach it.
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);

  constructor(private readonly config: ConfigService) {}

  send(_message: PushMessage): Promise<ProviderResult> {
    const serviceAccountJson = this.config.get<string>(
      'notifications.fcmServiceAccountJson',
    );

    if (!serviceAccountJson) {
      this.logger.warn(
        'Push skipped: FCM_SERVICE_ACCOUNT_JSON not configured.',
      );
    } else {
      this.logger.warn(
        'Push skipped: FCM credentials are configured, but this ' +
          'deployment has no device-token registry to send to yet.',
      );
    }

    return Promise.resolve('skipped');
  }
}
