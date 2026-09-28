import { ConfigService } from '@nestjs/config';
import type { MailerService } from '../../../common/mail/mailer.service';
import { ContactService } from './contact.service';
import type { SubmitContactMessageDto } from './dto/contact.dto';

describe('ContactService', () => {
  function build(env: Record<string, string> = {}, sent = true) {
    const send = jest
      .fn()
      .mockResolvedValue({ sent, reason: sent ? undefined : 'down' });
    const config = new ConfigService({
      MAIL_FROM_SUPPORT: 'support@proyekto.tech',
      ...env,
    });
    const service = new ContactService(
      { send } as unknown as MailerService,
      config,
    );
    return { service, send };
  }

  const dto: SubmitContactMessageDto = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    topic: 'support',
    message: 'The board will not open on my phone.',
  };

  it('emails the support mailbox', async () => {
    const { service, send } = build();

    await service.submit(dto);

    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('support@proyekto.tech');
    expect(message.sender).toBe('support');
    expect(message.text).toContain('The board will not open on my phone.');
  });

  it('replies to the sender, not the mailbox it landed in', async () => {
    const { service, send } = build();

    await service.submit(dto);

    expect(send.mock.calls[0][0].replyTo).toBe('ada@example.com');
  });

  it('keeps a submitted name out of the subject header', async () => {
    // An unauthenticated field that reaches a mail header is a header
    // injection if newlines survive.
    const { service, send } = build();

    await service.submit({ ...dto, name: 'Ada\r\nBcc: someone@evil.test' });

    const subject = send.mock.calls[0][0].subject as string;
    expect(subject).not.toContain('\n');
    expect(subject).not.toContain('\r');
  });

  it('escapes the message in the HTML body', async () => {
    const { service, send } = build();

    await service.submit({
      ...dto,
      message: '<script>alert(1)</script> and more',
    });

    expect(send.mock.calls[0][0].html).not.toContain('<script>');
    expect(send.mock.calls[0][0].html).toContain('&lt;script&gt;');
  });

  it('does not throw when the transport fails', async () => {
    // The controller answers 200 regardless; the sender has no other channel,
    // and failing the request would lose the message and blame them for it.
    const { service } = build({}, false);

    await expect(service.submit(dto)).resolves.toBeUndefined();
  });

  it('does not throw when no support address is configured', async () => {
    const { service, send } = build({ MAIL_FROM_SUPPORT: '' });

    await expect(service.submit(dto)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
