import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ActivityFlushInterceptor } from '../../../common/interceptors/activity-flush.interceptor';

/**
 * Global so any feature module (chat, projects, roadmaps, future scope /
 * change-request / file domains) can inject AuditService to record
 * project-wide activity without bespoke import wiring.
 *
 * ActivityFlushInterceptor is provided here (rather than via APP_INTERCEPTOR)
 * because main.ts registers the global interceptor chain positionally with
 * `new`, and this one needs AuditService injected — so main.ts resolves it
 * with app.get(), mirroring the existing app.get(Reflector) call.
 */
@Global()
@Module({
  providers: [AuditService, ActivityFlushInterceptor],
  exports: [AuditService, ActivityFlushInterceptor],
})
export class AuditModule {}
