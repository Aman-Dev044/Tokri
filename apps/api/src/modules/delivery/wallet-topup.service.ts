import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { JwtUser } from '../../common/decorators/current-user.decorator';
import { DeliveryPartnerDocument } from '../../database/schemas/delivery-partner.schema';
import {
  WalletTopup,
  WalletTopupDocument,
  WalletTopupStatus,
} from '../../database/schemas/wallet-topup.schema';
import { WalletTxnType } from '../../database/schemas/wallet-transaction.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplates } from '../notifications/templates';
import { problem } from '../shop/common/problem';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../shop/payments/payment-provider';
import { VerifyWalletTopupDto, WalletTopupDto } from './dto';
import { RiderWalletService } from './rider-wallet.service';
import { WalletTopupResponse } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  WALLET TOP-UP
 * ════════════════════════════════════════════════════════════════════════
 *
 * The same gateway, the same port, the same HMAC path as the customer's
 * checkout — `PAYMENT_PROVIDER`, injected, never a Razorpay type imported
 * directly. The verify DTO deliberately carries the SAME three field
 * names as `shop/payments`' `VerifyPaymentDto`: one gateway callback
 * shape across the platform, so a client cannot post the right values
 * under the wrong names to one of the two endpoints.
 *
 * ── On this deployment it 503s, and that is the honest answer ──────────
 * There are no Razorpay keys here. `provider.isConfigured()` is false, so
 * `createTopup` refuses with `PAYMENT_PROVIDER_NOT_CONFIGURED` BEFORE it
 * writes anything — no orphan pending attempt, no fabricated
 * `providerOrderId`, and no "success" the rider would then look for in a
 * balance that never moved. The way a rider actually gets money today is
 * `POST /admin/riders/:id/wallet/credit`, which is an audited ADJUSTMENT
 * made by a human who moved the money some other way.
 *
 * ── What is NOT here: a webhook ─────────────────────────────────────────
 * `POST /webhooks/razorpay` already exists and is keyed to an Order's
 * `payment.providerOrderId`. Teaching it a second document type is a
 * change to `shop/payments`, which this task does not own. Until that
 * happens the client callback is the only confirmation path for a
 * top-up — which is precisely why `verify` re-verifies the HMAC itself
 * rather than trusting the call, and why it is idempotent.
 */
@Injectable()
export class WalletTopupService {
  private readonly logger = new Logger(WalletTopupService.name);

  constructor(
    @InjectModel(WalletTopup.name)
    private readonly topups: Model<WalletTopupDocument>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly wallet: RiderWalletService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Opens a gateway order for `amountPaise`.
   *
   * Refuses with 503 before writing anything when the gateway has no
   * keys. The row is created first on the configured path so the receipt
   * handed to Razorpay is OUR id — a receipt the gateway generated is
   * not a reference this platform can look anything up by.
   */
  async createTopup(
    user: JwtUser,
    partner: DeliveryPartnerDocument,
    dto: WalletTopupDto,
  ): Promise<WalletTopupResponse> {
    if (!this.provider.isConfigured()) {
      throw new ServiceUnavailableException(
        problem(
          'PAYMENT_PROVIDER_NOT_CONFIGURED',
          'Online top-up is not available yet — the payment provider is not ' +
            'configured on this deployment. An administrator can credit your ' +
            'wallet in the meantime.',
          { provider: this.provider.name },
        ),
      );
    }

    const topup = await this.topups.create({
      partnerId: partner._id,
      userId: new Types.ObjectId(user.sub),
      amountPaise: dto.amountPaise,
      status: WalletTopupStatus.PENDING,
    });

    try {
      const order = await this.provider.createOrder({
        receipt: `wallet-${topup._id.toString()}`,
        amount: dto.amountPaise,
        notes: { purpose: 'rider_wallet_topup', partnerId: partner._id.toString() },
      });

      topup.providerOrderId = order.providerOrderId;
      await topup.save();

      return {
        topupId: topup._id.toString(),
        amountPaise: topup.amountPaise,
        gatewayOrder: {
          providerOrderId: order.providerOrderId,
          amount: order.amount,
          currency: 'INR',
          keyId: order.keyId,
        },
      };
    } catch (error) {
      // The attempt never reached the gateway. Mark it FAILED rather
      // than leaving a pending row that a later sweep would try to
      // reconcile against an order id that does not exist.
      topup.status = WalletTopupStatus.FAILED;
      await topup.save();
      throw error;
    }
  }

  /**
   * `POST /delivery/wallet/topup/:topupId/verify`.
   *
   * Verifies the checkout-sheet HMAC and credits the wallet EXACTLY ONCE.
   * Idempotent: a second call on an already-paid attempt reports the same
   * result and moves no money.
   */
  async verifyTopup(
    user: JwtUser,
    partner: DeliveryPartnerDocument,
    topupId: string,
    dto: VerifyWalletTopupDto,
  ): Promise<{ status: WalletTopupStatus; balancePaise: number }> {
    if (!Types.ObjectId.isValid(topupId)) {
      throw new NotFoundException('Top-up not found');
    }

    // Scoped by partner in the SAME query that loads it: another rider's
    // attempt reads as "no such top-up", never as 403.
    const topup = await this.topups
      .findOne({ _id: new Types.ObjectId(topupId), partnerId: partner._id })
      .exec();
    if (!topup) throw new NotFoundException('Top-up not found');

    if (topup.status === WalletTopupStatus.PAID) {
      const current = await this.wallet.ensureWallet(partner._id);
      return {
        status: WalletTopupStatus.PAID,
        balancePaise: current.balancePaise,
      };
    }

    if (topup.status !== WalletTopupStatus.PENDING) {
      throw new ConflictException(
        problem(
          'TOPUP_NOT_PENDING',
          'This top-up attempt is no longer open.',
          { status: topup.status },
        ),
      );
    }

    if (!topup.providerOrderId || topup.providerOrderId !== dto.providerOrderId) {
      throw new ConflictException(
        problem(
          'ORDER_MISMATCH',
          'This payment does not belong to this top-up.',
        ),
      );
    }

    const valid = this.provider.verifySignature({
      providerOrderId: dto.providerOrderId,
      providerPaymentId: dto.providerPaymentId,
      signature: dto.signature,
    });
    if (!valid) throw new UnauthorizedException('Invalid payment signature');

    // The amount comes from the STORED attempt, never from the request.
    const { balanceAfterPaise, transactionId } = await this.wallet.credit({
      partnerId: partner._id,
      type: WalletTxnType.TOPUP,
      amountPaise: topup.amountPaise,
      reference: dto.providerPaymentId,
      note: 'Wallet top-up',
    });

    topup.status = WalletTopupStatus.PAID;
    topup.providerPaymentId = dto.providerPaymentId;
    topup.paidAt = new Date();
    topup.transactionId = new Types.ObjectId(transactionId);
    await topup.save();

    await this.wallet.announceBalance(user.sub, balanceAfterPaise);
    await this.notifications.notify(
      user.sub,
      NotificationTemplates.walletCredited(topup.amountPaise, balanceAfterPaise),
    );

    this.logger.log(
      `Wallet top-up ${topup._id.toString()} paid for partner ${partner._id.toString()}`,
    );

    return { status: WalletTopupStatus.PAID, balancePaise: balanceAfterPaise };
  }
}
