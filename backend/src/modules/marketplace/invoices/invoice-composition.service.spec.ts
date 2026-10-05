import { ConflictException, HttpException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractRow } from '../contracts/contracts.service';
import type {
  EngagementTimeRateRow,
  EngagementTimeSettingsRow,
} from '../engagements/engagements.service';
import {
  assertNoInternalRates,
  buildTimeLines,
  ComposedLine,
  InvoiceCompositionService,
  type BillableEntry,
  type TimeLineContext,
} from './invoice-composition.service';

type Row = Record<string, unknown>;
interface Filter {
  op: string;
  column: string;
  value: unknown;
}
interface Call {
  table: string;
  op: string;
  filters: Filter[];
  payload?: unknown;
  options?: unknown;
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case 'eq':
      return v === f.value;
    case 'neq':
      return v !== f.value;
    case 'in':
      return (f.value as unknown[]).includes(v);
    case 'lt':
      return String(v) < String(f.value);
    case 'lte':
      return String(v) <= String(f.value);
    case 'gt':
      return String(v) > String(f.value);
    case 'gte':
      return String(v) >= String(f.value);
    case 'is':
      return f.value === null ? v === null || v === undefined : v === f.value;
    case 'not.is':
      return f.value === null ? v !== null && v !== undefined : v !== f.value;
    default:
      throw new Error(`fake: unsupported filter ${f.op}`);
  }
}

/**
 * In-memory stand-in for the supabase query builder, mocked at the system boundary only (the HTTP client),
 * per backend/CLAUDE.md. Filters, ranges and the ON CONFLICT (entry_id) DO NOTHING upsert are replayed so the
 * assertions stay meaningful. Embeds are pre-joined on the fixture rows (`task`).
 */
class FakeDb {
  readonly calls: Call[] = [];
  readonly rpcResults: Record<string, { data: unknown; error: unknown }> = {};
  /** Errors returned by the next upserts, in order. */
  readonly upsertErrors: Array<{ message: string; details?: string }> = [];
  /** Runs before an upsert applies (a competing draft reserving first). */
  beforeUpsert?: (rows: Row[]) => void;

  constructor(readonly tables: Record<string, Row[]>) {}

  rpc = jest.fn((name: string) =>
    Promise.resolve(this.rpcResults[name] ?? { data: null, error: null }),
  );

  from = (table: string) => this.query(table);

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  callsTo(table: string, op?: string): Call[] {
    return this.calls.filter(
      (c) => c.table === table && (op === undefined || c.op === op),
    );
  }

  client(): SupabaseClient {
    return { from: this.from, rpc: this.rpc } as unknown as SupabaseClient;
  }

  private query(table: string) {
    const call: Call = { table, op: 'select', filters: [] };
    this.calls.push(call);
    let range: [number, number] | null = null;
    let returning = false;
    const b: Record<string, unknown> = {};
    const filter = (op: string) => (column: string, value: unknown) => {
      call.filters.push({ op, column, value });
      return b;
    };
    b.select = () => {
      if (call.op !== 'select') returning = true;
      return b;
    };
    for (const op of ['eq', 'neq', 'in', 'lt', 'lte', 'gt', 'gte', 'is']) {
      b[op] = filter(op);
    }
    b.not = (column: string, op: string, value: unknown) => {
      call.filters.push({ op: `not.${op}`, column, value });
      return b;
    };
    b.order = () => b;
    b.limit = () => b;
    b.range = (from: number, to: number) => {
      range = [from, to];
      return b;
    };
    b.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return b;
    };
    b.upsert = (payload: unknown, options: unknown) => {
      call.op = 'upsert';
      call.payload = payload;
      call.options = options;
      return b;
    };
    b.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return b;
    };
    b.delete = () => {
      call.op = 'delete';
      return b;
    };
    const exec = (): { data: unknown; error: unknown } => {
      const all = this.rows(table);
      const hit = (row: Row) => call.filters.every((f) => matches(row, f));
      switch (call.op) {
        case 'upsert': {
          const error = this.upsertErrors.shift();
          if (error) return { data: null, error };
          const rows = call.payload as Row[];
          this.beforeUpsert?.(rows);
          for (const row of rows) {
            if (!all.some((r) => r.entry_id === row.entry_id)) {
              all.push({ ...row });
            }
          }
          return { data: null, error: null };
        }
        case 'insert':
          all.push(
            ...((Array.isArray(call.payload)
              ? call.payload
              : [call.payload]) as Row[]),
          );
          return { data: null, error: null };
        case 'update': {
          const updated = all.filter(hit);
          for (const row of updated) Object.assign(row, call.payload);
          return { data: returning ? updated : null, error: null };
        }
        case 'delete': {
          const kept = all.filter((row) => !hit(row));
          all.splice(0, all.length, ...kept);
          return { data: null, error: null };
        }
        default: {
          let rows = all.filter(hit).map((row) => ({ ...row }));
          if (range) rows = rows.slice(range[0], range[1] + 1);
          return { data: rows, error: null };
        }
      }
    };
    b.maybeSingle = () => {
      const result = exec();
      const rows = (result.data as Row[] | null) ?? [];
      return Promise.resolve({ data: rows[0] ?? null, error: result.error });
    };
    b.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(exec()).then(resolve, reject);
    return b;
  }
}

const BASE_CONTRACT: ContractRow = {
  id: 'contract-1',
  project_id: 'project-1',
  project_title_snapshot: 'Project One',
  consultant_user_id: 'consultant-1',
  relationship_kind: 'client_services',
  scope_mode: 'project_specific',
  contract_family_id: 'family-1',
  engagement_id: null,
  version: 1,
  revision: 1,
  contract_number: 'BS2026-001',
  status: 'signed',
  provider_kind: 'agency',
  client_kind: 'individual',
  document_title: 'Service Agreement',
  provider_name: 'Prodigitality',
  provider_address: null,
  provider_tin: null,
  provider_email: null,
  client_name: 'Filro Caregivers',
  client_contact_name: null,
  client_address: null,
  client_tin: null,
  client_email: null,
  client_user_id: null,
  currency: 'USD',
  billing_mode: 'time_based',
  fixed_fee: null,
  time_tracking_mode: 'optional',
  time_approval_mode: 'none',
  allow_manual_time: true,
  time_rounding_minutes: 0,
  weekly_time_limit_minutes: null,
  client_hours_detail_level: 'none',
  billing_timing: 'arrears',
  supersedes_contract_id: null,
  amendment_effective_date: null,
  recurring_fee: null,
  client_hourly_rate: 15,
  included_hours: null,
  invoice_cadence: 'semi_monthly',
  period_source: 'team_config',
  invoice_offset_days: 1,
  due_days: 14,
  invoice_number_prefix: 'BS',
  service_description: 'Digital marketing services',
  payment_method: 'Online payment',
  service_start_date: '2026-08-01',
  term_count: 12,
  term_unit: 'month',
  service_end_date: '2027-07-31',
  contract_end_date: '2027-07-31',
  auto_renew: false,
  notice_days: null,
  clauses: [],
  services: [],
  notes: null,
  signed_by_consultant_at: null,
  signed_by_consultant_name: null,
  signed_by_consultant_signature_url: null,
  signed_by_consultant_signature_scale: 1,
  signed_by_consultant_signature_offset_x: 0,
  signed_by_consultant_signature_offset_y: 0,
  signed_by_client_at: null,
  signed_by_client_name: null,
  signed_by_client_signature_url: null,
  signed_by_client_signature_scale: 1,
  signed_by_client_signature_offset_x: 0,
  signed_by_client_signature_offset_y: 0,
  created_by: 'consultant-1',
  created_at: '2026-07-24T00:00:00.000Z',
  updated_at: '2026-07-24T00:00:00.000Z',
  workspace_id: 'ws-1',
};

const PERIOD = { start: '2026-08-01', end: '2026-08-15' };
const INVOICE = 'invoice-1';

/** An approved team entry of the provider team on the contract project (overrides per case). */
function entry(o: Row & { id: string; started_at: string }): Row {
  return {
    project_id: 'project-1',
    task_id: null,
    work_item: 'other',
    context_kind: 'team',
    team_id: 'team-1',
    engagement_assignment_id: null,
    payable_seconds: 3600,
    legacy_status: null,
    work_type_snapshot: 'real_work',
    task: null,
    // Present on the row, must never reach a line.
    rate_snapshot: 4,
    member_user_id: 'member-1',
    ...o,
  };
}

// 25.75 hours across two tasks, mirroring the real FILRO invoice, plus rows that must never bill.
const LOGS: Row[] = [
  entry({
    id: 'log-1',
    started_at: '2026-08-03T09:00:00.000Z',
    payable_seconds: 20 * 3600,
    task_id: 'task-a',
    work_item: 'task',
    task: { title: 'Campaign setup' },
  }),
  entry({
    id: 'log-2',
    started_at: '2026-08-10T09:00:00.000Z',
    payable_seconds: 5.75 * 3600,
    task_id: 'task-b',
    work_item: 'task',
    task: { title: 'Content calendar' },
    legacy_status: 'paid_outside',
  }),
  // Not approved (no freeze yet).
  entry({
    id: 'log-3',
    started_at: '2026-08-11T09:00:00.000Z',
    payable_seconds: null,
  }),
  // Training is never billed.
  entry({
    id: 'log-4',
    started_at: '2026-08-12T09:00:00.000Z',
    work_type_snapshot: 'training',
  }),
  // Next period.
  entry({ id: 'log-5', started_at: '2026-08-20T09:00:00.000Z' }),
  // Legacy-rejected.
  entry({
    id: 'log-6',
    started_at: '2026-08-05T09:00:00.000Z',
    legacy_status: 'rejected',
  }),
  // Another team, the workspace, another project: never this contract's.
  entry({
    id: 'log-7',
    started_at: '2026-08-05T09:00:00.000Z',
    team_id: 'team-other',
  }),
  entry({
    id: 'log-8',
    started_at: '2026-08-05T09:00:00.000Z',
    context_kind: 'workspace',
    team_id: null,
  }),
  entry({
    id: 'log-9',
    started_at: '2026-08-05T09:00:00.000Z',
    project_id: 'project-other',
  }),
  // Capped to zero at approval: nothing to bill.
  entry({
    id: 'log-10',
    started_at: '2026-08-06T09:00:00.000Z',
    payable_seconds: 0,
  }),
];

interface EngagementOptions {
  engagement?: { id: string; kind: string; status: string } | null;
  byContract?: Record<string, { id: string; kind: string; status: string }>;
  assignmentIds?: string[];
  providerTeamId?: string | null;
  linkedProjects?: string[];
  rates?: EngagementTimeRateRow[];
  settings?: Partial<EngagementTimeSettingsRow> | null;
  assignments?: Record<
    string,
    { talent_engagement_id: string | null; client_engagement_id: string | null }
  >;
}

function engagementsMock(o: EngagementOptions = {}) {
  return {
    engagementForContract: jest.fn((contractId: string) =>
      Promise.resolve(
        o.byContract?.[contractId] ??
          (contractId === BASE_CONTRACT.id ? (o.engagement ?? null) : null),
      ),
    ),
    assignmentIdsForClientEngagement: jest.fn(() =>
      Promise.resolve(o.assignmentIds ?? []),
    ),
    providerPartyTeamId: jest.fn(() =>
      Promise.resolve(o.providerTeamId ?? null),
    ),
    isLinkedToProject: jest.fn((_e: string, projectId: string) =>
      Promise.resolve((o.linkedProjects ?? []).includes(projectId)),
    ),
    ratesFor: jest.fn(() => Promise.resolve(o.rates ?? [])),
    settingsInForceOn: jest.fn(() =>
      Promise.resolve(
        o.settings === null
          ? null
          : {
              client_hours_detail_level: 'detailed',
              rounding_minutes: 0,
              ...(o.settings ?? {}),
            },
      ),
    ),
    getAssignment: jest.fn((id: string) =>
      Promise.resolve(o.assignments?.[id] ?? null),
    ),
  };
}

function harness(
  options: {
    entries?: Row[];
    tables?: Record<string, Row[]>;
    engagement?: EngagementOptions;
    timezones?: Record<string, string>;
    floor?: string | null;
  } = {},
) {
  const db = new FakeDb({
    time_entries: (options.entries ?? LOGS).map((row) => ({ ...row })),
    invoice_time_entries: [],
    contract_positions: [
      {
        contract_id: BASE_CONTRACT.id,
        position: 'provider',
        user_id: 'consultant-1',
        team_id: 'team-1',
      },
    ],
    teams: [],
    project_teams: [],
    contracts: [
      {
        id: BASE_CONTRACT.id,
        contract_family_id: BASE_CONTRACT.contract_family_id,
        project_id: 'project-1',
        status: 'signed',
        relationship_kind: 'client_services',
        billing_mode: 'time_based',
        engagement_id: null,
      },
    ],
    projects: [{ id: 'project-1', workspace_id: 'ws-project' }],
    ...(options.tables ?? {}),
  });
  db.rpcResults.time_billing_floor = {
    data: options.floor === undefined ? '2026-08-01' : options.floor,
    error: null,
  };
  const engagements = engagementsMock(options.engagement);
  const timezones = options.timezones ?? {};
  const policy = {
    workspaceTimezone: jest.fn((workspaceId: string | null) =>
      Promise.resolve((workspaceId && timezones[workspaceId]) || 'UTC'),
    ),
  };
  const service = new InvoiceCompositionService(
    db.client(),
    engagements as never,
    policy as never,
  );
  return { db, service, engagements, policy };
}

function reservedIds(db: FakeDb, invoiceId = INVOICE): string[] {
  return db
    .rows('invoice_time_entries')
    .filter((row) => row.invoice_id === invoiceId)
    .map((row) => String(row.entry_id))
    .sort();
}

describe('buildTimeLines', () => {
  const ctx = (o: Partial<TimeLineContext> = {}): TimeLineContext => ({
    mode: 'time_based',
    includedHours: 0,
    detail: 'summary',
    period: PERIOD,
    timezone: 'UTC',
    serviceLabel: 'Services',
    ...o,
  });
  const billable = (
    o: Partial<BillableEntry> & { entry_id: string },
  ): BillableEntry => ({
    started_at: '2026-08-03T09:00:00.000Z',
    local_date: '2026-08-03',
    task_key: 'task-a',
    task_title: 'Task A',
    bill_seconds: 3600,
    bill_rate: 100,
    currency: 'USD',
    ...o,
  });

  // E74 / L63: line amount = round(Σ seconds/3600 × rate, 2); quantity is rounded separately.
  it('prices a line from its seconds, not from its rounded quantity', () => {
    const { lines, amounts } = buildTimeLines(
      [
        billable({ entry_id: 'a', bill_seconds: 1200 }),
        billable({ entry_id: 'b', bill_seconds: 1200 }),
        billable({ entry_id: 'c', bill_seconds: 1200 }),
        billable({ entry_id: 'd', bill_seconds: 1200 }),
      ],
      ctx(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(1.33);
    expect(lines[0].amount).toBe(133.33);
    expect(amounts.get('a')).toBe(33.33);
  });

  it('groups by (task, bill_rate) at detailed and by bill_rate otherwise', () => {
    const entries = [
      billable({ entry_id: 'a', task_key: 'task-a', bill_seconds: 7200 }),
      billable({
        entry_id: 'b',
        task_key: 'task-b',
        task_title: 'Task B',
        bill_seconds: 3600,
      }),
      // An amendment mid-period: a second price.
      billable({
        entry_id: 'c',
        task_key: 'task-a',
        bill_rate: 120,
        started_at: '2026-08-10T09:00:00.000Z',
        local_date: '2026-08-10',
      }),
    ];
    const detailed = buildTimeLines(entries, ctx({ detail: 'detailed' }));
    expect(
      detailed.lines.map((l) => [l.description, l.quantity, l.unit_rate]),
    ).toEqual([
      ['Task A (2026-08-01 to 2026-08-15)', 2, 100],
      ['Task B (2026-08-01 to 2026-08-15)', 1, 100],
      ['Task A (2026-08-01 to 2026-08-15)', 1, 120],
    ]);
    const summary = buildTimeLines(entries, ctx());
    expect(summary.lines.map((l) => [l.quantity, l.unit_rate])).toEqual([
      [3, 100],
      [1, 120],
    ]);
    expect(summary.lines[0].description).toBe(
      'Services (2026-08-01 to 2026-08-15)',
    );
    expect(
      buildTimeLines(entries, ctx({ detail: 'none' })).lines[0].description,
    ).toBe('Services');
  });

  it('consumes a hybrid allowance in started_at order and bills the rest as overage', () => {
    const { lines, amounts } = buildTimeLines(
      [
        billable({
          entry_id: 'late',
          started_at: '2026-08-05T09:00:00.000Z',
          local_date: '2026-08-05',
          bill_seconds: 3 * 3600,
        }),
        billable({ entry_id: 'early', bill_seconds: 2 * 3600 }),
      ],
      ctx({ mode: 'hybrid', includedHours: 3 }),
    );
    // early (2 h) is fully included; late straddles: 1 h included, 2 h overage.
    expect(amounts.get('early')).toBe(0);
    expect(amounts.get('late')).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source_type: 'overage',
      quantity: 2,
      amount: 200,
      description:
        'Additional hours beyond 3 included (2026-08-01 to 2026-08-15)',
    });
    expect(lines[0].metadata).toMatchObject({
      total_hours: 5,
      included_hours: 3,
    });
  });

  // E36: hours approved after their own period was invoiced bill on their own lines, outside the allowance.
  it('puts earlier hours on their own lines, never against the allowance', () => {
    const { lines } = buildTimeLines(
      [
        billable({
          entry_id: 'old',
          started_at: '2026-07-20T09:00:00.000Z',
          local_date: '2026-07-20',
          bill_seconds: 3600,
        }),
        billable({ entry_id: 'now', bill_seconds: 3600 }),
      ],
      ctx({ mode: 'hybrid', includedHours: 1 }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source_type: 'time_log',
      description: 'Earlier hours (before 2026-08-01)',
      quantity: 1,
      amount: 100,
    });
    expect(lines[0].metadata.earlier).toBe(true);
  });
});

describe('composeForContract — legacy time_based', () => {
  it("bills only the provider team's approved real work on the contract project, at the CLIENT rate", async () => {
    const { service, db } = harness();
    const { lines, hours } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'summary',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(25.75);
    // 15 is the contract's client_hourly_rate; 4 is the member's rate_snapshot.
    expect(lines[0].unit_rate).toBe(15);
    expect(lines[0].amount).toBe(386.25);
    expect(lines[0].source_type).toBe('time_log');
    expect(hours.totalHours).toBe(25.75);
    expect(reservedIds(db)).toEqual(['log-1', 'log-2']);

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('member');
    expect(serialized).not.toContain('rate_snapshot');
  });

  it('reserves with ON CONFLICT (entry_id) DO NOTHING after releasing its own rows', async () => {
    const { service, db } = harness({
      tables: {
        invoice_time_entries: [
          {
            invoice_id: INVOICE,
            entry_id: 'stale',
            bill_seconds: 60,
            bill_rate: 15,
            bill_amount: 0.25,
            currency: 'USD',
          },
        ],
      },
    });
    await service.composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary');

    const ops = db.callsTo('invoice_time_entries').map((c) => c.op);
    expect(ops[0]).toBe('delete');
    const upsert = db.callsTo('invoice_time_entries', 'upsert')[0];
    expect(upsert.options).toEqual({
      onConflict: 'entry_id',
      ignoreDuplicates: true,
    });
    expect(upsert.payload).toEqual([
      expect.objectContaining({
        invoice_id: INVOICE,
        entry_id: 'log-1',
        contract_id: 'contract-1',
        bill_seconds: 72000,
        bill_rate: 15,
        bill_amount: 300,
        currency: 'USD',
      }),
      expect.objectContaining({ entry_id: 'log-2', bill_amount: 86.25 }),
    ]);
    expect(reservedIds(db)).toEqual(['log-1', 'log-2']);
  });

  // E37: two drafts never share an entry.
  it('skips entries another invoice already holds', async () => {
    const { service, db } = harness({
      tables: {
        invoice_time_entries: [
          {
            invoice_id: 'invoice-other',
            entry_id: 'log-1',
            bill_seconds: 72000,
            bill_rate: 15,
            bill_amount: 300,
            currency: 'USD',
          },
        ],
      },
    });
    const { lines } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines[0].quantity).toBe(5.75);
    expect(reservedIds(db)).toEqual(['log-2']);
  });

  it('builds lines only from the rows it won when a concurrent draft reserves first', async () => {
    const { service, db } = harness();
    db.beforeUpsert = () => {
      db.rows('invoice_time_entries').push({
        invoice_id: 'invoice-race',
        entry_id: 'log-2',
        bill_seconds: 20700,
        bill_rate: 15,
        bill_amount: 86.25,
        currency: 'USD',
      });
    };
    const { lines } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines[0].quantity).toBe(20);
    expect(reservedIds(db)).toEqual(['log-1']);
    expect(reservedIds(db, 'invoice-race')).toEqual(['log-2']);
  });

  it('retries once when the guard refuses an entry, then gives up with 409', async () => {
    const refused = {
      message: 'INVOICE_TIME_ENTRY_NOT_BILLABLE',
      details: 'entry is not approved billable time',
    };
    const once = harness();
    once.db.upsertErrors.push(refused);
    const { lines } = await once.service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines[0].quantity).toBe(25.75);
    expect(once.db.callsTo('invoice_time_entries', 'upsert')).toHaveLength(2);

    const twice = harness();
    twice.db.upsertErrors.push(refused, refused);
    const error = await twice.service
      .composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'INVOICE_TIME_ENTRY_NOT_BILLABLE',
    });
    expect(reservedIds(twice.db)).toEqual([]);
  });

  it('groups a detailed invoice by task and never by member', async () => {
    const { service } = harness();
    const { lines } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'detailed',
    );
    expect(lines.map((l) => [l.description, l.quantity])).toEqual([
      ['Campaign setup (2026-08-01 to 2026-08-15)', 20],
      ['Content calendar (2026-08-01 to 2026-08-15)', 5.75],
    ]);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(386.25);
  });

  it('keeps a priced zero line, without a reservation key, when nothing is billable', async () => {
    const { service, db } = harness({ entries: [] });
    const { lines } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'none',
    );
    expect(lines).toEqual([
      expect.objectContaining({
        source_type: 'time_log',
        description: 'Digital marketing services',
        quantity: 0,
        amount: 0,
      }),
    ]);
    expect(lines[0].metadata.time_key).toBeUndefined();
    expect(db.callsTo('invoice_time_entries', 'upsert')).toHaveLength(0);
  });
});

describe('composeForContract — eligibility (E36)', () => {
  it('dates entries in the policy timezone of contracts.workspace_id', async () => {
    const { service, policy } = harness({
      timezones: { 'ws-1': 'Asia/Manila' },
      entries: [
        // 2026-08-15T20:00Z is 08-16 in Manila: next period.
        entry({ id: 'late', started_at: '2026-08-15T20:00:00.000Z' }),
        // 2026-07-31T18:00Z is 08-01 in Manila: this period, not earlier.
        entry({ id: 'early', started_at: '2026-07-31T18:00:00.000Z' }),
      ],
    });
    const { lines } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(policy.workspaceTimezone).toHaveBeenCalledWith('ws-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(1);
    expect(lines[0].metadata.earlier).toBeUndefined();
    expect(lines[0].metadata.time_context).toMatchObject({
      timezone: 'Asia/Manila',
    });
  });

  it("falls back to the contract project's workspace when contracts.workspace_id is NULL", async () => {
    const { service, policy } = harness();
    await service.composeForContract(
      { ...BASE_CONTRACT, workspace_id: null },
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(policy.workspaceTimezone).toHaveBeenCalledWith('ws-project');
  });

  it('never bills below the billing floor, and bills later-approved earlier hours on their own line', async () => {
    const { service, db } = harness({
      floor: '2026-07-15',
      entries: [
        entry({ id: 'before-floor', started_at: '2026-07-10T09:00:00.000Z' }),
        entry({ id: 'catch-up', started_at: '2026-07-20T09:00:00.000Z' }),
        entry({ id: 'current', started_at: '2026-08-04T09:00:00.000Z' }),
      ],
    });
    const { lines } = await service.composeForContract(
      BASE_CONTRACT,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(db.rpc).toHaveBeenCalledWith('time_billing_floor', {
      p_contract_id: 'contract-1',
    });
    expect(lines.map((l) => l.description)).toEqual([
      'Digital marketing services (2026-08-01 to 2026-08-15)',
      'Earlier hours (before 2026-08-01)',
    ]);
    expect(reservedIds(db)).toEqual(['catch-up', 'current']);
  });
});

describe('composeForContract — legacy scope (E17, E57)', () => {
  it("uses the provider seat user's only team when the seat names none", async () => {
    const { service, db } = harness({
      tables: {
        contract_positions: [
          {
            contract_id: 'contract-1',
            position: 'provider',
            user_id: 'consultant-1',
            team_id: null,
          },
        ],
        teams: [{ id: 'team-1', owner_id: 'consultant-1' }],
      },
    });
    await service.composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary');
    expect(reservedIds(db)).toEqual(['log-1', 'log-2']);
  });

  it('narrows several owned teams to the one attached to the project', async () => {
    const { service, db } = harness({
      tables: {
        contract_positions: [],
        teams: [
          { id: 'team-1', owner_id: 'consultant-1' },
          { id: 'team-other', owner_id: 'consultant-1' },
        ],
        project_teams: [{ project_id: 'project-1', team_id: 'team-1' }],
      },
    });
    await service.composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary');
    expect(reservedIds(db)).toEqual(['log-1', 'log-2']);
  });

  it.each([
    ['no team', []],
    [
      'several teams',
      [
        { id: 'team-1', owner_id: 'consultant-1' },
        { id: 'team-other', owner_id: 'consultant-1' },
      ],
    ],
  ])('refuses with LEGACY_CONTRACT_AMBIGUOUS for %s', async (_label, teams) => {
    const { service, db } = harness({
      tables: { contract_positions: [], teams: teams as Row[] },
    });
    const error = await service
      .composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'LEGACY_CONTRACT_AMBIGUOUS',
      reason: 'teams',
    });
    expect(db.callsTo('invoice_time_entries', 'upsert')).toHaveLength(0);
  });

  it('refuses when another live hourly legacy contract (hybrid counts) bills the same project', async () => {
    const { service } = harness({
      tables: {
        contracts: [
          {
            id: 'contract-1',
            contract_family_id: 'family-1',
            project_id: 'project-1',
            status: 'signed',
            relationship_kind: 'client_services',
            billing_mode: 'time_based',
            engagement_id: null,
          },
          {
            id: 'contract-2',
            contract_family_id: 'family-2',
            project_id: 'project-1',
            status: 'signed',
            relationship_kind: 'client_services',
            billing_mode: 'hybrid',
            engagement_id: null,
          },
        ],
      },
    });
    const error = await service
      .composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary')
      .catch((e: unknown) => e);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'LEGACY_CONTRACT_AMBIGUOUS',
      reason: 'contracts',
    });
  });

  it('ignores an amendment of the same family and a contract that activated an engagement', async () => {
    const { service, db } = harness({
      tables: {
        contracts: [
          {
            id: 'contract-1b',
            contract_family_id: 'family-1',
            project_id: 'project-1',
            status: 'signed',
            relationship_kind: 'client_services',
            billing_mode: 'time_based',
            engagement_id: null,
          },
          {
            id: 'contract-3',
            contract_family_id: 'family-3',
            project_id: 'project-1',
            status: 'signed',
            relationship_kind: 'client_services',
            billing_mode: 'time_based',
            engagement_id: null,
          },
        ],
      },
      engagement: {
        byContract: {
          'contract-3': {
            id: 'eng-3',
            kind: 'client_services',
            status: 'active',
          },
        },
      },
    });
    await service.composeForContract(BASE_CONTRACT, INVOICE, PERIOD, 'summary');
    expect(reservedIds(db)).toEqual(['log-1', 'log-2']);
  });
});

describe('composeForContract — engagement scope (E16, E62, E61)', () => {
  const engagementContract: ContractRow = {
    ...BASE_CONTRACT,
    engagement_id: 'eng-1',
    client_hourly_rate: 90,
  };
  const billingRate = (
    o: Partial<EngagementTimeRateRow> & { id: string },
  ): EngagementTimeRateRow => ({
    engagement_id: 'eng-1',
    source_contract_id: 'contract-1',
    worker_user_id: null,
    rate_kind: 'billing',
    unit: 'hour',
    work_type: null,
    amount: 100,
    currency: 'USD',
    effective_from: '2026-01-01',
    effective_until: null,
    ...o,
  });
  const ENGAGEMENT_ENTRIES: Row[] = [
    // (a) the client engagement's assignment, any project.
    entry({
      id: 'asg-1',
      started_at: '2026-08-03T09:00:00.000Z',
      context_kind: 'assignment',
      team_id: null,
      engagement_assignment_id: 'assignment-1',
      project_id: 'project-x',
    }),
    // Another engagement's assignment.
    entry({
      id: 'asg-other',
      started_at: '2026-08-03T10:00:00.000Z',
      context_kind: 'assignment',
      team_id: null,
      engagement_assignment_id: 'assignment-other',
    }),
    // (b) the provider team on a linked project, and on an unlinked one.
    entry({ id: 'team-linked', started_at: '2026-08-04T09:00:00.000Z' }),
    entry({
      id: 'team-unlinked',
      started_at: '2026-08-04T10:00:00.000Z',
      project_id: 'project-unlinked',
    }),
    // Some other team on the linked project.
    entry({
      id: 'team-foreign',
      started_at: '2026-08-04T11:00:00.000Z',
      team_id: 'team-other',
    }),
  ];
  const engagementOptions = (o: EngagementOptions = {}): EngagementOptions => ({
    engagement: { id: 'eng-1', kind: 'client_services', status: 'active' },
    assignmentIds: ['assignment-1'],
    providerTeamId: 'team-1',
    linkedProjects: ['project-1'],
    rates: [billingRate({ id: 'rate-1' })],
    ...o,
  });

  it("bills its assignments' entries and the provider team's entries on linked projects only", async () => {
    const { service, db, engagements } = harness({
      entries: ENGAGEMENT_ENTRIES,
      engagement: engagementOptions(),
    });
    const { lines } = await service.composeForContract(
      engagementContract,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(reservedIds(db)).toEqual(['asg-1', 'team-linked']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quantity: 2,
      unit_rate: 100,
      amount: 200,
    });
    expect(engagements.ratesFor).toHaveBeenCalledWith('eng-1', {
      rateKind: 'billing',
    });
    // Legacy-only lookups never run for an engagement contract.
    expect(db.callsTo('contract_positions')).toHaveLength(0);
  });

  it('prices each entry at the billing rate in force on its local date, work_type first', async () => {
    const { service } = harness({
      entries: [
        entry({ id: 'june-terms', started_at: '2026-08-03T09:00:00.000Z' }),
        entry({ id: 'amended', started_at: '2026-08-10T09:00:00.000Z' }),
      ],
      engagement: engagementOptions({
        rates: [
          billingRate({
            id: 'old',
            amount: 100,
            effective_until: '2026-08-07',
          }),
          billingRate({
            id: 'new',
            amount: 120,
            effective_from: '2026-08-08',
          }),
          billingRate({
            id: 'training',
            amount: 10,
            work_type: 'training',
            effective_from: '2026-08-08',
          }),
        ],
      }),
    });
    const { lines } = await service.composeForContract(
      engagementContract,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines.map((l) => [l.quantity, l.unit_rate])).toEqual([
      [1, 100],
      [1, 120],
    ]);
  });

  it("falls back to the version's client_hourly_rate when no billing rate is in force", async () => {
    const { service } = harness({
      entries: [
        entry({ id: 'team-linked', started_at: '2026-08-04T09:00:00.000Z' }),
      ],
      engagement: engagementOptions({ rates: [] }),
    });
    const { lines } = await service.composeForContract(
      engagementContract,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines[0].unit_rate).toBe(90);
  });

  it('leaves a day priced by a month or fixed rate to the retainer/fixed lines (E61)', async () => {
    const { service, db } = harness({
      entries: [
        entry({ id: 'team-linked', started_at: '2026-08-04T09:00:00.000Z' }),
      ],
      engagement: engagementOptions({
        rates: [billingRate({ id: 'month', unit: 'month', amount: 5000 })],
      }),
    });
    const { lines } = await service.composeForContract(
      engagementContract,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(reservedIds(db)).toEqual([]);
    expect(lines.every((l) => l.quantity === 0)).toBe(true);
  });

  it('caps the detail level at the contract settings in force on the period end (L22)', async () => {
    const { service, engagements } = harness({
      entries: ENGAGEMENT_ENTRIES,
      engagement: engagementOptions({
        settings: { client_hours_detail_level: 'summary' },
      }),
    });
    const { lines } = await service.composeForContract(
      engagementContract,
      INVOICE,
      PERIOD,
      'detailed',
    );
    expect(engagements.settingsInForceOn).toHaveBeenCalledWith(
      'eng-1',
      '2026-08-15',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].metadata).toMatchObject({ grouped_by: 'period' });
  });

  it("re-rounds a two-engagement assignment's payable time to the client's rounding", async () => {
    const { service, db } = harness({
      entries: [
        entry({
          id: 'asg-1',
          started_at: '2026-08-03T09:00:00.000Z',
          context_kind: 'assignment',
          team_id: null,
          engagement_assignment_id: 'assignment-1',
          payable_seconds: 1000,
        }),
      ],
      engagement: engagementOptions({
        settings: { rounding_minutes: 15 },
        assignments: {
          'assignment-1': {
            talent_engagement_id: 'eng-talent',
            client_engagement_id: 'eng-1',
          },
        },
      }),
    });
    await service.composeForContract(
      engagementContract,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(db.rows('invoice_time_entries')[0]).toMatchObject({
      entry_id: 'asg-1',
      bill_seconds: 900,
    });
  });
});

describe('composeForContract — retainer and hybrid', () => {
  const retainer: ContractRow = {
    ...BASE_CONTRACT,
    billing_mode: 'retainer',
    recurring_fee: 15000,
    client_hourly_rate: null,
  };

  // E73: a retainer never reserves time or blocks a reopen.
  it('bills a flat fee and never reads or reserves time', async () => {
    const { service, db } = harness();
    const { lines } = await service.composeForContract(
      retainer,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source_type: 'retainer',
      quantity: 1,
      amount: 15000,
    });
    expect(db.callsTo('time_entries')).toHaveLength(0);
    expect(db.callsTo('invoice_time_entries', 'upsert')).toHaveLength(0);
  });

  it('composes nothing for a fixed-price contract', async () => {
    const { service, db } = harness();
    const { lines } = await service.composeForContract(
      { ...BASE_CONTRACT, billing_mode: 'fixed', fixed_fee: 1000 },
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines).toEqual([]);
    expect(db.callsTo('time_entries')).toHaveLength(0);
  });

  const hybrid: ContractRow = {
    ...BASE_CONTRACT,
    billing_mode: 'hybrid',
    recurring_fee: 1000,
    client_hourly_rate: 15,
    included_hours: 20,
  };

  it('adds an overage line for hours beyond the included allowance and reserves every billed entry', async () => {
    const { service, db } = harness();
    const { lines } = await service.composeForContract(
      hybrid,
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines.map((l) => l.source_type)).toEqual(['retainer', 'overage']);
    expect(lines[1].quantity).toBe(5.75);
    expect(lines[1].amount).toBe(86.25);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(1086.25);
    // Included hours are reserved too, at a zero audit amount.
    expect(
      db.rows('invoice_time_entries').map((r) => [r.entry_id, r.bill_amount]),
    ).toEqual([
      ['log-1', 0],
      ['log-2', 86.25],
    ]);
  });

  it('omits the overage line within the allowance but keeps the time context on the retainer line', async () => {
    const { service } = harness();
    const { lines } = await service.composeForContract(
      { ...hybrid, included_hours: 40 },
      INVOICE,
      PERIOD,
      'summary',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].source_type).toBe('retainer');
    expect(lines[0].metadata.time_context).toMatchObject({
      mode: 'hybrid',
      included_hours: 40,
    });
  });
});

describe('verifyReservations (E37)', () => {
  async function composed(contract: ContractRow = BASE_CONTRACT) {
    const h = harness();
    const { lines } = await h.service.composeForContract(
      contract,
      INVOICE,
      PERIOD,
      'detailed',
    );
    return { ...h, lines };
  }

  it('passes when the hour lines are exactly what the reservations bill', async () => {
    const { service, lines } = await composed();
    await expect(
      service.verifyReservations(INVOICE, lines),
    ).resolves.toBeUndefined();
  });

  it('passes for a hybrid whose hours all fit the allowance', async () => {
    const { service, lines } = await composed({
      ...BASE_CONTRACT,
      billing_mode: 'hybrid',
      recurring_fee: 1000,
      included_hours: 40,
    });
    await expect(
      service.verifyReservations(INVOICE, lines),
    ).resolves.toBeUndefined();
  });

  it('does nothing for an invoice without reservations or keyed hour lines', async () => {
    const { service, db } = harness();
    await service.verifyReservations(INVOICE, [
      { source_type: 'manual', quantity: 1, metadata: {} },
      // An hour line composed before reservations existed.
      {
        source_type: 'time_log',
        quantity: 3,
        metadata: { grouped_by: 'period' },
      },
    ]);
    expect(db.callsTo('time_entries')).toHaveLength(0);
  });

  it('refuses when a line quantity no longer matches', async () => {
    const { service, lines } = await composed();
    const tampered = lines.map((line, index) =>
      index === 0 ? { ...line, quantity: line.quantity + 1 } : line,
    );
    const error = await service
      .verifyReservations(INVOICE, tampered)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'INVOICE_TIME_ENTRY_NOT_BILLABLE',
      reason: 'reservation_mismatch',
    });
  });

  it('refuses when a reserved entry is no longer approved', async () => {
    const { service, db, lines } = await composed();
    const row = db.rows('time_entries').find((r) => r.id === 'log-2') as Row;
    row.payable_seconds = null;
    await expect(
      service.verifyReservations(INVOICE, lines),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses hour lines whose reservations are gone', async () => {
    const { service, db, lines } = await composed();
    db.rows('invoice_time_entries').splice(0);
    await expect(
      service.verifyReservations(INVOICE, lines),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('releaseReservations / moveReservations', () => {
  it('moves every reservation to the replacement and releases by invoice', async () => {
    const { service, db } = harness({
      tables: {
        invoice_time_entries: [
          { invoice_id: 'voided', entry_id: 'a' },
          { invoice_id: 'voided', entry_id: 'b' },
          { invoice_id: 'kept', entry_id: 'c' },
        ],
      },
    });
    await expect(
      service.moveReservations('voided', 'replacement'),
    ).resolves.toBe(2);
    expect(reservedIds(db, 'replacement')).toEqual(['a', 'b']);

    await service.releaseReservations('replacement');
    expect(reservedIds(db, 'replacement')).toEqual([]);
    expect(reservedIds(db, 'kept')).toEqual(['c']);
  });

  it('maps a guard refusal to 409 without Postgres text', async () => {
    const db = new FakeDb({});
    const client = {
      from: () => ({
        delete: () => ({
          eq: () =>
            Promise.resolve({
              error: {
                message: 'INVOICE_TIME_ENTRY_NOT_BILLABLE',
                details: 'reservation is locked by an issued invoice',
              },
            }),
        }),
      }),
      rpc: db.rpc,
    } as unknown as SupabaseClient;
    const service = new InvoiceCompositionService(
      client,
      engagementsMock() as never,
      {} as never,
    );
    await expect(service.releaseReservations('issued')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('composition never consults the plan (E59)', () => {
  it('takes no entitlements dependency', () => {
    // Constructor arity: supabase, engagements, policy. time_billable_invoices is checked at contract
    // create/sign only, so a downgraded workspace's signed hourly contract keeps composing.
    expect(InvoiceCompositionService.length).toBe(3);
  });
});

describe('assertNoInternalRates', () => {
  const line = (metadata: Record<string, unknown>): ComposedLine => ({
    source_type: 'time_log',
    source_log_id: null,
    description: 'Work',
    quantity: 1,
    unit_rate: 15,
    amount: 15,
    metadata,
    position: 0,
  });

  it('passes clean lines', () => {
    expect(() =>
      assertNoInternalRates([line({ grouped_by: 'period' })]),
    ).not.toThrow();
  });

  it.each([
    // What a member costs.
    'rate_snapshot',
    'member_user_id',
    'currency_snapshot',
    // How the revenue divides internally — margin, not price.
    'monthly_allocation',
    'allocation',
    'team_pool',
  ])('throws when a line carries %s', (key) => {
    expect(() => assertNoInternalRates([line({ [key]: 4 })])).toThrow(
      /member cost rates/,
    );
  });
});
