import { Global, Module } from '@nestjs/common';
import { MailHealthController } from './mail-health.controller';
import { MailerService } from './mailer.service';
import { GmailTransport } from './transport/gmail.transport';
import { MAIL_TRANSPORT } from './transport/mail-transport';

/**
 * Outbound transactional email. Global so any feature module can inject
 * `MailerService` without re-importing the module.
 *
 * Gmail is bound directly: with one provider, a selector env var would be a
 * switch with nothing to switch to. The `MailTransport` interface is what makes
 * an ESP swap cheap — adding a second provider means a new class and one line
 * here, at which point a selector earns its keep.
 */
@Global()
@Module({
  controllers: [MailHealthController],
  providers: [
    GmailTransport,
    { provide: MAIL_TRANSPORT, useExisting: GmailTransport },
    MailerService,
  ],
  exports: [MailerService],
})
export class MailModule {}
