import { Module } from '@nestjs/common';
import {
  ApplicationsController,
  ApplicationsService,
} from './applications.controller';
import { SupabaseApplicationsRepository } from './repositories/applications.repository.supabase';
import { APPLICATIONS_REPOSITORY } from './applications.controller';

@Module({
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    {
      provide: APPLICATIONS_REPOSITORY,
      useClass: SupabaseApplicationsRepository,
    },
  ],
})
export class ApplicationsModule {}
