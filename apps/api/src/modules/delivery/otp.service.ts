import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { PasswordService } from '../../common/utils/password.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  PROOF-OF-DELIVERY OTP
 * ════════════════════════════════════════════════════════════════════════
 *
 * The four digits the customer reads out at the door. They are the only
 * evidence that the goods reached the right person, so the rules are
 * narrow:
 *
 *   • The order stores a HASH (`deliveryOtpHash`, `select: false`).
 *     Plain text would mean anyone with read access to the orders
 *     collection could mark deliveries complete from a laptop.
 *   • Comparison is CONSTANT TIME. A comparison that returns early on the
 *     first wrong digit leaks the correct prefix through response timing,
 *     and a 4-digit code falls to that in forty tries.
 *   • The value is never logged, never echoed in a response, and never
 *     put in an error message.
 *
 * ── Two accepted hash formats ───────────────────────────────────────────
 * `$argon2…` is the canonical one — the same `PasswordService` the seeder
 * writes with, so demo data verifies unchanged and an attacker with the
 * database still faces a memory-hard KDF.
 *
 * A 64-character hex string is accepted as an HMAC-SHA256 of the code
 * under ARGON2_PEPPER. Checkout runs at the top of the funnel, and if it
 * chooses the cheaper HMAC over a 19 MiB argon2 hash per order, the rider
 * side verifies it rather than silently failing every delivery. Both are
 * keyed by a secret that lives only in the environment; the format is
 * detected from the stored value, never chosen by the caller.
 */
@Injectable()
export class DeliveryOtpService {
  private readonly pepper: Buffer;

  constructor(
    private readonly passwords: PasswordService,
    config: ConfigService,
  ) {
    this.pepper = Buffer.from(config.getOrThrow<string>('argon2.pepper'));
  }

  /**
   * Hashes a code for storage.
   *
   * Exported for whoever mints the OTP at checkout, so there is one
   * writer and one reader of this format rather than two guesses.
   */
  hash(otp: string): Promise<string> {
    return this.passwords.hash(otp);
  }

  /** The HMAC form, for a caller that cannot afford argon2 per order. */
  hmac(otp: string): string {
    return createHmac('sha256', this.pepper).update(otp).digest('hex');
  }

  /**
   * Constant-time verification.
   *
   * A missing hash is `false`, not an exception: an order with no OTP is
   * a data problem for an operator to look at, and it must not become a
   * way to complete a delivery without one.
   */
  async verify(storedHash: string | null | undefined, otp: string): Promise<boolean> {
    if (!storedHash) return false;

    if (storedHash.startsWith('$argon2')) {
      // argon2.verify is itself constant-time in the secret.
      return this.passwords.verify(storedHash, otp);
    }

    const expected = Buffer.from(storedHash, 'hex');
    const actual = createHmac('sha256', this.pepper).update(otp).digest();

    // timingSafeEqual throws on a length mismatch, which would itself be
    // a timing signal — so the lengths are compared first and the result
    // is the same "no" either way.
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}
