import type { ConfigService } from '@nestjs/config';
import { resolveAllSenders, resolveSender } from './mail-senders';

/** Minimal ConfigService stand-in — resolveSender only ever calls `get`. */
function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('resolveSender', () => {
  it('uses the sender-specific address and labels the display name', () => {
    const config = configWith({ MAIL_FROM_BILLING: 'billing@example.test' });
    expect(resolveSender(config, 'billing')).toEqual({
      address: 'billing@example.test',
      header: 'Proyekto Billing <billing@example.test>',
    });
  });

  it('leaves noreply unlabelled — "Proyekto Noreply" reads badly', () => {
    const config = configWith({ MAIL_FROM_NOREPLY: 'noreply@example.test' });
    expect(resolveSender(config, 'noreply').header).toBe(
      'Proyekto <noreply@example.test>',
    );
  });

  it('honours MAIL_FROM_NAME', () => {
    const config = configWith({
      MAIL_FROM_NAME: 'Acme',
      MAIL_FROM_SUPPORT: 'help@example.test',
    });
    expect(resolveSender(config, 'support').header).toBe(
      'Acme Support <help@example.test>',
    );
  });

  it('falls back to GMAIL_FROM_EMAIL, then INVITE_FROM_EMAIL', () => {
    expect(
      resolveSender(configWith({ GMAIL_FROM_EMAIL: 'a@example.test' }), 'billing')
        .address,
    ).toBe('a@example.test');
    expect(
      resolveSender(
        configWith({ INVITE_FROM_EMAIL: 'b@example.test' }),
        'noreply',
      ).address,
    ).toBe('b@example.test');
  });

  it('returns a null header when nothing is configured, so the From line is omitted', () => {
    // This is the pre-existing behaviour the whole registry has to preserve:
    // with no address, Gmail stamps the authenticated mailbox and mail still
    // goes out. Regressing this would break every unconfigured deploy.
    expect(resolveSender(configWith({}), 'billing')).toEqual({
      address: null,
      header: null,
    });
  });

  it('ignores blank and whitespace-only addresses', () => {
    const config = configWith({
      MAIL_FROM_BILLING: '   ',
      GMAIL_FROM_EMAIL: 'fallback@example.test',
    });
    expect(resolveSender(config, 'billing').address).toBe(
      'fallback@example.test',
    );
  });

  it('strips CRLF from the display name — header injection guard', () => {
    const config = configWith({
      MAIL_FROM_NAME: 'Evil\r\nBcc: victim@example.test',
      MAIL_FROM_BILLING: 'billing@example.test',
    });
    const header = resolveSender(config, 'billing').header ?? '';
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
  });

  it('strips CRLF from the address too', () => {
    const config = configWith({
      MAIL_FROM_BILLING: 'billing@example.test\r\nBcc: victim@example.test',
    });
    const header = resolveSender(config, 'billing').header ?? '';
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('puts the tenant in the display name but never in the address', () => {
    // The multi-tenant rule: many agencies bill through Proyekto, but we can
    // only authenticate a domain we control. The agency's name leads; the
    // envelope stays ours.
    const config = configWith({ MAIL_FROM_BILLING: 'billing@proyekto.test' });
    const resolved = resolveSender(config, 'billing', 'Acme Studio');
    // Quoted because parentheses delimit a comment in RFC 5322 — unquoted,
    // "(via Proyekto)" would be discarded and the name would read "Acme Studio".
    expect(resolved.header).toBe(
      '"Acme Studio (via Proyekto)" <billing@proyekto.test>',
    );
    expect(resolved.address).toBe('billing@proyekto.test');
  });

  it('falls back to the plain label when there is no tenant', () => {
    const config = configWith({ MAIL_FROM_BILLING: 'billing@proyekto.test' });
    expect(resolveSender(config, 'billing', null).header).toBe(
      'Proyekto Billing <billing@proyekto.test>',
    );
    expect(resolveSender(config, 'billing', '   ').header).toBe(
      'Proyekto Billing <billing@proyekto.test>',
    );
  });

  it('strips CRLF from a tenant name — it comes from editable contract data', () => {
    const config = configWith({ MAIL_FROM_BILLING: 'billing@proyekto.test' });
    const header =
      resolveSender(config, 'billing', 'Evil\r\nBcc: victim@example.test')
        .header ?? '';
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('quotes a display name containing RFC 5322 specials', () => {
    const config = configWith({
      MAIL_FROM_NAME: 'Proyekto, Inc.',
      MAIL_FROM_BILLING: 'billing@example.test',
    });
    // Unquoted, the comma would make this parse as two addresses.
    expect(resolveSender(config, 'billing').header).toBe(
      '"Proyekto, Inc. Billing" <billing@example.test>',
    );
  });
});

describe('resolveAllSenders', () => {
  it('reports every sender for the health endpoint', () => {
    const config = configWith({
      MAIL_FROM_NOREPLY: 'noreply@example.test',
      MAIL_FROM_BILLING: 'billing@example.test',
    });
    expect(resolveAllSenders(config)).toEqual({
      noreply: 'noreply@example.test',
      billing: 'billing@example.test',
      accounts: null,
      support: null,
    });
  });
});
