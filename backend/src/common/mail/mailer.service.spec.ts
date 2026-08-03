import { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service';
import type {
  MailTransport,
  OutboundMessage,
} from './transport/mail-transport';

describe('MailerService', () => {
  function build(
    transportOverrides: Partial<MailTransport> = {},
    env: Record<string, string> = {},
  ) {
    const delivered: OutboundMessage[] = [];
    const transport: MailTransport = {
      name: 'test',
      isConfigured: () => true,
      deliver: (message) => {
        delivered.push(message);
        return Promise.resolve({ sent: true, messageId: 'm-1' });
      },
      diagnostics: () =>
        Promise.resolve({
          configured: true,
          credentials: {
            client_id: true,
            client_secret: true,
            refresh_token: true,
          },
          auth: { ok: true as const },
        }),
      ...transportOverrides,
    };
    const config = new ConfigService({ MAIL_FROM_NAME: 'Proyekto', ...env });
    return { service: new MailerService(config, transport), delivered };
  }

  /** Decode what the transport was handed, so assertions read the real MIME. */
  const decode = (raw: string) => Buffer.from(raw, 'base64url').toString();

  it('hands a built message to the transport and reports the id', async () => {
    const { service, delivered } = build();

    const result = await service.send({
      to: 'her@example.test',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });

    expect(result).toEqual({
      sent: true,
      messageId: 'm-1',
      to: 'her@example.test',
    });
    expect(delivered).toHaveLength(1);
    expect(decode(delivered[0].raw)).toContain('To: her@example.test');
  });

  it('reports a transport failure without throwing', async () => {
    // Load-bearing: most callers commit their write before sending, and the OTP
    // paths decide for themselves whether to re-raise based on `sent`. A throw
    // here would turn a mail outage into a failed user action.
    const { service } = build({
      deliver: () => Promise.resolve({ sent: false, reason: 'nope' }),
    });

    await expect(
      service.send({ to: 'x@example.test', subject: 's', html: 'h' }),
    ).resolves.toEqual({ sent: false, reason: 'nope', to: 'x@example.test' });
  });

  it('does not call the transport when it is unconfigured', async () => {
    const deliver = jest.fn();
    const { service } = build({ isConfigured: () => false, deliver });

    const result = await service.send({
      to: 'x@example.test',
      subject: 's',
      html: 'h',
    });

    expect(result.sent).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('builds multipart/alternative with a text fallback', async () => {
    const { service, delivered } = build();

    await service.send({
      to: 'x@example.test',
      subject: 's',
      html: '<p>Ship <b>it</b></p>',
    });

    const raw = decode(delivered[0].raw);
    expect(raw).toContain('multipart/alternative');
    expect(raw).toContain('text/plain');
    // The generated fallback carries the words without the markup.
    expect(raw).toContain('Ship it');
  });

  it('strips CRLF from header values (injection guard)', async () => {
    const { service, delivered } = build();

    await service.send({
      to: 'x@example.test',
      subject: 'Hi\r\nBcc: victim@example.test',
      html: 'h',
    });

    const raw = decode(delivered[0].raw);
    // Injection means smuggling a NEW header line. The text may still appear
    // flattened inside the Subject — that is inert, and asserting on the
    // substring alone would pass for the wrong reason.
    expect(raw).not.toContain('\r\nBcc:');
    expect(raw).toContain('Subject: Hi Bcc: victim@example.test');
  });

  it('refuses caller headers that would corrupt the message', async () => {
    const { service, delivered } = build();

    await service.send({
      to: 'x@example.test',
      subject: 's',
      html: 'h',
      headers: {
        'List-Unsubscribe': '<https://example.test/u?t=1>',
        // Reserved: the builder owns these.
        'Content-Type': 'text/plain',
        From: 'spoofed@example.test',
      },
    });

    const raw = decode(delivered[0].raw);
    expect(raw).toContain('List-Unsubscribe: <https://example.test/u?t=1>');
    expect(raw).not.toContain('From: spoofed@example.test');
  });

  it('surfaces transport health through diagnostics without sending', async () => {
    const deliver = jest.fn();
    const { service } = build({
      deliver,
      diagnostics: () =>
        Promise.resolve({
          configured: true,
          credentials: {
            client_id: true,
            client_secret: false,
            refresh_token: true,
          },
          auth: { ok: false as const, error: 'invalid_client', hint: 'rotate' },
        }),
    });

    const diag = await service.diagnostics();

    expect(diag.configured).toBe(true);
    expect(diag.credentials.client_secret).toBe(false);
    expect(diag.token).toEqual({
      ok: false,
      error: 'invalid_client',
      hint: 'rotate',
    });
    expect(deliver).not.toHaveBeenCalled();
  });
});
