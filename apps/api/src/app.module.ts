import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ShopModule } from './modules/shop/shop.module';
import { UsersModule } from './modules/users/users.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { VendorScopeGuard } from './common/guards/vendor-scope.guard';
import { ResourceOwnerGuard } from './common/guards/resource-owner.guard';
import { RealtimeModule } from './realtime/realtime.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        // Report EVERY missing variable at once, not just the first.
        abortEarly: false,
      },
      // `.env` is read from the app root. It is gitignored; `.env.example`
      // is the committed template.
      envFilePath: ['.env'],
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongo.uri'),
        dbName: config.getOrThrow<string>('mongo.dbName'),
        retryAttempts: 5,
        retryDelay: 2000,
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('throttle.ttlMs'),
            limit: config.getOrThrow<number>('throttle.limit'),
          },
        ],
      }),
    }),

    AuthModule,
    HealthModule,
    UsersModule,
    AdminModule,
    DeliveryModule,
    RealtimeModule,
    VendorModule,
    ShopModule,
    NotificationsModule,
  ],

  providers: [
    // ─────────────────────────────────────────────────────────────
    //  THE GLOBAL GUARD CHAIN — deny by default.
    //
    //  Applied to EVERY route in the application, in this order.
    //  A route is public only if it carries @Public(); a route is
    //  role-restricted only if it carries @Roles(). Nothing has to be
    //  remembered per-controller, so nothing can be forgotten.
    //
    //    1. ThrottlerGuard      — rate limit
    //    2. JwtAuthGuard        — authenticated?
    //    3. RolesGuard          — permitted role?
    //    4. VendorScopeGuard    — inject tenant scope from the token
    //    5. ResourceOwnerGuard  — does this user own THIS document?
    //
    //  The order is deliberate and widening-to-narrowing: reject cheaply
    //  and anonymously first (rate limit), then identity, then coarse
    //  role, then tenant, and only then hit the database for an
    //  object-level ownership check. Reversing any pair would either
    //  query the database on behalf of an unauthenticated caller or
    //  leak the existence of a document to the wrong tenant.
    // ─────────────────────────────────────────────────────────────
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: VendorScopeGuard },
    { provide: APP_GUARD, useClass: ResourceOwnerGuard },

    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
