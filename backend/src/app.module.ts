import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { SupabaseModule } from './config/supabase.module';
import { ThrottlerStorageRedisService } from './config/throttler-storage.service';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';
import { ConsultantsModule } from './modules/consultants/consultants.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { GuestsModule } from './modules/guests/guests.module';
import { RoadmapsModule } from './modules/roadmaps/roadmaps.module';
import { RoadmapSharesModule } from './modules/roadmap-shares/roadmap-shares.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ChatModule } from './modules/chat/chat.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TeamTimeModule } from './modules/team-time/team-time.module';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          configService.get<string>('UPSTASH_REDIS_REST_URL'),
          configService.get<string>('UPSTASH_REDIS_REST_TOKEN'),
        ),
      }),
    }),
    SupabaseModule,
    AuthModule,
    UsersModule,
    ProfileModule,
    ProjectsModule,
    PaymentsModule,
    AdminModule,
    ConsultantsModule,
    ApplicationsModule,
    UploadsModule,
    GuestsModule,
    RoadmapsModule,
    RoadmapSharesModule,
    MarketplaceModule,
    NotificationsModule,
    ChatModule,
    TeamsModule,
    TeamTimeModule,
  ],
})
export class AppModule {}
