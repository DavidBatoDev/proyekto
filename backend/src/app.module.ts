import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { Redis } from '@upstash/redis';
import { SupabaseModule } from './config/supabase.module';
import { R2Module } from './config/r2.module';
import { MailModule } from './common/mail/mail.module';
import { ThrottlerStorageRedisService } from './config/throttler-storage.service';
import { RedisModule } from './config/redis.module';
import { UPSTASH_REDIS_CLIENT } from './config/redis.tokens';
import { backendEnvFilePaths } from './config/node-environment';

import { AuthModule } from './modules/shared/auth/auth.module';
import { UsersModule } from './modules/shared/users/users.module';
import { ProfileModule } from './modules/marketplace/profile/profile.module';
import { ProjectsModule } from './modules/execution/projects/projects.module';
import { PayoutsModule } from './modules/marketplace/payouts/payouts.module';
import { AdminModule } from './modules/shared/admin/admin.module';
import { ConsultantsModule } from './modules/marketplace/consultants/consultants.module';
import { ApplicationsModule } from './modules/marketplace/applications/applications.module';
import { UploadsModule } from './modules/shared/uploads/uploads.module';
import { GuestsModule } from './modules/shared/guests/guests.module';
import { RoadmapsModule } from './modules/execution/roadmaps/roadmaps.module';
import { RoadmapTemplatesModule } from './modules/marketplace/roadmap-templates/roadmap-templates.module';
import { RoadmapSharesModule } from './modules/execution/roadmap-shares/roadmap-shares.module';
import { MarketplaceModule } from './modules/marketplace/marketplace/marketplace.module';
import { NotificationsModule } from './modules/shared/notifications/notifications.module';
import { PushModule } from './modules/shared/push/push.module';
import { MobileUpdatesModule } from './modules/shared/mobile-updates/mobile-updates.module';
import { ChatModule } from './modules/execution/chat/chat.module';
import { TeamsModule } from './modules/execution/teams/teams.module';
import { TeamTimeModule } from './modules/execution/team-time/team-time.module';
import { MeetingsModule } from './modules/execution/meetings/meetings.module';
import { InvoicesModule } from './modules/marketplace/invoices/invoices.module';
import { ContractsModule } from './modules/marketplace/contracts/contracts.module';
import { FinancialsModule } from './modules/marketplace/financials/financials.module';
import { FinanceModule } from './modules/marketplace/finance/finance.module';
import { RealtimeModule } from './modules/shared/realtime/realtime.module';
import { RealtimePublisherModule } from './modules/shared/realtime/realtime-publisher.module';
import { AuditModule } from './modules/shared/audit/audit.module';
import { ActivityModule } from './modules/execution/activity/activity.module';
import { DeliveryModule } from './modules/execution/delivery/delivery.module';
import { KnowledgeModule } from './modules/shared/knowledge/knowledge.module';
import { McpModule } from './modules/shared/mcp/mcp.module';
import { QaFixturesModule } from './modules/shared/qa-fixtures/qa-fixtures.module';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Support running Nest from either backend/ or the monorepo root while
      // keeping development credentials isolated from production credentials.
      envFilePath: backendEnvFilePaths,
      validate: validateEnv,
    }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [UPSTASH_REDIS_CLIENT],
      useFactory: (redisClient: Redis | null) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redisClient),
      }),
    }),
    SupabaseModule,
    R2Module,
    MailModule,
    AuthModule,
    UsersModule,
    ProfileModule,
    ProjectsModule,
    PayoutsModule,
    AdminModule,
    ConsultantsModule,
    ApplicationsModule,
    UploadsModule,
    GuestsModule,
    RoadmapsModule,
    RoadmapTemplatesModule,
    RoadmapSharesModule,
    MarketplaceModule,
    NotificationsModule,
    PushModule,
    MobileUpdatesModule,
    ChatModule,
    TeamsModule,
    TeamTimeModule,
    MeetingsModule,
    InvoicesModule,
    ContractsModule,
    FinancialsModule,
    FinanceModule,
    RealtimePublisherModule,
    RealtimeModule,
    AuditModule,
    ActivityModule,
    DeliveryModule,
    KnowledgeModule,
    McpModule,
    QaFixturesModule,
  ],
})
export class AppModule {}
