import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './services/applications.service';
import { ConsultantEligibilityService } from './services/consultant-eligibility.service';
import { APPLICATIONS_REPOSITORY } from './repositories/applications.repository.interface';
import { SupabaseApplicationsRepository } from './repositories/applications.repository.supabase';

@Module({
  imports: [NotificationsModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    ConsultantEligibilityService,
    {
      provide: APPLICATIONS_REPOSITORY,
      useClass: SupabaseApplicationsRepository,
    },
  ],
})
export class ApplicationsModule {}
