/**
 * Loads backend/.env into process.env before the integration suite runs, so the
 * harness (service-role Supabase client, JWT secret) and the booted AppModule
 * both see real config. Tiny hand parser — avoids adding a `dotenv` direct dep
 * (mirrors the repo-root benchmark scripts' own env loaders). Only sets keys not
 * already present in the environment, so an explicit shell override still wins.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(__dirname, '../../.env');

try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
} catch (err) {
  // Surface a clear message — the suite is useless without real creds.
  // eslint-disable-next-line no-console
  console.warn(
    `[integration] could not load ${envPath}: ${(err as Error).message}. ` +
      'Integration tests need backend/.env with SUPABASE_URL, ' +
      'SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET.',
  );
}
