import { Module } from '@nestjs/common';
import { ConsultantServicesController } from './consultant-services.controller';
import { ConsultantServicesService } from './consultant-services.service';
import { CONSULTANT_SERVICES_REPOSITORY } from './repositories/consultant-services.repository.interface';
import { SupabaseConsultantServicesRepository } from './repositories/consultant-services.repository.supabase';

@Module({
  controllers: [ConsultantServicesController],
  providers: [
    ConsultantServicesService,
    {
      provide: CONSULTANT_SERVICES_REPOSITORY,
      useClass: SupabaseConsultantServicesRepository,
    },
  ],
  // Exported so the consultants module can read published services for the
  // public profile without reaching into the table itself.
  exports: [CONSULTANT_SERVICES_REPOSITORY],
})
export class ConsultantServicesModule {}
