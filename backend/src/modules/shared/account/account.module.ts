import { Module } from '@nestjs/common';
import { MailModule } from '../../../common/mail/mail.module';
import { AccountController } from './account.controller';
import { AccountReauthService } from './account-reauth.service';
import { AccountStorageService } from './account-storage.service';
import { AccountService } from './account.service';

/**
 * Account self-service. Today that is deletion only.
 *
 * SupabaseModule, RedisModule, R2Module and RevokedUsersModule are all
 * `@Global()`, so only the mailer needs importing here.
 */
@Module({
  imports: [MailModule],
  controllers: [AccountController],
  providers: [AccountService, AccountReauthService, AccountStorageService],
  exports: [AccountService],
})
export class AccountModule {}
