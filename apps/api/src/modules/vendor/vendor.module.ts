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
import { User, UserSchema } from '../../database/schemas/user.schema';
import {
  InvoiceCounter,
  InvoiceCounterSchema,
  PosSale,
  PosSaleSchema,
} from '../../database/schemas/pos-sale.schema';

import { PasswordService } from '../../common/utils/password.service';
import { AdminAuditModule } from '../admin/audit/audit.module';
import { IdempotencyModule } from '../../common/idempotency.module';

import { VendorStoreController } from './store/store.controller';
import { VendorStoreService } from './store/store.service';
import { VendorCatalogController } from './catalog/catalog.controller';
import { VendorCatalogService } from './catalog/catalog.service';
import { VendorImagesService } from './catalog/images.service';
import { VendorInventoryController } from './inventory/inventory.controller';
import { VendorInventoryService } from './inventory/inventory.service';
import { VendorOrdersController } from './orders/orders.controller';
import { VendorOrdersService } from './orders/orders.service';
import { VendorPartnersController } from './partners/partners.controller';
import { VendorPartnersService } from './partners/partners.service';
import { VendorEarningsController } from './earnings/earnings.controller';
import { VendorEarningsService } from './earnings/earnings.service';
import {
  VendorMeController,
  VendorStaffController,
} from './staff/staff.controller';
import { VendorStaffService } from './staff/staff.service';
import { VendorPosController } from './pos/pos.controller';
import { VendorPosService } from './pos/pos.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE VENDOR SURFACE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Everything a shop owner needs to run their store: the store record,
 * the catalogue, stock, the order board, their riders and their money.
 *
 * ── Authorisation, in one place ─────────────────────────────────────────
 * Nothing here carries `@Public()`, so the global `JwtAuthGuard` already
 * demands a valid access token on every route, and every controller
 * declares `@Roles(Role.VENDOR, Role.STAFF)` — the store's owner and its
 * employees. Every ROUTE then names the store permission it needs with
 * `@RequirePermission(...)`; `PermissionsGuard` checks it against the
 * permissions `JwtStrategy` read from the database on this request. The
 * owner holds all of them; staff hold what their profile grants.
 * `test/integration/store-staff.spec.ts` fails the build for any
 * `/vendor/*` route without a rule.
 *
 * Note what that does NOT admit: role inheritance in `RolesGuard` runs
 * upward only (SUPER_ADMIN satisfies ADMIN), and no rule makes a platform
 * role a vendor — so an admin token is a 403 here. An admin who needs to
 * act on a store does it through `/admin/vendors/*`, where the action is
 * recorded as an admin action against a named operator rather than
 * disappearing into the store's own audit trail.
 *
 * ── Tenancy ─────────────────────────────────────────────────────────────
 * `VendorScopeGuard` puts the tenant id on `req.vendorScope` from the
 * VERIFIED JWT. The `@VendorScope()` param decorator is the only way this
 * module reads it, and every service method takes it as a required first
 * argument that lands in the query filter. There is no `:vendorId`
 * parameter on any route in this module, and no service method that can
 * be called without a scope.
 *
 * Proven, not asserted: `test/integration/vendor-isolation.spec.ts`
 * authenticates as vendor A and addresses every one of vendor B's
 * resources by id.
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
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: User.name, schema: UserSchema },
      { name: PosSale.name, schema: PosSaleSchema },
      { name: InvoiceCounter.name, schema: InvoiceCounterSchema },
    ]),

    // Counter sales REQUIRE an Idempotency-Key: a double-tapped Charge
    // button must not sell the basket twice.
    IdempotencyModule,

    // Supplies AuditService + AuditContext + AuditInterceptor. Nest
    // caches module instances, so importing it here reuses the single
    // instance AdminModule already has rather than registering a second
    // copy of `/admin/audit-logs`.
    AdminAuditModule,
  ],

  controllers: [
    VendorStoreController,
    VendorCatalogController,
    VendorInventoryController,
    VendorOrdersController,
    VendorPartnersController,
    VendorEarningsController,
    VendorMeController,
    VendorStaffController,
    VendorPosController,
  ],

  providers: [
    VendorStoreService,
    VendorCatalogService,
    VendorImagesService,
    VendorInventoryService,
    VendorOrdersService,
    VendorPartnersService,
    VendorEarningsService,
    VendorStaffService,
    VendorPosService,
    // Rider onboarding hashes a password with argon2id + the environment
    // pepper. Reused, never reimplemented.
    PasswordService,
  ],
})
export class VendorModule {}
