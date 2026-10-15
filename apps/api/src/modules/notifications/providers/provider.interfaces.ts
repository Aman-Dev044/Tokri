/**
 * The result of one send attempt.
 *
 *   'sent'    — the provider accepted it.
 *   'skipped' — the provider has no credentials configured. Logged, not
 *               an error: this is the expected state for a COD-only
 *               deployment that has not contracted an email/SMS/push
 *               vendor, and the outbox row is closed rather than retried
 *               forever waiting for a configuration that may never come.
 *
 * A genuine failure (the provider IS configured but the call errors —
 * a timeout, a 5xx, a bad payload) is signalled by THROWING, not by a
 * third enum value: `NotificationOutboxSweeperService` catches exactly
 * that to apply the exponential-backoff retry.
 */
export type ProviderResult = 'sent' | 'skipped';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<ProviderResult>;
}

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<ProviderResult>;
}

export interface PushMessage {
  /** Platform user id. Adapters resolve device tokens from this, if any. */
  userId: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
}

export interface PushProvider {
  send(message: PushMessage): Promise<ProviderResult>;
}

/** DI tokens — the interfaces above have no runtime representation. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
