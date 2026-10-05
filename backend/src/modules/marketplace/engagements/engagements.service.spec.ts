import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementsService } from './engagements.service';

type Row = Record<string, unknown>;

/**
 * In-memory stand-in that actually applies `eq` and `in`. The scoping this
 * service relies on happens in the query, so a fake that ignored filters would
 * make every redaction assertion below vacuous.
 */
function makeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const from = jest.fn((table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      order: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  });
  return { from } as unknown as SupabaseClient;
}

const CLIENT = 'user-client';
const CONSULTANT = 'user-consultant';
const TALENT = 'user-talent';
const CLIENT_ENGAGEMENT = 'eng-client';
const TALENT_ENGAGEMENT = 'eng-talent';

/**
 * The canonical two-sided shape: a Client pays a Consultant on one engagement,
 * and that Consultant pays Talent on a separate one.
 */
function fixture(): Record<string, Row[]> {
  return {
    engagements: [
      {
        id: CLIENT_ENGAGEMENT,
        kind: 'client_services',
        scope_mode: 'project_specific',
        status: 'active',
        started_at: '2026-01-01T00:00:00Z',
      },
      {
        id: TALENT_ENGAGEMENT,
        kind: 'talent_services',
        scope_mode: 'flexible',
        status: 'active',
        started_at: '2026-02-01T00:00:00Z',
      },
    ],
    engagement_parties: [
      {
        engagement_id: CLIENT_ENGAGEMENT,
        position: 'hirer',
        user_id: CLIENT,
        capacity: 'client',
        display_name_snapshot: 'Client One',
        email_snapshot: 'client@example.invalid',
      },
      {
        engagement_id: CLIENT_ENGAGEMENT,
        position: 'provider',
        user_id: CONSULTANT,
        capacity: 'consultant',
        display_name_snapshot: 'Consultant One',
        email_snapshot: 'consultant@example.invalid',
      },
      {
        engagement_id: TALENT_ENGAGEMENT,
        position: 'hirer',
        user_id: CONSULTANT,
        capacity: 'consultant',
        display_name_snapshot: 'Consultant One',
        email_snapshot: 'consultant@example.invalid',
      },
      {
        engagement_id: TALENT_ENGAGEMENT,
        position: 'provider',
        user_id: TALENT,
        capacity: 'talent',
        display_name_snapshot: 'Talent One',
        email_snapshot: 'talent@example.invalid',
      },
    ],
    engagement_project_links: [
      {
        id: 'link-1',
        engagement_id: CLIENT_ENGAGEMENT,
        project_id: 'project-1',
        project_title_snapshot: 'Delivery project',
        basis: 'contract_scope',
        status: 'active',
        linked_at: '2026-01-01T00:00:00Z',
        ended_at: null,
      },
    ],
    engagement_time_settings: [
      {
        id: 'settings-current',
        engagement_id: CLIENT_ENGAGEMENT,
        tracking_mode: 'required',
        approval_mode: 'none',
        allow_manual_entries: true,
        rounding_minutes: 15,
        weekly_limit_minutes: null,
        client_hours_detail_level: 'summary',
        effective_from: '2026-01-01',
        effective_until: null,
      },
      {
        id: 'settings-superseded',
        engagement_id: CLIENT_ENGAGEMENT,
        tracking_mode: 'optional',
        approval_mode: 'none',
        allow_manual_entries: true,
        rounding_minutes: 0,
        weekly_limit_minutes: null,
        client_hours_detail_level: 'none',
        effective_from: '2025-01-01',
        effective_until: '2025-12-31',
      },
    ],
    engagement_time_rates: [
      {
        id: 'rate-billing',
        engagement_id: CLIENT_ENGAGEMENT,
        worker_user_id: null,
        rate_kind: 'billing',
        unit: 'hour',
        amount: 100,
        currency: 'USD',
        effective_from: '2026-01-01',
        effective_until: null,
      },
      {
        id: 'rate-billing-old',
        engagement_id: CLIENT_ENGAGEMENT,
        worker_user_id: null,
        rate_kind: 'billing',
        unit: 'hour',
        amount: 80,
        currency: 'USD',
        effective_from: '2025-01-01',
        effective_until: '2025-12-31',
      },
      {
        id: 'rate-cost',
        engagement_id: TALENT_ENGAGEMENT,
        worker_user_id: TALENT,
        rate_kind: 'cost',
        unit: 'hour',
        amount: 40,
        currency: 'USD',
        effective_from: '2026-02-01',
        effective_until: null,
      },
    ],
  };
}

function service(tables = fixture()) {
  return new EngagementsService(makeSupabase(tables));
}

describe('EngagementsService', () => {
  describe('party scoping keeps the two commercial sides apart', () => {
    it('never returns the Talent engagement, identity, or cost rate to the Client', async () => {
      const results = await service().list(CLIENT);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(CLIENT_ENGAGEMENT);

      const serialized = JSON.stringify(results);
      expect(serialized).not.toContain(TALENT_ENGAGEMENT);
      expect(serialized).not.toContain(TALENT);
      expect(serialized).not.toContain('Talent One');
      expect(serialized).not.toContain('cost');
      expect(
        results[0].current_rates.every((rate) => rate.rate_kind === 'billing'),
      ).toBe(true);
    });

    it('refuses a direct fetch of an engagement the caller is not a party to', async () => {
      await expect(
        service().getById(CLIENT, TALENT_ENGAGEMENT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns nothing at all for a user with no seat', async () => {
      expect(await service().list('user-stranger')).toEqual([]);
    });

    it('gives the Consultant both sides, since they hold a seat on each', async () => {
      const results = await service().list(CONSULTANT);

      expect(results.map((view) => view.id).sort()).toEqual(
        [CLIENT_ENGAGEMENT, TALENT_ENGAGEMENT].sort(),
      );
      const talent = results.find((view) => view.id === TALENT_ENGAGEMENT);
      expect(talent?.viewer_position).toBe('hirer');
      expect(talent?.counterparty?.user_id).toBe(TALENT);
    });
  });

  describe('composition', () => {
    it('reports the viewer seat and the opposite party as the counterparty', async () => {
      const [view] = await service().list(CLIENT);

      expect(view.viewer_position).toBe('hirer');
      expect(view.viewer_capacity).toBe('client');
      expect(view.counterparty?.user_id).toBe(CONSULTANT);
      expect(view.counterparty?.position).toBe('provider');
    });

    it('exposes only currently effective settings and rates', async () => {
      const [view] = await service().list(CLIENT);

      expect(view.current_settings?.id).toBe('settings-current');
      expect(view.current_rates.map((rate) => rate.id)).toEqual([
        'rate-billing',
      ]);
    });

    it('attaches project links', async () => {
      const [view] = await service().list(CLIENT);

      expect(view.project_links).toHaveLength(1);
      expect(view.project_links[0].project_id).toBe('project-1');
    });
  });

  describe('filters', () => {
    it('narrows by kind', async () => {
      const results = await service().list(CONSULTANT, {
        kind: 'talent_services',
      });

      expect(results.map((view) => view.id)).toEqual([TALENT_ENGAGEMENT]);
    });

    it('narrows by linked project', async () => {
      const results = await service().list(CONSULTANT, {
        project_id: 'project-1',
      });

      expect(results.map((view) => view.id)).toEqual([CLIENT_ENGAGEMENT]);
    });

    it('returns an empty list when the project matches no engagement', async () => {
      expect(
        await service().list(CONSULTANT, { project_id: 'project-absent' }),
      ).toEqual([]);
    });
  });
});

// ── Time-composition reads (PR-1, P05) ──────────────────────────────────────

type Cell = string | number | boolean | null;
type QueryRow = Record<string, Cell>;
type RowFilter = (row: QueryRow) => boolean;

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/** Instants compare as instants ('…00Z' and '…00.000Z' are equal); the rest as text. */
function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    TIMESTAMP.test(a) &&
    TIMESTAMP.test(b)
  ) {
    return Date.parse(a) - Date.parse(b);
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** One PostgREST `or()` term: `column.op.value` (the value may contain dots). */
function orTerm(term: string): RowFilter {
  const first = term.indexOf('.');
  const second = term.indexOf('.', first + 1);
  const column = term.slice(0, first);
  const op = term.slice(first + 1, second);
  const value = term.slice(second + 1);
  return (row) => {
    const cell = row[column];
    if (op === 'is') {
      if (value !== 'null') throw new Error(`fake: unsupported is.${value}`);
      return cell === null || cell === undefined;
    }
    if (cell === null || cell === undefined) return false;
    const order = compareCells(cell, value);
    if (op === 'eq') return order === 0;
    if (op === 'gt') return order > 0;
    if (op === 'gte') return order >= 0;
    if (op === 'lt') return order < 0;
    if (op === 'lte') return order <= 0;
    throw new Error(`fake: unsupported or() operator ${op}`);
  };
}

/**
 * A fuller in-memory PostgREST stand-in for the time reads: it applies `eq`,
 * `in`, `lte`, `or`, multi-key `order` and `limit`, and `maybeSingle` fails on
 * more than one row like the real thing. `failTable` makes every read of one
 * table return a Postgres error.
 */
function makeQueryable(
  tables: Record<string, QueryRow[]>,
  o: { failTable?: string } = {},
) {
  const tablesRead: string[] = [];
  const from = (table: string) => {
    tablesRead.push(table);
    const filters: RowFilter[] = [];
    const sorts: Array<{ column: string; ascending: boolean }> = [];
    let limit: number | null = null;
    const run = (): {
      data: QueryRow[] | null;
      error: { message: string } | null;
    } => {
      if (o.failTable === table) {
        return {
          data: null,
          error: { message: `permission denied for table ${table}` },
        };
      }
      let rows = (tables[table] ?? []).filter((row) =>
        filters.every((filter) => filter(row)),
      );
      if (sorts.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const sort of sorts) {
            const order = compareCells(a[sort.column], b[sort.column]);
            if (order !== 0) return sort.ascending ? order : -order;
          }
          return 0;
        });
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: Cell) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: Cell[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      lte: (column: string, value: Cell) => {
        filters.push(
          (row) =>
            row[column] !== null &&
            row[column] !== undefined &&
            compareCells(row[column], value) <= 0,
        );
        return builder;
      },
      or: (expression: string) => {
        const terms = expression.split(',').map(orTerm);
        filters.push((row) => terms.some((term) => term(row)));
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        sorts.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      limit: (count: number) => {
        limit = count;
        return builder;
      },
      maybeSingle: () => {
        const result = run();
        if (result.error) return Promise.resolve(result);
        const rows = result.data ?? [];
        if (rows.length > 1) {
          return Promise.resolve({
            data: null,
            error: { message: 'JSON object requested, multiple rows returned' },
          });
        }
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then: (
        resolve: (value: ReturnType<typeof run>) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, tablesRead };
}

const WORKER = 'user-worker';
const PROJECT = 'project-time';
const OTHER_PROJECT = 'project-other';
const TALENT_ENG = 'eng-talent-t';
const CLIENT_ENG = 'eng-client-c';
const CLIENT_ENG_ENDED = 'eng-client-ended';

function assignment(row: QueryRow & { id: string }): QueryRow {
  const startedAt = row.started_at ?? '2026-01-01T00:00:00Z';
  return {
    project_id: PROJECT,
    worker_user_id: WORKER,
    talent_engagement_id: null,
    client_engagement_id: null,
    team_id: null,
    role_title: null,
    status: 'active',
    started_at: startedAt,
    ended_at: null,
    created_at: startedAt,
    ...row,
  };
}

function settings(row: QueryRow & { id: string }): QueryRow {
  return {
    source_contract_id: 'contract-v1',
    tracking_mode: 'optional',
    approval_mode: 'provider_submit_hirer_approve',
    allow_manual_entries: true,
    rounding_minutes: 0,
    weekly_limit_minutes: null,
    client_hours_detail_level: 'none',
    effective_until: null,
    ...row,
  };
}

function rateRow(row: QueryRow & { id: string }): QueryRow {
  return {
    source_contract_id: 'contract-v1',
    worker_user_id: null,
    rate_kind: 'cost',
    unit: 'hour',
    work_type: null,
    amount: 40,
    currency: 'USD',
    effective_from: '2026-03-01',
    effective_until: null,
    ...row,
  };
}

/**
 * A consultant hires the worker on a talent engagement and delivers to a
 * client on a client engagement; an older client engagement has ended.
 */
function timeFixture(): Record<string, QueryRow[]> {
  return {
    engagements: [
      {
        id: TALENT_ENG,
        kind: 'talent_services',
        status: 'active',
        activated_by_contract_id: 'contract-talent',
        created_at: '2026-03-01T00:00:00Z',
      },
      {
        id: CLIENT_ENG,
        kind: 'client_services',
        status: 'active',
        activated_by_contract_id: 'contract-client',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: CLIENT_ENG_ENDED,
        kind: 'client_services',
        status: 'ended',
        activated_by_contract_id: null,
        created_at: '2025-06-01T00:00:00Z',
      },
    ],
    engagement_parties: [
      {
        engagement_id: TALENT_ENG,
        position: 'hirer',
        user_id: CONSULTANT,
        display_name_snapshot: 'Consultant One',
        team_id: 'team-consultant',
      },
      {
        engagement_id: TALENT_ENG,
        position: 'provider',
        user_id: WORKER,
        display_name_snapshot: 'Worker One',
        team_id: null,
      },
      {
        engagement_id: CLIENT_ENG,
        position: 'hirer',
        user_id: CLIENT,
        display_name_snapshot: 'Client One',
        team_id: 'team-client',
      },
      {
        engagement_id: CLIENT_ENG,
        position: 'provider',
        user_id: CONSULTANT,
        display_name_snapshot: 'Consultant One',
        team_id: 'team-consultant',
      },
      {
        engagement_id: CLIENT_ENG_ENDED,
        position: 'hirer',
        user_id: CLIENT,
        display_name_snapshot: 'Client One (2025)',
        team_id: null,
      },
      {
        engagement_id: CLIENT_ENG_ENDED,
        position: 'provider',
        user_id: WORKER,
        display_name_snapshot: 'Worker One',
        team_id: null,
      },
    ],
    engagement_assignments: [
      assignment({
        id: 'asg-b',
        started_at: '2026-03-01T00:00:00Z',
        talent_engagement_id: TALENT_ENG,
        client_engagement_id: CLIENT_ENG,
        team_id: 'team-consultant',
        role_title: 'Designer',
      }),
      assignment({
        id: 'asg-a',
        started_at: '2026-03-01T00:00:00Z',
        client_engagement_id: CLIENT_ENG_ENDED,
      }),
      assignment({
        id: 'asg-ended',
        status: 'ended',
        started_at: '2026-01-01T00:00:00Z',
        ended_at: '2026-02-15T12:00:00Z',
        client_engagement_id: CLIENT_ENG,
      }),
      assignment({
        id: 'asg-cancelled',
        status: 'cancelled',
        started_at: '2026-01-01T00:00:00Z',
        ended_at: '2026-12-31T00:00:00Z',
        client_engagement_id: CLIENT_ENG,
      }),
      assignment({
        id: 'asg-future',
        started_at: '2026-05-01T00:00:00Z',
        client_engagement_id: CLIENT_ENG,
      }),
      assignment({
        id: 'asg-other-project',
        project_id: OTHER_PROJECT,
        started_at: '2026-01-01T00:00:00Z',
        client_engagement_id: CLIENT_ENG,
      }),
      assignment({
        id: 'asg-other-worker',
        worker_user_id: 'user-someone',
        started_at: '2026-01-01T00:00:00Z',
        client_engagement_id: CLIENT_ENG,
      }),
      assignment({
        id: 'asg-severed',
        project_id: null,
        status: 'ended',
        started_at: '2025-01-01T00:00:00Z',
        ended_at: '2025-02-01T00:00:00Z',
        talent_engagement_id: TALENT_ENG,
      }),
    ],
    engagement_time_settings: [
      // A June amendment closes v1 the day before it starts.
      settings({
        id: 'set-v1',
        engagement_id: TALENT_ENG,
        effective_from: '2026-03-01',
        effective_until: '2026-05-31',
      }),
      settings({
        id: 'set-v2',
        engagement_id: TALENT_ENG,
        source_contract_id: 'contract-v2',
        rounding_minutes: 15,
        effective_from: '2026-06-01',
      }),
      settings({
        id: 'set-client',
        engagement_id: CLIENT_ENG,
        client_hours_detail_level: 'summary',
        effective_from: '2026-01-01',
      }),
      // Two open-ended rows overlap: the newer one wins once it starts.
      settings({
        id: 'set-open-old',
        engagement_id: CLIENT_ENG_ENDED,
        effective_from: '2025-06-01',
      }),
      settings({
        id: 'set-open-new',
        engagement_id: CLIENT_ENG_ENDED,
        effective_from: '2026-04-01',
      }),
    ],
    engagement_time_rates: [
      rateRow({
        id: 'rate-cost-worker',
        engagement_id: TALENT_ENG,
        worker_user_id: WORKER,
      }),
      rateRow({ id: 'rate-cost-generic', engagement_id: TALENT_ENG }),
      rateRow({
        id: 'rate-cost-other-worker',
        engagement_id: TALENT_ENG,
        worker_user_id: 'user-someone',
      }),
      rateRow({
        id: 'rate-billing-client',
        engagement_id: CLIENT_ENG,
        rate_kind: 'billing',
        amount: 100,
      }),
    ],
    engagement_project_links: [
      {
        id: 'link-active',
        engagement_id: CLIENT_ENG,
        project_id: PROJECT,
        status: 'active',
      },
      {
        id: 'link-ended',
        engagement_id: CLIENT_ENG,
        project_id: OTHER_PROJECT,
        status: 'ended',
      },
    ],
    contracts: [
      {
        id: 'contract-client',
        workspace_id: 'ws-client',
        engagement_id: CLIENT_ENG,
      },
      {
        id: 'contract-client-amendment',
        workspace_id: 'ws-client',
        engagement_id: CLIENT_ENG,
      },
      // A root whose engagement_id stamp is missing: found by activation.
      { id: 'contract-talent', workspace_id: null, engagement_id: null },
      { id: 'contract-legacy', workspace_id: null, engagement_id: null },
    ],
  };
}

function timeService(tables = timeFixture(), o: { failTable?: string } = {}) {
  const fake = makeQueryable(tables, o);
  return { service: new EngagementsService(fake.client), fake };
}

describe('EngagementsService time-composition reads', () => {
  describe('listActiveAssignmentsForWorker', () => {
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

    it('returns active assignments that have started, ordered by started_at then id', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
      );
      // Not: ended, cancelled, not yet started, another project, another worker.
      expect(ids(rows)).toEqual(['asg-a', 'asg-b']);
    });

    it('counts started_at itself as inside the window', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-03-01T00:00:00Z'),
      );
      expect(ids(rows)).toEqual(['asg-a', 'asg-b']);
    });

    it('ignores an ended assignment by default, even inside its window', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-02-10T00:00:00Z'),
      );
      expect(rows).toEqual([]);
    });

    it('with includeEndedWindow, accepts an ended assignment whose window holds `at`', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-02-10T00:00:00Z'),
        { includeEndedWindow: true },
      );
      // The cancelled assignment's window also holds `at`; it never counts.
      expect(ids(rows)).toEqual(['asg-ended']);
    });

    it('treats ended_at as outside the window (half-open)', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-02-15T12:00:00Z'),
        { includeEndedWindow: true },
      );
      expect(rows).toEqual([]);
    });

    it('with includeEndedWindow, still drops an ended assignment whose window is over', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
        { includeEndedWindow: true },
      );
      expect(ids(rows)).toEqual(['asg-a', 'asg-b']);
    });

    it('resolves the governing engagement: talent first, else client', async () => {
      const { service } = timeService();
      const [clientOnly, talent] = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
      );

      expect(talent).toEqual({
        id: 'asg-b',
        project_id: PROJECT,
        worker_user_id: WORKER,
        talent_engagement_id: TALENT_ENG,
        client_engagement_id: CLIENT_ENG,
        governing_engagement_id: TALENT_ENG,
        governing_kind: 'talent_services',
        governing_status: 'active',
        team_id: 'team-consultant',
        role_title: 'Designer',
        status: 'active',
        started_at: '2026-03-01T00:00:00Z',
        ended_at: null,
        created_at: '2026-03-01T00:00:00Z',
        hirer_label: 'Consultant One',
      });
      expect(clientOnly).toMatchObject({
        id: 'asg-a',
        governing_engagement_id: CLIENT_ENG_ENDED,
        governing_kind: 'client_services',
        hirer_label: 'Client One (2025)',
      });
    });

    it('reports an inactive governing engagement instead of filtering it out', async () => {
      const { service } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
      );
      expect(rows.find((row) => row.id === 'asg-a')?.governing_status).toBe(
        'ended',
      );
    });

    it('falls back to "Unknown" when the governing hirer seat is missing', async () => {
      const tables = timeFixture();
      tables.engagement_parties = tables.engagement_parties.filter(
        (row) =>
          !(row.engagement_id === TALENT_ENG && row.position === 'hirer'),
      );
      const { service } = timeService(tables);
      const rows = await service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
      );
      expect(rows.find((row) => row.id === 'asg-b')?.hirer_label).toBe(
        'Unknown',
      );
    });

    it('reads no engagement rows when the worker has no assignment', async () => {
      const { service, fake } = timeService();
      const rows = await service.listActiveAssignmentsForWorker(
        'user-stranger',
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
      );
      expect(rows).toEqual([]);
      expect(fake.tablesRead).toEqual(['engagement_assignments']);
    });
  });

  describe('getAssignment and assignmentsForProject', () => {
    it('returns one assignment with its governing engagement', async () => {
      const { service } = timeService();
      const row = await service.getAssignment('asg-ended');
      expect(row).toMatchObject({
        id: 'asg-ended',
        status: 'ended',
        ended_at: '2026-02-15T12:00:00Z',
        governing_engagement_id: CLIENT_ENG,
        governing_kind: 'client_services',
        hirer_label: 'Client One',
      });
    });

    it('returns a severed assignment with a null project', async () => {
      const { service } = timeService();
      const row = await service.getAssignment('asg-severed');
      expect(row?.project_id).toBeNull();
      expect(row?.governing_engagement_id).toBe(TALENT_ENG);
    });

    it('returns null for an unknown assignment', async () => {
      const { service } = timeService();
      expect(await service.getAssignment('asg-missing')).toBeNull();
    });

    it('lists every assignment on the project, whatever its status or worker', async () => {
      const { service } = timeService();
      const rows = await service.assignmentsForProject(PROJECT);
      expect(rows.map((row) => row.id)).toEqual([
        'asg-cancelled',
        'asg-ended',
        'asg-other-worker',
        'asg-a',
        'asg-b',
        'asg-future',
      ]);
    });
  });

  describe('engagement and party lookups', () => {
    it('reads the engagement kind', async () => {
      const { service } = timeService();
      expect(await service.engagementKind(TALENT_ENG)).toBe('talent_services');
      expect(await service.engagementKind(CLIENT_ENG)).toBe('client_services');
      expect(await service.engagementKind('eng-missing')).toBeNull();
    });

    it('reads the hirer and provider seats', async () => {
      const { service } = timeService();
      expect(await service.hirerUserIdForEngagement(TALENT_ENG)).toBe(
        CONSULTANT,
      );
      expect(await service.providerUserIdForEngagement(TALENT_ENG)).toBe(
        WORKER,
      );
      expect(await service.hirerUserIdForEngagement('eng-missing')).toBeNull();
    });

    it('reads the team each seat signed for', async () => {
      const { service } = timeService();
      expect(await service.hirerPartyTeamId(TALENT_ENG)).toBe(
        'team-consultant',
      );
      expect(await service.providerPartyTeamId(TALENT_ENG)).toBeNull();
      expect(await service.providerPartyTeamId(CLIENT_ENG)).toBe(
        'team-consultant',
      );
      expect(await service.hirerPartyTeamId('eng-missing')).toBeNull();
    });

    it('reports the seat a user holds, or null', async () => {
      const { service } = timeService();
      expect(await service.isParty(TALENT_ENG, CONSULTANT)).toBe('hirer');
      expect(await service.isParty(TALENT_ENG, WORKER)).toBe('provider');
      // The client is a party to the client engagement, never the talent one.
      expect(await service.isParty(TALENT_ENG, CLIENT)).toBeNull();
    });

    it('finds the active project link only', async () => {
      const { service } = timeService();
      expect(await service.isLinkedToProject(CLIENT_ENG, PROJECT)).toBe(true);
      expect(await service.isLinkedToProject(CLIENT_ENG, OTHER_PROJECT)).toBe(
        false,
      );
      expect(await service.isLinkedToProject(TALENT_ENG, PROJECT)).toBe(false);
    });

    it('lists every assignment billed through a client engagement', async () => {
      const { service } = timeService();
      expect(
        await service.assignmentIdsForClientEngagement(CLIENT_ENG),
      ).toEqual([
        'asg-cancelled',
        'asg-ended',
        'asg-other-project',
        'asg-other-worker',
        'asg-b',
        'asg-future',
      ]);
      expect(
        await service.assignmentIdsForClientEngagement(TALENT_ENG),
      ).toEqual([]);
    });
  });

  describe('engagementForContract', () => {
    it('follows contracts.engagement_id, amendments included', async () => {
      const { service } = timeService();
      expect(await service.engagementForContract('contract-client')).toEqual({
        id: CLIENT_ENG,
        kind: 'client_services',
        status: 'active',
      });
      expect(
        await service.engagementForContract('contract-client-amendment'),
      ).toEqual({ id: CLIENT_ENG, kind: 'client_services', status: 'active' });
    });

    it('falls back to the engagement the contract activated', async () => {
      const { service } = timeService();
      expect(await service.engagementForContract('contract-talent')).toEqual({
        id: TALENT_ENG,
        kind: 'talent_services',
        status: 'active',
      });
    });

    it('returns null for a legacy or unknown contract', async () => {
      const { service } = timeService();
      expect(await service.engagementForContract('contract-legacy')).toBeNull();
      expect(
        await service.engagementForContract('contract-missing'),
      ).toBeNull();
    });
  });

  describe('settingsInForceOn', () => {
    it.each([
      ['2026-03-01', 'set-v1'],
      ['2026-05-31', 'set-v1'],
      ['2026-06-01', 'set-v2'],
      ['2026-12-31', 'set-v2'],
    ])('across the June amendment, %s is %s', async (day, id) => {
      const { service } = timeService();
      const row = await service.settingsInForceOn(TALENT_ENG, day);
      expect(row?.id).toBe(id);
      expect(row?.engagement_id).toBe(TALENT_ENG);
    });

    it('has nothing in force before the agreement starts', async () => {
      const { service } = timeService();
      expect(
        await service.settingsInForceOn(TALENT_ENG, '2026-02-28'),
      ).toBeNull();
    });

    it('picks the newest effective_from when open rows overlap', async () => {
      const { service } = timeService();
      expect(
        (await service.settingsInForceOn(CLIENT_ENG_ENDED, '2026-03-31'))?.id,
      ).toBe('set-open-old');
      expect(
        (await service.settingsInForceOn(CLIENT_ENG_ENDED, '2026-05-01'))?.id,
      ).toBe('set-open-new');
    });

    it("never returns another engagement's row", async () => {
      const { service } = timeService();
      expect(
        (await service.settingsInForceOn(CLIENT_ENG, '2026-04-01'))?.id,
      ).toBe('set-client');
    });
  });

  describe('ratesFor', () => {
    const sortedIds = (rows: Array<{ id: string }>) =>
      rows.map((row) => row.id).sort();

    it('narrows to one rate kind', async () => {
      const { service } = timeService();
      expect(
        sortedIds(await service.ratesFor(CLIENT_ENG, { rateKind: 'billing' })),
      ).toEqual(['rate-billing-client']);
      expect(await service.ratesFor(CLIENT_ENG, { rateKind: 'cost' })).toEqual(
        [],
      );
    });

    it("with a worker, keeps that worker's rows and rows with no worker", async () => {
      const { service } = timeService();
      expect(
        sortedIds(
          await service.ratesFor(TALENT_ENG, {
            rateKind: 'cost',
            workerId: WORKER,
          }),
        ),
      ).toEqual(['rate-cost-generic', 'rate-cost-worker']);
    });

    it('without a worker, returns every row of the kind', async () => {
      const { service } = timeService();
      expect(
        sortedIds(await service.ratesFor(TALENT_ENG, { rateKind: 'cost' })),
      ).toEqual([
        'rate-cost-generic',
        'rate-cost-other-worker',
        'rate-cost-worker',
      ]);
    });
  });

  describe('policyWorkspaceFor (mirrors time_sheet_scope_for)', () => {
    const hirer = (engagementId: string, teamId: string | null): QueryRow => ({
      engagement_id: engagementId,
      position: 'hirer',
      user_id: 'user-hirer',
      team_id: teamId,
    });
    const provider = (
      engagementId: string,
      teamId: string | null,
    ): QueryRow => ({
      engagement_id: engagementId,
      position: 'provider',
      user_id: 'user-provider',
      team_id: teamId,
    });

    function policyFixture(): Record<string, QueryRow[]> {
      return {
        engagements: [
          { id: 'eng-contract-ws', activated_by_contract_id: 'k-ws' },
          { id: 'eng-contract-no-ws', activated_by_contract_id: 'k-no-ws' },
          { id: 'eng-legacy', activated_by_contract_id: null },
          { id: 'eng-no-hirer-team', activated_by_contract_id: 'k-no-ws' },
          { id: 'eng-team-no-ws', activated_by_contract_id: null },
          { id: 'eng-deleted-team', activated_by_contract_id: null },
        ],
        contracts: [
          { id: 'k-ws', workspace_id: 'ws-contract' },
          { id: 'k-no-ws', workspace_id: null },
        ],
        engagement_parties: [
          hirer('eng-contract-ws', 'team-hirer'),
          provider('eng-contract-ws', 'team-provider'),
          hirer('eng-contract-no-ws', 'team-hirer'),
          hirer('eng-legacy', 'team-hirer'),
          hirer('eng-no-hirer-team', null),
          provider('eng-no-hirer-team', 'team-provider'),
          hirer('eng-team-no-ws', 'team-personal'),
          hirer('eng-deleted-team', 'team-gone'),
        ],
        teams: [
          { id: 'team-hirer', workspace_id: 'ws-hirer-team' },
          { id: 'team-provider', workspace_id: 'ws-provider-team' },
          { id: 'team-personal', workspace_id: null },
        ],
      };
    }

    it.each<[string, string, string | null]>([
      [
        'the activating contract workspace wins',
        'eng-contract-ws',
        'ws-contract',
      ],
      [
        'a contract without a workspace falls back to the hirer team',
        'eng-contract-no-ws',
        'ws-hirer-team',
      ],
      [
        'a legacy engagement uses the hirer team',
        'eng-legacy',
        'ws-hirer-team',
      ],
      [
        'no hirer team is null, never the provider team',
        'eng-no-hirer-team',
        null,
      ],
      ['a hirer team outside any workspace is null', 'eng-team-no-ws', null],
      ['a hirer team row that is gone is null', 'eng-deleted-team', null],
      ['an unknown engagement is null', 'eng-missing', null],
    ])('%s', async (_label, engagementId, expected) => {
      const { service } = timeService(policyFixture());
      expect(await service.policyWorkspaceFor(engagementId)).toBe(expected);
    });
  });

  describe('database errors', () => {
    let logSpy: jest.SpyInstance;
    beforeEach(() => {
      logSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });
    afterEach(() => logSpy.mockRestore());

    it('answers a plain 500 that carries no Postgres text', async () => {
      const { service } = timeService(timeFixture(), {
        failTable: 'engagement_assignments',
      });
      const attempt = service.listActiveAssignmentsForWorker(
        WORKER,
        PROJECT,
        new Date('2026-04-10T00:00:00Z'),
      );
      await expect(attempt).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await expect(attempt).rejects.not.toThrow(/permission denied/);
    });

    it('fails the governing lookup and the seat lookup the same way', async () => {
      const { service } = timeService(timeFixture(), {
        failTable: 'engagement_parties',
      });
      await expect(service.getAssignment('asg-b')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await expect(service.isParty(TALENT_ENG, WORKER)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('fails the settings read the same way', async () => {
      const { service } = timeService(timeFixture(), {
        failTable: 'engagement_time_settings',
      });
      await expect(
        service.settingsInForceOn(TALENT_ENG, '2026-06-01'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
