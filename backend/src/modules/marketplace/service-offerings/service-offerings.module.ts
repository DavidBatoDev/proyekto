import { Module } from '@nestjs/common';
import { ServiceOfferingsController } from './service-offerings.controller';
import { ServiceOfferingsService } from './service-offerings.service';
import { SERVICE_OFFERINGS_REPOSITORY } from './repositories/service-offerings.repository.interface';
import { SupabaseServiceOfferingsRepository } from './repositories/service-offerings.repository.supabase';

@Module({
  controllers: [ServiceOfferingsController],
  providers: [
    ServiceOfferingsService,
    {
      provide: SERVICE_OFFERINGS_REPOSITORY,
      useClass: SupabaseServiceOfferingsRepository,
    },
  ],
  // Exported so the consultants module can read published services for the
  // public profile without reaching into the table itself.
  exports: [SERVICE_OFFERINGS_REPOSITORY],
})
export class ServiceOfferingsModule {}
