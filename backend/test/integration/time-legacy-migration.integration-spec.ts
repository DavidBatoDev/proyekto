/**
 * M2 legacy migration (supabase/migrations/20261003100000_time_timesheets_backfill.sql): assertions on the
 * APPLIED dev state.
 *
 * PostgREST cannot set app.time_maintenance, so this spec cannot replay time_legacy_backfill on a fixture;
 * instead it checks the invariants the backfill left behind on the hosted dev project
 * (backend/.env.development.local). Read-only: service-role selects, no writes, no AppModule boot (a bare
 * client, never Harness.boot()).
 *
 * Valid from M2 until M5. Before M3 the entries table is task_time_logs; from M3 on it is time_entries (the
 * old name becomes a view without the new columns), so the spec probes for time_entries first. The status
 * column drops in M5; the status-based checks then report and return.
 *
 * Rows the old backend changed after the import (updated_at later than the sheet's legacy_import event) are
 * left out of the by-fact checks: status and reviewed_* stay writable on locked rows until M5, and M4
 * (time_legacy_backfill(true)) reconciles them.
 *
 * Never runs against production (describeDevOnly).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

jest.setTimeout(120000);

const DEV_PROJECT_REF = 'vyiedlwasdwmjbztqznl';
const describeDevOnly = (process.env.SUPABASE_URL ?? '').includes(
  DEV_PROJECT_REF,
)
  ? describe
  : describe.skip;

interface EntryRow {
  id: string;
  member_user_id: string | null;
  context_kind: 'assignment' | 'team' | 'workspace' | 'personal';
  timesheet_id: string | null;
  duration_seconds: number | null;
  payable_seconds: number | null;
  legacy_status: 'rejected' | 'paid_outside' | null;
  payout_id: string | null;
  updated_at: string;
  status?: string;
}

interface SheetRow {
  id: string;
  member_user_id: string | null;
  status: 'open' | 'submitted' | 'returned' | 'approved';
  origin: 'app' | 'legacy_migration';
  submission_kind: string | null;
  decision_kind: string | null;
  decided_by: string | null;
  total_seconds: number | null;
  payable_seconds: number | null;
  revision: number;
}

interface EventRow {
  id: number;
  timesheet_id: string;
  event: string;
  to_status: string;
  revision: number;
  created_at: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[integration] missing ${name}; set it in backend/.env.development.local.`,
    );
  }
  return value;
}

/** Every row of a table, paged by id (PostgREST caps a response at 1000). */
async function selectAll<T>(
  sb: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[integration] ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

describeDevOnly('M2 legacy migration (applied dev state)', () => {
  let sb: SupabaseClient;
  let entryTable: 'time_entries' | 'task_time_logs';
  let statusAvailable = false;
  let entries: EntryRow[] = [];
  let sheets = new Map<string, SheetRow>();
  let eventsBySheet = new Map<string, EventRow[]>();
  /** legacy_import time per imported sheet. */
  const importedAt = new Map<string, number>();

  /** On an imported sheet and untouched since the import (the backfill's own output). */
  const unchangedSinceImport = (e: EntryRow): boolean => {
    if (!e.timesheet_id) return false;
    const at = importedAt.get(e.timesheet_id);
    return at !== undefined && Date.parse(e.updated_at) <= at;
  };

  beforeAll(async () => {
    sb = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const probe = await sb.from('time_entries').select('id').limit(1);
    entryTable = probe.error ? 'task_time_logs' : 'time_entries';
    const statusProbe = await sb.from(entryTable).select('status').limit(1);
    statusAvailable = !statusProbe.error;

    const entryColumns = [
      'id',
      'member_user_id',
      'context_kind',
      'timesheet_id',
      'duration_seconds',
      'payable_seconds',
      'legacy_status',
      'payout_id',
      'updated_at',
      ...(statusAvailable ? ['status'] : []),
    ].join(', ');
    entries = await selectAll<EntryRow>(sb, entryTable, entryColumns);

    const sheetRows = await selectAll<SheetRow>(
      sb,
      'timesheets',
      'id, member_user_id, status, origin, submission_kind, decision_kind, decided_by, total_seconds, payable_seconds, revision',
    );
    sheets = new Map(sheetRows.map((s) => [s.id, s]));

    const events = await selectAll<EventRow>(
      sb,
      'timesheet_events',
      'id, timesheet_id, event, to_status, revision, created_at',
    );
    eventsBySheet = new Map();
    for (const ev of events) {
      const list = eventsBySheet.get(ev.timesheet_id) ?? [];
      list.push(ev);
      eventsBySheet.set(ev.timesheet_id, list);
      if (ev.event === 'legacy_import') {
        importedAt.set(ev.timesheet_id, Date.parse(ev.created_at));
      }
    }
  });

  it('M2 has been applied (imported sheets exist)', () => {
    const imported = [...sheets.values()].filter(
      (s) => s.origin === 'legacy_migration',
    );
    expect(imported.length).toBeGreaterThan(0);
  });

  it('every non-personal entry has a timesheet; personal entries have none', () => {
    const sheetless = entries.filter(
      (e) => e.context_kind !== 'personal' && e.timesheet_id === null,
    );
    const personalWithSheet = entries.filter(
      (e) => e.context_kind === 'personal' && e.timesheet_id !== null,
    );
    expect(sheetless.map((e) => e.id)).toEqual([]);
    expect(personalWithSheet.map((e) => e.id)).toEqual([]);
  });

  it('each entry sits on a sheet of its own member', () => {
    const wrongMember = entries.filter((e) => {
      if (!e.timesheet_id) return false;
      const sheet = sheets.get(e.timesheet_id);
      return !sheet || sheet.member_user_id !== e.member_user_id;
    });
    // A member FK cascading to NULL (deleted profile) nulls both sides.
    expect(wrongMember.map((e) => e.id)).toEqual([]);
  });

  it('each legacy_migration sheet has exactly one legacy_import event, and only those sheets do', () => {
    const problems: string[] = [];
    for (const sheet of sheets.values()) {
      const imports = (eventsBySheet.get(sheet.id) ?? []).filter(
        (ev) => ev.event === 'legacy_import',
      );
      const expected = sheet.origin === 'legacy_migration' ? 1 : 0;
      if (imports.length !== expected) {
        problems.push(`${sheet.id} (${sheet.origin}): ${imports.length}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('imported sheets carry origin legacy_migration and submission_kind legacy, at revision 1', () => {
    const problems: string[] = [];
    for (const [sheetId, list] of eventsBySheet) {
      const imported = list.find((ev) => ev.event === 'legacy_import');
      if (!imported) continue;
      const sheet = sheets.get(sheetId);
      if (!sheet) {
        problems.push(`${sheetId}: event without sheet`);
        continue;
      }
      if (sheet.origin !== 'legacy_migration') {
        problems.push(`${sheetId}: origin ${sheet.origin}`);
      }
      if (imported.revision !== 1) {
        problems.push(`${sheetId}: import revision ${imported.revision}`);
      }
      // Untouched since the import: the sheet still shows what M2 wrote.
      if (list.length === 1) {
        if (sheet.submission_kind !== 'legacy') {
          problems.push(`${sheetId}: submission_kind ${sheet.submission_kind}`);
        }
        if (sheet.status !== imported.to_status) {
          problems.push(
            `${sheetId}: status ${sheet.status} vs import ${imported.to_status}`,
          );
        }
        if (sheet.revision !== 1) {
          problems.push(`${sheetId}: revision ${sheet.revision}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every entry of an approved sheet is frozen', () => {
    const unfrozen = entries.filter((e) => {
      if (!e.timesheet_id) return false;
      return (
        sheets.get(e.timesheet_id)?.status === 'approved' &&
        e.payable_seconds === null
      );
    });
    expect(unfrozen.map((e) => e.id)).toEqual([]);
  });

  it('imported sheets still untouched carry the totals of their entries', () => {
    const problems: string[] = [];
    for (const sheet of sheets.values()) {
      if (sheet.origin !== 'legacy_migration') continue;
      if ((eventsBySheet.get(sheet.id) ?? []).length !== 1) continue;
      if (sheet.status === 'open') continue;
      const own = entries.filter((e) => e.timesheet_id === sheet.id);
      const total = own.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
      if (sheet.total_seconds !== total) {
        problems.push(`${sheet.id}: total ${sheet.total_seconds} vs ${total}`);
      }
      if (sheet.status === 'approved') {
        const payable = own
          .filter((e) => e.legacy_status !== 'rejected')
          .reduce((s, e) => s + (e.payable_seconds ?? 0), 0);
        if (sheet.payable_seconds !== payable) {
          problems.push(
            `${sheet.id}: payable ${sheet.payable_seconds} vs ${payable}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('paid_outside and rejected markers match status, by fact', () => {
    if (!statusAvailable) return; // M5 dropped status; nothing left to compare.
    const problems: string[] = [];
    for (const e of entries) {
      if (e.context_kind === 'personal') {
        if (e.legacy_status !== null) {
          problems.push(`${e.id}: personal entry marked ${e.legacy_status}`);
        }
        continue;
      }
      if (!unchangedSinceImport(e)) continue;
      const expected =
        e.status === 'rejected'
          ? 'rejected'
          : e.status === 'paid' && e.payout_id === null
            ? 'paid_outside'
            : null;
      if (e.legacy_status !== expected) {
        problems.push(
          `${e.id}: status ${e.status}, payout ${e.payout_id ?? '-'}, marker ${e.legacy_status ?? '-'}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('approved hours + approved-in-open hours = old approved + paid hours (L11)', () => {
    if (!statusAvailable) return; // M5 dropped status; nothing left to compare.
    const scope = entries.filter(unchangedSinceImport);
    const approvedOrPaid = (e: EntryRow) =>
      e.status === 'approved' || e.status === 'paid';
    const newSeconds = scope
      .filter(
        (e) => e.payable_seconds !== null && e.legacy_status !== 'rejected',
      )
      .reduce((s, e) => s + (e.payable_seconds ?? 0), 0);
    const openSeconds = scope
      .filter((e) => approvedOrPaid(e) && e.payable_seconds === null)
      .reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
    const oldSeconds = scope
      .filter(approvedOrPaid)
      .reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
    expect(newSeconds + openSeconds).toBe(oldSeconds);
  });

  it('a frozen rejected entry pays nothing', () => {
    const paidRejected = entries.filter(
      (e) =>
        e.legacy_status === 'rejected' &&
        e.payable_seconds !== null &&
        e.payable_seconds !== 0,
    );
    expect(paidRejected.map((e) => e.id)).toEqual([]);
  });

  it('a NULL or self decider exists only on legacy, auto or self decisions', () => {
    const problems: string[] = [];
    for (const sheet of sheets.values()) {
      if (sheet.decision_kind === null) continue;
      if (sheet.decision_kind === 'legacy') {
        if (sheet.origin !== 'legacy_migration') {
          problems.push(`${sheet.id}: legacy decision on an app sheet`);
        }
        continue;
      }
      if (sheet.decided_by === null && sheet.decision_kind !== 'auto') {
        problems.push(`${sheet.id}: NULL decider, kind ${sheet.decision_kind}`);
      }
      if (
        sheet.decided_by !== null &&
        sheet.decided_by === sheet.member_user_id &&
        sheet.decision_kind !== 'self'
      ) {
        problems.push(`${sheet.id}: self decider, kind ${sheet.decision_kind}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
