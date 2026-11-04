import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Role } from '../../common/constants/roles.enum';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';
import { DeliveryService } from './delivery.service';
import {
  AttachKycDocumentDto,
  KycDocumentPresignDto,
  SubmitKycDto,
  VehicleDetailsDto,
} from './dto';
import { PresignedUpload } from './proof-photo.service';
import { RiderKycService } from './rider-kyc.service';
import { RiderKycView } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER KYC API
 * ════════════════════════════════════════════════════════════════════════
 *
 * `@Roles(Role.DELIVERY)` on the controller. No route is `@Public()`, and
 * no route takes a rider id — the partner is resolved from the verified
 * token, so a rider can only ever read or write their OWN identity
 * record.
 *
 * ── Nothing here returns a full identifier ──────────────────────────────
 * `GET /delivery/profile/kyc` masks every number — the three identity
 * numbers and the vehicle's plate, RC and policy — to its last four
 * characters. The rider does not need to read their own Aadhaar back off
 * a server — they are holding the card — and a response that carries it
 * is one screenshot, one proxy log and one crash reporter away from
 * being somewhere it should not be. The single endpoint in this platform
 * that returns them whole is `GET /admin/riders/:id/kyc`, which exists so
 * a human can compare the number against the uploaded document.
 */
@ApiTags('delivery/kyc')
@ApiBearerAuth()
@Controller('delivery/profile/kyc')
@Roles(Role.DELIVERY)
@ApiForbiddenResponse({
  description: 'The caller is authenticated but is not a delivery partner.',
})
export class RiderKycController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly kyc: RiderKycService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Verification status, masked numbers and documents',
    description:
      'Numbers are MASKED (`XXXX XXXX 1234`). `slaDueAt` and ' +
      '`slaRemainingMs` drive the countdown while the submission is ' +
      'pending; `slaHours` is the promise itself, from ' +
      '`RIDER_KYC_SLA_HOURS`. `canResubmit` is false once VERIFIED.',
  })
  @ApiOkResponse({ description: 'The rider\'s KYC record, masked.' })
  async view(@CurrentUser() user: JwtUser): Promise<RiderKycView> {
    const partner = await this.delivery.requirePartner(user);
    return this.kyc.view(partner._id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit Aadhaar, PAN and driving licence (and the vehicle)',
    description:
      'Sets status SUBMITTED and stamps `kycSlaDueAt = now + ' +
      'RIDER_KYC_SLA_HOURS`. Formats are validated at the edge — a typo ' +
      'must not consume a human\'s 24-hour SLA. A rider may resubmit ' +
      'while NOT_STARTED, SUBMITTED or REJECTED; a VERIFIED record is ' +
      '409, because silently replacing an identity a human approved ' +
      'would make the approval meaningless.',
  })
  @ApiBadRequestResponse({ description: 'A number did not match its format.' })
  @ApiConflictResponse({ description: 'KYC_ALREADY_VERIFIED.' })
  async submit(
    @CurrentUser() user: JwtUser,
    @Body() dto: SubmitKycDto,
  ): Promise<RiderKycView> {
    const partner = await this.delivery.requirePartner(user);
    return this.kyc.submit(user, partner, dto);
  }

  @Put('vehicle')
  @ApiOperation({
    summary: 'Update the vehicle: plate, RC, insurance policy and expiry',
    description:
      'The one part of KYC a VERIFIED rider may change themselves — ' +
      'vehicles are replaced and insurance renews every year. A CHANGE ' +
      'to a verified record sends it back to SUBMITTED with a fresh SLA, ' +
      'because no human has seen the new details; resending what is ' +
      'already on file changes nothing. While SUBMITTED the deadline does ' +
      'not move; a REJECTED record is resubmitted. 409 before any identity ' +
      'has been submitted. An expired policy is accepted and flagged.',
  })
  @ApiOkResponse({ description: "The rider's KYC record, masked." })
  @ApiBadRequestResponse({ description: 'A field did not match its format.' })
  @ApiConflictResponse({ description: 'KYC_NOT_SUBMITTED.' })
  async updateVehicle(
    @CurrentUser() user: JwtUser,
    @Body() dto: VehicleDetailsDto,
  ): Promise<RiderKycView> {
    const partner = await this.delivery.requirePartner(user);
    return this.kyc.updateVehicle(user, partner, dto);
  }

  @Post('document')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Presigned PUT for one KYC document',
    description:
      'The file NEVER passes through this API. `contentType` is ' +
      'allowlisted and `sizeBytes` is SIGNED into the URL as ' +
      '`content-length`, so the 5 MB cap is enforced by the bucket ' +
      'rather than suggested to the client. Returns 503 while object ' +
      'storage is unconfigured — which it is on this deployment; the ' +
      'number-based submission above keeps working. PUT the bytes, then ' +
      'POST the returned `publicUrl` back to `/document/attach`.',
  })
  @ApiServiceUnavailableResponse({ description: 'image upload not configured' })
  @ApiConflictResponse({ description: 'KYC_ALREADY_VERIFIED.' })
  async presignDocument(
    @CurrentUser() user: JwtUser,
    @Body() dto: KycDocumentPresignDto,
  ): Promise<PresignedUpload> {
    const partner = await this.delivery.requirePartner(user);
    return this.kyc.presignDocument(partner, dto);
  }

  @Post('document/attach')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record an upload that has landed',
    description:
      'The URL is checked against the key prefix a presign for THIS ' +
      'rider and THIS document kind would produce, so a rider cannot ' +
      'attach an arbitrary link or another rider\'s object. One document ' +
      'per kind — a second upload replaces the first. A VERIFIED rider ' +
      'may still attach `vehicle_rc` / `vehicle_insurance`, which sends ' +
      'the record back for review; any other kind is 409.',
  })
  @ApiBadRequestResponse({ description: 'KYC_DOCUMENT_URL_REJECTED.' })
  @ApiConflictResponse({ description: 'KYC_ALREADY_VERIFIED.' })
  async attachDocument(
    @CurrentUser() user: JwtUser,
    @Body() dto: AttachKycDocumentDto,
  ): Promise<RiderKycView> {
    const partner = await this.delivery.requirePartner(user);
    return this.kyc.attachDocument(user, partner, dto);
  }
}
