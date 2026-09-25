import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import {
  Coupon,
  CouponDocument,
  CouponType,
} from '../../../database/schemas/coupon.schema';
import {
  CouponRedemption,
  CouponRedemptionDocument,
} from '../schemas/coupon-redemption.schema';
import { ShopSettingsService } from '../common/shop-settings.service';
import { problem } from '../common/problem';
import {
  ApplicableCoupon,
  GST_PCT,
  PricedLine,
  PricingResult,
  computePricing,
} from './pricing';

export interface AppliedCoupon {
  id: string;
  code: string;
  /** INTEGER PAISE actually taken off. */
  discount: number;
  /** True when the vendor issued it, so the vendor funds it. */
  vendorFunded: boolean;
}

export interface CouponProblem {
  code:
    | 'COUPON_NOT_FOUND'
    | 'COUPON_EXPIRED'
    | 'COUPON_WRONG_STORE'
    | 'COUPON_MIN_ORDER'
    | 'COUPON_EXHAUSTED'
    | 'COUPON_ALREADY_USED';
  message: string;
  /** INTEGER PAISE, present on COUPON_MIN_ORDER. */
  minOrder?: number;
}

export interface Quote {
  pricing: PricingResult;
  coupon: AppliedCoupon | null;
  /** Non-null when a coupon was offered and refused. */
  couponProblem: CouponProblem | null;
}

interface CouponLean {
  _id: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
  code: string;
  type: CouponType;
  value: number;
  minOrder: number;
  maxDiscount?: number | null;
  usageLimit: number;
  usedCount: number;
  perUserLimit: number;
  validFrom: Date;
  validTo: Date;
  isActive: boolean;
}

/**
 * Prices a basket, server-side, from live data.
 *
 * ── The rule that makes this worth having ───────────────────────────────
 * A price that arrived in a request body is a NUMBER THE CUSTOMER TYPED.
 * Nothing here ever reads one. Line prices come from the product
 * collection, the discount from the coupon collection, the fee and
 * threshold from platform settings, and the commission rate from the
 * vendor — at the moment of pricing, inside the checkout's own
 * transaction session when there is one.
 *
 * The same method backs `POST /checkout/validate` and `POST /checkout`,
 * so the preview and the charge cannot drift apart.
 */
@Injectable()
export class PricingService {
  constructor(
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(CouponRedemption.name)
    private readonly redemptions: Model<CouponRedemptionDocument>,
    private readonly settings: ShopSettingsService,
  ) {}

  /**
   * @param strict when true an unusable coupon THROWS (the real checkout:
   *   a customer who typed a code must never be charged full price
   *   silently). When false it is reported as `couponProblem` so the
   *   preview can explain it and still show a total.
   */
  async quote(input: {
    lines: readonly PricedLine[];
    vendorId: Types.ObjectId;
    commissionPct: number;
    customerId: Types.ObjectId;
    couponCode?: string;
    strict: boolean;
    session?: ClientSession;
  }): Promise<Quote> {
    const settings = await this.settings.read(input.session);

    const itemsSubtotal = input.lines.reduce(
      (sum, line) => sum + line.price * line.qty,
      0,
    );

    let applicable: ApplicableCoupon | null = null;
    let coupon: CouponLean | null = null;
    let refusal: CouponProblem | null = null;

    if (input.couponCode) {
      const found = await this.resolveCoupon(
        input.couponCode,
        input.vendorId,
        input.customerId,
        itemsSubtotal,
        input.session,
      );

      if ('problem' in found) {
        if (input.strict) {
          throw new BadRequestException(
            problem(
              found.problem.code,
              found.problem.message,
              found.problem.minOrder === undefined
                ? {}
                : { minOrder: found.problem.minOrder },
            ),
          );
        }
        refusal = found.problem;
      } else {
        coupon = found.coupon;
        applicable = {
          type: coupon.type === CouponType.FLAT ? 'flat' : 'percent',
          value: coupon.value,
          maxDiscount: coupon.maxDiscount ?? null,
          vendorFunded: coupon.vendorId !== null && coupon.vendorId !== undefined,
        };
      }
    }

    const pricing = computePricing({
      lines: input.lines,
      coupon: applicable,
      deliveryFeePaise: settings.deliveryFeePaise,
      freeDeliveryThresholdPaise: settings.freeDeliveryThresholdPaise,
      gstPct: GST_PCT,
      commissionPct: input.commissionPct,
    });

    return {
      pricing,
      coupon: coupon
        ? {
            id: coupon._id.toString(),
            code: coupon.code,
            discount: pricing.discount,
            vendorFunded: applicable?.vendorFunded ?? false,
          }
        : null,
      couponProblem: refusal,
    };
  }

  /**
   * Burns one use of a coupon, atomically, inside the checkout
   * transaction.
   *
   * The usage cap lives in the FILTER, exactly like the stock check in
   * §8.2: `usedCount < usageLimit` is evaluated by the same operation
   * that increments it, so a hundred simultaneous redemptions of a
   * hundred-use coupon produce a hundred redemptions and not a hundred
   * and four. Read-then-write here would be the same bug as read-then-
   * write on stock, with the same cause and a smaller blast radius.
   */
  async redeem(input: {
    couponId: Types.ObjectId;
    code: string;
    customerId: Types.ObjectId;
    vendorId: Types.ObjectId;
    orderId: Types.ObjectId;
    discount: number;
    session: ClientSession;
  }): Promise<void> {
    const claimed = await this.coupons
      .updateOne(
        {
          _id: input.couponId,
          isActive: true,
          $or: [
            // 0 means "no global cap".
            { usageLimit: 0 },
            { $expr: { $lt: ['$usedCount', '$usageLimit'] } },
          ],
        },
        { $inc: { usedCount: 1 } },
        { session: input.session },
      )
      .exec();

    if (claimed.modifiedCount === 0) {
      throw new BadRequestException(
        problem(
          'COUPON_EXHAUSTED',
          'This coupon has just reached its usage limit',
        ),
      );
    }

    await this.redemptions.create(
      [
        {
          couponId: input.couponId,
          code: input.code,
          customerId: input.customerId,
          vendorId: input.vendorId,
          orderId: input.orderId,
          discount: input.discount,
        },
      ],
      { session: input.session },
    );
  }

  /** Releases a redemption when an order is cancelled before fulfilment. */
  async release(orderId: Types.ObjectId, session: ClientSession): Promise<void> {
    const redemption = await this.redemptions
      .findOne({ orderId })
      .session(session)
      .lean<{ _id: Types.ObjectId; couponId: Types.ObjectId } | null>()
      .exec();

    if (!redemption) return;

    await Promise.all([
      this.coupons
        .updateOne(
          { _id: redemption.couponId, usedCount: { $gt: 0 } },
          { $inc: { usedCount: -1 } },
          { session },
        )
        .exec(),
      this.redemptions.deleteOne({ _id: redemption._id }, { session }).exec(),
    ]);
  }

  /**
   * Every reason a coupon can be refused, checked in the order the
   * customer would ask about them.
   */
  private async resolveCoupon(
    code: string,
    vendorId: Types.ObjectId,
    customerId: Types.ObjectId,
    itemsSubtotal: number,
    session?: ClientSession,
  ): Promise<{ coupon: CouponLean } | { problem: CouponProblem }> {
    const coupon = await this.coupons
      .findOne({ code: code.toUpperCase().trim() })
      .session(session ?? null)
      .lean<CouponLean | null>()
      .exec();

    if (!coupon || !coupon.isActive) {
      return {
        problem: {
          code: 'COUPON_NOT_FOUND',
          message: 'That coupon code is not valid',
        },
      };
    }

    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validTo) {
      return {
        problem: {
          code: 'COUPON_EXPIRED',
          message: 'That coupon is not valid right now',
        },
      };
    }

    // A vendor coupon is valid only at that vendor. A null vendorId is
    // platform-wide.
    if (coupon.vendorId && !coupon.vendorId.equals(vendorId)) {
      return {
        problem: {
          code: 'COUPON_WRONG_STORE',
          message: 'That coupon cannot be used at this store',
        },
      };
    }

    if (itemsSubtotal < coupon.minOrder) {
      return {
        problem: {
          code: 'COUPON_MIN_ORDER',
          minOrder: coupon.minOrder,
          message: 'Your basket is below the minimum for this coupon',
        },
      };
    }

    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      return {
        problem: {
          code: 'COUPON_EXHAUSTED',
          message: 'This coupon has been fully claimed',
        },
      };
    }

    if (coupon.perUserLimit > 0) {
      const used = await this.redemptions
        .countDocuments({ couponId: coupon._id, customerId })
        .session(session ?? null)
        .exec();

      if (used >= coupon.perUserLimit) {
        return {
          problem: {
            code: 'COUPON_ALREADY_USED',
            message: 'You have already used this coupon',
          },
        };
      }
    }

    return { coupon };
  }
}
