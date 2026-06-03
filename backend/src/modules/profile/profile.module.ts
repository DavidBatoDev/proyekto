import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PhoneOtpService } from './phone-otp.service';
import { ConsoleSmsProvider } from './sms/console-sms.provider';
import { SMS_PROVIDER } from './sms/sms.provider.interface';
import { SupabaseProfileRepository } from './repositories/profile.repository.supabase';
import { PROFILE_REPOSITORY } from './profile.service';
import { FreelancerEligibilityService } from './freelancer-eligibility.service';

@Module({
  controllers: [ProfileController],
  providers: [
    ProfileService,
    PhoneOtpService,
    FreelancerEligibilityService,
    { provide: PROFILE_REPOSITORY, useClass: SupabaseProfileRepository },
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
  ],
  exports: [FreelancerEligibilityService],
})
export class ProfileModule {}
