import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_PLANS } from '../../execution/workspaces/dto/workspaces.dto';
import { ENTITLEMENT_KEYS } from './entitlement-keys';
import {
  buildSeedKeyRows,
  buildSeedLimitRows,
} from './__entitlements-test-kit-spec';

/**
 * The plan-limit registry lives in two places that must agree: the code
 * (ENTITLEMENT_KEYS: kind, enforced) and the database (plan_limit_keys +
 * plan_limits, seeded by migration). At runtime a code key the database lacks
 * fails open, which is safe but silent: the limit simply stops applying. This
 * test cannot read production, so it pins the half it can see: the
 * migrations seed every code key, with the same kind, for every plan.
 *
 * Rows are accumulated across every migration in order, so a later migration
 * that adds a key counts. plan_limits seeds are ON CONFLICT DO NOTHING, so the
 * first insert of a cell is the one that lands.
 */

type SqlValue = string | number | boolean | null | { raw: string };

const migrationsDir = join(__dirname, '../../../../../supabase/migrations');
const PLAN_LIMITS_MIGRATION = '20260922120000_workspace_plan_limits.sql';

/** Skips whitespace, `-- line` and block comments. */
function skipTrivia(sql: string, from: number): number {
  let i = from;
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql.startsWith('--', i)) {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? sql.length : eol + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    return i;
  }
}

/** Skips a `::type` cast after a value. */
function skipCast(sql: string, from: number): number {
  let i = skipTrivia(sql, from);
  if (!sql.startsWith('::', i)) return from;
  i += 2;
  while (i < sql.length && /[\w.[\] ]/.test(sql[i]) && sql[i] !== ',') i++;
  return i;
}

function parseValue(sql: string, from: number): [SqlValue, number] {
  let i = from;
  if (sql[i] === "'") {
    let literal = '';
    i++;
    for (;;) {
      if (i >= sql.length) throw new Error('Unterminated string literal');
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          literal += "'";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      literal += sql[i++];
    }
    return [literal, skipCast(sql, i)];
  }

  // Anything else: read to the next top-level ',' or ')'.
  let depth = 0;
  const start = i;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const [, next] = parseValue(sql, i);
      i = next;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (ch === ',' && depth === 0) break;
    i++;
  }
  const raw = sql
    .slice(start, i)
    .trim()
    .replace(/::[\w.[\] ]+$/, '')
    .trim();
  if (/^null$/i.test(raw)) return [null, i];
  if (/^true$/i.test(raw)) return [true, i];
  if (/^false$/i.test(raw)) return [false, i];
  if (/^-?\d+(\.\d+)?$/.test(raw)) return [Number(raw), i];
  return [{ raw }, i];
}

/** Every `INSERT INTO [public.]<table> (cols) VALUES (...), (...)` row, as objects. */
function parseInserts(
  sql: string,
  table: string,
): Array<Record<string, SqlValue>> {
  const rows: Array<Record<string, SqlValue>> = [];
  const pattern = new RegExp(
    `INSERT\\s+INTO\\s+(?:public\\.)?${table}\\s*\\(([^)]*)\\)\\s*VALUES`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const columns = match[1].split(',').map((c) => c.trim());
    let i = skipTrivia(sql, match.index + match[0].length);
    while (sql[i] === '(') {
      i++;
      const values: SqlValue[] = [];
      for (;;) {
        i = skipTrivia(sql, i);
        const [value, next] = parseValue(sql, i);
        values.push(value);
        i = skipTrivia(sql, next);
        if (sql[i] === ',') {
          i++;
          continue;
        }
        if (sql[i] === ')') {
          i++;
          break;
        }
        throw new Error(
          `Unexpected "${sql[i]}" in ${table} VALUES near: ${sql.slice(i - 40, i + 40)}`,
        );
      }
      if (values.length !== columns.length) {
        throw new Error(
          `${table} row has ${values.length} values for ${columns.length} columns: ${JSON.stringify(values)}`,
        );
      }
      rows.push(
        Object.fromEntries(columns.map((column, n) => [column, values[n]])),
      );
      i = skipTrivia(sql, i);
      if (sql[i] !== ',') break;
      i = skipTrivia(sql, i + 1);
    }
  }
  return rows;
}

/** A parsed value as text, for building map keys. */
function text(value: SqlValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function readMigrations(): Array<{ file: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(migrationsDir, file), 'utf8'),
    }));
}

function seededRegistry() {
  const keys = new Map<string, Record<string, SqlValue>>();
  const cells = new Map<string, Record<string, SqlValue>>();
  for (const { sql } of readMigrations()) {
    if (!/plan_limit/i.test(sql)) continue;
    // plan_limit_keys re-applies refresh presentation, never kind: keep the
    // first kind seen, merge the rest.
    for (const row of parseInserts(sql, 'plan_limit_keys')) {
      const key = text(row.key);
      const existing = keys.get(key);
      keys.set(key, existing ? { ...row, kind: existing.kind } : row);
    }
    for (const row of parseInserts(sql, 'plan_limits')) {
      const id = `${text(row.plan)}:${text(row.limit_key)}`;
      if (!cells.has(id)) cells.set(id, row);
    }
  }
  return { keys, cells };
}

describe('entitlement keys <-> migration parity', () => {
  const migrationPath = join(migrationsDir, PLAN_LIMITS_MIGRATION);

  it('has the plan limits migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  const { keys, cells } = existsSync(migrationPath)
    ? seededRegistry()
    : {
        keys: new Map<string, Record<string, SqlValue>>(),
        cells: new Map<string, Record<string, SqlValue>>(),
      };

  it.each(Object.entries(ENTITLEMENT_KEYS))(
    'seeds %s in plan_limit_keys with the code kind',
    (key, def) => {
      const row = keys.get(key);
      expect(row).toBeDefined();
      expect(row?.kind).toBe(def.kind);
    },
  );

  it.each(Object.entries(ENTITLEMENT_KEYS))(
    'seeds one %s plan_limits row per plan, with the key kind',
    (key, def) => {
      const rows = [...cells.values()].filter((row) => row.limit_key === key);
      expect(rows.map((row) => row.plan).sort()).toEqual(
        [...WORKSPACE_PLANS].sort(),
      );
      for (const row of rows) expect(row.kind).toBe(def.kind);
    },
  );

  it('seeds the values the pricing matrix fixture (and the service specs) assume', () => {
    // The test kit's seed is what every entitlements spec runs against; if the
    // migration drifts from it, those specs are testing a table nobody ships.
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, 'utf8')
      : '';
    const seeded = parseInserts(sql, 'plan_limits').map((row) => ({
      plan: row.plan,
      limit_key: row.limit_key,
      kind: row.kind,
      int_value: row.int_value,
      bool_value: row.bool_value,
      per_seat: row.per_seat,
      display_label: row.display_label,
    }));
    const expected = buildSeedLimitRows().map((row) => ({
      plan: row.plan,
      limit_key: row.limit_key,
      kind: row.kind,
      int_value: row.int_value,
      bool_value: row.bool_value,
      per_seat: row.per_seat,
      display_label: row.display_label,
    }));
    const byId = (a: { plan: SqlValue; limit_key: SqlValue }) =>
      `${text(a.limit_key)}:${text(a.plan)}`;
    expect([...seeded].sort((a, b) => byId(a).localeCompare(byId(b)))).toEqual(
      [...expected].sort((a, b) => byId(a).localeCompare(byId(b))),
    );

    const seededKeys = parseInserts(sql, 'plan_limit_keys').map((row) => ({
      key: row.key,
      kind: row.kind,
      label: row.label,
      unit: row.unit,
      group_key: row.group_key,
    }));
    expect(seededKeys).toEqual(
      buildSeedKeyRows().map((row) => ({
        key: row.key,
        kind: row.kind,
        label: row.label,
        unit: row.unit,
        group_key: row.group_key,
      })),
    );
  });

  it('never lets a re-apply change a kind or overwrite an admin edit', () => {
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, 'utf8')
      : '';
    const keysConflict =
      /ON CONFLICT\s*\(key\)\s*DO UPDATE SET([\s\S]*?);/i.exec(sql);
    expect(keysConflict).not.toBeNull();
    expect(keysConflict?.[1]).not.toMatch(/\bkind\s*=/i);
    expect(sql).toMatch(/ON CONFLICT\s*\(plan,\s*limit_key\)\s*DO NOTHING/i);
  });
});
