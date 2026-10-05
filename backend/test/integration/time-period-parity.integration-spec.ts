/**
 * Period parity: TypeScript periodFor (time-periods.ts) and SQL time_period_for (M1) must agree, because the
 * backend computes windows (caps, retroactive floor, overview) that the database uses to pick a timesheet.
 *
 * The fixture's start/end were produced by time_period_for on dev with a read-only SELECT; this spec re-asks
 * the configured database (backend/.env.development.local, the hosted dev project) for every case and
 * compares all three: fixture = SQL = TypeScript. Read-only: one STABLE rpc per case, no writes, no AppModule
 * boot (a bare service-role client, never Harness.boot()).
 *
 * Never run against production: prod parity is one read-only MCP SELECT over the fixture cases, run by the
 * orchestrator (blueprint §6.9, critic CC6). The guard below refuses the prod project ref.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  addDays,
  periodFor,
} from '../../src/modules/execution/time/time-periods';
import type { PeriodKind } from '../../src/modules/execution/time/time.types';

jest.setTimeout(120000);

const PROD_PROJECT_REF = 'byvbnkpiselvvulsvxgo';

interface ParityCase {
  kind: PeriodKind;
  timezone: string;
  week_start: number;
  anchor: string | null;
  at: string;
  start: string;
  end: string;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../src/modules/execution/time/__fixtures__/period-parity.json',
    ),
    'utf8',
  ),
) as ParityCase[];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[integration] missing ${name}; set it in backend/.env.development.local.`,
    );
  }
  return value;
}

/** daterange text "[2026-10-05,2026-10-12)" → inclusive { start, end }. */
function parseDaterange(raw: unknown): { start: string; end: string } {
  const match = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(
    String(raw),
  );
  if (!match) throw new Error(`unexpected daterange ${String(raw)}`);
  return { start: match[1], end: addDays(match[2], -1) };
}

describe('time_period_for parity (fixture = SQL = TypeScript)', () => {
  let sb: SupabaseClient;
  const fromDb = new Map<number, { start: string; end: string } | Error>();

  beforeAll(async () => {
    const url = requireEnv('SUPABASE_URL');
    if (url.includes(PROD_PROJECT_REF)) {
      throw new Error(
        '[integration] time-period-parity never runs against production; point it at dev.',
      );
    }
    sb = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const CHUNK = 10;
    for (let i = 0; i < fixture.length; i += CHUNK) {
      await Promise.all(
        fixture.slice(i, i + CHUNK).map(async (c, j) => {
          const { data, error } = await sb.rpc('time_period_for', {
            p_kind: c.kind,
            p_tz: c.timezone,
            p_week_start: c.week_start,
            p_anchor: c.anchor,
            p_at: c.at,
          });
          fromDb.set(
            i + j,
            error ? new Error(error.message) : parseDaterange(data),
          );
        }),
      );
    }
  });

  it('has the full fixture', () => {
    expect(fixture.length).toBeGreaterThanOrEqual(60);
  });

  it.each(
    fixture.map(
      (c, i) =>
        [
          `#${i} ${c.kind} ${c.timezone} ws=${c.week_start} anchor=${c.anchor} at=${c.at}`,
          i,
        ] as const,
    ),
  )('%s', (_label, i) => {
    const c = fixture[i];
    const db = fromDb.get(i);
    if (db instanceof Error) throw db;
    expect(db).toEqual({ start: c.start, end: c.end });
    expect(
      periodFor(
        {
          kind: c.kind,
          timezone: c.timezone,
          weekStart: c.week_start,
          anchor: c.anchor,
        },
        c.at,
      ),
    ).toEqual(db);
  });
});
