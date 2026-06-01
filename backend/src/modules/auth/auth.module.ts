import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseAuthRepository } from './repositories/auth.repository.supabase';
import { AUTH_REPOSITORY } from './auth.service';
import { ProjectsModule } from '../projects/projects.module';
import { ProfileModule } from '../profile/profile.module';
import { TeamsModule } from '../teams/teams.module';
import { EmailOtpService } from './email-otp.service';

@Module({
  imports: [ProjectsModule, ProfileModule, TeamsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailOtpService,
    { provide: AUTH_REPOSITORY, useClass: SupabaseAuthRepository },
  ],
})
export class AuthModule {}
