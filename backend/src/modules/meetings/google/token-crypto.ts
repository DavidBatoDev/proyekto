import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypt/decrypt an OAuth refresh token for at-rest storage.
 *
 * Format: `gcmv1:<iv>:<tag>:<ciphertext>` (each part base64). AES-256-GCM with a
 * random 12-byte IV; the key is 32 raw bytes supplied base64 via
 * GOOGLE_TOKEN_ENC_KEY. When no key is configured (local/dark), values are
 * stored as plaintext so the feature still works in dev — the caller logs a
 * one-time warning. The `gcmv1:` prefix (base64 never contains `:`) lets decrypt
 * unambiguously tell an encrypted value from a plaintext token.
 */
const ENC_PREFIX = 'gcmv1:';

export function loadEncKey(keyB64?: string | null): Buffer | null {
  if (!keyB64) return null;
  const key = Buffer.from(keyB64, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptToken(plain: string, keyB64?: string | null): string {
  const key = loadEncKey(keyB64);
  if (!key) return plain; // dark/local: stored as-is
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptToken(stored: string, keyB64?: string | null): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // plaintext (dark/local)
  const key = loadEncKey(keyB64);
  if (!key) {
    throw new Error(
      'Encrypted Google token present but GOOGLE_TOKEN_ENC_KEY is missing or not 32 bytes.',
    );
  }
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(':');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
