import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global so any feature module (chat, projects, roadmaps, future scope /
 * change-request / file domains) can inject AuditService to record
 * project-wide activity without bespoke import wiring.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
