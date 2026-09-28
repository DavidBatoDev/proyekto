import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '../../../common/mail/mailer.service';
import { resolveSender } from '../../../common/mail/mail-senders';
import type { SubmitContactMessageDto } from './dto/contact.dto';

const TOPIC_LABEL: Record<string, string> = {
  sales: 'Plans and pricing',
  support: 'Help with Proyekto',
  partnership: 'Partnerships',
  other: 'Something else',
};

/** Keeps a submitted name or company out of the header it lands in. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Emails a contact-form submission to the support mailbox.
   *
   * Never throws. The controller answers 200 whatever happens here, because a
   * 500 loses the message and tells the sender to go away — and the sender has
   * no other channel. A failure is logged loudly instead, which is the signal
   * that actually reaches someone who can fix it.
   */
  async submit(dto: SubmitContactMessageDto): Promise<void> {
    const to = resolveSender(this.config, 'support').address;
    if (!to) {
      // Deliberately an error-level log: this means contact messages are being
      // accepted and silently dropped, which is worse than the endpoint 500ing.
      this.logger.error(
        'contact_message_dropped: no support address configured (set MAIL_FROM_SUPPORT)',
      );
      return;
    }

    const name = headerSafe(dto.name);
    const company = dto.company ? headerSafe(dto.company) : null;
    const topic = TOPIC_LABEL[dto.topic] ?? dto.topic;
    const subject = `[${topic}] ${name}${company ? ` — ${company}` : ''}`;

    const lines = [
      `From: ${name} <${dto.email}>`,
      company ? `Company: ${company}` : null,
      `Topic: ${topic}`,
      '',
      dto.message,
    ].filter((line): line is string => line !== null);

    const result = await this.mailer.send({
      to,
      subject,
      sender: 'support',
      // So hitting reply in the support inbox reaches the person who wrote in,
      // rather than the mailbox it was delivered to.
      replyTo: dto.email,
      text: lines.join('\n'),
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(
        lines.join('\n'),
      )}</pre>`,
    });

    if (!result.sent) {
      this.logger.error(
        `contact_message_not_delivered: ${result.reason ?? 'unknown reason'}`,
      );
    }
  }
}
