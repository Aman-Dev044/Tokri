import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  KycStatus,
} from '../../../database/schemas/delivery-partner.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  RiderWallet,
  RiderWalletDocument,
} from '../../../database/schemas/rider-wallet.schema';
import { WalletTxnType } from '../../../database/schemas/wallet-transaction.schema';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationTemplates } from '../../notifications/templates';
import { RiderKycService } from '../../delivery/rider-kyc.service';
import { RiderWalletService } from '../../delivery/rider-wallet.service';
import { problem } from '../../shop/common/problem';
import { AuditService } from '../audit/audit.service';
import {
  CreditRiderWalletDto,
  ListRiderKycQueryDto,
  RejectRiderKycDto,
} from './dto';

/** One row of the verification queue. NO identifier numbers. */
export interface RiderKycQueueRow {
  partnerId: string;
  userId: string;
  name: string;
  phone: string;
  status: KycStatus;
  submittedAt: string | null;
  slaDueAt: string | null;
  /** Negative once the 24-hour promise has been missed. */
  slaRemainingMs: number | null;
  breached: boolean;
  documentCount: number;
  walletBalancePaise: number;
}

/**
 * `GET /admin/riders/:id/kyc` — THE ONE PLACE the numbers are whole.
 *
 * Named so nobody can produce it by accident: building this object is a
 * deliberate act in one service method, and the route that returns it is
 * behind `@Roles(SUPER_ADMIN, ADMIN)` and audited.
 */
export interface RiderKycFullView {
  partnerId: string;
  userId: string;
  name: string;
  phone: string;
  status: KycStatus;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectedReason: string | null;
  slaDueAt: string | null;
  slaRemainingMs: number | null;
  breached: boolean;
  /** IN FULL. This endpoint exists to let a human compare it to the card. */
  aadhaarNumber: string | null;
  panNumber: string | null;
  drivingLicenceNumber: string | null;
  documents: { kind: string; url: string; uploadedAt: string }[];
  walletBalancePaise: number;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ADMIN — RIDER KYC AND WALLET
 * ════════════════════════════════════════════════════════════════════════
 *
 * The other half of the rider surface: the queue a human works through,
 * the two decisions they can make, and the one way money gets into a
 * rider's wallet while there is no payment gateway.
 *
 * ── Why the numbers are returned whole on exactly one route ────────────
 * `aadhaarNumber`, `panNumber` and `drivingLicenceNumber` are
 * `select: false` on the schema. `findByIdForVerification` is the only
 * query in the platform that asks for them, and the only response that
 * carries them is the verification screen — which exists SO THAT a human
 * can read the number off the uploaded photograph of the card and
 * confirm they match. Masking it there would leave the reviewer with two
 * things they cannot compare, which is not a control, it is a ritual.
 *
 * The queue listing (`list`) deliberately does NOT select them: an
 * operator scrolling a page of twenty riders has no reason to have
 * twenty Aadhaar numbers in their browser's memory.
 *
 * ── Why `wallet/credit` is an ADJUSTMENT and not a TOPUP ───────────────
 * A TOPUP means the rider paid money to the platform through the
 * gateway. This is a human saying "I have seen the money arrive some
 * other way". Recording it as a top-up would corrupt
 * `lifetimeToppedUpPaise`, which is a figure somebody will eventually
 * reconcile against gateway settlements. `createdBy` is set, and the
 * call is audited.
 */
@Injectable()
export class AdminRidersService {
  private readonly logger = new Logger(AdminRidersService.name);

  constructor(
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(RiderWallet.name)
    private readonly wallets: Model<RiderWalletDocument>,
    private readonly wallet: RiderWalletService,
    private readonly kyc: RiderKycService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  //  The queue
  // ══════════════════════════════════════════════════════════════════

  /**
   * The verification queue, oldest DEADLINE first.
   *
   * Ordered by `kycSlaDueAt` ascending rather than `kycSubmittedAt`: the
   * two agree today because the SLA is a constant offset, but they stop
   * agreeing the moment `RIDER_KYC_SLA_HOURS` changes — and what an
   * operator must work first is what is closest to breaching, not what
   * arrived first.
   */
  async list(query: ListRiderKycQueryDto): Promise<Paginated<RiderKycQueueRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? KycStatus.SUBMITTED;

    const filter: FilterQuery<DeliveryPartnerDocument> = { kycStatus: status };

    const [rows, total] = await Promise.all([
      this.partners
        .find(filter)
        // Ascending with nulls first is what MongoDB does, and that is
        // the right answer here: a NOT_STARTED rider has no deadline and
        // costs an operator nothing to skip past.
        .sort({ kycSlaDueAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        // NOT `+aadhaarNumber` and friends. A page of twenty riders is
        // no reason to put twenty government identifiers in a browser.
        .select(
          'userId kycStatus kycSubmittedAt kycSlaDueAt kycDocuments',
        )
        .exec(),
      this.partners.countDocuments(filter).exec(),
    ]);

    const [accounts, wallets] = await Promise.all([
      this.users
        .find({ _id: { $in: rows.map((row) => row.userId) } })
        .select('name phone')
        .lean<{ _id: Types.ObjectId; name: string; phone: string }[]>()
        .exec(),
      this.wallets
        .find({ partnerId: { $in: rows.map((row) => row._id) } })
        .select('partnerId balancePaise')
        .lean<
          { partnerId: Types.ObjectId; balancePaise: number }[]
        >()
        .exec(),
    ]);

    const accountById = new Map(
      accounts.map((row) => [row._id.toString(), row]),
    );
    const balanceByPartner = new Map(
      wallets.map((row) => [row.partnerId.toString(), row.balancePaise]),
    );

    const now = Date.now();

    return paginate(
      rows.map((partner) => {
        const account = accountById.get(partner.userId.toString());
        const due = partner.kycSlaDueAt ?? null;
        const remaining = due ? due.getTime() - now : null;

        return {
          partnerId: partner._id.toString(),
          userId: partner.userId.toString(),
          name: account?.name ?? '',
          phone: account?.phone ?? '',
          status: partner.kycStatus,
          submittedAt: partner.kycSubmittedAt?.toISOString() ?? null,
          slaDueAt: due ? due.toISOString() : null,
          slaRemainingMs: remaining,
          // A breach is reported, never hidden. An operator who cannot
          // see which promises have already been missed cannot triage.
          breached:
            partner.kycStatus === KycStatus.SUBMITTED &&
            remaining !== null &&
            remaining < 0,
          documentCount: partner.kycDocuments?.length ?? 0,
          walletBalancePaise:
            balanceByPartner.get(partner._id.toString()) ?? 0,
        };
      }),
      total,
      page,
      limit,
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  The one place the numbers are whole
  // ══════════════════════════════════════════════════════════════════

  async findByIdForVerification(id: string): Promise<RiderKycFullView> {
    const partner = await this.requirePartner(id, { withNumbers: true });

    const account = await this.users
      .findById(partner.userId)
      .select('name phone')
      .lean<{ name: string; phone: string } | null>()
      .exec();

    const wallet = await this.wallet.ensureWallet(partner._id);
    const due = partner.kycSlaDueAt ?? null;
    const remaining = due ? due.getTime() - Date.now() : null;

    // Audited BY NAME: reading a government identifier is itself an
    // event worth a row, separately from any decision that follows it.
    // Note the audit carries no number — only that one was read.
    await this.audit.record({
      action: 'admin.riders.kyc.read',
      entity: 'DeliveryPartner',
      entityId: partner._id.toString(),
      before: null,
      after: { kycStatus: partner.kycStatus, identifiersRevealed: true },
    });

    return {
      partnerId: partner._id.toString(),
      userId: partner.userId.toString(),
      name: account?.name ?? '',
      phone: account?.phone ?? '',
      status: partner.kycStatus,
      submittedAt: partner.kycSubmittedAt?.toISOString() ?? null,
      verifiedAt: partner.kycVerifiedAt?.toISOString() ?? null,
      rejectedReason: partner.kycRejectedReason ?? null,
      slaDueAt: due ? due.toISOString() : null,
      slaRemainingMs: remaining,
      breached:
        partner.kycStatus === KycStatus.SUBMITTED &&
        remaining !== null &&
        remaining < 0,
      aadhaarNumber: partner.aadhaarNumber ?? null,
      panNumber: partner.panNumber ?? null,
      drivingLicenceNumber: partner.drivingLicenceNumber ?? null,
      documents: (partner.kycDocuments ?? []).map((doc) => ({
        kind: doc.kind,
        url: doc.url,
        uploadedAt: doc.uploadedAt.toISOString(),
      })),
      walletBalancePaise: wallet.balancePaise,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  The two decisions
  // ══════════════════════════════════════════════════════════════════

  async verify(id: string, actor: JwtUser): Promise<RiderKycFullView> {
    const partner = await this.requirePartner(id, { withNumbers: true });

    if (partner.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException(
        problem('KYC_ALREADY_VERIFIED', 'This rider is already verified.'),
      );
    }

    if (partner.kycStatus === KycStatus.NOT_STARTED) {
      throw new ConflictException(
        problem(
          'KYC_NOT_SUBMITTED',
          'This rider has not submitted any documents yet.',
          { kycStatus: partner.kycStatus },
        ),
      );
    }

    const before = partner.kycStatus;
    partner.set({
      kycStatus: KycStatus.VERIFIED,
      kycVerifiedAt: new Date(),
      kycRejectedReason: null,
      // The deadline is discharged: the promise has been kept (or
      // missed), and a live countdown on a finished item is noise.
      kycSlaDueAt: null,
    });
    await partner.save();

    await this.afterDecision(partner, actor, before, KycStatus.VERIFIED, null);
    return this.findByIdForVerification(id);
  }

  async reject(
    id: string,
    dto: RejectRiderKycDto,
    actor: JwtUser,
  ): Promise<RiderKycFullView> {
    const partner = await this.requirePartner(id, { withNumbers: true });

    if (partner.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException(
        problem(
          'KYC_ALREADY_VERIFIED',
          'This rider is already verified. Suspend them instead of ' +
            'rejecting a verification that has already been granted.',
        ),
      );
    }

    if (partner.kycStatus === KycStatus.NOT_STARTED) {
      throw new ConflictException(
        problem(
          'KYC_NOT_SUBMITTED',
          'This rider has not submitted any documents yet.',
          { kycStatus: partner.kycStatus },
        ),
      );
    }

    const before = partner.kycStatus;
    partner.set({
      kycStatus: KycStatus.REJECTED,
      kycVerifiedAt: null,
      kycRejectedReason: dto.reason,
      kycSlaDueAt: null,
    });
    await partner.save();

    await this.afterDecision(
      partner,
      actor,
      before,
      KycStatus.REJECTED,
      dto.reason,
    );
    return this.findByIdForVerification(id);
  }

  // ══════════════════════════════════════════════════════════════════
  //  The wallet credit — SUPER_ADMIN only
  // ══════════════════════════════════════════════════════════════════

  /**
   * Puts money in a rider's wallet, as an audited ADJUSTMENT.
   *
   * The only way a rider gets a balance on a deployment with no payment
   * gateway. It is not a pretend top-up: the ledger row is an
   * `ADJUSTMENT` with `createdBy` set to the admin who made it, the
   * lifetime top-up total is untouched, and an audit row records the
   * amount and the note.
   */
  async creditWallet(
    id: string,
    dto: CreditRiderWalletDto,
    actor: JwtUser,
  ): Promise<{ balancePaise: number; transactionId: string }> {
    const partner = await this.requirePartner(id);
    const before = await this.wallet.ensureWallet(partner._id);

    const { balanceAfterPaise, transactionId } = await this.wallet.credit({
      partnerId: partner._id,
      type: WalletTxnType.ADJUSTMENT,
      amountPaise: dto.amountPaise,
      note: dto.note,
      createdBy: Types.ObjectId.isValid(actor.sub)
        ? new Types.ObjectId(actor.sub)
        : null,
    });

    await this.audit.record({
      action: 'admin.riders.wallet.credit',
      entity: 'RiderWallet',
      entityId: partner._id.toString(),
      before: { balancePaise: before.balancePaise },
      after: {
        balancePaise: balanceAfterPaise,
        amountPaise: dto.amountPaise,
        note: dto.note,
        transactionId,
      },
      actor,
    });

    const riderUserId = partner.userId.toString();
    await this.wallet.announceBalance(riderUserId, balanceAfterPaise);
    await this.notifications.notify(
      riderUserId,
      NotificationTemplates.walletCredited(dto.amountPaise, balanceAfterPaise),
    );

    return { balancePaise: balanceAfterPaise, transactionId };
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async requirePartner(
    id: string,
    options: { withNumbers?: boolean } = {},
  ): Promise<DeliveryPartnerDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Rider not found');
    }

    const query = this.partners.findById(new Types.ObjectId(id));
    if (options.withNumbers) {
      query.select('+aadhaarNumber +panNumber +drivingLicenceNumber');
    }

    const partner = await query.exec();
    if (!partner) throw new NotFoundException('Rider not found');
    return partner;
  }

  /** Audit, socket and notification — the same three for both decisions. */
  private async afterDecision(
    partner: DeliveryPartnerDocument,
    actor: JwtUser,
    before: KycStatus,
    after: KycStatus,
    reason: string | null,
  ): Promise<void> {
    await this.audit.record({
      action: `admin.riders.kyc.${after === KycStatus.VERIFIED ? 'verify' : 'reject'}`,
      entity: 'DeliveryPartner',
      entityId: partner._id.toString(),
      // No identifier number on either side: an audit row is read by
      // more people, and kept for longer, than the screen it came from.
      before: { kycStatus: before },
      after: { kycStatus: after, reason },
      actor,
    });

    const riderUserId = partner.userId.toString();
    this.kyc.announce(riderUserId, partner);

    await this.notifications.notify(
      riderUserId,
      after === KycStatus.VERIFIED
        ? NotificationTemplates.kycVerified()
        : NotificationTemplates.kycRejected(reason ?? 'No reason given.'),
    );

    this.logger.log(
      `KYC ${after} for partner ${partner._id.toString()} by ${actor.sub}`,
    );
  }
}
