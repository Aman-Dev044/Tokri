import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Vendor, VendorSchema } from '../../database/schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../../database/schemas/delivery-partner.schema';
import {
  DeliveryAssignment,
  DeliveryAssignmentSchema,
} from '../../database/schemas/delivery-assignment.schema';
import {
  LocationPing,
  LocationPingSchema,
} from '../../database/schemas/location-ping.schema';
import {
  RiderWallet,
  RiderWalletSchema,
} from '../../database/schemas/rider-wallet.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from '../../database/schemas/wallet-transaction.schema';
import {
  WalletTopup,
  WalletTopupSchema,
} from '../../database/schemas/wallet-topup.schema';
import { PasswordService } from '../../common/utils/password.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  PAYMENT_PROVIDER,
} from '../shop/payments/payment-provider';
import { RazorpayProvider } from '../shop/payments/razorpay.provider';
import { AssignmentService } from './assignment.service';
import { AssignmentSweeperService } from './assignment-sweeper.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryLocationService } from './delivery-location.service';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DeliveryService } from './delivery.service';
import { DeliveryOtpService } from './otp.service';
import { GeoService } from './geo.service';
import { DeliveryProofPhotoService } from './proof-photo.service';
import { RiderHeartbeatService } from './rider-heartbeat.service';
import { RiderKycController } from './rider-kyc.controller';
import { RiderKycService } from './rider-kyc.service';
import { RiderWalletController } from './rider-wallet.controller';
import { RiderWalletService } from './rider-wallet.service';
import { WalletTopupService } from './wallet-topup.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  DELIVERY
 * ════════════════════════════════════════════════════════════════════════
 *
 * The rider API, the assignment engine and the two background sweepers.
 *
 * ── What it exports, and why ────────────────────────────────────────────
 * `AssignmentService` — so the vendor module can call `dispatch(orderId)`
 * the moment an order reaches READY_FOR_PICKUP, and the admin console can
 * reuse the same engine rather than growing a second one that drifts.
 *
 * `GeoService` — distance, ETA and geocoding. Checkout needs the first
 * two and address creation needs the third, and all three must agree with
 * what the rider is shown.
 *
 * ── The dependency arrow points one way ─────────────────────────────────
 * This module imports `RealtimeModule`, never the reverse. It emits
 * through `RealtimeService` and touches the gateway nowhere, so the
 * module graph stays acyclic no matter how many modules start
 * broadcasting.
 *
 * `PasswordService` is provided directly rather than pulled in through
 * `AuthModule`: the OTP hash format has to match the one the seeder and
 * checkout write, and this is the argon2id configuration that produces
 * it. Importing the whole auth module to reach one stateless hasher
 * would drag the JWT strategy along with it.
 */
@Module({
  imports: [
    RealtimeModule,

    // The wallet and KYC both notify the rider. `NotificationsService` is
    // consumed, never reimplemented — `src/modules/notifications/**` is
    // read-only to this module apart from APPENDING templates.
    NotificationsModule,

    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
      { name: DeliveryAssignment.name, schema: DeliveryAssignmentSchema },
      { name: LocationPing.name, schema: LocationPingSchema },
      { name: RiderWallet.name, schema: RiderWalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: WalletTopup.name, schema: WalletTopupSchema },
    ]),
  ],
  controllers: [
    DeliveryController,
    RiderWalletController,
    RiderKycController,
  ],
  providers: [
    DeliveryService,
    DeliveryOrdersService,
    DeliveryLocationService,
    AssignmentService,
    AssignmentSweeperService,
    RiderHeartbeatService,
    DeliveryOtpService,
    GeoService,
    DeliveryProofPhotoService,
    PasswordService,
    RiderWalletService,
    RiderKycService,
    WalletTopupService,

    // ── The payment port, bound locally ───────────────────────────────
    // The wallet top-up goes through the SAME `PaymentProvider` port and
    // the SAME Razorpay adapter as the customer's checkout, so there is
    // one HMAC implementation in the platform rather than two that can
    // drift apart.
    //
    // It is bound HERE rather than imported from `ShopModule` because
    // `ShopModule` already imports THIS module (for `AssignmentService`)
    // and the reverse edge would close a cycle — Nest would hand one of
    // the two an `undefined` dependency at runtime. `RazorpayProvider`
    // is stateless: it holds no connection and no cached credential, it
    // reads `ConfigService` per call, so a second instance is a second
    // object and nothing more.
    { provide: PAYMENT_PROVIDER, useClass: RazorpayProvider },
  ],
  exports: [
    AssignmentService,
    GeoService,
    DeliveryOtpService,
    // Exported so the admin rider console can credit a wallet and move a
    // KYC decision through the SAME service the rider surface uses —
    // one place where a balance changes, one place that masks a number.
    RiderWalletService,
    RiderKycService,
  ],
})
export class DeliveryModule {}
