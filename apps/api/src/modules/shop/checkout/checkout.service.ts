import { randomInt } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import {
  Product,
  ProductDocument,
} from '../../../database/schemas/product.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import { point } from '../../../database/schemas/geo-point';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';
import { Role } from '../../../common/constants/roles.enum';
import { PasswordService } from '../../../common/utils/password.service';
import { Cart, CartDocument, CartStatus } from '../schemas/cart.schema';
import { CartLine, CartService } from '../cart/cart.service';
import { AddressView, AddressesService } from '../addresses/addresses.service';
import { CouponProblem, PricingService } from '../pricing/pricing.service';
import { distanceMetres, toKm } from '../common/geo.util';
import { problem } from '../common/problem';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../payments/payment-provider';
import {
  CustomerPricing,
  OrderDetail,
  OrderLean,
  StoreRef,
  toOrderDetail,
} from '../orders/order-view';
import { OrderNumberService } from './order-number.service';
import { PlaceOrderDto, ValidateCheckoutDto } from './dto';

export interface CheckoutIssue {
  code:
    | 'OUT_OF_STOCK'
    | 'REDUCED_QTY'
    | 'PRICE_CHANGED'
    | 'UNAVAILABLE'
    | 'STORE_CLOSED'
    | 'OUT_OF_SERVICE_AREA'
    | 'NO_ADDRESS'
    | 'COD_UNAVAILABLE'
    | 'COD_LIMIT'
    | 'COUPON';
  message: string;
  productId?: string;
}

export interface CheckoutQuote {
  vendorId: string;
  store: {
    id: string;
    storeName: string;
    slug: string;
    isOpen: boolean;
  };
  items: CartLine[];
  pricing: CustomerPricing;
  coupon: { code: string; discount: number } | null;
  couponProblem: CouponProblem | null;
  address: AddressView | null;
  delivery: {
    serviceable: boolean;
    distanceKm: number | null;
    radiusKm: number;
  };
  payment: {
    cod: { available: boolean; reason: string | null };
    online: { available: boolean; reason: string | null };
  };
  issues: CheckoutIssue[];
  /** True only when nothing in `issues` blocks the order. */
  checkoutReady: boolean;
}

export interface PlacedOrder {
  order: OrderDetail;
  /**
   * The 4-digit proof-of-delivery OTP, IN PLAIN TEXT, exactly once.
   *
   * Only the hash is stored (§5.1), so this response is the only place it
   * can ever be read — the customer reads it out to the rider at the door.
   * It is returned to the authenticated buyer and to nobody else; an
   * `Idempotency-Key` replay returns it to the SAME caller only, because
   * `IdempotencyInterceptor` binds every stored response to the user who
   * created it.
   *
   * TODO(notifications-phase): also send it by SMS (MSG91), so a customer
   * who closes the app can still find it. Until then the app must show it
   * on the confirmation screen.
   */
  deliveryOtp: string;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    /** What the client does next. `none` = nothing to pay now. */
    next: 'pay_on_delivery' | 'gateway';
  };
}

interface VendorFull {
  _id: Types.ObjectId;
  storeName: string;
  slug: string;
  isOpen: boolean;
  status: VendorStatus;
  commissionPct: number;
  codEnabled: boolean;
  codMaxAmount: number;
  serviceRadiusKm: number;
  location: { type: 'Point'; coordinates: number[] };
}

interface ProductForOrder {
  _id: Types.ObjectId;
  name: string;
  images: string[];
  price: number;
  unit: string;
  unitValue: number;
  isActive: boolean;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  CHECKOUT — the one place where getting it wrong costs real money
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three properties have to hold simultaneously, and each one is a classic
 * failure of this exact endpoint:
 *
 *  1. STOCK CANNOT GO NEGATIVE (§8.2). `findOne` → check → `save` is the
 *     bug: two customers read "1 left" and both write "0". Here the check
 *     lives in the FILTER of the update — `{ stock: { $gte: qty } }` — so
 *     MongoDB will not match a document that lacks the stock, and the
 *     check and the decrement are ONE operation with no window between
 *     them. `modifiedCount === 0` means somebody else got the last unit,
 *     and the whole transaction rolls back including every line already
 *     reserved. Proven by `test/integration/checkout-concurrency.spec.ts`:
 *     50 parallel checkouts against 10 units, exactly 10 succeed.
 *
 *  2. THE PRICE IS THE SERVER'S. Nothing in the request body carries an
 *     amount. Lines come from the cart, prices from the product
 *     collection, the fee from settings, the rate from the vendor — all
 *     re-read inside the transaction.
 *
 *  3. A RETRY CANNOT DOUBLE-ORDER. `Idempotency-Key` is REQUIRED (§6.1),
 *     enforced by `IdempotencyInterceptor`, which takes the unique index
 *     on the key as a lock before this method is ever entered.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly pricing: PricingService,
    private readonly orderNumbers: OrderNumberService,
    private readonly passwords: PasswordService,
    @Inject(PAYMENT_PROVIDER)
    private readonly payments: PaymentProvider,
  ) {}

  // ── Preview ───────────────────────────────────────────────────────────

  /**
   * Everything `POST /checkout` will check, without committing to it.
   *
   * The point of this endpoint is that the customer finds out about a
   * price change, a sold-out line or an unserviceable address on the
   * review screen, not after tapping Pay.
   */
  async validate(
    customerId: string,
    dto: ValidateCheckoutDto,
  ): Promise<CheckoutQuote> {
    const vendor = await this.loadVendor(dto.vendorId);
    const cart = await this.loadCart(customerId, vendor._id);
    const lines = await this.cart.revalidate(cart);

    const issues: CheckoutIssue[] = [];

    for (const line of lines) {
      if (line.flags.includes('unavailable')) {
        issues.push({
          code: 'UNAVAILABLE',
          productId: line.productId,
          message: `${line.name} is no longer sold here`,
        });
      } else if (line.flags.includes('out_of_stock')) {
        issues.push({
          code: 'OUT_OF_STOCK',
          productId: line.productId,
          message: `${line.name} is out of stock`,
        });
      } else if (line.flags.includes('reduced_qty')) {
        issues.push({
          code: 'REDUCED_QTY',
          productId: line.productId,
          message: `Only ${line.availableQty} × ${line.name} left`,
        });
      }

      if (line.flags.includes('price_changed')) {
        issues.push({
          code: 'PRICE_CHANGED',
          productId: line.productId,
          message: `The price of ${line.name} has changed`,
        });
      }
    }

    if (!vendor.isOpen) {
      issues.push({
        code: 'STORE_CLOSED',
        message: 'This store is closed right now',
      });
    }

    const address = dto.addressId
      ? await this.addresses.owned(customerId, dto.addressId)
      : null;

    let distanceKm: number | null = null;
    let serviceable = false;

    if (address) {
      const metres = distanceMetres(vendor.location, address.location);
      distanceKm = toKm(metres);
      serviceable = metres <= vendor.serviceRadiusKm * 1000;
      if (!serviceable) {
        issues.push({
          code: 'OUT_OF_SERVICE_AREA',
          message: `This store delivers within ${vendor.serviceRadiusKm} km; that address is ${distanceKm} km away`,
        });
      }
    } else {
      issues.push({
        code: 'NO_ADDRESS',
        message: 'Choose a delivery address',
      });
    }

    const quote = await this.pricing.quote({
      lines: lines
        .filter((line) => !line.flags.includes('unavailable'))
        .map((line) => ({ price: line.currentPrice, qty: line.qty })),
      vendorId: vendor._id,
      commissionPct: vendor.commissionPct,
      customerId: new Types.ObjectId(customerId),
      couponCode: dto.couponCode,
      // Advisory: the preview explains a bad coupon instead of failing.
      strict: false,
    });

    if (quote.couponProblem) {
      issues.push({ code: 'COUPON', message: quote.couponProblem.message });
    }

    const cod = this.codAvailability(vendor, quote.pricing.grandTotal);
    if (dto.paymentMethod === PaymentMethod.COD && !cod.available && cod.reason) {
      issues.push({
        code:
          cod.reason.includes('limit') || cod.reason.includes('cap')
            ? 'COD_LIMIT'
            : 'COD_UNAVAILABLE',
        message: cod.reason,
      });
    }

    const onlineAvailable = this.payments.isConfigured();

    return {
      vendorId: vendor._id.toString(),
      store: {
        id: vendor._id.toString(),
        storeName: vendor.storeName,
        slug: vendor.slug,
        isOpen: vendor.isOpen,
      },
      items: lines,
      pricing: this.customerPricing(quote.pricing),
      coupon: quote.coupon
        ? { code: quote.coupon.code, discount: quote.coupon.discount }
        : null,
      couponProblem: quote.couponProblem,
      address: address ? this.toAddressView(address) : null,
      delivery: {
        serviceable,
        distanceKm,
        radiusKm: vendor.serviceRadiusKm,
      },
      payment: {
        cod,
        online: {
          available: onlineAvailable,
          reason: onlineAvailable
            ? null
            : 'Online payment is not available yet — pay on delivery instead',
        },
      },
      issues,
      checkoutReady: issues.length === 0,
    };
  }

  // ── The real thing ────────────────────────────────────────────────────

  async place(customerId: string, dto: PlaceOrderDto): Promise<PlacedOrder> {
    // Refused BEFORE anything is reserved. An unconfigured gateway must
    // be a clean 503, never a half-placed order holding stock nobody can
    // pay for.
    if (
      dto.paymentMethod === PaymentMethod.ONLINE &&
      !this.payments.isConfigured()
    ) {
      throw new ServiceUnavailableException(
        problem(
          'PAYMENT_PROVIDER_NOT_CONFIGURED',
          'Online payment is not available yet — the payment provider is ' +
            'not configured. Choose cash on delivery.',
        ),
      );
    }

    const buyer = new Types.ObjectId(customerId);
    const placedAt = new Date();

    // Both are deliberately outside the transaction: the counter would
    // otherwise be a contention point for every concurrent checkout, and
    // argon2 is ~50ms of CPU that would be holding transaction locks.
    const orderNo = await this.orderNumbers.next(placedAt);
    const otp = this.generateOtp();
    const deliveryOtpHash = await this.passwords.hash(otp);

    const session = await this.connection.startSession();
    let placed: OrderLean | null = null;
    let store: StoreRef | null = null;

    try {
      await session.withTransaction(async () => {
        const result = await this.placeInTransaction({
          session,
          buyer,
          dto,
          orderNo,
          deliveryOtpHash,
          placedAt,
        });
        placed = result.order;
        store = result.store;
      });
    } finally {
      await session.endSession();
    }

    const order = placed as OrderLean | null;
    if (!order) {
      // withTransaction either commits or throws; this is defensive
      // rather than expected.
      throw new ConflictException('Checkout did not complete');
    }

    this.logger.log(`Order ${order.orderNo} placed by ${customerId}`);

    // NOTE: `order.created` is emitted by the realtime gateway AFTER the
    // transaction commits, never inside it (§8.2). Emitting inside would
    // announce an order that can still roll back.

    return {
      order: toOrderDetail(order, store as StoreRef | null),
      deliveryOtp: otp,
      payment: {
        method: dto.paymentMethod,
        status: PaymentStatus.PENDING,
        next:
          dto.paymentMethod === PaymentMethod.COD
            ? 'pay_on_delivery'
            : 'gateway',
      },
    };
  }

  /**
   * The transaction from §8.2, in order: reserve → re-price → create.
   *
   * Every read inside takes the session, so the order is priced from the
   * same snapshot the stock was reserved from.
   */
  private async placeInTransaction(input: {
    session: ClientSession;
    buyer: Types.ObjectId;
    dto: PlaceOrderDto;
    orderNo: string;
    deliveryOtpHash: string;
    placedAt: Date;
  }): Promise<{ order: OrderLean; store: StoreRef }> {
    const { session, buyer, dto, orderNo, placedAt } = input;

    const vendor = await this.loadVendor(dto.vendorId, session);
    if (!vendor.isOpen) {
      throw new ConflictException(
        problem('STORE_CLOSED', 'This store is closed right now'),
      );
    }

    const cart = await this.loadCart(buyer.toString(), vendor._id, session);
    const address = await this.addresses.owned(
      buyer.toString(),
      dto.addressId,
      session,
    );

    const metres = distanceMetres(vendor.location, address.location);
    if (metres > vendor.serviceRadiusKm * 1000) {
      throw new ConflictException(
        problem(
          'OUT_OF_SERVICE_AREA',
          'This store does not deliver to that address',
          { distanceKm: toKm(metres), radiusKm: vendor.serviceRadiusKm },
        ),
      );
    }

    const products = await this.products
      .find({ _id: { $in: cart.items.map((item) => item.productId) } })
      .select('name images price unit unitValue isActive')
      .session(session)
      .lean<ProductForOrder[]>()
      .exec();

    const productById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    // ── 1. Reserve every line ATOMICALLY ────────────────────────────
    //
    //  `{ stock: { $gte: qty } }` is in the FILTER. That is the whole
    //  trick: MongoDB matches the document only if the stock is there,
    //  and decrements it in the same operation. There is no window
    //  between the check and the write for a second customer to slip
    //  into, which is precisely the window `findOne`-then-`save` leaves
    //  open. A line that cannot be satisfied throws, and the transaction
    //  rolls back every line already reserved above it.
    for (const item of cart.items) {
      const product = productById.get(item.productId.toString());
      if (!product || !product.isActive) {
        throw new ConflictException(
          problem(
            'PRODUCT_UNAVAILABLE',
            `${item.name} is no longer sold here`,
            { productId: item.productId.toString() },
          ),
        );
      }

      const reserved = await this.inventory
        .updateOne(
          { productId: item.productId, stock: { $gte: item.qty } },
          { $inc: { stock: -item.qty, reserved: item.qty } },
          { session },
        )
        .exec();

      if (reserved.modifiedCount === 0) {
        throw new ConflictException(
          problem('OUT_OF_STOCK', `${product.name} just sold out`, {
            productId: item.productId.toString(),
          }),
        );
      }
    }

    // TODO(jobs-phase, §8.2): a BullMQ delayed job must release
    // `reserved` back to `stock` when an ONLINE order has not been paid
    // within 15 minutes, and convert it to a permanent decrement on
    // DELIVERED. Deliberately not started here — half a queue (a timer
    // in this process, say) would release stock on a restart and lose it
    // on a crash, which is worse than the honest gap. COD orders are
    // unaffected: they are reserved at PLACED and committed on delivery.

    // ── 2. Re-price, server-side, from what was just reserved ───────
    const lines = cart.items.map((item) => {
      const product = productById.get(item.productId.toString());
      if (!product) {
        throw new ConflictException(
          problem(
            'PRODUCT_UNAVAILABLE',
            'A product in your cart is no longer available',
            { productId: item.productId.toString() },
          ),
        );
      }
      return { product, qty: item.qty };
    });

    const quote = await this.pricing.quote({
      lines: lines.map((line) => ({ price: line.product.price, qty: line.qty })),
      vendorId: vendor._id,
      commissionPct: vendor.commissionPct,
      customerId: buyer,
      couponCode: dto.couponCode,
      // The real checkout: a coupon the customer typed either applies or
      // the request fails. Charging full price silently is not an option.
      strict: true,
      session,
    });

    if (dto.paymentMethod === PaymentMethod.COD) {
      const cod = this.codAvailability(vendor, quote.pricing.grandTotal);
      if (!cod.available) {
        throw new ConflictException(
          problem(
            'COD_UNAVAILABLE',
            cod.reason ?? 'Cash on delivery is not available',
          ),
        );
      }
    }

    // ── 3. Create the order in the SAME transaction ─────────────────
    const [created] = await this.orders.create(
      [
        {
          orderNo,
          customerId: buyer,
          vendorId: vendor._id,
          deliveryPartnerId: null,
          items: lines.map((line) => ({
            productId: line.product._id,
            name: line.product.name,
            image: line.product.images[0] ?? null,
            unit: `${line.product.unitValue}${line.product.unit}`,
            price: line.product.price,
            qty: line.qty,
            lineTotal: line.product.price * line.qty,
            fulfilled: true,
          })),
          // The commission SNAPSHOT lives in here: `commissionPct`,
          // `commissionAmount` and `vendorPayout` are copied from the
          // vendor as they stand right now. Changing the vendor's rate
          // tomorrow must never re-price what they sold today.
          pricing: quote.pricing,
          address: {
            label: address.label,
            line1: address.line1,
            line2: address.line2 ?? null,
            city: address.city,
            pincode: address.pincode,
            location: point(
              address.location.coordinates[0],
              address.location.coordinates[1],
            ),
            phone: address.phone,
          },
          payment: {
            method: dto.paymentMethod,
            status: PaymentStatus.PENDING,
            provider:
              dto.paymentMethod === PaymentMethod.ONLINE ? 'razorpay' : null,
            refundedAmount: 0,
          },
          status: OrderStatus.PLACED,
          statusHistory: [
            {
              from: null,
              to: OrderStatus.PLACED,
              byUserId: buyer,
              byRole: Role.CUSTOMER,
              reason: null,
              at: placedAt,
            },
          ],
          deliveryOtpHash: input.deliveryOtpHash,
          proof: {},
          cancellation: {},
          placedAt,
        },
      ],
      { session },
    );

    await this.inventoryLogs.create(
      cart.items.map((item) => ({
        vendorId: vendor._id,
        productId: item.productId,
        delta: -item.qty,
        reason: InventoryReason.ORDER_RESERVE,
        refId: created._id,
        byUserId: buyer,
        at: placedAt,
      })),
      { session },
    );

    if (quote.coupon) {
      await this.pricing.redeem({
        couponId: new Types.ObjectId(quote.coupon.id),
        code: quote.coupon.code,
        customerId: buyer,
        vendorId: vendor._id,
        orderId: created._id,
        discount: quote.coupon.discount,
        session,
      });
    }

    // The cart is spent, not deleted: it is the trail from the order back
    // to what the customer actually assembled, and it expires on its own.
    cart.status = CartStatus.CONVERTED;
    cart.convertedOrderId = created._id;
    await cart.save({ session });

    return {
      order: created.toObject<OrderLean>(),
      store: {
        id: vendor._id.toString(),
        storeName: vendor.storeName,
        slug: vendor.slug,
      },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async loadVendor(
    vendorId: string,
    session?: ClientSession,
  ): Promise<VendorFull> {
    if (!Types.ObjectId.isValid(vendorId)) {
      throw new NotFoundException('Store not found');
    }

    const vendor = await this.vendors
      .findOne({
        _id: new Types.ObjectId(vendorId),
        status: VendorStatus.APPROVED,
      })
      .session(session ?? null)
      .lean<VendorFull | null>()
      .exec();

    if (!vendor) throw new NotFoundException('Store not found');
    return vendor;
  }

  private async loadCart(
    customerId: string,
    vendorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CartDocument> {
    const cart = await this.carts
      .findOne({
        customerId: new Types.ObjectId(customerId),
        vendorId,
        status: CartStatus.ACTIVE,
      })
      .session(session ?? null)
      .exec();

    if (!cart || cart.items.length === 0) {
      throw new NotFoundException('Your cart for this store is empty');
    }
    return cart;
  }

  /** COD rules: locked decision #3 — per-vendor toggle plus a cash cap. */
  private codAvailability(
    vendor: VendorFull,
    grandTotal: number,
  ): { available: boolean; reason: string | null } {
    if (!vendor.codEnabled) {
      return {
        available: false,
        reason: 'This store does not accept cash on delivery',
      };
    }

    if (grandTotal > vendor.codMaxAmount) {
      return {
        available: false,
        // The cap limits how much cash one rider carries, so it is a
        // safety rule rather than a credit decision — say so plainly.
        reason: `Cash on delivery is limited to ₹${Math.floor(
          vendor.codMaxAmount / 100,
        )} for this store`,
      };
    }

    return { available: true, reason: null };
  }

  /**
   * A cryptographically random 4-digit OTP.
   *
   * `randomInt` and not `Math.random()`: the OTP is the proof of delivery
   * for the whole order, and `Math.random()` is a predictable PRNG that
   * has no business guarding goods.
   */
  private generateOtp(): string {
    return String(randomInt(0, 10_000)).padStart(4, '0');
  }

  private customerPricing(pricing: {
    itemsSubtotal: number;
    discount: number;
    deliveryFee: number;
    taxes: number;
    grandTotal: number;
  }): CustomerPricing {
    return {
      itemsSubtotal: pricing.itemsSubtotal,
      discount: pricing.discount,
      deliveryFee: pricing.deliveryFee,
      taxes: pricing.taxes,
      grandTotal: pricing.grandTotal,
    };
  }

  private toAddressView(address: {
    _id: Types.ObjectId;
    label: string;
    line1: string;
    line2?: string | null;
    city: string;
    pincode: string;
    location: { type: 'Point'; coordinates: number[] };
    phone: string;
    isDefault: boolean;
  }): AddressView {
    const [lng, lat] = address.location.coordinates;
    return {
      id: address._id.toString(),
      label: address.label,
      line1: address.line1,
      line2: address.line2 ?? null,
      city: address.city,
      pincode: address.pincode,
      location: { lat, lng },
      phone: address.phone,
      isDefault: address.isDefault,
    };
  }
}
