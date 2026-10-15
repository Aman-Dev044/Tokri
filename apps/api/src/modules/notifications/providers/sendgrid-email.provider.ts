import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EmailMessage,
  EmailProvider,
  ProviderResult,
} from './provider.interfaces';

/**
 * SendGrid `v3/mail/send`, over plain `fetch` — no SendGrid SDK, matching
 * `GeoService`'s Google Maps call and `VendorImagesService`'s hand-rolled
 * S3 SigV4: this platform reaches third-party HTTP APIs directly rather
 * than carrying a client library per vendor.
 *
 * `SENDGRID_API_KEY` and `MAIL_FROM` are read with `config.get()`, never
 * `getOrThrow()`: their absence is the expected state on a deployment
 * that has not contracted SendGrid yet, and must degrade to a logged
 * no-op rather than an exception the caller has to know to catch.
 */
@Injectable()
export class SendGridEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SendGridEmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: EmailMessage): Promise<ProviderResult> {
    const apiKey = this.config.get<string>('notifications.sendgridApiKey');
    const mailFrom = this.config.get<string>('notifications.mailFrom');

    if (!apiKey || !mailFrom) {
      this.logger.warn(
        'Email skipped: SENDGRID_API_KEY / MAIL_FROM not configured.',
      );
      return 'skipped';
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: mailFrom },
        subject: message.subject,
        content: [{ type: 'text/plain', value: message.body }],
      }),
      // A slow SendGrid call must never hang the sweeper tick — the row
      // stays PENDING (via the caller's catch) and is retried with
      // backoff, exactly like a 5xx would be.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`SendGrid responded ${response.status}: ${detail.slice(0, 300)}`);
    }

    return 'sent';
  }
}
