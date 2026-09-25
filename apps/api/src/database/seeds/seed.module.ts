import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { join } from 'node:path';

import { configuration } from '../../config/configuration';
import { envValidationSchema } from '../../config/env.validation';
import { PasswordService } from '../../common/utils/password.service';
import { User, UserSchema } from '../schemas/user.schema';
import { SeedUsersService } from './seed-users';

/**
 * A deliberately minimal module for the seeder.
 *
 * It does NOT import AppModule: the seeder has no business booting
 * controllers, guards, throttlers or websockets. What it does share with
 * the app is the part that matters for correctness —
 *
 *   • the SAME `configuration()` + `envValidationSchema`, so a missing or
 *     too-short SEED_* password aborts the seed instead of quietly
 *     creating a weak bootstrap admin;
 *   • the SAME `PasswordService`, so the argon2id parameters and the
 *     ARGON2_PEPPER used here are byte-for-byte what `/auth/login`
 *     verifies against. Re-implementing the hashing here would be the
 *     easy way to produce accounts that can never log in.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
      // Resolved from this file rather than from process.cwd(), so the
      // seed works whether it is run from the repo root or from apps/api,
      // and from src/ (ts-node) or dist/ (compiled).
      envFilePath: [join(__dirname, '..', '..', '..', '.env'), '.env'],
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongo.uri'),
        dbName: config.getOrThrow<string>('mongo.dbName'),
        // The seeder is a short-lived CLI process. It should fail fast and
        // loudly rather than hang for minutes behind a retry loop — a
        // timeout here almost always means the Atlas IP allowlist.
        retryAttempts: 0,
        serverSelectionTimeoutMS: 15_000,
      }),
    }),

    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [PasswordService, SeedUsersService],
})
export class SeedModule {}
