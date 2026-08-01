/**
 * Guards the project activity-log vocabulary.
 *
 * `backend/src/modules/audit/activity-actions.ts` is the source of truth and
 * is hand-mirrored into `web/src/components/project/logs/activityCatalog.ts`
 * (the same convention the far larger permission catalog already uses — there
 * is no shared TS package in this monorepo, and creating one for ~75 string
 * constants would be disproportionate).
 *
 * Hand-mirroring is only safe if drift is loud, hence this script. It also
 * catches the failure the mirror cannot: an action or entity type that is
 * EMITTED somewhere in the backend but never DECLARED, which renders in the
 * feed through the unknown-action fallback and quietly makes a real event look
 * anonymous. That is not hypothetical — nine `mcp.*` actions were emitted for
 * months before being declared, with rows already in production.
 *
 * Run: node scripts/check_activity_actions.mjs   (or npm run check:activity-actions)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const backendActionsPath = path.join(
  root,
  'backend/src/modules/audit/activity-actions.ts',
);
const webCatalogPath = path.join(
  root,
  'web/src/components/project/logs/activityCatalog.ts',
);
const backendModulesDir = path.join(root, 'backend/src/modules');

function readUtf8(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(root, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function compare(label, expected, actual) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return null;
  return `${label} mismatch\n  expected=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`;
}

/**
 * Like compare(), but reports only the entries that differ.
 *
 * These lists are ~75 entries long; dumping both in full to show one typo
 * buries the answer in noise, and a guard nobody can read is a guard nobody
 * acts on.
 */
function compareEntries(label, expected, actual) {
  const key = (pair) => (Array.isArray(pair) ? pair.join('=') : String(pair));
  const expectedKeys = expected.map(key);
  const actualKeys = actual.map(key);
  if (JSON.stringify(expectedKeys) === JSON.stringify(actualKeys)) return null;

  const missing = expectedKeys.filter((k) => !actualKeys.includes(k));
  const extra = actualKeys.filter((k) => !expectedKeys.includes(k));

  const lines = [`${label} mismatch (backend is the source of truth)`];
  if (missing.length) lines.push(`  missing from web: ${missing.join(', ')}`);
  if (extra.length) lines.push(`  unexpected in web: ${extra.join(', ')}`);
  if (!missing.length && !extra.length) {
    // Same members, different order — which still matters, because the
    // ordering is part of what makes the mirror reviewable side by side.
    const at = expectedKeys.findIndex((k, i) => k !== actualKeys[i]);
    lines.push(
      `  same entries, different order (first divergence at index ${at}: ` +
        `expected ${expectedKeys[at]}, got ${actualKeys[at]})`,
    );
  }
  return lines.join('\n');
}

// The two sides use different quote styles — backend is Prettier (single),
// web is Biome (double) — so every extractor must accept both.
const Q = `['"]`;

/** `export const NAME = { KEY: 'value', ... } as const` -> [[KEY, value], ...] */
function extractObjectConst(content, name, label) {
  const block = content.match(
    new RegExp(`export const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as\\s+const`, 'm'),
  );
  if (!block) throw new Error(`Could not find object const ${name} in ${label}`);
  const entryRe = new RegExp(
    `^\\s*([A-Z][A-Z0-9_]*)\\s*:\\s*${Q}([^'"]+)${Q}\\s*,`,
    'gm',
  );
  const pairs = [...block[1].matchAll(entryRe)].map((m) => [m[1], m[2]]);
  if (pairs.length === 0) throw new Error(`${name} parsed to zero entries in ${label}`);
  return pairs;
}

/** `export const NAME = [ 'a', 'b' ] as const` -> ['a','b'] */
function extractArrayConst(content, name, label) {
  const block = content.match(
    new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`, 'm'),
  );
  if (!block) throw new Error(`Could not find array const ${name} in ${label}`);
  const values = [...block[1].matchAll(new RegExp(`${Q}([^'"]+)${Q}`, 'g'))].map(
    (m) => m[1],
  );
  if (values.length === 0) throw new Error(`${name} parsed to zero entries in ${label}`);
  return values;
}

/** Keys of the presentation registry: `"task.created": { ... }`. */
function extractCopyKeys(content) {
  const block = content.match(
    /ACTIVITY_COPY\s*:\s*Record<[^>]*>\s*=\s*\{([\s\S]*?)\n\};/m,
  );
  if (!block) return null; // registry not written yet — skipped, not failed
  const keyRe = new RegExp(`^\\s*${Q}([a-z_]+\\.[a-z_]+)${Q}\\s*:`, 'gm');
  return [...block[1].matchAll(keyRe)].map((m) => m[1]);
}

function walkTsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Every action / entityType STRING LITERAL handed to the audit writer.
 *
 * Only literals: call sites that go through `ACTIVITY_ACTIONS.X` are already
 * type-checked by TypeScript, so they cannot drift. Literals are exactly the
 * untyped path that can — which is how the `mcp.*` gap happened.
 */
function extractEmitted() {
  const actions = new Set();
  const entityTypes = new Set();
  for (const file of walkTsFiles(backendModulesDir)) {
    const content = fs.readFileSync(file, 'utf8');
    if (!/audit\.log\(|auditWrite\(/.test(content)) continue;
    for (const m of content.matchAll(/action:\s*'([a-z_]+\.[a-z_]+)'/g)) {
      actions.add(m[1]);
    }
    // The MCP helpers pass the action positionally, not as `action:`.
    for (const m of content.matchAll(/'(mcp\.[a-z_]+)'/g)) actions.add(m[1]);
    for (const m of content.matchAll(/entityType:\s*'([a-z_]+)'/g)) {
      entityTypes.add(m[1]);
    }
  }
  return { actions: [...actions].sort(), entityTypes: [...entityTypes].sort() };
}

function main() {
  const failures = [];

  const backend = readUtf8(backendActionsPath);
  const backendActions = extractObjectConst(backend, 'ACTIVITY_ACTIONS', 'backend');
  const backendEntityTypes = extractArrayConst(
    backend,
    'ACTIVITY_ENTITY_TYPES',
    'backend',
  );

  // ── 1 + 2. backend <-> web mirror ─────────────────────────────────────────
  // Skipped (not failed) until the web catalog exists, so this script is
  // useful for checks 4/5 during the phase that creates it.
  if (fs.existsSync(webCatalogPath)) {
    const web = readUtf8(webCatalogPath);
    const webActions = extractObjectConst(web, 'ACTIVITY_ACTIONS', 'web');
    const webEntityTypes = extractArrayConst(web, 'ACTIVITY_ENTITY_TYPES', 'web');

    // Compared in order, so a reordering or a value typo both fail.
    const drift = compareEntries('ACTIVITY_ACTIONS', backendActions, webActions);
    if (drift) failures.push(drift);

    const typeDrift = compareEntries(
      'ACTIVITY_ENTITY_TYPES',
      backendEntityTypes,
      webEntityTypes,
    );
    if (typeDrift) failures.push(typeDrift);

    // ── 3. every action has presentation copy ───────────────────────────────
    const copyKeys = extractCopyKeys(web);
    if (copyKeys) {
      const copyDrift = compareEntries(
        'ACTIVITY_COPY keys',
        backendActions.map(([, value]) => value).sort(),
        [...copyKeys].sort(),
      );
      if (copyDrift) failures.push(copyDrift);
    }
  } else {
    console.log(
      `note: ${path.relative(root, webCatalogPath)} does not exist yet — mirror checks skipped.`,
    );
  }

  // ── 4 + 5. emitted must be declared ───────────────────────────────────────
  const declaredActions = new Set(backendActions.map(([, value]) => value));
  const declaredTypes = new Set(backendEntityTypes);
  const emitted = extractEmitted();

  const undeclaredActions = emitted.actions.filter((a) => !declaredActions.has(a));
  if (undeclaredActions.length > 0) {
    failures.push(
      `actions emitted but not declared in ACTIVITY_ACTIONS: ${JSON.stringify(undeclaredActions)}\n` +
        '  These render through the unknown-action fallback, so a real event looks anonymous in the feed.',
    );
  }

  const undeclaredTypes = emitted.entityTypes.filter((t) => !declaredTypes.has(t));
  if (undeclaredTypes.length > 0) {
    failures.push(
      `entity types emitted but not declared in ACTIVITY_ENTITY_TYPES: ${JSON.stringify(undeclaredTypes)}`,
    );
  }

  if (failures.length > 0) {
    console.error('Activity action vocabulary check FAILED:\n');
    for (const failure of failures) console.error(`- ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `Activity action vocabulary OK ` +
      `(${backendActions.length} actions, ${backendEntityTypes.length} entity types, ` +
      `${emitted.actions.length} emitted literals verified).`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Activity action vocabulary check ERRORED: ${error.message}`);
  process.exit(1);
}
