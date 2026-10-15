import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderResult, SmsMessage, SmsProvider } from './provider.interfaces';

/**
 * MSG91's flow-less plain-text send API, over `fetch`. See
 * `SendGridEmailProvider` for why there is no vendor SDK here.
 *
 * `MSG91_AUTH_KEY` / `MSG91_SENDER_ID` are read with `config.get()`; a
 * COD-only deployment with no SMS vendor contracted must still boot and
 * still deliver in-app notifications, so their absence is a logged
 * no-op, never a thrown error.
 */
@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: SmsMessage): Promise<ProviderResult> {
    const authKey = this.config.get<string>('notifications.msg91AuthKey');
    const senderId = this.config.get<string>('notifications.msg91SenderId');

    if (!authKey || !senderId) {
      this.logger.warn(
        'SMS skipped: MSG91_AUTH_KEY / MSG91_SENDER_ID not configured.',
      );
      return 'skipped';
    }

    const url = new URL('https://control.msg91.com/api/v5/flow/');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authkey: authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: senderId,
        // MSG91's plain-send shape — one recipient, one templated body.
        // Never an OTP: `notify()` is fed only by `templates.ts`.
        recipients: [{ mobiles: message.to, body: message.body }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`MSG91 responded ${response.status}: ${detail.slice(0, 300)}`);
    }

    return 'sent';
  }
}
