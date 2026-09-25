import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { PasswordService } from '../../common/utils/password.service';
import { IdempotencyModule } from '../../common/idempotency.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    // Supplies IdempotencyInterceptor for `POST /users`.
    IdempotencyModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}
