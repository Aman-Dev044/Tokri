import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Vendor, VendorSchema } from '../../database/schemas/vendor.schema';
import {
  Category,
  CategorySchema,
} from '../../database/schemas/category.schema';
import { Product, ProductSchema } from '../../database/schemas/product.schema';
import {
  Inventory,
  InventorySchema,
} from '../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogSchema,
} from '../../database/schemas/inventory-log.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { Address, AddressSchema } from '../../database/schemas/address.schema';
import { Coupon, CouponSchema } from '../../database/schemas/coupon.schema';
import { Setting, SettingSchema } from '../../database/schemas/setting.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../../database/schemas/delivery-partner.schema';

import { Cart, CartSchema } from './schemas/cart.schema';
import {
  CouponRedemption,
  CouponRedemptionSchema,
} from './schemas/coupon-redemption.schema';
import {
  OrderCounter,
  OrderCounterSchema,
} from './schemas/order-counter.schema';

import { IdempotencyModule } from '../../common/idempotency.module';
import { PasswordService } from '../../common/utils/password.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AdminAuditModule } from '../admin/audit/audit.module';

import { ShopSettingsService } from './common/shop-settings.service';
import { DiscoveryController } from './discovery/discovery.controller';
import { DiscoveryService } from './discovery/discovery.service';
import { CartController } from './cart/cart.controller';
import { CartService } from './cart/cart.service';
import { AddressesController } from './addresses/addresses.controller';
import { AddressesService } from './addresses/addresses.service';
import { PricingService } from './pricing/pricing.service';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { OrderNumberService } from './checkout/order-number.service';
import { ShopOrdersController } from './orders/orders.controller';
import { ShopOrdersService } from './orders/orders.service';
import { PAYMENT_PROVIDER } from './payments/payment-provider';
import { RazorpayProvider } from './payments/razorpay.provider';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { StockReleaseSweeperService } from './jobs/stock-release-sweeper.service';
import { PaymentReconciliationSweeperService } from './jobs/payment-reconciliation-sweeper.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE CUSTOMER SURFACE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Discovery → cart → addresses → checkout → orders → tracking.
 *
 * ── Authorisation, in one place ─────────────────────────────────────────
 * The five `DiscoveryController` routes carry `@Public()` and are listed
 * by name in `test/integration/public-routes.spec.ts`, which asserts the
 * public set EXACTLY. Everything else in this module is
 * `@Roles(Role.CUSTOMER)` behind the global guard chain, and every route
 * that names a document in its path also carries `@Owns(...)` so
 * `ResourceOwnerGuard` checks the document against the token's `sub` —
 * returning 404 on a mismatch, never 403.
 *
 * ── What this module owns, and what it borrows ──────────────────────────
 * It owns three collections: `carts` (§5.1 specifies the shape; nothing
 * else in the platform writes one), `coupon_redemptions` (per-user coupon
 * limits have nowhere else to live — the order carries an amount, not a
 * code) and `order_counters` (the `orderNo` allocator). Everything else —
 * vendors, products, inventory, orders, addresses, coupons, settings — is
 * an existing schema, registered read/write here and duplicated nowhere.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Product.name, schema: ProductSchema },
      { name: Inventory.name, schema: InventorySchema },
      { name: InventoryLog.name, schema: InventoryLogSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: Setting.name, schema: SettingSchema },
      { name: User.name, schema: UserSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },

      // Owned by this module.
      { name: Cart.name, schema: CartSchema },
      { name: CouponRedemption.name, schema: CouponRedemptionSchema },
      { name: OrderCounter.name, schema: OrderCounterSchema },
    ]),

    // Supplies IdempotencyInterceptor for POST /checkout, where the
    // Idempotency-Key header is REQUIRED (§6.1). Also re-exports the
    // `IdempotencyKey` model, which `PaymentsService` injects directly to
    // dedupe Razorpay webhook deliveries on the provider's own event id
    // (§8.3) — a second, ad-hoc claim mechanism would be a second place
    // that logic could drift from the one `IdempotencyInterceptor` uses.
    IdempotencyModule,

    // `PaymentsService` emits `payment.updated` / `order.status_changed`
    // through this, never through the gateway directly — see
    // `RealtimeModule`'s own module comment for why that keeps the
    // dependency graph acyclic.
    RealtimeModule,

    // Supplies AuditService + AuditContext + AuditInterceptor, exactly as
    // `VendorModule` does. Every payment mutation — webhook-driven,
    // client-callback-driven, or sweeper-driven — writes an audit row.
    AdminAuditModule,
  ],

  controllers: [
    DiscoveryController,
    CartController,
    AddressesController,
    CheckoutController,
    ShopOrdersController,
    PaymentsController,
  ],

  providers: [
    ShopSettingsService,
    DiscoveryService,
    CartService,
    AddressesService,
    PricingService,
    OrderNumberService,
    CheckoutService,
    ShopOrdersService,
    PaymentsService,

    // §8.2 / §8.3: the two interval sweepers. Neither is BullMQ — see
    // their own module comments for why an interval sweeper mirroring
    // `AssignmentSweeperService` is the right call here.
    StockReleaseSweeperService,
    PaymentReconciliationSweeperService,

    // argon2id + pepper, reused for the delivery OTP hash. Provided the
    // same way AuthModule and UsersModule provide it: it is a stateless
    // utility, so a second instance is a second object and not a second
    // source of truth.
    PasswordService,

    // The gateway behind its port (decision #2). Swapping Razorpay for
    // Stripe is a different class bound to this token, and nothing that
    // consumes it changes.
    { provide: PAYMENT_PROVIDER, useClass: RazorpayProvider },
  ],
})
export class ShopModule {}
