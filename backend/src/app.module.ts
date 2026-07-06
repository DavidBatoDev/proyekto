import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { Redis } from '@upstash/redis';
import { SupabaseModule } from './config/supabase.module';
import { R2Module } from './config/r2.module';
import { ThrottlerStorageRedisService } from './config/throttler-storage.service';
import { RedisModule } from './config/redis.module';
import { UPSTASH_REDIS_CLIENT } from './config/redis.tokens';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { AdminModule } from './modules/admin/admin.module';
import { ConsultantsModule } from './modules/consultants/consultants.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { GuestsModule } from './modules/guests/guests.module';
import { RoadmapsModule } from './modules/roadmaps/roadmaps.module';
import { RoadmapSharesModule } from './modules/roadmap-shares/roadmap-shares.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PushModule } from './modules/push/push.module';
import { MobileUpdatesModule } from './modules/mobile-updates/mobile-updates.module';
import { ChatModule } from './modules/chat/chat.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TeamTimeModule } from './modules/team-time/team-time.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RealtimePublisherModule } from './modules/realtime/realtime-publisher.module';
import { AuditModule } from './modules/audit/audit.module';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Support running Nest from either backend/ or the monorepo root.
      envFilePath: ['.env', 'backend/.env'],
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
    AuthModule,
    UsersModule,
    ProfileModule,
    ProjectsModule,
    PaymentsModule,
    PayoutsModule,
    AdminModule,
    ConsultantsModule,
    ApplicationsModule,
    UploadsModule,
    GuestsModule,
    RoadmapsModule,
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
    RealtimePublisherModule,
    RealtimeModule,
    AuditModule,
  ],
})
export class AppModule {}
