import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Vendor, VendorSchema } from '../../database/schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerSchema,
} from '../../database/schemas/delivery-partner.schema';
import { Setting, SettingSchema } from '../../database/schemas/setting.schema';
import { PasswordService } from '../../common/utils/password.service';
import {
  RegistrationOtp,
  RegistrationOtpSchema,
} from './schemas/registration-otp.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: RegistrationOtp.name, schema: RegistrationOtpSchema },
      // Vendor, DeliveryPartner and Setting are owned by their respective
      // schemas under src/database/schemas — this module only registers
      // the models it needs (vendor + rider applications, and reading the
      // platform's default commission). It never redefines them.
      { name: Vendor.name, schema: VendorSchema },
      { name: DeliveryPartner.name, schema: DeliveryPartnerSchema },
      { name: Setting.name, schema: SettingSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // Secrets are supplied per-signing-call from ConfigService, so the
    // access and refresh secrets stay distinct and neither is baked in here.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, RegistrationService, JwtStrategy, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
