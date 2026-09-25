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
import { PasswordService } from '../../common/utils/password.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AssignmentService } from './assignment.service';
import { AssignmentSweeperService } from './assignment-sweeper.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryLocationService } from './delivery-location.service';
import { DeliveryOrdersService } from './delivery-orders.service';
import { DeliveryService } from './delivery.service';
import { DeliveryOtpService } from './otp.service';
import { GeoService } from './geo.service';
import { RiderHeartbeatService } from './rider-heartbeat.service';

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
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
      { name: DeliveryAssignment.name, schema: DeliveryAssignmentSchema },
      { name: LocationPing.name, schema: LocationPingSchema },
    ]),
  ],
  controllers: [DeliveryController],
  providers: [
    DeliveryService,
    DeliveryOrdersService,
    DeliveryLocationService,
    AssignmentService,
    AssignmentSweeperService,
    RiderHeartbeatService,
    DeliveryOtpService,
    GeoService,
    PasswordService,
  ],
  exports: [AssignmentService, GeoService, DeliveryOtpService],
})
export class DeliveryModule {}
