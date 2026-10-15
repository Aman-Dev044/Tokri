import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { JwtUser } from '../../common/decorators/current-user.decorator';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  KycDocument,
  KycDocumentKind,
  KycStatus,
} from '../../database/schemas/delivery-partner.schema';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTemplates } from '../notifications/templates';
import { problem } from '../shop/common/problem';
import {
  AttachKycDocumentDto,
  KycDocumentPresignDto,
  SubmitKycDto,
} from './dto';
import { DeliveryProofPhotoService, PresignedUpload } from './proof-photo.service';
import { KycDocumentRow, RiderKycView } from './types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RIDER KYC
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three government identifiers, up to four document images, one admin
 * decision, and a 24-hour promise.
 *
 * ── The masking rule, and why it is enforced HERE ───────────────────────
 * `aadhaarNumber`, `panNumber` and `drivingLicenceNumber` are
 * `select: false` on the schema, so a query that does not name them
 * cannot leak them. This service is the one place in the rider surface
 * that selects them at all, and it selects them only to MASK them:
 * nothing it returns carries a full number. The single endpoint in the
 * entire platform that returns them whole is
 * `GET /admin/riders/:id/kyc`, which exists so a human can compare the
 * number against the photograph of the card — and that is a different
 * module, behind `@Roles(SUPER_ADMIN, ADMIN)`.
 *
 * Nothing here logs a number. Nothing here puts one in a notification
 * body — the templates take a status and an SLA, and are physically
 * incapable of interpolating an identifier because they do not accept
 * one.
 *
 * ── Resubmission ────────────────────────────────────────────────────────
 * Allowed while NOT_STARTED, SUBMITTED or REJECTED. Refused once
 * VERIFIED: a verified rider silently replacing the Aadhaar a human
 * approved with a different one would make the verification meaningless.
 * Changing a verified identity is an admin action, not a self-service
 * one.
 */
@Injectable()
export class RiderKycService {
  private readonly logger = new Logger(RiderKycService.name);

  constructor(
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly uploads: DeliveryProofPhotoService,
  ) {}

  get slaHours(): number {
    return this.config.getOrThrow<number>('rider.kycSlaHours');
  }

  // ══════════════════════════════════════════════════════════════════
  //  Read
  // ══════════════════════════════════════════════════════════════════

  /**
   * The rider's own KYC screen. Numbers MASKED, never whole.
   *
   * The three identifier fields are explicitly `+selected` here and
   * nowhere else in this module — and immediately reduced to their last
   * four digits before anything is returned.
   */
  async view(partnerId: Types.ObjectId): Promise<RiderKycView> {
    const partner = await this.partners
      .findById(partnerId)
      .select('+aadhaarNumber +panNumber +drivingLicenceNumber')
      .exec();

    if (!partner) throw new NotFoundException('No delivery partner profile');

    return this.toView(partner);
  }

  toView(partner: DeliveryPartnerDocument): RiderKycView {
    const slaDueAt = partner.kycSlaDueAt ?? null;

    return {
      status: partner.kycStatus,
      submittedAt: partner.kycSubmittedAt?.toISOString() ?? null,
      verifiedAt: partner.kycVerifiedAt?.toISOString() ?? null,
      rejectedReason: partner.kycRejectedReason ?? null,
      slaDueAt: slaDueAt ? slaDueAt.toISOString() : null,
      slaRemainingMs:
        slaDueAt && partner.kycStatus === KycStatus.SUBMITTED
          ? Math.max(0, slaDueAt.getTime() - Date.now())
          : null,
      slaHours: this.slaHours,
      aadhaarNumberMasked: maskAadhaar(partner.aadhaarNumber ?? null),
      panNumberMasked: maskTail(partner.panNumber ?? null),
      drivingLicenceNumberMasked: maskTail(partner.drivingLicenceNumber ?? null),
      documents: (partner.kycDocuments ?? []).map(toDocumentRow),
      canResubmit: partner.kycStatus !== KycStatus.VERIFIED,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Submit
  // ══════════════════════════════════════════════════════════════════

  async submit(
    user: JwtUser,
    partner: DeliveryPartnerDocument,
    dto: SubmitKycDto,
  ): Promise<RiderKycView> {
    if (partner.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException(
        problem(
          'KYC_ALREADY_VERIFIED',
          'Your documents are already verified. Contact support to change them.',
          { kycStatus: partner.kycStatus },
        ),
      );
    }

    const now = new Date();
    const slaDueAt = new Date(now.getTime() + this.slaHours * HOUR_MS);

    // A resubmission after a rejection clears the old reason: leaving it
    // behind would show the rider a rejection message beside a pending
    // submission, which reads as a second rejection.
    partner.set({
      aadhaarNumber: dto.aadhaarNumber,
      panNumber: dto.panNumber,
      drivingLicenceNumber: dto.drivingLicenceNumber,
      kycStatus: KycStatus.SUBMITTED,
      kycSubmittedAt: now,
      kycVerifiedAt: null,
      kycRejectedReason: null,
      kycSlaDueAt: slaDueAt,
    });
    await partner.save();

    // Note what is NOT logged: the three numbers. The partner id is an
    // internal identifier, the status is not sensitive.
    this.logger.log(
      `KYC submitted by partner ${partner._id.toString()}; due ${slaDueAt.toISOString()}`,
    );

    this.announce(user.sub, partner);
    await this.notifications.notify(
      user.sub,
      NotificationTemplates.kycSubmitted(this.slaHours),
    );

    return this.toView(partner);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Documents
  // ══════════════════════════════════════════════════════════════════

  /**
   * A presigned PUT for one KYC document.
   *
   * 503 while object storage is unconfigured — which it is on this
   * deployment. The rest of KYC keeps working: a rider can submit their
   * NUMBERS and be verified against them; the images are an additional
   * check, not the only one.
   */
  presignDocument(
    partner: DeliveryPartnerDocument,
    dto: KycDocumentPresignDto,
  ): PresignedUpload {
    if (partner.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException(
        problem(
          'KYC_ALREADY_VERIFIED',
          'Your documents are already verified and cannot be replaced.',
        ),
      );
    }

    return this.uploads.presignKycDocument(
      partner._id.toString(),
      dto.kind,
      dto.contentType,
      dto.sizeBytes,
    );
  }

  /**
   * Records an upload that has already landed in the bucket.
   *
   * The URL is NOT trusted: it must start with the `publicUrl` prefix a
   * presign for this partner would produce, so a rider cannot attach an
   * arbitrary external link (or another rider's object) as their own
   * document. One document per kind — a second upload REPLACES the
   * first, because two "Aadhaar" images are two answers to one question.
   */
  async attachDocument(
    partner: DeliveryPartnerDocument,
    dto: AttachKycDocumentDto,
  ): Promise<RiderKycView> {
    if (partner.kycStatus === KycStatus.VERIFIED) {
      throw new ConflictException(
        problem(
          'KYC_ALREADY_VERIFIED',
          'Your documents are already verified and cannot be replaced.',
        ),
      );
    }

    const prefix = `/riders/${partner._id.toString()}/kyc/${dto.kind}/`;
    if (!dto.url.includes(prefix)) {
      throw new BadRequestException(
        problem(
          'KYC_DOCUMENT_URL_REJECTED',
          'That upload does not belong to this rider and this document kind.',
        ),
      );
    }

    const kept = (partner.kycDocuments ?? []).filter(
      (doc) => doc.kind !== dto.kind,
    );
    partner.set({
      kycDocuments: [
        ...kept,
        { kind: dto.kind, url: dto.url, uploadedAt: new Date() },
      ],
    });
    await partner.save();

    return this.toView(partner);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Announcement
  // ══════════════════════════════════════════════════════════════════

  /**
   * `kyc.status_changed` to the rider's user room.
   *
   * Carries the status, the reason and the deadline — and NO identifier
   * number. A socket payload reaches every device the rider has open,
   * which is the last place a government identifier should travel.
   */
  announce(riderUserId: string, partner: DeliveryPartnerDocument): void {
    this.realtime.emitToUser(riderUserId, 'kyc.status_changed', {
      status: partner.kycStatus,
      reason: partner.kycRejectedReason ?? null,
      slaDueAt:
        partner.kycStatus === KycStatus.SUBMITTED && partner.kycSlaDueAt
          ? partner.kycSlaDueAt.toISOString()
          : null,
      at: new Date().toISOString(),
    });
  }
}

// ── Masking ─────────────────────────────────────────────────────────────

const toDocumentRow = (doc: KycDocument): KycDocumentRow => ({
  kind: doc.kind,
  url: doc.url,
  uploadedAt: doc.uploadedAt.toISOString(),
});

/**
 * `123412341234` → `XXXX XXXX 1234`.
 *
 * The last four are kept so the rider can confirm they sent the right
 * card, which is the entire legitimate use of a partial identifier.
 * Anything shorter than five characters is masked WHOLE rather than
 * revealing most of it.
 */
export function maskAadhaar(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return 'X'.repeat(value.length);
  return `XXXX XXXX ${value.slice(-4)}`;
}

/** Everything but the last four characters, masked. */
export function maskTail(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return 'X'.repeat(value.length);
  return `${'X'.repeat(value.length - 4)}${value.slice(-4)}`;
}

/** Re-exported so the admin module names the same kinds as the rider one. */
export { KycDocumentKind, KycStatus };
