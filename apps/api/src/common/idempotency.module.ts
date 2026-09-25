import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  IdempotencyKey,
  IdempotencyKeySchema,
} from '../database/schemas/idempotency-key.schema';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';

/**
 * Makes `IdempotencyInterceptor` injectable wherever it is used.
 *
 * Import this module in any feature module whose controllers carry
 * `@UseInterceptors(IdempotencyInterceptor)` — checkout, payments and
 * account provisioning today.
 *
 * It is deliberately NOT an APP_INTERCEPTOR: replay storage should be
 * opted into per route, so every idempotent endpoint is a visible,
 * reviewable decision rather than an ambient behaviour.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IdempotencyKey.name, schema: IdempotencyKeySchema },
    ]),
  ],
  providers: [IdempotencyInterceptor],
  exports: [IdempotencyInterceptor, MongooseModule],
})
export class IdempotencyModule {}
