import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  AuditLog,
  AuditLogSchema,
} from '../../../database/schemas/audit-log.schema';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { AdminAuditController } from './audit.controller';
import { AuditContext } from './audit-context';
import { AuditService } from './audit.service';

/**
 * Owns the audit trail: the writer (`AuditService`), the request-identity
 * carrier (`AuditContext`) and the safety-net `AuditInterceptor`.
 *
 * Every admin sub-module imports this, so `@UseInterceptors(AuditInterceptor)`
 * on a controller resolves without each module re-registering the model.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AdminAuditController],
  providers: [AuditService, AuditContext, AuditInterceptor],
  exports: [AuditService, AuditContext, AuditInterceptor],
})
export class AdminAuditModule {}
