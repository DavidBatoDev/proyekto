/**
 * An unset NODE_ENV means development, never production.
 *
 * It used to default to 'production', which made any command that does not set
 * the variable -- `node dist/main`, a one-off script, a debugger launch --
 * silently load `.env` and talk to the PRODUCTION database from a laptop. The
 * symptom was a blanket 401: the browser holds a token signed by the dev
 * Supabase project, the backend verified it against prod's JWT secret, and
 * every authenticated request failed for reasons that had nothing to do with
 * the request itself.
 *
 * Defaulting the other way is safe because production is always explicit:
 * `backend/Dockerfile` sets `ENV NODE_ENV=production`, and the Cloud Run deploy
 * passes `NODE_ENV=production` in its env vars. Both would have to be removed
 * before a deployed instance could reach this default -- and if that ever
 * happened, reading the dev database is a far better failure than a laptop
 * writing to the real one.
 */
// `||`, not `??`: an empty NODE_ENV is what a shell leaves behind when a
// variable is declared but not given a value, and `??` treats '' as a real
// setting -- which put it back on the production branch.
export const nodeEnvironment = process.env.NODE_ENV?.trim() || 'development';

// Establish the default before tracing or Nest configuration reads the process
// environment.
process.env.NODE_ENV = nodeEnvironment;

export const backendEnvFilePaths =
  nodeEnvironment === 'development'
    ? ['.env.development.local', 'backend/.env.development.local']
    : nodeEnvironment === 'test'
      ? [
          '.env.test.local',
          'backend/.env.test.local',
          '.env.development.local',
          'backend/.env.development.local',
        ]
      : [
          '.env.production.local',
          'backend/.env.production.local',
          '.env',
          'backend/.env',
        ];
