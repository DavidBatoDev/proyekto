// class-transformer needs the metadata shim. Most specs get it transitively
// from @nestjs/testing; this one imports nothing from Nest.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

/**
 * The production CLIENT_URL guard.
 *
 * Worth a test rather than trusting the regex by eye: the failure it prevents
 * is invisible in every environment where the tests actually run. A wrong
 * CLIENT_URL does not throw, it mails people a link to their own laptop.
 */
describe('validateEnv — CLIENT_URL in production', () => {
  // Every non-optional variable, so the class-validator pass succeeds and the
  // guard is what any failure below is actually reporting.
  const base = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    GMAIL_CLIENT_ID: 'gmail-id',
    GMAIL_CLIENT_SECRET: 'gmail-secret',
    GMAIL_REFRESH_TOKEN: 'gmail-token',
  };

  it('defaults NODE_ENV to production', () => {
    const result = validateEnv({
      ...base,
      CLIENT_URL: 'https://www.proyekto.tech',
    });

    expect(result.NODE_ENV).toBe('production');
  });

  it('rejects an unknown NODE_ENV instead of silently using production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'staging',
        CLIENT_URL: 'https://www.proyekto.tech',
      }),
    ).toThrow(/NODE_ENV/);
  });

  it('rejects the localhost default', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        CLIENT_URL: 'http://localhost:3000',
      }),
    ).toThrow(/CLIENT_URL must be the public https origin/);
  });

  it.each([
    ['http://127.0.0.1:3000'],
    ['https://localhost:3000'],
    // http in production means the link is downgraded, not just insecure.
    ['http://www.proyekto.tech'],
    [''],
  ])('rejects %s', (clientUrl) => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', CLIENT_URL: clientUrl }),
    ).toThrow(/CLIENT_URL/);
  });

  it('accepts a real https origin', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        CLIENT_URL: 'https://www.proyekto.tech',
      }),
    ).not.toThrow();
  });

  it('leaves development alone — localhost is correct there', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        CLIENT_URL: 'http://localhost:3000',
      }),
    ).not.toThrow();
  });

  it('leaves test alone, so this suite does not need a real origin', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });
});
