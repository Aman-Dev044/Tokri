import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from './geo-point';

export type DeliveryPartnerDocument = HydratedDocument<DeliveryPartner>;

export enum VehicleType {
  BICYCLE = 'bicycle',
  SCOOTER = 'scooter',
  MOTORCYCLE = 'motorcycle',
  EV_SCOOTER = 'ev_scooter',
}

export enum PartnerStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
}

/**
 * Identity verification, which is a DIFFERENT axis from `PartnerStatus`.
 *
 * An ACTIVE rider whose KYC is NOT_STARTED may log in, go online and see
 * the board — they simply may not accept an order, because accepting one
 * spends real money out of a wallet attached to a person nobody has
 * identified. Collapsing the two into one field would mean suspending a
 * rider to stop them taking work, which is a different (and much louder)
 * administrative act.
 */
export enum KycStatus {
  NOT_STARTED = 'not_started',
  SUBMITTED = 'submitted',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

/** The four documents the verification screen expects to compare against. */
export enum KycDocumentKind {
  AADHAAR = 'aadhaar',
  PAN = 'pan',
  DRIVING_LICENCE = 'driving_licence',
  SELFIE = 'selfie',
}

@Schema({ _id: false })
export class KycDocument {
  @Prop({ type: String, enum: KycDocumentKind, required: true })
  kind: KycDocumentKind;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  uploadedAt: Date;
}
export const KycDocumentSchema = SchemaFactory.createForClass(KycDocument);

@Schema({ timestamps: true, collection: 'delivery_partners' })
export class DeliveryPartner {
  /** The login identity. One User, one DeliveryPartner profile. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** `null` means the shared platform pool rather than a vendor's rider. */
  @Prop({ type: Types.ObjectId, ref: 'Vendor', default: null })
  vendorId?: Types.ObjectId | null;

  @Prop({ type: String, enum: VehicleType, required: true })
  vehicleType: VehicleType;

  @Prop({ type: Boolean, default: false })
  isAvailable: boolean;

  @Prop({ type: Boolean, default: false })
  isOnline: boolean;

  @Prop({ type: GeoPointSchema, default: null })
  currentLocation?: GeoPoint | null;

  @Prop({ type: Date, default: null })
  locationAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  activeOrderId?: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  completedCount: number;

  /** 0-5. */
  @Prop({ type: Number, default: 0 })
  rating: number;

  /**
   * Administrative state, distinct from `isOnline`.
   * A suspended rider is not merely offline - they may not come back on.
   */
  @Prop({ type: String, enum: PartnerStatus, default: PartnerStatus.ACTIVE })
  status: PartnerStatus;

  @Prop({ type: String, default: null })
  statusReason?: string | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;

  // ══════════════════════════════════════════════════════════════════
  //  KYC
  // ══════════════════════════════════════════════════════════════════

  @Prop({ type: String, enum: KycStatus, default: KycStatus.NOT_STARTED })
  kycStatus: KycStatus;

  @Prop({ type: Date, default: null })
  kycSubmittedAt?: Date | null;

  @Prop({ type: Date, default: null })
  kycVerifiedAt?: Date | null;

  @Prop({ type: String, default: null })
  kycRejectedReason?: string | null;

  /**
   * `kycSubmittedAt + RIDER_KYC_SLA_HOURS`.
   *
   * Stored rather than computed on read so the promise made to the rider
   * ("verified within 24 hours") survives a later change to the knob:
   * a submission made under a 24-hour SLA keeps its 24-hour deadline.
   * It is also what the admin queue sorts on, oldest deadline first.
   */
  @Prop({ type: Date, default: null })
  kycSlaDueAt?: Date | null;

  /**
   * ── GOVERNMENT IDENTIFIERS — `select: false` ────────────────────────
   *
   * These three are excluded from every query that does not ASK for them
   * by name. That is the whole safeguard: a future `findById(partnerId)`
   * written by somebody who has never read this file cannot leak an
   * Aadhaar number, because it is simply not in the document they get.
   *
   * They are returned IN FULL on exactly one endpoint —
   * `GET /admin/riders/:id/kyc` — which exists so a human can compare
   * the number against the uploaded document image. Everywhere else,
   * the rider's own profile included, they are MASKED to the last four
   * (`XXXX XXXX 1234`). They are never logged and never put in a
   * notification body.
   *
   * They are NOT hashed. An admin has to READ the number to verify it;
   * storing an unreadable hash beside a perfectly readable photograph
   * of the same card would be security theatre, not security.
   */
  @Prop({ type: String, default: null, select: false })
  aadhaarNumber?: string | null;

  @Prop({ type: String, default: null, select: false })
  panNumber?: string | null;

  @Prop({ type: String, default: null, select: false })
  drivingLicenceNumber?: string | null;

  /**
   * Uploaded document images. Not `select: false`: a URL to an object in
   * a private bucket is not itself an identifier, and the rider's own
   * KYC screen has to render what they have already sent.
   */
  @Prop({ type: [KycDocumentSchema], default: [] })
  kycDocuments: KycDocument[];
}

export const DeliveryPartnerSchema =
  SchemaFactory.createForClass(DeliveryPartner);

DeliveryPartnerSchema.index({ currentLocation: '2dsphere' });
DeliveryPartnerSchema.index({ vendorId: 1, isAvailable: 1, isOnline: 1 });
DeliveryPartnerSchema.index({ userId: 1 }, { unique: true });
DeliveryPartnerSchema.index({ status: 1 });
DeliveryPartnerSchema.index({ isDemo: 1 });
// The admin KYC queue: filter by status, order by the SLA deadline.
// Both halves are in the index, so the queue never sorts in memory.
DeliveryPartnerSchema.index({ kycStatus: 1, kycSlaDueAt: 1 });
