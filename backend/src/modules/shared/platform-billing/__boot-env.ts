/**
 * Minimal environment for the AppModule compile check in app-boot.spec.ts.
 *
 * validateEnv() runs at boot and rejects a missing required var, so this fills
 * in placeholders rather than reading a real .env: the spec compiles the DI
 * container and never opens a connection, so fake credentials are correct here
 * — and it keeps the check runnable in CI and on a machine with no local env.
 *
 * Provider credentials (STRIPE_*) are deliberately absent: one of the
 * assertions is that an unconfigured deployment has no active billing provider.
 */
const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://boot-check.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-placeholder',
  SUPABASE_JWT_SECRET: 'jwt-secret-placeholder',
  CLIENT_URL: 'http://localhost:3000',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

export {};
