import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { KycDocumentKind } from '../../database/schemas/delivery-partner.schema';

/**
 * Every DTO here is validated by the GLOBAL ValidationPipe with
 * `whitelist: true, forbidNonWhitelisted: true`. An unknown property is
 * REJECTED, not dropped — so a rider client cannot post
 * `{ isOnline: true, completedCount: 500 }` and have the extra field
 * reach a service that happens to spread it.
 */

export class AvailabilityDto {
  @ApiProperty({
    description:
      'Connected and taking work at all. Going offline while carrying an ' +
      'order is refused — finish it or hand it back first.',
  })
  @IsBoolean()
  isOnline: boolean;

  @ApiProperty({
    description:
      'Willing to receive a new offer. A rider can be online (visible on ' +
      'the dispatch board, location updating) but unavailable.',
  })
  @IsBoolean()
  isAvailable: boolean;
}

export class RejectOfferDto {
  @ApiPropertyOptional({
    description: 'Why the rider declined. Feeds the dispatch quality view.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @Matches(/^.{3,200}$/s, { message: 'reason must be 3-200 characters' })
  reason?: string;
}

export class DeliverOrderDto {
  @ApiProperty({
    description:
      'The proof-of-delivery OTP read out by the customer. Compared ' +
      'against a HASH in constant time; never logged, never echoed back.',
    example: '0000',
  })
  @Matches(/^\d{4,6}$/, { message: 'otp must be 4 to 6 digits' })
  otp: string;

  @ApiPropertyOptional({
    description: 'Optional handover photo, already uploaded to storage.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  photoUrl?: string;
}

export class FailDeliveryDto {
  @ApiProperty({
    description:
      'Mandatory. A failed delivery becomes a support case and somebody ' +
      'has to be able to read what happened.',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @Matches(/^.{3,500}$/s, { message: 'reason must be 3-500 characters' })
  reason: string;
}

export class LocationPingDto {
  @ApiProperty({ example: 12.9716, description: 'Degrees, -90 to 90.' })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 77.5946, description: 'Degrees, -180 to 180.' })
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiPropertyOptional({ description: 'Metres, as reported by the handset.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracy?: number;

  @ApiPropertyOptional({ description: 'Degrees clockwise from north, 0-359.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(359)
  heading?: number;
}

export class DeliveryHistoryQueryDto extends PaginationQueryDto {}

export class EarningsQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive ISO-8601 start. Defaults to 30 days ago.',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive ISO-8601 end. Defaults to now.',
    example: '2026-09-25',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/**
 * `POST /delivery/orders/:id/proof-photo` — `{ contentType, sizeBytes }`.
 *
 * The file NEVER passes through this API; the rider app PUTs it straight
 * to object storage with the signed URL this call returns, exactly like
 * the vendor's product-image presign. `sizeBytes` is required because it
 * is SIGNED into the URL as `content-length`, which is what makes the
 * 5 MB cap real rather than a client-side suggestion.
 */
export class ProofPhotoPresignDto {
  @ApiProperty({
    example: 'image/jpeg',
    description: 'Allowlisted: image/jpeg, image/png, image/webp, image/avif.',
  })
  @IsString()
  @Matches(/^image\/(jpeg|png|webp|avif)$/, {
    message: 'contentType must be image/jpeg, image/png, image/webp or image/avif',
  })
  contentType: string;

  @ApiProperty({ description: 'Exact byte length. Hard cap 5 MB.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes: number;
}

// ══════════════════════════════════════════════════════════════════════
//  WALLET
// ══════════════════════════════════════════════════════════════════════

export class WalletLedgerQueryDto extends PaginationQueryDto {}

/**
 * `POST /delivery/wallet/topup` — `{ amountPaise }`.
 *
 * INTEGER PAISE, and `@IsInt()` is the point: `10.5` is rejected outright
 * rather than silently floored into a balance that is a rupee short. The
 * floor of ₹10 stops a flood of one-paise gateway orders; the ceiling of
 * ₹10,000 is a blast radius, not a business rule — a rider who genuinely
 * needs more tops up twice, and a compromised session cannot move a
 * fortune in one call.
 */
export class WalletTopupDto {
  @ApiProperty({
    description: 'INTEGER PAISE. 1000 is ₹10. Never a float, never rupees.',
    minimum: 1_000,
    maximum: 1_000_000,
    example: 50_000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(1_000_000)
  amountPaise: number;
}

/**
 * `POST /delivery/wallet/topup/:topupId/verify`.
 *
 * The SAME three field names as `shop/payments`' `VerifyPaymentDto`, on
 * purpose: one gateway, one callback shape, one HMAC path. A second
 * spelling of the same three values is how a client ends up posting
 * `razorpay_order_id` to one endpoint and `providerOrderId` to the other.
 */
export class VerifyWalletTopupDto {
  @ApiProperty({ description: 'The Razorpay gateway order id.' })
  @IsString()
  @Length(1, 100)
  providerOrderId: string;

  @ApiProperty({ description: 'The Razorpay payment id for this attempt.' })
  @IsString()
  @Length(1, 100)
  providerPaymentId: string;

  @ApiProperty({ description: 'HMAC-SHA256 signature from the checkout sheet.' })
  @IsString()
  @Length(1, 512)
  signature: string;
}

// ══════════════════════════════════════════════════════════════════════
//  KYC
// ══════════════════════════════════════════════════════════════════════

/**
 * `POST /delivery/profile/kyc`.
 *
 * Formats are validated HERE, at the edge, because a malformed Aadhaar
 * reaching the admin queue wastes a human's 24-hour SLA on a typo. The
 * regexes are the published formats:
 *
 *   Aadhaar  12 digits. Spaces are stripped before validation so a rider
 *            may type the grouping they see printed on the card.
 *   PAN      AAAAA9999A — five letters, four digits, one letter.
 *   DL       8-20 alphanumerics: the format varies by state and there is
 *            no single national pattern to pin it to. A tighter regex
 *            here would reject real licences, which is worse than
 *            accepting a wrong one that a human is about to look at.
 *
 * None of these values is ever logged, echoed back, or put in a
 * notification body. `@Exclude()` is not used: the DTO is never
 * serialised into a response, and the one endpoint that does return
 * them (`GET /admin/riders/:id/kyc`) builds its own view object.
 */
export class SubmitKycDto {
  @ApiProperty({
    description: '12 digits. Spaces are ignored. Stored, never logged.',
    example: '123412341234',
  })
  @Transform(stripSpaces)
  @Matches(/^\d{12}$/, { message: 'aadhaarNumber must be 12 digits' })
  aadhaarNumber: string;

  @ApiProperty({ description: 'AAAAA9999A.', example: 'ABCDE1234F' })
  @Transform(upperNoSpaces)
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, {
    message: 'panNumber must look like ABCDE1234F',
  })
  panNumber: string;

  @ApiProperty({
    description: '8-20 letters and digits. State formats vary.',
    example: 'KA0120210012345'.slice(0, 20),
  })
  @Transform(upperNoSpaces)
  @Matches(/^[A-Z0-9]{8,20}$/, {
    message: 'drivingLicenceNumber must be 8 to 20 letters or digits',
  })
  drivingLicenceNumber: string;
}

/**
 * `POST /delivery/profile/kyc/document` — `{ kind, contentType, sizeBytes }`.
 *
 * Mirrors `ProofPhotoPresignDto`: the file NEVER passes through this API,
 * and `sizeBytes` is required because it is SIGNED into the URL as
 * `content-length` — which is what makes the cap real rather than a
 * client-side suggestion. `application/pdf` is allowed here and not
 * there: a driving licence is routinely a PDF scan.
 */
export class KycDocumentPresignDto {
  @ApiProperty({
    enum: KycDocumentKind,
    description: 'Which document this is.',
  })
  @IsEnum(KycDocumentKind)
  kind: KycDocumentKind;

  @ApiProperty({
    example: 'image/jpeg',
    description: 'image/jpeg, image/png, image/webp, image/avif or application/pdf.',
  })
  @IsString()
  @Matches(/^(image\/(jpeg|png|webp|avif)|application\/pdf)$/, {
    message:
      'contentType must be image/jpeg, image/png, image/webp, image/avif or application/pdf',
  })
  contentType: string;

  @ApiProperty({ description: 'Exact byte length. Hard cap 5 MB.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes: number;
}

/**
 * `POST /delivery/profile/kyc/document/attach` — recorded AFTER the PUT.
 *
 * Separate from the presign because the upload happens between them, and
 * the API has no way to know it succeeded until the rider says so. The
 * URL must be one this deployment actually serves, which is checked
 * against the presigned public URL prefix rather than trusted.
 */
export class AttachKycDocumentDto {
  @ApiProperty({ enum: KycDocumentKind })
  @IsEnum(KycDocumentKind)
  kind: KycDocumentKind;

  @ApiProperty({ description: 'The `publicUrl` returned by the presign call.' })
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  url: string;
}

/** Trim and remove every space — Aadhaar is printed in groups of four. */
function stripSpaces({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : value;
}

function upperNoSpaces({ value }: { value: unknown }): unknown {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').toUpperCase()
    : value;
}
