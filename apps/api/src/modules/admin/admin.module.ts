import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { User, UserSchema } from '../../database/schemas/user.schema';
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
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../../database/schemas/delivery-partner.schema';
import {
  LedgerEntry,
  LedgerEntrySchema,
} from '../../database/schemas/ledger-entry.schema';
import {
  Settlement,
  SettlementSchema,
} from '../../database/schemas/settlement.schema';
import { Coupon, CouponSchema } from '../../database/schemas/coupon.schema';
import { Setting, SettingSchema } from '../../database/schemas/setting.schema';
import { Address, AddressSchema } from '../../database/schemas/address.schema';
import { Issue, IssueSchema } from '../../database/schemas/issue.schema';
import {
  InventoryLog,
  InventoryLogSchema,
} from '../../database/schemas/inventory-log.schema';
import {
  RiderWallet,
  RiderWalletSchema,
} from '../../database/schemas/rider-wallet.schema';

import { UsersModule } from '../users/users.module';
import { IdempotencyModule } from '../../common/idempotency.module';
import { AdminAuditModule } from './audit/audit.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { AdminAnalyticsController } from './analytics/analytics.controller';
import { AdminAnalyticsService } from './analytics/analytics.service';
import { AdminVendorsController } from './vendors/vendors.controller';
import { AdminVendorsService } from './vendors/vendors.service';
import { AdminOrdersController } from './orders/orders.controller';
import { AdminOrdersService } from './orders/orders.service';
import { AdminCustomersController } from './customers/customers.controller';
import { AdminCustomersService } from './customers/customers.service';
import { AdminDeliveryPartnersController } from './delivery-partners/delivery-partners.controller';
import { AdminDeliveryPartnersService } from './delivery-partners/delivery-partners.service';
import { AdminCatalogController } from './catalog/catalog.controller';
import { AdminCatalogService } from './catalog/catalog.service';
import { AdminFinanceController } from './finance/finance.controller';
import { AdminFinanceService } from './finance/finance.service';
import { AdminCouponsController } from './coupons/coupons.controller';
import { AdminCouponsService } from './coupons/coupons.service';
import { AdminTeamController } from './team/team.controller';
import { AdminTeamService } from './team/team.service';
import { AdminSettingsController } from './settings/settings.controller';
import { AdminSettingsService } from './settings/settings.service';
import { AdminRidersController } from './riders/riders.controller';
import { AdminRidersService } from './riders/riders.service';

import { AdminOpsController } from './ops/ops.controller';
import { AdminOpsApprovalsController } from './ops/ops-approvals.controller';
import { AdminOpsDispatchController } from './ops/ops-dispatch.controller';
import { AdminOpsIssuesController } from './ops/ops-issues.controller';
import { AdminOpsStockController } from './ops/ops-stock.controller';
import { AdminOpsService } from './ops/ops.service';
import { AdminOpsApprovalsService } from './ops/ops-approvals.service';
import { AdminOpsDispatchService } from './ops/ops-dispatch.service';
import { AdminOpsIssuesService } from './ops/ops-issues.service';
import { AdminOpsStockService } from './ops/ops-stock.service';
import { OpsCardsService } from './ops/ops-cards.service';

/**
 * The Super Admin surface.
 *
 * ── Authorisation, in one place ─────────────────────────────────────────
 * Nothing here carries `@Public()`, so the global `JwtAuthGuard` already
 * demands a valid access token on every route. Each controller then
 * declares `@Roles(Role.ADMIN)` — the LOWEST role permitted — and
 * `RolesGuard` lets SUPER_ADMIN through that implicitly.
 *
 * Four things are SUPER_ADMIN-only, and each is either irreversible or
 * a privilege grant:
 *   PATCH /admin/vendors/:id/commission   money policy
 *   POST  /admin/settlements/generate     creates payable rows
 *   POST  /admin/settlements/:id/pay      moves money
 *   /admin/team/*                         creates and revokes staff
 *   PUT   /admin/settings                 platform-wide pricing
 *
 * Role inheritance runs upward only, so ADMIN does not satisfy any of
 * them. A compromised ADMIN session can run the platform day to day but
 * cannot re-price it, pay itself out, or mint a replacement admin.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Product.name, schema: ProductSchema },
      { name: Inventory.name, schema: InventorySchema },
      { name: Order.name, schema: OrderSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: Setting.name, schema: SettingSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Issue.name, schema: IssueSchema },
      { name: InventoryLog.name, schema: InventoryLogSchema },
      { name: RiderWallet.name, schema: RiderWalletSchema },
    ]),

    // Reused, not reimplemented: UsersService owns the account invariants
    // (no SUPER_ADMIN through the API, system accounts immutable, refresh
    // family cleared on suspension) that /admin/team and the customer and
    // rider status endpoints all depend on.
    UsersModule,

    // Supplies IdempotencyInterceptor for POST /admin/settlements/:id/pay.
    IdempotencyModule,

    // Supplies AuditService + AuditInterceptor, and owns
    // GET /admin/audit-logs.
    AdminAuditModule,

    // Reused, not reimplemented: `RiderWalletService` and
    // `RiderKycService` own the wallet invariants (the guarded debit,
    // the signed ledger, the masking rule) and the admin console must
    // move a balance through the SAME code the rider surface uses. A
    // second credit path here is a second place the ledger can drift
    // from the balance.
    DeliveryModule,

    // Every KYC decision and every wallet credit tells the rider.
    NotificationsModule,
  ],

  controllers: [
    AdminAnalyticsController,
    AdminVendorsController,
    AdminOrdersController,
    AdminCustomersController,
    AdminDeliveryPartnersController,
    AdminCatalogController,
    AdminFinanceController,
    AdminCouponsController,
    AdminTeamController,
    AdminSettingsController,
    AdminRidersController,

    // ── The ADMIN operations console (§ ops) ──────────────────────────
    //  Read-heavy, action-oriented, live. Every route is
    //  @Roles(Role.ADMIN): none of it moves money or grants privilege,
    //  so none of it is SUPER_ADMIN-only.
    AdminOpsController,
    AdminOpsApprovalsController,
    AdminOpsDispatchController,
    AdminOpsIssuesController,
    AdminOpsStockController,
  ],

  providers: [
    AdminAnalyticsService,
    AdminVendorsService,
    AdminOrdersService,
    AdminCustomersService,
    AdminDeliveryPartnersService,
    AdminCatalogService,
    AdminFinanceService,
    AdminCouponsService,
    AdminTeamService,
    AdminSettingsService,
    AdminRidersService,

    OpsCardsService,
    AdminOpsService,
    AdminOpsApprovalsService,
    AdminOpsDispatchService,
    AdminOpsIssuesService,
    AdminOpsStockService,
  ],
})
export class AdminModule {}
