import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { EngagementsCoreModule } from '../../marketplace/engagements/engagements-core.module';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TeamTimeLegacyController } from './controllers/team-time-legacy.controller';
import { TimeCronController } from './controllers/time-cron.controller';
import { TimeEntriesController } from './controllers/time-entries.controller';
import { TimePoliciesController } from './controllers/time-policies.controller';
import { TimeReportsController } from './controllers/time-reports.controller';
import { TimesheetsController } from './controllers/timesheets.controller';
import { TimeGuestGuard } from './guards/time-guest.guard';
import { TeamTimeLegacyService } from './legacy/team-time-legacy.service';
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
 * Time tracking: entries, timesheets, policies, reports, the hourly cron, the For resolver and the
 * `/api/team-time` alias that keeps the deployed web and old OTA bundles working until the web PR.
 *
 * It imports EngagementsCoreModule, never EngagementsModule (D25): ProjectsModule, TeamsModule, PayoutsModule,
 * InvoicesModule, FinanceModule, AccountModule and EngagementsModule import TimeModule, and TimeModule imports
 * none of them, so there is no cycle. UPSTASH_REDIS_CLIENT (TimeCacheService) and ConfigService (CronSecretGuard)
 * are global.
 *
 * The alias telemetry interceptor is not a provider (D74): `@UseInterceptors(AliasTelemetryInterceptor)` on
 * TeamTimeLegacyController makes Nest create it as this module's injectable, and that instance does the counting
 * and receives the shutdown flush. Listing it here too would only add a second, idle instance.
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
  controllers: [
    TimeEntriesController,
    TimesheetsController,
    TimeReportsController,
    TimePoliciesController,
    TimeCronController,
    TeamTimeLegacyController,
  ],
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
    TeamTimeLegacyService,
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
