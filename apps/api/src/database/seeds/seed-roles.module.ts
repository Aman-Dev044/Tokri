import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { join } from 'node:path';

import { configuration } from '../../config/configuration';
import { envValidationSchema } from '../../config/env.validation';
import { PasswordService } from '../../common/utils/password.service';
import { User, UserSchema } from '../schemas/user.schema';
import { Vendor, VendorSchema } from '../schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../schemas/delivery-partner.schema';

/**
 * Minimal module for `seed:roles`.
 *
 * Like `SeedModule`, it deliberately does NOT import `AppModule` — the
 * seeder has no business booting controllers, guards, throttlers or
 * websockets, and importing them would make it fail whenever an unrelated
 * module is mid-edit.
 *
 * What it DOES share with the app is the part that matters: the same
 * `configuration()` + `envValidationSchema`, and the same
 * `PasswordService`, so the argon2id parameters and ARGON2_PEPPER used
 * here are byte-for-byte what `/auth/login` verifies against. Hashing
 * re-implemented here is the easy way to create accounts that exist but
 * can never sign in.
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
        // No retry loop: an unreachable database should fail in seconds
        // with a readable error, not hang behind silent reconnects.
        retryAttempts: 0,
        serverSelectionTimeoutMS: 15_000,
      }),
    }),

    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
    ]),
  ],
  providers: [PasswordService],
})
export class SeedRolesModule {}
