import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SupabaseProfileRepository } from './repositories/profile.repository.supabase';
import { PROFILE_REPOSITORY } from './profile.service';
import { TalentEligibilityService } from './talent-eligibility.service';

@Module({
  controllers: [ProfileController],
  providers: [
    ProfileService,
    TalentEligibilityService,
    { provide: PROFILE_REPOSITORY, useClass: SupabaseProfileRepository },
  ],
  exports: [TalentEligibilityService],
})
export class ProfileModule {}
