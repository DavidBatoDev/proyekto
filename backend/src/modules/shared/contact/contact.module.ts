import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

/**
 * The public contact form. MailModule is @Global, so MailerService needs no
 * import here.
 */
@Module({
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
