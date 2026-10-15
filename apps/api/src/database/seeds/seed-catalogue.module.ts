import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { join } from 'node:path';

import { configuration } from '../../config/configuration';
import { envValidationSchema } from '../../config/env.validation';
import { Category, CategorySchema } from '../schemas/category.schema';
import { Inventory, InventorySchema } from '../schemas/inventory.schema';
import { Product, ProductSchema } from '../schemas/product.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Vendor, VendorSchema } from '../schemas/vendor.schema';

/**
 * Minimal module for `seed:catalogue`.
 *
 * Like `SeedRolesModule`, it deliberately does NOT import `AppModule`: a
 * seeder has no business booting controllers, guards, throttlers or
 * websockets, and importing them makes the seed fail whenever an unrelated
 * module happens to be mid-edit.
 *
 * It shares the one thing that matters — the same `configuration()` and
 * `envValidationSchema` as the app — so it reads exactly the database the
 * API reads, and refuses to start on a half-configured environment.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
      // Resolved from this file, not from process.cwd(), so the seed works
      // from the repo root or from apps/api, under ts-node or compiled.
      envFilePath: [join(__dirname, '..', '..', '..', '.env'), '.env'],
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongo.uri'),
        dbName: config.getOrThrow<string>('mongo.dbName'),
        retryAttempts: 0,
        serverSelectionTimeoutMS: 15_000,
      }),
    }),

    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Product.name, schema: ProductSchema },
      { name: Inventory.name, schema: InventorySchema },
    ]),
  ],
})
export class SeedCatalogueModule {}
