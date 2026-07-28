import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * Outbound transactional email. Global so any feature module can inject
 * `MailerService` without re-importing the module.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
