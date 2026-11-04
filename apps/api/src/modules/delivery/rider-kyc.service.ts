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
  KYC_NUMBER_FIELDS,
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
  VehicleDetailsDto,
} from './dto';
import { DeliveryProofPhotoService, PresignedUpload } from './proof-photo.service';
import {
  VEHICLE_DOCUMENT_KINDS,
  insuranceStanding,
  parseCalendarDay,
  toCalendarDay,
} from './rider-vehicle';
import { KycDocumentRow, RiderKycView } from './types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RIDER KYC
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three government identifiers, the vehicle's plate, RC and policy, up to
 * six document images, one admin decision, and a 24-hour promise.
 *
 * ── The masking rule, and why it is enforced HERE ───────────────────────
 * `aadhaarNumber`, `panNumber`, `drivingLicenceNumber` and the three
 * vehicle numbers are `select: false` on the schema, so a query that does not name them
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
 *
 * ── The vehicle is the exception, and it reopens the review ─────────────
 * A person keeps one Aadhaar for life; a rider changes scooters, and
 * renews insurance every single year. Refusing vehicle changes once
 * VERIFIED would send every rider to support annually, so
 * `PUT /delivery/profile/kyc/vehicle` (and a vehicle document upload)
 * stays open to a verified rider — but a CHANGE sends the record back to
 * SUBMITTED with a fresh SLA. "Verified" is a human's statement that the
 * numbers on file match the documents; a plate or policy that no human
 * has seen would make that statement false while still displaying it.
 *
 * Two edges keep that from being harsher than it must be:
 *   • Sending back the details already on file changes nothing, so it
 *     does not demote anyone — a double-tapped Save is not a new claim.
 *   • Only ACCEPTING an order is gated on VERIFIED. A rider mid-run when
 *     they update their vehicle finishes that run; they wait for the
 *     re-review only before taking the next one.
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
    return this.toView(await this.withNumbers(partnerId));
  }

  /**
   * The partner WITH its identifiers selected, for this service to mask
   * or compare. Never returned as-is.
   */
  private async withNumbers(
    partnerId: Types.ObjectId,
  ): Promise<DeliveryPartnerDocument> {
    const partner = await this.partners
      .findById(partnerId)
      .select(KYC_NUMBER_FIELDS)
      .exec();

    if (!partner) throw new NotFoundException('No delivery partner profile');
    return partner;
  }

  toView(partner: DeliveryPartnerDocument): RiderKycView {
    const slaDueAt = partner.kycSlaDueAt ?? null;
    const expiresAt = partner.vehicleInsuranceExpiresAt ?? null;
    const insurance = insuranceStanding(expiresAt);

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
      // Same `maskTail` as PAN and the licence: the console and the app
      // cannot disagree about how much of a plate is shown.
      vehicleRegistrationNumberMasked: maskTail(
        partner.vehicleRegistrationNumber ?? null,
      ),
      vehicleRcNumberMasked: maskTail(partner.vehicleRcNumber ?? null),
      vehicleInsurancePolicyNumberMasked: maskTail(
        partner.vehicleInsurancePolicyNumber ?? null,
      ),
      vehicleInsuranceExpiresOn: expiresAt ? toCalendarDay(expiresAt) : null,
      vehicleInsuranceStatus: insurance.status,
      vehicleInsuranceDaysLeft: insurance.daysLeft,
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

    // A resubmission after a rejection clears the old reason: leaving it
    // behind would show the rider a rejection message beside a pending
    // submission, which reads as a second rejection.
    //
    // An omitted `vehicle` leaves whatever is on file alone: resending
    // the identity is not a statement that the rider has no vehicle.
    partner.set({
      aadhaarNumber: dto.aadhaarNumber,
      panNumber: dto.panNumber,
      drivingLicenceNumber: dto.drivingLicenceNumber,
      ...(dto.vehicle ? vehicleFields(dto.vehicle) : {}),
      ...this.submissionStamp(),
    });
    await partner.save();

    await this.afterSubmission(user, partner, 'submitted');
    // Re-read WITH the numbers: `partner` came from `requirePartner`,
    // which does not select them, and a vehicle left untouched above
    // would otherwise mask as "nothing on file".
    return this.view(partner._id);
  }

  // ══════════════════════════════════════════════════════════════════
  //  The vehicle
  // ══════════════════════════════════════════════════════════════════

  /**
   * `PUT /delivery/profile/kyc/vehicle` — the vehicle alone.
   *
   *   NOT_STARTED  409 `KYC_NOT_SUBMITTED`: a vehicle is verified as
   *                belonging to an identified person, so it goes with the
   *                identity on the first submission.
   *   SUBMITTED    updated in place; the SLA deadline does NOT move, so
   *                a correction never costs the rider their place.
   *   REJECTED     updated, and resubmitted with a fresh SLA — exactly
   *                what resending the identity form does.
   *   VERIFIED     updated, and sent BACK to SUBMITTED with a fresh SLA.
   *                See the class comment for why this is not a 409.
   *
   * Identical details are a no-op in every state, VERIFIED included.
   */
  async updateVehicle(
    user: JwtUser,
    ref: DeliveryPartnerDocument,
    dto: VehicleDetailsDto,
  ): Promise<RiderKycView> {
    const partner = await this.withNumbers(ref._id);

    if (partner.kycStatus === KycStatus.NOT_STARTED) {
      throw new ConflictException(
        problem(
          'KYC_NOT_SUBMITTED',
          'Send your identity details first — your vehicle goes with them.',
          { kycStatus: partner.kycStatus },
        ),
      );
    }

    const next = vehicleFields(dto);
    if (sameVehicle(partner, next)) return this.toView(partner);

    const before = partner.kycStatus;
    const resubmits = before !== KycStatus.SUBMITTED;
    partner.set({
      ...next,
      ...(resubmits ? this.submissionStamp() : {}),
    });
    await partner.save();

    if (resubmits) {
      await this.afterSubmission(
        user,
        partner,
        before === KycStatus.VERIFIED
          ? 'reopened by a vehicle change'
          : 'resubmitted',
      );
    }
    return this.toView(partner);
  }

  /**
   * The fields that make a record SUBMITTED, with a fresh deadline.
   * Shared by every path that hands the record to a human again.
   */
  private submissionStamp(): Partial<DeliveryPartner> {
    const now = new Date();
    return {
      kycStatus: KycStatus.SUBMITTED,
      kycSubmittedAt: now,
      kycVerifiedAt: null,
      kycRejectedReason: null,
      kycSlaDueAt: new Date(now.getTime() + this.slaHours * HOUR_MS),
    };
  }

  private async afterSubmission(
    user: JwtUser,
    partner: DeliveryPartnerDocument,
    how: string,
  ): Promise<void> {
    // Note what is NOT logged: any number. The partner id is an internal
    // identifier, the status is not sensitive.
    this.logger.log(
      `KYC ${how} by partner ${partner._id.toString()}; ` +
        `due ${partner.kycSlaDueAt?.toISOString() ?? '-'}`,
    );

    this.announce(user.sub, partner);
    await this.notifications.notify(
      user.sub,
      NotificationTemplates.kycSubmitted(this.slaHours),
    );
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
    // A verified rider may still send a NEW RC or policy — attaching it
    // reopens the review, exactly as changing the numbers does.
    if (
      partner.kycStatus === KycStatus.VERIFIED &&
      !VEHICLE_DOCUMENT_KINDS.has(dto.kind)
    ) {
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
    user: JwtUser,
    partner: DeliveryPartnerDocument,
    dto: AttachKycDocumentDto,
  ): Promise<RiderKycView> {
    const reopens =
      partner.kycStatus === KycStatus.VERIFIED &&
      VEHICLE_DOCUMENT_KINDS.has(dto.kind);

    if (partner.kycStatus === KycStatus.VERIFIED && !reopens) {
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
      ...(reopens ? this.submissionStamp() : {}),
    });
    await partner.save();

    if (reopens) {
      await this.afterSubmission(user, partner, 'reopened by a vehicle document');
    }
    return this.view(partner._id);
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

// ── The vehicle ─────────────────────────────────────────────────────────

/** A validated DTO → the stored fields. The DTO has already normalised. */
function vehicleFields(dto: VehicleDetailsDto): Partial<DeliveryPartner> {
  return {
    vehicleRegistrationNumber: dto.vehicleRegistrationNumber,
    vehicleRcNumber: dto.vehicleRcNumber,
    vehicleInsurancePolicyNumber: dto.vehicleInsurancePolicyNumber,
    // The validator has already proved this is a real day.
    vehicleInsuranceExpiresAt: parseCalendarDay(dto.vehicleInsuranceExpiresOn),
  };
}

/** True when `next` says nothing the record does not already say. */
function sameVehicle(
  partner: DeliveryPartnerDocument,
  next: Partial<DeliveryPartner>,
): boolean {
  return (
    (partner.vehicleRegistrationNumber ?? null) ===
      next.vehicleRegistrationNumber &&
    (partner.vehicleRcNumber ?? null) === next.vehicleRcNumber &&
    (partner.vehicleInsurancePolicyNumber ?? null) ===
      next.vehicleInsurancePolicyNumber &&
    (partner.vehicleInsuranceExpiresAt?.getTime() ?? null) ===
      (next.vehicleInsuranceExpiresAt?.getTime() ?? null)
  );
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
