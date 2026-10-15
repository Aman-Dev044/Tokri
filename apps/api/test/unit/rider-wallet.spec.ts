import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';

import {
  RiderWalletService,
} from '../../src/modules/delivery/rider-wallet.service';
import {
  maskAadhaar,
  maskTail,
} from '../../src/modules/delivery/rider-kyc.service';
import {
  DeliveryPartnerDocument,
  KycStatus,
} from '../../src/database/schemas/delivery-partner.schema';
import { RiderWalletDocument } from '../../src/database/schemas/rider-wallet.schema';
import { WalletTransactionDocument } from '../../src/database/schemas/wallet-transaction.schema';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE PICK FEE DRAW, AND THE MASKING RULE — UNIT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two properties that are questions about arithmetic and strings rather
 * than about MongoDB, so they are asserted without a database. The
 * transactional half — the guarded debit, the 402, the ledger row — is
 * asserted against a real replica set in
 * `test/integration/rider-wallet-kyc.spec.ts`, where the transaction IS
 * the property and a stub would prove nothing.
 *
 * ── Why the draw is worth 2,000 iterations ──────────────────────────────
 * `crypto.randomInt(min, max)` is EXCLUSIVE of `max`. The `+ 1` in
 * `drawPickFeePaise` is what makes the advertised ceiling actually
 * reachable — without it a rider is never charged the top of the range
 * and the platform quietly under-charges by one paise-worth of ceiling
 * forever. An off-by-one there is invisible to a single-sample test and
 * obvious to a loop, so this loops.
 */

/** A config that answers only the four rider keys. */
const configWith = (min: number, max: number): ConfigService =>
  ({
    getOrThrow: (key: string) => {
      switch (key) {
        case 'rider.pickFeeMinPaise':
          return min;
        case 'rider.pickFeeMaxPaise':
          return max;
        case 'rider.lowBalanceWarnPaise':
          return 10_000;
        default:
          throw new Error(`Unexpected config key ${key}`);
      }
    },
  }) as unknown as ConfigService;

const serviceWith = (min: number, max: number): RiderWalletService =>
  new RiderWalletService(
    {} as unknown as Model<RiderWalletDocument>,
    {} as unknown as Model<WalletTransactionDocument>,
    configWith(min, max),
    {} as unknown as RealtimeService,
    {} as unknown as NotificationsService,
  );

describe('The pick fee', () => {
  it('is always an integer inside [min, max], inclusive at both ends', () => {
    const service = serviceWith(2_500, 5_000);
    const seen = new Set<number>();

    for (let i = 0; i < 2_000; i += 1) {
      const fee = service.drawPickFeePaise();
      expect(Number.isInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThanOrEqual(2_500);
      expect(fee).toBeLessThanOrEqual(5_000);
      seen.add(fee);
    }

    // It genuinely varies — a "random" fee that returns one value is a
    // constant with extra steps, and this is the assertion that would
    // have caught it.
    expect(seen.size).toBeGreaterThan(100);
  });

  it('can actually draw the ceiling — the `+ 1` is not decoration', () => {
    // A two-value window. `randomInt(min, max)` is EXCLUSIVE of `max`, so
    // without the `+ 1` this could only ever return 2_500 and the
    // advertised top of the range would be unreachable forever.
    const service = serviceWith(2_500, 2_501);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(service.drawPickFeePaise());

    expect(seen.has(2_501)).toBe(true);
    expect(seen.has(2_500)).toBe(true);
    expect(seen.size).toBe(2);
  });

  it('handles a fixed fee, where min and max are the same', () => {
    const service = serviceWith(3_000, 3_000);
    for (let i = 0; i < 50; i += 1) {
      expect(service.drawPickFeePaise()).toBe(3_000);
    }
  });
});

describe('The KYC gate', () => {
  const partnerWith = (kycStatus: KycStatus): DeliveryPartnerDocument =>
    ({ kycStatus }) as unknown as DeliveryPartnerDocument;

  it('lets a VERIFIED rider through', () => {
    const service = serviceWith(2_500, 5_000);
    expect(() =>
      service.assertKycVerified(partnerWith(KycStatus.VERIFIED)),
    ).not.toThrow();
  });

  it('refuses every other state with KYC_NOT_VERIFIED', () => {
    const service = serviceWith(2_500, 5_000);

    for (const status of [
      KycStatus.NOT_STARTED,
      KycStatus.SUBMITTED,
      KycStatus.REJECTED,
    ]) {
      let thrown: unknown = null;
      try {
        service.assertKycVerified(partnerWith(status));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).not.toBeNull();
      const response = (
        thrown as { getResponse: () => { errors: { code: string } } }
      ).getResponse();
      expect(response.errors.code).toBe('KYC_NOT_VERIFIED');
      // SUBMITTED is refused too, and that is the point: a rider whose
      // documents are merely "with us" has not been identified yet, and
      // the fee comes out of a balance attached to that identity.
    }
  });
});

describe('Masking a government identifier', () => {
  it('shows only the last four digits of an Aadhaar', () => {
    expect(maskAadhaar('123456789012')).toBe('XXXX XXXX 9012');
    // The whole number never survives the call.
    expect(maskAadhaar('123456789012')).not.toContain('12345678');
  });

  it('shows only the last four characters of a PAN or a licence', () => {
    expect(maskTail('ABCDE1234F')).toBe('XXXXXX234F');
    expect(maskTail('KA0120210012345')).toBe('XXXXXXXXXXX2345');
  });

  it('masks a short value WHOLE rather than revealing most of it', () => {
    // "Keep the last four" on a four-character value would be no mask at
    // all, which is exactly the case a naive `slice(-4)` gets wrong.
    expect(maskAadhaar('1234')).toBe('XXXX');
    expect(maskTail('AB')).toBe('XX');
  });

  it('passes null through — an absent number has nothing to mask', () => {
    expect(maskAadhaar(null)).toBeNull();
    expect(maskTail(null)).toBeNull();
  });
});
