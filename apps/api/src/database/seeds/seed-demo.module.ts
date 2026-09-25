import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { join } from 'node:path';

import { configuration } from '../../config/configuration';
import { envValidationSchema } from '../../config/env.validation';
import { PasswordService } from '../../common/utils/password.service';

import { User, UserSchema } from '../schemas/user.schema';
import { Vendor, VendorSchema } from '../schemas/vendor.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { Product, ProductSchema } from '../schemas/product.schema';
import { Inventory, InventorySchema } from '../schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogSchema,
} from '../schemas/inventory-log.schema';
import { Order, OrderSchema } from '../schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../schemas/delivery-partner.schema';
import {
  LedgerEntry,
  LedgerEntrySchema,
} from '../schemas/ledger-entry.schema';
import { Settlement, SettlementSchema } from '../schemas/settlement.schema';
import { Coupon, CouponSchema } from '../schemas/coupon.schema';
import { AuditLog, AuditLogSchema } from '../schemas/audit-log.schema';
import { Address, AddressSchema } from '../schemas/address.schema';
import { Issue, IssueSchema } from '../schemas/issue.schema';

import { SeedDemoService } from './seed-demo.service';

/**
 * A standalone context for the demo seeder.
 *
 * Like `SeedModule` it deliberately does NOT import AppModule — the
 * seeder has no business booting controllers, guards or throttlers — but
 * it shares the two things that must not diverge: the same validated
 * configuration, and the same `PasswordService`, so demo accounts are
 * hashed with the identical argon2id parameters and pepper that
 * `/auth/login` verifies against.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
      envFilePath: [join(__dirname, '..', '..', '..', '.env'), '.env'],
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongo.uri'),
        dbName: config.getOrThrow<string>('mongo.dbName'),
        // Fail fast and loudly. A timeout here is almost always the Atlas
        // IP allowlist, not a transient blip worth retrying for minutes.
        retryAttempts: 0,
        serverSelectionTimeoutMS: 20_000,
      }),
    }),

    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Product.name, schema: ProductSchema },
      { name: Inventory.name, schema: InventorySchema },
      { name: InventoryLog.name, schema: InventoryLogSchema },
      { name: Order.name, schema: OrderSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
  ],
  providers: [PasswordService, SeedDemoService],
})
export class SeedDemoModule {}
