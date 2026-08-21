/**
 * Guards the one rule the marketplace intake survey must not break: a stated
 * intent is not a role.
 *
 * `profiles.role` was dropped on 2026-08-10 (20260810160000), and
 * `profiles.settings->'onboarding'->'intent'` — which held the same
 * client/talent shape the survey now asks for — went with it. The survey
 * reintroduces that question deliberately, for personalization only:
 * `marketplace_survey_responses.intents` orders and re-labels storefront
 * sections and decides nothing about access.
 *
 * That distinction survives exactly as long as nobody "just checks the survey"
 * inside a guard. It is a small, reasonable-looking edit that would quietly
 * restore the account role. So this script fails the build if the survey tables
 * or the `intents` column are referenced anywhere authorization is decided:
 *
 *   - NestJS guards (backend/src/common/guards/, **\/*.guard.ts)
 *   - project authorization services (backend/src/**\/authorization/)
 *   - RLS policy bodies in supabase/migrations/*.sql
 *   - TanStack Router `beforeLoad` blocks in web/src/routes/
 *
 * Run: node scripts/check_survey_is_not_authz.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

/**
 * `intents` on its own is far too common a word to grep for globally, so each
 * scan pairs it with the table name or scopes itself to a region that is
 * already about authorization.
 */
const SURVEY_TABLES = [
  'marketplace_survey_responses',
  'marketplace_survey_categories',
];
const SURVEY_TOKENS = [...SURVEY_TABLES, 'SurveyService', 'SURVEY_REPOSITORY'];

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, filter, out);
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file) => path.relative(root, file).replace(/\\/g, '/');

function findTokens(text, tokens) {
  return tokens.filter((token) => text.includes(token));
}

/** Guards and any file under an `authorization/` directory. */
function scanBackendAuthz(failures) {
  const files = walk(
    path.join(root, 'backend/src'),
    (file) =>
      (file.endsWith('.ts') && !file.endsWith('.spec.ts')) &&
      (/[\\/]guards[\\/]/.test(file) ||
        file.endsWith('.guard.ts') ||
        /[\\/]authorization[\\/]/.test(file)),
  );

  let scanned = 0;
  for (const file of files) {
    scanned += 1;
    const text = fs.readFileSync(file, 'utf8');
    const hits = findTokens(text, SURVEY_TOKENS);
    if (hits.length > 0) {
      failures.push(
        `${rel(file)} references ${hits.join(', ')}. Guards and authorization ` +
          `services decide access; the survey is personalization. Gate on ` +
          `consultant_profiles.status='verified' (is_active_consultant) or the ` +
          `share_role ladder instead.`,
      );
    }
  }
  return scanned;
}

/**
 * RLS policy bodies. Scoped to CREATE POLICY statements so the survey's own
 * migration — which names its tables constantly — does not trip the check on
 * its own DDL and comments.
 */
function scanMigrations(failures) {
  const files = walk(path.join(root, 'supabase/migrations'), (file) =>
    file.endsWith('.sql'),
  );

  let scanned = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const policies = text.match(/CREATE\s+POLICY[\s\S]*?;/gi) ?? [];
    for (const policy of policies) {
      scanned += 1;
      // A policy ON the survey table is the survey's own owner-check and is
      // fine; a policy on ANY OTHER table that reads the survey is the failure.
      const target = /\bON\s+(?:public\.)?([a-z_]+)/i.exec(policy)?.[1];
      if (SURVEY_TABLES.includes(target)) continue;

      const hits = findTokens(policy, SURVEY_TABLES);
      if (hits.length > 0) {
        failures.push(
          `${rel(file)} has a policy on \`${target}\` that reads ${hits.join(', ')}. ` +
            `Row visibility must not depend on what somebody told an intake survey.`,
        );
      }
    }
  }
  return scanned;
}

/** TanStack Router `beforeLoad` blocks — the web-side equivalent of a guard. */
function scanRouteLoaders(failures) {
  const files = walk(
    path.join(root, 'web/src/routes'),
    (file) =>
      (file.endsWith('.tsx') || file.endsWith('.ts')) &&
      !file.endsWith('.test.tsx') &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('routeTree.gen.ts'),
  );

  let scanned = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('beforeLoad')) continue;
    scanned += 1;

    // Crude but sufficient: from `beforeLoad` to the next top-level property.
    // A false positive here is a route that mentions the survey immediately
    // after its guard, which is worth a second look anyway.
    const start = text.indexOf('beforeLoad');
    const block = text.slice(start, start + 1200);
    const hits = findTokens(block, [...SURVEY_TOKENS, 'marketplaceSurvey']);
    if (hits.length > 0) {
      failures.push(
        `${rel(file)} reads ${hits.join(', ')} inside beforeLoad. Route access ` +
          `must not depend on survey answers — gate on isActiveConsultant() or ` +
          `authentication instead.`,
      );
    }
  }
  return scanned;
}

function main() {
  const failures = [];
  const guards = scanBackendAuthz(failures);
  const policies = scanMigrations(failures);
  const loaders = scanRouteLoaders(failures);

  if (failures.length > 0) {
    console.error('Survey-is-not-authz check FAILED:\n');
    for (const failure of failures) console.error(`- ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `Survey-is-not-authz OK ` +
      `(${guards} guard/authorization files, ${policies} RLS policies, ` +
      `${loaders} route loaders scanned).`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Survey-is-not-authz check ERRORED: ${error.message}`);
  process.exit(1);
}
