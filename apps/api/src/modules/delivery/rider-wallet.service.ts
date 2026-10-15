import { randomInt } from 'node:crypto';

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import { Paginated, paginate } from '../../common/dto/paginated';
import {
  DeliveryPartnerDocument,
  KycStatus,
} from '../../database/schemas/delivery-partner.schema';
import {
  RiderWallet,
  RiderWalletDocument,
} from '../../database/schemas/rider-wallet.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTxnType,
} from '../../database/schemas/wallet-transaction.schema';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplates } from '../notifications/templates';
import { problem } from '../shop/common/problem';
import { WalletLedgerQueryDto } from './dto';
import { WalletLedgerRow, WalletSummary } from './types';

/** What a successful pick-fee charge produced, for the caller to emit. */
export interface PickFeeCharge {
  pickFeePaise: number;
  balanceAfterPaise: number;
}

/** One credit to write. `amountPaise` is always POSITIVE here. */
export interface CreditInput {
  partnerId: Types.ObjectId;
  type: WalletTxnType.TOPUP | WalletTxnType.EARNING | WalletTxnType.ADJUSTMENT | WalletTxnType.REFUND;
  amountPaise: number;
  orderId?: Types.ObjectId | null;
  reference?: string | null;
  note?: string | null;
  createdBy?: Types.ObjectId | null;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER WALLET
 * ════════════════════════════════════════════════════════════════════════
 *
 * One prepaid balance per rider, one append-only ledger beside it, and
 * exactly one way money leaves it: the PICK FEE charged when a rider
 * accepts an order.
 *
 * ── Why the fee comes from `crypto.randomInt` and not `Math.random()` ──
 * `Math.random()` is an xorshift PRNG seeded once per realm. Its output
 * is not merely "not cryptographically strong" — the internal state is
 * RECOVERABLE from a modest number of consecutive outputs, after which
 * every subsequent draw is predictable. This draw decides how much money
 * comes out of a real person's balance. A rider who can predict the next
 * draw can wait for a cheap one; the platform then has a charge it
 * cannot defend as random. `randomInt` draws from the CSPRNG and is
 * uniform over the range (it rejects and redraws rather than taking a
 * biased modulus), which also matters: a modulo-biased "random" fee is
 * systematically wrong in one direction, forever.
 *
 * ── Why the debit is a GUARDED `$inc` and not read-then-write ──────────
 * Two accepts can be in flight for one rider at the same instant (two
 * offers, two taps, two API replicas). A read of the balance followed by
 * a write of `balance - fee` lets both reads see ₹30, both write ₹0, and
 * the rider takes two orders having paid for roughly one. The guard
 * (`{ _id, balancePaise: { $gte: fee } }`) makes the check and the
 * decrement ONE atomic operation the database arbitrates: the loser
 * matches no document and aborts. The `min: 0` on the schema is the
 * second net, not the first.
 *
 * ── Emits happen AFTER the caller commits, never inside ────────────────
 * `chargePickFee` deliberately returns a payload rather than emitting.
 * An emit inside `withTransaction` is delivered even when the
 * transaction then aborts, and the rider's app would show a balance the
 * database does not have. The caller calls `announceBalance()` once the
 * commit has returned.
 */
@Injectable()
export class RiderWalletService {
  private readonly logger = new Logger(RiderWalletService.name);

  constructor(
    @InjectModel(RiderWallet.name)
    private readonly wallets: Model<RiderWalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly ledger: Model<WalletTransactionDocument>,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Configuration, read once per call, never with a fallback ──────

  get pickFeeMinPaise(): number {
    return this.config.getOrThrow<number>('rider.pickFeeMinPaise');
  }

  get pickFeeMaxPaise(): number {
    return this.config.getOrThrow<number>('rider.pickFeeMaxPaise');
  }

  get lowBalanceWarnPaise(): number {
    return this.config.getOrThrow<number>('rider.lowBalanceWarnPaise');
  }

  // ══════════════════════════════════════════════════════════════════
  //  The wallet document
  // ══════════════════════════════════════════════════════════════════

  /**
   * The rider's wallet, created at zero if this is the first time.
   *
   * Called BEFORE the accept transaction opens, never inside it: an
   * upsert is idempotent and safe to repeat, and doing it outside keeps
   * the transaction to the two writes that actually have to be atomic.
   *
   * `upsert` racing itself is resolved by the UNIQUE index on
   * `partnerId` — the loser's duplicate-key error is swallowed and the
   * row re-read, which is the same claim pattern the payments webhook
   * uses.
   */
  async ensureWallet(partnerId: Types.ObjectId): Promise<RiderWalletDocument> {
    const existing = await this.wallets.findOne({ partnerId }).exec();
    if (existing) return existing;

    try {
      return await this.wallets.create({ partnerId });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.wallets.findOne({ partnerId }).exec();
      if (!raced) throw error;
      return raced;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  THE PICK FEE
  // ══════════════════════════════════════════════════════════════════

  /**
   * One draw in `[min, max]`, INCLUSIVE at both ends.
   *
   * `randomInt(min, max)` is exclusive of `max`, so the `+ 1` is what
   * makes ₹50 actually reachable rather than a bound the rider is never
   * charged. Joi guarantees `max >= min` at boot, so this never throws.
   */
  drawPickFeePaise(): number {
    return randomInt(this.pickFeeMinPaise, this.pickFeeMaxPaise + 1);
  }

  /** KYC is a precondition for spending money, checked before anything. */
  assertKycVerified(partner: DeliveryPartnerDocument): void {
    if (partner.kycStatus === KycStatus.VERIFIED) return;

    throw new ForbiddenException(
      problem(
        'KYC_NOT_VERIFIED',
        'Your documents must be verified before you can accept an order.',
        { kycStatus: partner.kycStatus },
      ),
    );
  }

  /**
   * Draws the fee, checks the balance and takes the money — all inside
   * the caller's transaction.
   *
   * Throws 402 Payment Required, not 400: the request was perfectly
   * well-formed and the rider is being told to add money. A 400 would
   * read to the app as "you sent something wrong", which is the one
   * thing that did not happen.
   */
  async chargePickFee(
    partnerId: Types.ObjectId,
    orderId: Types.ObjectId,
    session: ClientSession,
  ): Promise<PickFeeCharge> {
    const pickFeePaise = this.drawPickFeePaise();

    // Read inside the transaction purely so the 402 can tell the rider
    // what they actually have. The guard below is what enforces it.
    const wallet = await this.wallets
      .findOne({ partnerId })
      .session(session)
      .exec();

    const balancePaise = wallet?.balancePaise ?? 0;
    if (balancePaise < pickFeePaise) {
      throw new HttpException(
        problem(
          'INSUFFICIENT_WALLET_BALANCE',
          'Your wallet does not have enough balance to accept this order.',
          { requiredPaise: pickFeePaise, balancePaise },
        ),
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // The guard and the decrement, atomically, in one operation. A null
    // result is the `matchedCount === 0` case: somebody else spent the
    // money between the read above and this write, so abort rather than
    // overdraw.
    const debited = await this.wallets
      .findOneAndUpdate(
        { _id: wallet?._id, balancePaise: { $gte: pickFeePaise } },
        {
          $inc: {
            balancePaise: -pickFeePaise,
            lifetimeSpentPaise: pickFeePaise,
          },
        },
        { new: true, session },
      )
      .exec();

    if (!debited) {
      throw new HttpException(
        problem(
          'INSUFFICIENT_WALLET_BALANCE',
          'Your wallet does not have enough balance to accept this order.',
          { requiredPaise: pickFeePaise, balancePaise },
        ),
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    await this.ledger.create(
      [
        {
          partnerId,
          type: WalletTxnType.PICK_FEE,
          // SIGNED: a debit is negative, so the balance is always
          // `sum(amountPaise)` and a reconciliation is one aggregate.
          amountPaise: -pickFeePaise,
          balanceAfterPaise: debited.balancePaise,
          orderId,
          createdBy: null,
        },
      ],
      { session },
    );

    return { pickFeePaise, balanceAfterPaise: debited.balancePaise };
  }

  /**
   * Gives a pick fee back, once.
   *
   * Called when an order is taken away from a rider by the PLATFORM or
   * the VENDOR — never when the rider themselves hands it back. A rider
   * must not pay for an order they were not allowed to keep.
   *
   * Idempotent on `pickFeeRefundedAt`, set by the caller in the same
   * breath: a sweeper re-running after a crash must not pay twice.
   */
  async refundPickFee(
    partnerId: Types.ObjectId,
    orderId: Types.ObjectId,
    amountPaise: number,
    note: string,
  ): Promise<number> {
    const { balanceAfterPaise } = await this.credit({
      partnerId,
      type: WalletTxnType.REFUND,
      amountPaise,
      orderId,
      note,
    });
    return balanceAfterPaise;
  }

  // ══════════════════════════════════════════════════════════════════
  //  Credits
  // ══════════════════════════════════════════════════════════════════

  /**
   * Adds money and writes the matching ledger row.
   *
   * `$inc` with `upsert: true` so a rider who has never had a wallet can
   * still be credited — the first top-up creates it. `amountPaise` must
   * be positive; a negative "credit" would be a debit that skipped the
   * balance guard entirely, which is precisely the hole this refuses.
   */
  async credit(
    input: CreditInput,
  ): Promise<{ balanceAfterPaise: number; transactionId: string }> {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new HttpException(
        problem(
          'INVALID_CREDIT_AMOUNT',
          'A credit must be a positive whole number of paise.',
        ),
        HttpStatus.BAD_REQUEST,
      );
    }

    const lifetimeField =
      input.type === WalletTxnType.EARNING
        ? 'lifetimeEarnedPaise'
        : input.type === WalletTxnType.TOPUP
          ? 'lifetimeToppedUpPaise'
          : null;

    const inc: Record<string, number> = { balancePaise: input.amountPaise };
    // An ADJUSTMENT or a REFUND is not a top-up and not an earning: it
    // moves the balance without belonging to either lifetime total. A
    // refund in particular must NOT inflate "topped up" — the rider
    // never put that money in.
    if (lifetimeField) inc[lifetimeField] = input.amountPaise;

    const wallet = await this.wallets
      .findOneAndUpdate(
        { partnerId: input.partnerId },
        { $inc: inc, $setOnInsert: { partnerId: input.partnerId } },
        { new: true, upsert: true },
      )
      .exec();

    const row = await this.ledger.create({
      partnerId: input.partnerId,
      type: input.type,
      amountPaise: input.amountPaise,
      balanceAfterPaise: wallet.balancePaise,
      orderId: input.orderId ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    });

    return {
      balanceAfterPaise: wallet.balancePaise,
      transactionId: row._id.toString(),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════

  async summary(
    partner: DeliveryPartnerDocument,
  ): Promise<WalletSummary> {
    const wallet = await this.ensureWallet(partner._id);
    const threshold = this.lowBalanceWarnPaise;

    return {
      balancePaise: wallet.balancePaise,
      lowBalance: wallet.balancePaise <= threshold,
      warnThresholdPaise: threshold,
      lifetimeEarnedPaise: wallet.lifetimeEarnedPaise,
      lifetimeToppedUpPaise: wallet.lifetimeToppedUpPaise,
      lifetimeSpentPaise: wallet.lifetimeSpentPaise,
      totalDelivered: partner.completedCount,
      pickFeeMinPaise: this.pickFeeMinPaise,
      pickFeeMaxPaise: this.pickFeeMaxPaise,
    };
  }

  async transactions(
    partnerId: Types.ObjectId,
    query: WalletLedgerQueryDto,
  ): Promise<Paginated<WalletLedgerRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [rows, total] = await Promise.all([
      this.ledger
        .find({ partnerId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<WalletTransactionLean[]>()
        .exec(),
      this.ledger.countDocuments({ partnerId }).exec(),
    ]);

    return paginate(rows.map(toLedgerRow), total, page, limit);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Announcements — ALWAYS after the caller's commit
  // ══════════════════════════════════════════════════════════════════

  /**
   * Tells the rider their balance moved, and warns them if it is now low.
   *
   * Never throws: a broken socket or a slow notification provider must
   * not be the reason an accept, a top-up or an admin credit fails after
   * the money has already moved.
   */
  async announceBalance(
    riderUserId: string,
    balancePaise: number,
  ): Promise<void> {
    const thresholdPaise = this.lowBalanceWarnPaise;
    const lowBalance = balancePaise <= thresholdPaise;

    try {
      this.realtime.emitToUser(riderUserId, 'wallet.updated', {
        balancePaise,
        lowBalance,
      });

      if (lowBalance) {
        this.realtime.emitToUser(riderUserId, 'wallet.low_balance', {
          balancePaise,
          thresholdPaise,
        });
        await this.notifications.notify(
          riderUserId,
          NotificationTemplates.walletLowBalance(balancePaise, thresholdPaise),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to announce wallet balance for user ${riderUserId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

interface WalletTransactionLean {
  _id: Types.ObjectId;
  type: WalletTxnType;
  amountPaise: number;
  balanceAfterPaise: number;
  orderId?: Types.ObjectId | null;
  reference?: string | null;
  note?: string | null;
  createdAt?: Date;
}

const toLedgerRow = (row: WalletTransactionLean): WalletLedgerRow => ({
  id: row._id.toString(),
  type: row.type,
  amountPaise: row.amountPaise,
  balanceAfterPaise: row.balanceAfterPaise,
  orderId: row.orderId ? row.orderId.toString() : null,
  reference: row.reference ?? null,
  note: row.note ?? null,
  createdAt: (row.createdAt ?? new Date()).toISOString(),
});

/** Mongo duplicate-key, without importing the `mongodb` package. */
const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;
