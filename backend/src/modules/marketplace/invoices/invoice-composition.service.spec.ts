import { SupabaseClient } from '@supabase/supabase-js';
import type { ContractRow } from '../contracts/contracts.service';
import {
  assertNoInternalRates,
  ComposedLine,
  InvoiceCompositionService,
} from './invoice-composition.service';

interface FakeLog {
  id: string;
  started_at: string;
  duration_seconds: number;
  break_minutes: number;
  status: string;
  work_type_snapshot: string;
  task: { title: string | null } | null;
  /** Internal cost rate — present on the row, must never reach a line. */
  rate_snapshot: number;
}

/**
 * Minimal stand-in for the supabase query builder. Mocked at the system
 * boundary only (the HTTP client), per backend/CLAUDE.md — the filtering the
 * service relies on is replayed here so the assertions stay meaningful.
 */
function fakeSupabase(rows: FakeLog[]): SupabaseClient {
  const state = { rows: [...rows] };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  builder.select = chain;
  builder.order = () =>
    Promise.resolve({
      data: state.rows,
      error: null,
    }) as unknown as typeof builder;
  builder.eq = (column: string, value: unknown) => {
    if (column === 'work_type_snapshot') {
      state.rows = state.rows.filter((r) => r.work_type_snapshot === value);
    }
    return builder;
  };
  builder.in = (column: string, values: string[]) => {
    if (column === 'status') {
      state.rows = state.rows.filter((r) => values.includes(r.status));
    }
    return builder;
  };
  builder.gte = (_c: string, value: string) => {
    state.rows = state.rows.filter((r) => r.started_at >= value);
    return builder;
  };
  builder.lte = (_c: string, value: string) => {
    state.rows = state.rows.filter((r) => r.started_at <= value);
    return builder;
  };

  return { from: () => builder } as unknown as SupabaseClient;
}

const BASE_CONTRACT: ContractRow = {
  id: 'contract-1',
  project_id: 'project-1',
  project_title_snapshot: 'Project One',
  consultant_user_id: 'consultant-1',
  version: 1,
  contract_number: 'BS2026-001',
  status: 'active',
  provider_kind: 'agency',
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
  created_by: null,
  created_at: '2026-07-24T00:00:00.000Z',
  updated_at: '2026-07-24T00:00:00.000Z',
};

// 25.75 hours across two tasks, mirroring the real FILRO invoice.
const LOGS: FakeLog[] = [
  {
    id: 'log-1',
    started_at: '2026-08-03T09:00:00.000Z',
    duration_seconds: 20 * 3600,
    break_minutes: 0,
    status: 'approved',
    work_type_snapshot: 'real_work',
    task: { title: 'Campaign setup' },
    rate_snapshot: 4,
  },
  {
    id: 'log-2',
    started_at: '2026-08-10T09:00:00.000Z',
    duration_seconds: 5.75 * 3600,
    break_minutes: 0,
    status: 'paid',
    work_type_snapshot: 'real_work',
    task: { title: 'Content calendar' },
    rate_snapshot: 4,
  },
  {
    id: 'log-3',
    started_at: '2026-08-11T09:00:00.000Z',
    duration_seconds: 8 * 3600,
    break_minutes: 0,
    status: 'pending',
    work_type_snapshot: 'real_work',
    task: { title: 'Not approved yet' },
    rate_snapshot: 4,
  },
  {
    id: 'log-4',
    started_at: '2026-08-12T09:00:00.000Z',
    duration_seconds: 4 * 3600,
    break_minutes: 0,
    status: 'approved',
    work_type_snapshot: 'training',
    task: { title: 'Onboarding training' },
    rate_snapshot: 2,
  },
  {
    id: 'log-5',
    started_at: '2026-08-20T09:00:00.000Z',
    duration_seconds: 6 * 3600,
    break_minutes: 0,
    status: 'approved',
    work_type_snapshot: 'real_work',
    task: { title: 'Next period work' },
    rate_snapshot: 4,
  },
];

function service(rows: FakeLog[] = LOGS): InvoiceCompositionService {
  return new InvoiceCompositionService(fakeSupabase(rows));
}

describe('getBillableHours', () => {
  it('counts only approved/paid real work inside the period', async () => {
    const hours = await service().getBillableHours(
      'project-1',
      '2026-08-01',
      '2026-08-15',
    );
    // 20 + 5.75 approved/paid real work. Pending, training, and the Aug 20 log
    // are all excluded.
    expect(hours.totalHours).toBe(25.75);
    expect(hours.byTask.map((t) => t.task)).toEqual([
      'Campaign setup',
      'Content calendar',
    ]);
    expect(hours.byDay).toEqual([
      { day: '2026-08-03', hours: 20 },
      { day: '2026-08-10', hours: 5.75 },
    ]);
  });

  it('returns zero when nothing is billable', async () => {
    const hours = await service([]).getBillableHours(
      'project-1',
      '2026-08-01',
      '2026-08-15',
    );
    expect(hours).toEqual({ totalHours: 0, byDay: [], byTask: [] });
  });

  // The writer has already reduced an 8-hour span with a 60-minute break to
  // seven net hours. The rounded break mirror must not be deducted again.
  it('does not subtract breaks twice from net duration', async () => {
    const hours = await service([
      {
        id: 'log-break',
        started_at: '2026-08-04T09:00:00.000Z',
        duration_seconds: 7 * 3600,
        break_minutes: 60,
        status: 'approved',
        work_type_snapshot: 'real_work',
        task: { title: 'Long session' },
        rate_snapshot: 4,
      },
    ]).getBillableHours('project-1', '2026-08-01', '2026-08-15');

    expect(hours.totalHours).toBe(7);
    expect(hours.byDay).toEqual([{ day: '2026-08-04', hours: 7 }]);
    expect(hours.byTask).toEqual([{ task: 'Long session', hours: 7 }]);
  });

  // Monetary calculations use the exact net seconds, not the rounded display
  // mirror, even when legacy/bad data leaves that mirror inconsistent.
  it('ignores an inconsistent break_minutes mirror', async () => {
    const hours = await service([
      {
        id: 'log-overbreak',
        started_at: '2026-08-04T09:00:00.000Z',
        duration_seconds: 30 * 60,
        break_minutes: 120,
        status: 'approved',
        work_type_snapshot: 'real_work',
        task: { title: 'Mostly break' },
        rate_snapshot: 4,
      },
    ]).getBillableHours('project-1', '2026-08-01', '2026-08-15');

    expect(hours.totalHours).toBe(0.5);
    expect(hours.byDay).toEqual([{ day: '2026-08-04', hours: 0.5 }]);
  });
});

describe('composeForContract — time_based', () => {
  it('prices hours at the CLIENT rate, not the member cost rate', async () => {
    const { lines } = await service().composeForContract(
      BASE_CONTRACT,
      '2026-08-01',
      '2026-08-15',
      'summary',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(25.75);
    // 15 is the contract's client_hourly_rate; 4 is the member's rate_snapshot.
    expect(lines[0].unit_rate).toBe(15);
    expect(lines[0].amount).toBe(386.25);
    expect(lines[0].source_type).toBe('time_log');
  });

  it('collapses to a single summary line', async () => {
    const { lines } = await service().composeForContract(
      BASE_CONTRACT,
      '2026-08-01',
      '2026-08-15',
      'summary',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe(
      'Digital marketing services (2026-08-01 to 2026-08-15)',
    );
  });

  it('groups a detailed invoice by task and never by member', async () => {
    const { lines } = await service().composeForContract(
      BASE_CONTRACT,
      '2026-08-01',
      '2026-08-15',
      'detailed',
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.quantity)).toEqual([20, 5.75]);
    expect(lines.every((l) => l.unit_rate === 15)).toBe(true);
    // Total is unchanged by the disclosure level.
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(386.25);

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('member');
    expect(serialized).not.toContain('rate_snapshot');
  });

  it('omits the period from the description when hours are hidden', async () => {
    const { lines } = await service().composeForContract(
      BASE_CONTRACT,
      '2026-08-01',
      '2026-08-15',
      'none',
    );
    expect(lines[0].description).toBe('Digital marketing services');
  });
});

describe('composeForContract — retainer', () => {
  const retainer: ContractRow = {
    ...BASE_CONTRACT,
    billing_mode: 'retainer',
    recurring_fee: 15000,
    client_hourly_rate: null,
  };

  it('bills a flat fee regardless of hours logged', async () => {
    const { lines, hours } = await service().composeForContract(
      retainer,
      '2026-08-01',
      '2026-08-15',
      'summary',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].source_type).toBe('retainer');
    expect(lines[0].quantity).toBe(1);
    expect(lines[0].amount).toBe(15000);
    // Hours are still computed — they drive internal cost and margin, they just
    // do not change what the client owes.
    expect(hours.totalHours).toBe(25.75);
  });
});

describe('composeForContract — hybrid', () => {
  const hybrid: ContractRow = {
    ...BASE_CONTRACT,
    billing_mode: 'hybrid',
    recurring_fee: 1000,
    client_hourly_rate: 15,
    included_hours: 20,
  };

  it('adds an overage line for hours beyond the included allowance', async () => {
    const { lines } = await service().composeForContract(
      hybrid,
      '2026-08-01',
      '2026-08-15',
      'summary',
    );
    expect(lines.map((l) => l.source_type)).toEqual(['retainer', 'overage']);
    expect(lines[1].quantity).toBe(5.75);
    expect(lines[1].amount).toBe(86.25);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(1086.25);
  });

  it('omits the overage line when hours are within the allowance', async () => {
    const { lines } = await service().composeForContract(
      { ...hybrid, included_hours: 40 },
      '2026-08-01',
      '2026-08-15',
      'summary',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].source_type).toBe('retainer');
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
