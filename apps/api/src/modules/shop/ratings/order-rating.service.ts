import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, PipelineStage, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../../database/schemas/delivery-partner.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { problem } from '../common/problem';
import {
  OrderLean,
  OrderRatingView,
  RATING_WINDOW_DAYS,
  ratingDeadline,
} from '../orders/order-view';
import { RateOrderDto } from './dto';

/**
 * `ratingSum += value; ratingCount += 1; rating = round(sum / count, 1)`
 * as ONE update-pipeline write.
 *
 * In the database rather than read-modify-write in Node, so two customers
 * rating the same store in the same millisecond both land: each `$add`
 * reads the value the other just wrote. `$ifNull` covers a vendor or rider
 * created before the two counter fields existed.
 */
function absorbRating(value: number): PipelineStage[] {
  return [
    {
      $set: {
        ratingSum: { $add: [{ $ifNull: ['$ratingSum', 0] }, value] },
        ratingCount: { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] },
      },
    },
    {
      $set: {
        rating: { $round: [{ $divide: ['$ratingSum', '$ratingCount'] }, 1] },
      },
    },
  ];
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RATE THE ORDER — the only writer of `Vendor.rating` and the rider's
 * ════════════════════════════════════════════════════════════════════════
 *
 * Once per order, only once DELIVERED, only within `RATING_WINDOW_DAYS` of
 * delivery. All three are checked up front for a clear error, and "once"
 * is then enforced AGAIN by the write itself: the claim filters on
 * `customerRating: null`, so a double-submitted form claims the order once
 * and the second request finds nothing to claim.
 *
 * The claim and the two average updates share one transaction. A rating
 * stored on the order but never folded into the store's average — or
 * folded in twice — would make the two disagree forever, with no way to
 * tell afterwards which one is right.
 */
@Injectable()
export class OrderRatingService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
  ) {}

  async rate(
    customerId: string,
    orderId: string,
    dto: RateOrderDto,
  ): Promise<OrderRatingView> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('Order not found');
    }
    const owner = new Types.ObjectId(customerId);

    const order = await this.orders
      .findOne({ _id: new Types.ObjectId(orderId), customerId: owner })
      .lean<OrderLean | null>()
      .exec();
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== OrderStatus.DELIVERED) {
      throw new ConflictException(
        problem(
          'ORDER_NOT_DELIVERED',
          'You can rate an order once it has been delivered.',
          { status: order.status },
        ),
      );
    }
    if (order.customerRating) throw this.alreadyRated();

    const deadline = ratingDeadline(order);
    if (!deadline || deadline.getTime() <= Date.now()) {
      throw new ConflictException(
        problem(
          'RATING_WINDOW_CLOSED',
          `Orders can be rated for ${RATING_WINDOW_DAYS} days after delivery.`,
          { closedAt: deadline ? deadline.toISOString() : null },
        ),
      );
    }

    const riderId = order.deliveryPartnerId ?? null;
    if (dto.riderRating !== undefined && dto.riderRating !== null && !riderId) {
      throw new BadRequestException(
        problem('NO_RIDER_TO_RATE', 'No rider delivered this order, so there is no one to rate.'),
      );
    }

    const riderRating = riderId ? (dto.riderRating ?? null) : null;
    const rating = {
      store: dto.storeRating,
      rider: riderRating,
      comment: dto.comment ?? null,
      at: new Date(),
    };

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const claimed = await this.orders
          .updateOne(
            {
              _id: order._id,
              customerId: owner,
              status: OrderStatus.DELIVERED,
              customerRating: null,
            },
            { $set: { customerRating: rating } },
            { session },
          )
          .exec();
        if (claimed.modifiedCount !== 1) throw this.alreadyRated();

        await this.absorb(this.vendors, order.vendorId, dto.storeRating, session);
        if (riderId && riderRating !== null) {
          await this.absorb(this.partners, riderId, riderRating, session);
        }
      });
    } finally {
      await session.endSession();
    }

    return {
      storeRating: rating.store,
      riderRating: rating.rider,
      comment: rating.comment,
      at: rating.at.toISOString(),
    };
  }

  private async absorb(
    model: Model<VendorDocument> | Model<DeliveryPartnerDocument>,
    id: Types.ObjectId,
    value: number,
    session: ClientSession,
  ): Promise<void> {
    // The union of two Model types has no callable `updateOne` signature in
    // TypeScript's eyes; both accept exactly this call.
    await (model as Model<VendorDocument>)
      .updateOne({ _id: id }, absorbRating(value), { session })
      .exec();
  }

  private alreadyRated(): ConflictException {
    return new ConflictException(
      problem('ORDER_ALREADY_RATED', 'You have already rated this order.'),
    );
  }
}
