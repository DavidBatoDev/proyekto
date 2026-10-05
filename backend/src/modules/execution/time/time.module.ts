import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { EngagementsCoreModule } from '../../marketplace/engagements/engagements-core.module';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TimeGuestGuard } from './guards/time-guest.guard';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import { TimeCacheService } from './time-cache';
import { TimeCronService } from './time-cron.service';
import { TimeEntriesService } from './time-entries.service';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimeProjectsFacade } from './time-projects.facade';
import { TimeRatesService } from './time-rates.service';
import { TimeReportsService } from './time-reports.service';
import { TimesheetsService } from './timesheets.service';

/**
 * Time tracking: entries, timesheets, policies, the For resolver and the /api/team-time alias.
 *
 * Skeleton (P03, providers only); P17 adds the controllers and the alias telemetry interceptor and wires the
 * module into AppModule. It imports EngagementsCoreModule, never EngagementsModule (D25): ProjectsModule,
 * TeamsModule, PayoutsModule, InvoicesModule and EngagementsModule import TimeModule, and TimeModule imports
 * none of them, so there is no cycle. UPSTASH_REDIS_CLIENT (TimeCacheService) is global.
 */
@Module({
  imports: [
    SupabaseModule,
    AuthorizationModule,
    NotificationsModule,
    WorkspacesModule,
    EntitlementsCoreModule,
    EngagementsCoreModule,
  ],
  controllers: [],
  providers: [
    TimeCacheService,
    TimeGuestGuard,
    LoggingContextService,
    TimePolicyService,
    TimeRatesService,
    TimeAuthorityService,
    TimeNotificationsService,
    TimeEntriesService,
    TimesheetsService,
    TimeCronService,
    TimeReportsService,
    TimeProjectsFacade,
  ],
  exports: [
    TimeCacheService,
    TimePolicyService,
    TimeNotificationsService,
    TimeEntriesService,
    TimeProjectsFacade,
    TimeAuthorityService,
  ],
})
export class TimeModule {}
