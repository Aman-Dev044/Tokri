import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { OrderStatus } from '../../common/constants/order-status.enum';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../database/schemas/delivery-partner.schema';
import {
  LocationPing,
  LocationPingDocument,
} from '../../database/schemas/location-ping.schema';
import { RealtimeService } from '../../realtime/realtime.service';
import { DeliveryService } from './delivery.service';
import { LocationPingDto } from './dto';
import { GeoService } from './geo.service';
import { LocationAck } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  LOCATION PINGS
 * ════════════════════════════════════════════════════════════════════════
 *
 * The highest-frequency endpoint in the platform: one call every ten
 * seconds per rider in flight. Three rules follow from that, and all
 * three are here rather than spread across the module.
 *
 * ── 1. No active delivery, no ping ──────────────────────────────────────
 * A ping is REFUSED (400) unless this rider has an order that is actually
 * OUT_FOR_DELIVERY. Accepting one otherwise would let a phone left on a
 * charger write a document every ten seconds forever, and none of them
 * would ever be read: a breadcrumb belongs to a delivery, and without one
 * there is nothing for it to be a breadcrumb of.
 *
 * ── 2. Two writes, deliberately different in kind ───────────────────────
 * An APPEND to `location_pings` (the trail, TTL'd to seven days) and an
 * UPDATE of `DeliveryPartner.currentLocation` (the latest fix, which is
 * what the dispatch `$geoNear` searches). One is history and one is
 * state; conflating them would either lose the trail or leave dispatch
 * searching yesterday's positions.
 *
 * ── 3. The broadcast is the point ───────────────────────────────────────
 * `delivery.location_updated` to the order room is what makes the
 * customer's map move. It carries the ETA with it so the tracking screen
 * never has to ask a maps API — the distance comes from the stored
 * 2dsphere points, which costs nothing (§8.7).
 */
@Injectable()
export class DeliveryLocationService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(LocationPing.name)
    private readonly pings: Model<LocationPingDocument>,
    private readonly delivery: DeliveryService,
    private readonly geo: GeoService,
    private readonly realtime: RealtimeService,
  ) {}

  async record(user: JwtUser, dto: LocationPingDto): Promise<LocationAck> {
    const partner = await this.delivery.requirePartner(user);

    const order = await this.orders
      .findOne({
        deliveryPartnerId: partner._id,
        status: OrderStatus.OUT_FOR_DELIVERY,
      })
      .select('_id address isDemo')
      .exec();

    if (!order) {
      // 400, not 404: the request is well-formed and the rider exists —
      // there is simply nothing in flight for this fix to belong to.
      throw new BadRequestException(
        'No order is out for delivery. Location is only accepted while a ' +
          'delivery is in progress.',
      );
    }

    const now = new Date();
    const location = this.geo.toPoint({ lat: dto.lat, lng: dto.lng });

    await this.pings.create({
      orderId: order._id,
      partnerId: partner._id,
      location,
      at: now,
      accuracy: dto.accuracy ?? null,
      heading: dto.heading ?? null,
      isDemo: order.isDemo,
    });

    await this.partners
      .updateOne(
        { _id: partner._id },
        { $set: { currentLocation: location, locationAt: now } },
      )
      .exec();

    const remainingKm = this.geo.distanceKm(location, order.address.location);
    const etaMinutes = this.geo.etaMinutes(remainingKm);

    // After both writes. A map that moves to a position the database did
    // not keep is worse than a map that lags by one ping.
    this.realtime.emitToOrder(
      order._id.toString(),
      'delivery.location_updated',
      {
        orderId: order._id.toString(),
        lat: dto.lat,
        lng: dto.lng,
        at: now.toISOString(),
        etaMinutes,
      },
    );

    return {
      accepted: true,
      at: now.toISOString(),
      orderId: order._id.toString(),
      etaMinutes,
    };
  }
}
