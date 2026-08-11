import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SupabaseProfileRepository } from './repositories/profile.repository.supabase';
import { PROFILE_REPOSITORY } from './profile.service';
import { FreelancerEligibilityService } from './freelancer-eligibility.service';

@Module({
  controllers: [ProfileController],
  providers: [
    ProfileService,
    FreelancerEligibilityService,
    { provide: PROFILE_REPOSITORY, useClass: SupabaseProfileRepository },
  ],
  exports: [FreelancerEligibilityService],
})
export class ProfileModule {}
