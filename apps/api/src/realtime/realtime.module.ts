import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { User, UserSchema } from '../database/schemas/user.schema';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../database/schemas/delivery-partner.schema';
import { RealtimeGateway } from './gateways/realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RiderPresenceRegistry } from './rider-presence.registry';
import { WsAuthService } from './middleware/ws-auth.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE REALTIME LAYER
 * ════════════════════════════════════════════════════════════════════════
 *
 * Exports `RealtimeService` and `RiderPresenceRegistry` — never the
 * gateway.
 *
 * That is the rule that keeps this module a LEAF of the dependency graph.
 * The gateway injects models in order to authorise a subscription; if the
 * orders or delivery module injected the gateway back, Nest would have a
 * cycle to resolve and would hand one of the two an `undefined`
 * dependency at runtime. Emitting through a plain injectable that holds a
 * late-bound `Server` reference has no such edge, so any module can
 * broadcast by importing this one.
 *
 * `JwtModule.register({})` mirrors `AuthModule`: the secret is supplied
 * per verification call from `ConfigService`, so the access secret is
 * never baked into module metadata.
 */
@Module({
  imports: [
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
    ]),
  ],
  providers: [
    RealtimeGateway,
    RealtimeService,
    RiderPresenceRegistry,
    WsAuthService,
  ],
  exports: [RealtimeService, RiderPresenceRegistry],
})
export class RealtimeModule {}
