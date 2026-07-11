import { decryptToken, encryptToken } from './token-crypto';

describe('token-crypto', () => {
  const key = Buffer.alloc(32, 7).toString('base64'); // valid 32-byte key

  it('round-trips a token when a key is configured', () => {
    const enc = encryptToken('1//refresh-abc', key);
    expect(enc).toMatch(/^gcmv1:/);
    expect(enc).not.toContain('refresh-abc');
    expect(decryptToken(enc, key)).toBe('1//refresh-abc');
  });

  it('stores plaintext when no key is configured (dev/dark)', () => {
    const enc = encryptToken('1//refresh-abc');
    expect(enc).toBe('1//refresh-abc');
    expect(decryptToken(enc)).toBe('1//refresh-abc');
  });

  it('decrypt passes a plaintext value through even when a key is set', () => {
    expect(decryptToken('1//plain', key)).toBe('1//plain');
  });

  it('throws if an encrypted value is decrypted without the key', () => {
    const enc = encryptToken('secret', key);
    expect(() => decryptToken(enc)).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
  });

  it('treats a wrong-length key as unset (stores plaintext)', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(encryptToken('x', shortKey)).toBe('x');
  });
});
