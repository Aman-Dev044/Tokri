import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';

import { Role } from '../../common/constants/roles.enum';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated';
import { AssignmentService } from './assignment.service';
import { DeliveryLocationService } from './delivery-location.service';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DeliveryService } from './delivery.service';
import { LOCATION_PING_LIMIT_PER_MINUTE } from './delivery.constants';
import {
  AvailabilityDto,
  DeliverOrderDto,
  DeliveryHistoryQueryDto,
  EarningsQueryDto,
  FailDeliveryDto,
  LocationPingDto,
  ProofPhotoPresignDto,
  RejectOfferDto,
} from './dto';
import { PresignedUpload } from './proof-photo.service';
import {
  AcceptedOffer,
  ActiveOrder,
  DeliveryHistoryRow,
  DeliveryTracking,
  EarningsSummary,
  LocationAck,
  OfferDetail,
  OfferRow,
  RiderProfile,
} from './types';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER API
 * ════════════════════════════════════════════════════════════════════════
 *
 * `@Roles(Role.DELIVERY)` on the CONTROLLER, so it covers every route in
 * it — including the next one somebody adds. Combined with the global
 * guard chain that means: no token → 401, any other role → 403, before a
 * handler runs or the database is touched.
 *
 * Note what is NOT here: no route takes a rider id. The caller is always
 * resolved from the verified token, so there is no identifier to tamper
 * with on the whole surface. The two routes that do take an id — an
 * offer and an order — filter on the caller's partner id in the same
 * query that loads the document, and answer 404 when it is not theirs.
 *
 * Not one route is `@Public()`.
 */
@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
@Roles(Role.DELIVERY)
@ApiForbiddenResponse({
  description: 'The caller is authenticated but is not a delivery partner.',
})
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly assignments: AssignmentService,
    private readonly riderOrders: DeliveryOrdersService,
    private readonly location: DeliveryLocationService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Profile
  // ──────────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({
    summary: "The rider's profile and today's figures",
    description:
      'Profile, current location and today\'s deliveries, earnings (integer ' +
      'paise) and online minutes. Online minutes are measured from the live ' +
      'socket rather than the `isOnline` flag — a rider whose app is closed ' +
      'is not online however the flag was left.',
  })
  me(@CurrentUser() user: JwtUser): Promise<RiderProfile> {
    return this.delivery.me(user);
  }

  @Patch('availability')
  @ApiOperation({
    summary: 'Go online/offline, or stop taking new offers',
    description:
      'A rider carrying an order cannot go offline (409), and is never ' +
      'marked available whatever is requested — availability is what the ' +
      'dispatch `$geoNear` pool filters on.',
  })
  @ApiConflictResponse({ description: 'The rider is carrying an order.' })
  setAvailability(
    @CurrentUser() user: JwtUser,
    @Body() dto: AvailabilityDto,
  ): Promise<RiderProfile> {
    return this.delivery.setAvailability(user, dto);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Offers
  // ──────────────────────────────────────────────────────────────────

  @Get('offers')
  @ApiOperation({
    summary: 'Live offers for this rider',
    description:
      'Offers that are still `offered` and not yet past their 45-second ' +
      '`expiresAt`, with pickup, drop, distance, payout and a millisecond ' +
      'countdown so the app does not depend on the handset clock.',
  })
  async offers(@CurrentUser() user: JwtUser): Promise<OfferRow[]> {
    const partner = await this.delivery.requirePartner(user);
    return this.assignments.listOffers(partner._id);
  }

  @Get('offers/:id')
  @ApiOperation({
    summary: 'One offer in full — the confirm screen',
    description:
      'Everything the rider must see BEFORE the money moves: the item ' +
      'list, pickup and drop, the payout, their current balance, and the ' +
      'bounds the pick fee will be drawn from. The exact fee is drawn at ' +
      'accept time, so the range is the only statement that is true when ' +
      'it is made — and showing nothing would mean the rider discovers ' +
      'the charge after it has been taken.',
  })
  @ApiNotFoundResponse({ description: 'No such offer, or not this rider\'s.' })
  async offerDetail(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<OfferDetail> {
    const partner = await this.delivery.requirePartner(user);
    return this.assignments.offerDetail(toObjectId(id), partner);
  }

  @Post('offers/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take the job — and pay the pick fee',
    description:
      'Moves the order READY_FOR_PICKUP → ASSIGNED, holds the rider and ' +
      'charges a RANDOM pick fee in [RIDER_PICK_FEE_MIN_PAISE, ' +
      'RIDER_PICK_FEE_MAX_PAISE], all in ONE transaction. Any competing ' +
      'offer on the same order is cancelled. Returns the active order ' +
      'plus `pickFeePaise` and the resulting `walletBalancePaise`, so the ' +
      'app can show the charge the instant it happens.',
  })
  @ApiNotFoundResponse({ description: 'No such offer, or not this rider\'s.' })
  @ApiForbiddenResponse({
    description: 'KYC_NOT_VERIFIED — documents must be verified first.',
  })
  @ApiConflictResponse({
    description:
      'The offer expired or was already answered, or the rider is already ' +
      'carrying another order.',
  })
  @ApiResponse({
    status: HttpStatus.PAYMENT_REQUIRED,
    description:
      'INSUFFICIENT_WALLET_BALANCE. The body carries `errors: ' +
      '{ code, requiredPaise, balancePaise }`. 402 and not 400: the ' +
      'request was well-formed and the rider is being told to add money.',
  })
  async acceptOffer(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<AcceptedOffer> {
    const partner = await this.delivery.requirePartner(user);
    const charge = await this.assignments.accept(
      toObjectId(id),
      partner,
      user.sub,
    );
    const order = await this.riderOrders.active(user);

    return {
      order,
      pickFeePaise: charge.pickFeePaise,
      walletBalancePaise: charge.balancePaise,
    };
  }

  @Post('offers/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline the job',
    description:
      'The order goes to the next nearest rider immediately, with ' +
      '`attemptNo` incremented. After three attempts it escalates to the ' +
      'vendor and the admin console instead of looping. Returns the ' +
      "rider's remaining live offers.",
  })
  @ApiNotFoundResponse({ description: 'No such offer, or not this rider\'s.' })
  @ApiConflictResponse({ description: 'The offer was already answered.' })
  async rejectOffer(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: RejectOfferDto,
  ): Promise<OfferRow[]> {
    const partner = await this.delivery.requirePartner(user);
    await this.assignments.reject(toObjectId(id), partner, dto.reason ?? null);
    return this.assignments.listOffers(partner._id);
  }

  // ──────────────────────────────────────────────────────────────────
  //  The active order
  // ──────────────────────────────────────────────────────────────────

  @Get('orders/active')
  @ApiOperation({
    summary: 'The job in hand, in full',
    description:
      'Pickup and drop with coordinates, the customer contact for the door, ' +
      'the items, the cash to collect (integer paise) and the OTP attempt ' +
      'state. `null` when the rider has no active order.',
  })
  @ApiOkResponse({ description: 'The active order, or null.' })
  active(@CurrentUser() user: JwtUser): Promise<ActiveOrder | null> {
    return this.riderOrders.active(user);
  }

  @Get('orders/:id/tracking')
  @ApiOperation({
    summary: 'Live tracking — rider, customer, store and the items',
    description:
      "The Ola/Uber view: the rider's last reported position, the " +
      'customer drop and the store pickup with coordinates, the distance ' +
      'and ETA still to run, and the item list being carried. This is the ' +
      'initial paint; `delivery.location_updated` on the order room moves ' +
      'the marker afterwards, so the app never polls this in a loop.',
  })
  @ApiNotFoundResponse({ description: 'Not this rider\'s order.' })
  tracking(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<DeliveryTracking> {
    return this.riderOrders.tracking(user, id);
  }

  @Patch('orders/:id/picked-up')
  @ApiOperation({
    summary: 'ASSIGNED → PICKED_UP',
    description: 'The goods have left the store.',
  })
  @ApiNotFoundResponse({ description: 'Not this rider\'s order.' })
  @ApiConflictResponse({ description: 'Not a legal transition from here.' })
  pickedUp(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<ActiveOrder> {
    return this.riderOrders.pickedUp(user, id);
  }

  @Patch('orders/:id/out-for-delivery')
  @ApiOperation({
    summary: 'PICKED_UP → OUT_FOR_DELIVERY',
    description:
      'Location pings are accepted only from this point on, and this is ' +
      "where the customer's map starts moving.",
  })
  @ApiNotFoundResponse({ description: 'Not this rider\'s order.' })
  @ApiConflictResponse({ description: 'Not a legal transition from here.' })
  outForDelivery(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<ActiveOrder> {
    return this.riderOrders.outForDelivery(user, id);
  }

  @Post('orders/:id/proof-photo')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Presigned S3 PUT for an optional handover photo',
    description:
      'The file NEVER passes through this API. `contentType` is ' +
      'allowlisted and `sizeBytes` is capped at 5 MB — and both are ' +
      'SIGNED into the URL, exactly like the vendor product-image ' +
      'presign. Returns 503 while object storage is unconfigured; the ' +
      'rest of the module keeps working. Send the resulting `publicUrl` ' +
      'back as `photoUrl` on `POST .../deliver`.',
  })
  @ApiNotFoundResponse({ description: 'Not this rider\'s order.' })
  @ApiServiceUnavailableResponse({ description: 'image upload not configured' })
  presignProofPhoto(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: ProofPhotoPresignDto,
  ): Promise<PresignedUpload> {
    return this.riderOrders.presignProofPhoto(user, id, dto);
  }

  @Post('orders/:id/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OUT_FOR_DELIVERY → DELIVERED, with the customer\'s OTP',
    description:
      'The code is compared against a stored hash in constant time. A wrong ' +
      'code is 400 with `attemptsRemaining`; the fifth wrong code LOCKS the ' +
      'delivery (423) and only an admin can complete it. The code is never ' +
      'logged or echoed back.',
  })
  @ApiBadRequestResponse({
    description:
      'Incorrect code. The RFC 7807 body carries ' +
      '`errors: { attemptsRemaining, locked }`.',
  })
  @ApiNotFoundResponse({ description: 'Not this rider\'s order.' })
  @ApiConflictResponse({ description: 'The order is not out for delivery.' })
  deliver(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: DeliverOrderDto,
  ): Promise<ActiveOrder> {
    return this.riderOrders.deliver(user, id, dto);
  }

  @Post('orders/:id/failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OUT_FOR_DELIVERY → DELIVERY_FAILED',
    description:
      'A reason is mandatory. The rider is released for other work; the ' +
      'order becomes a support case and can be reassigned.',
  })
  @ApiNotFoundResponse({ description: 'Not this rider\'s order.' })
  @ApiConflictResponse({ description: 'Not a legal transition from here.' })
  failed(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: FailDeliveryDto,
  ): Promise<ActiveOrder> {
    return this.riderOrders.failed(user, id, dto);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Location
  // ──────────────────────────────────────────────────────────────────

  @Post('location')
  @HttpCode(HttpStatus.OK)
  // The handset sends one every ten seconds — six a minute. Thirty is
  // generous headroom for a retrying client and still three orders of
  // magnitude below what it takes to fill `location_pings` with rubbish.
  @Throttle({
    default: { limit: LOCATION_PING_LIMIT_PER_MINUTE, ttl: 60_000 },
  })
  @ApiOperation({
    summary: 'Report the rider position',
    description:
      'Accepted ONLY while this rider has an order that is OUT_FOR_DELIVERY ' +
      '— otherwise 400. Writes a `LocationPing` (7-day TTL), updates the ' +
      "partner's `currentLocation`, and broadcasts " +
      '`delivery.location_updated` to the order room with a fresh ETA.',
  })
  @ApiBadRequestResponse({ description: 'Nothing is out for delivery.' })
  recordLocation(
    @CurrentUser() user: JwtUser,
    @Body() dto: LocationPingDto,
  ): Promise<LocationAck> {
    return this.location.record(user, dto);
  }

  // ──────────────────────────────────────────────────────────────────
  //  History and money
  // ──────────────────────────────────────────────────────────────────

  @Get('history')
  @ApiOperation({
    summary: 'Completed deliveries, newest first',
    description:
      'Delivered and failed attempts, paginated as `{ data, meta }`. Payout ' +
      'and COD collected are integer paise.',
  })
  history(
    @CurrentUser() user: JwtUser,
    @Query() query: DeliveryHistoryQueryDto,
  ): Promise<Paginated<DeliveryHistoryRow>> {
    return this.delivery.history(user, query);
  }

  @Get('earnings')
  @ApiOperation({
    summary: 'Earnings over a window, day by day',
    description:
      'Defaults to the last 30 days. Every figure is integer paise and is ' +
      'derived from the same distance the offer card quoted, so the ' +
      'statement and the offer cannot disagree.',
  })
  earnings(
    @CurrentUser() user: JwtUser,
    @Query() query: EarningsQueryDto,
  ): Promise<EarningsSummary> {
    return this.delivery.earnings(user, query);
  }
}

/**
 * A malformed id is 404, exactly like an id that does not exist.
 *
 * A 400 here would distinguish "not a valid ObjectId" from "no such
 * offer", which is the first half of an enumeration oracle.
 */
const toObjectId = (id: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
  return new Types.ObjectId(id);
};
