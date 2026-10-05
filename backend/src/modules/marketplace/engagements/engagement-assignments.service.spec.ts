import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import {
  type ProjectRole,
  resolvePermissions,
} from '../../execution/projects/permissions/project-permissions';
import { TimeCacheService } from '../../execution/time/time-cache';
import { TimeNotificationsService } from '../../execution/time/time-notifications.service';
import { TimePolicyService } from '../../execution/time/time-policy.service';
import { AuditService } from '../../shared/audit/audit.service';
import {
  EngagementAssignmentsService,
  MASKED_WORKER_LABEL,
  mapAssignmentDbError,
} from './engagement-assignments.service';
import { EngagementsService } from './engagements.service';

// ── An in-memory PostgREST stand-in ─────────────────────────────────────────
// Applies eq / neq / is / in / not-is-null, multi-key order, limit, single and
// maybeSingle, insert / update with `.select()` returning rows. Writes are
// recorded; a failure can be injected per (table, op); `afterUpdate` plays the
// part of a trigger.

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update';
interface PgError {
  code?: string;
  message: string;
  details?: string | null;
}
interface Write {
  table: string;
  op: Op;
  payload: unknown;
  rows: Row[];
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: Write[] = [];
  failures: Array<{ table: string; op: Op; error: PgError }> = [];
  afterUpdate?: (table: string, rows: Row[]) => void;
  rpcResults: Record<string, (args: Row) => unknown> = {};
  private seq = 0;

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  nextId(table: string): string {
    this.seq += 1;
    return `${table}-${this.seq}`;
  }

  takeFailure(table: string, op: Op): PgError | null {
    const index = this.failures.findIndex(
      (f) => f.table === table && f.op === op,
    );
    if (index < 0) return null;
    return this.failures.splice(index, 1)[0].error;
  }

  writesTo(table: string, op?: Op): Write[] {
    return this.writes.filter(
      (w) => w.table === table && (op === undefined || w.op === op),
    );
  }

  client(): SupabaseClient {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: jest.fn((name: string, args: Row) =>
        Promise.resolve({
          data: this.rpcResults[name]?.(args) ?? null,
          error: null,
        }),
      ),
    } as unknown as SupabaseClient;
  }
}

/** Column defaults the real tables apply on insert. */
const COLUMN_DEFAULTS: Record<string, Row> = {
  engagement_project_links: { status: 'active' },
};

function sortKey(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private op: Op = 'select';
  private payload: unknown = null;
  private returning = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(): this {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(payload: unknown): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: unknown): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  not(column: string, operator: string, value: unknown): this {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => (row[column] ?? null) !== null);
    }
    return this;
  }
  order(column: string, o: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: o.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: PgError | null }> {
    return this.run().then(({ data, error }) => {
      if (error) return { data: null, error };
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length > 1) {
        return { data: null, error: { message: 'multiple rows' } };
      }
      return { data: rows[0] ?? null, error: null };
    });
  }

  single(): Promise<{ data: unknown; error: PgError | null }> {
    return this.run().then(({ data, error }) => {
      if (error) return { data: null, error };
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: 'not one' } };
      }
      return { data: rows[0], error: null };
    });
  }

  then<T>(
    resolve: (value: { data: unknown; error: PgError | null }) => T,
    reject?: (reason: unknown) => T,
  ): Promise<T> {
    return this.run().then(resolve, reject);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => filter(row));
  }

  private run(): Promise<{ data: unknown; error: PgError | null }> {
    return Promise.resolve(this.execute());
  }

  private execute(): { data: unknown; error: PgError | null } {
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };
    const rows = this.db.rows(this.table);

    if (this.op === 'insert') {
      const list = (
        Array.isArray(this.payload) ? this.payload : [this.payload]
      ) as Row[];
      const added = list.map((row) => ({
        id: this.db.nextId(this.table),
        created_at: '2026-10-05T00:00:00.000Z',
        ...COLUMN_DEFAULTS[this.table],
        ...row,
      }));
      rows.push(...added);
      this.db.writes.push({
        table: this.table,
        op: 'insert',
        payload: this.payload,
        rows: added.map((row) => ({ ...row })),
      });
      return {
        data: this.returning ? added.map((row) => ({ ...row })) : null,
        error: null,
      };
    }

    if (this.op === 'update') {
      const hit = rows.filter((row) => this.matches(row));
      for (const row of hit) Object.assign(row, this.payload as Row);
      this.db.writes.push({
        table: this.table,
        op: 'update',
        payload: this.payload,
        rows: hit.map((row) => ({ ...row })),
      });
      this.db.afterUpdate?.(this.table, hit);
      return {
        data: this.returning ? hit.map((row) => ({ ...row })) : null,
        error: null,
      };
    }

    let out = rows.filter((row) => this.matches(row));
    if (this.orders.length > 0) {
      out = [...out].sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const x = sortKey(a[column]);
          const y = sortKey(b[column]);
          if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return { data: out.map((row) => ({ ...row })), error: null };
  }
}

// ── Fixture ─────────────────────────────────────────────────────────────────

const CONSULTANT = 'u-consultant';
const TALENT = 'u-talent';
const CLIENT = 'u-client';
const STRANGER = 'u-stranger';
const OUTSIDER_ADMIN = 'u-project-admin';

const TALENT_ENG = 'eng-talent';
const CLIENT_ENG = 'eng-client';
const CLIENT_ENG_2 = 'eng-client-2';
const PROJECT = 'proj-1';

const ENGAGEMENT_START = '2026-01-01T00:00:00.000Z';

function engagement(
  id: string,
  kind: 'talent_services' | 'client_services',
  o: { scope_mode?: string; status?: string; started_at?: string } = {},
): Row {
  return {
    id,
    kind,
    scope_mode: o.scope_mode ?? 'flexible',
    status: o.status ?? 'active',
    started_at: o.started_at ?? ENGAGEMENT_START,
    activated_by_contract_id: null,
  };
}

function party(
  engagementId: string,
  position: 'hirer' | 'provider',
  userId: string,
  capacity: string,
  name: string,
  teamId: string | null = null,
): Row {
  return {
    engagement_id: engagementId,
    position,
    user_id: userId,
    capacity,
    display_name_snapshot: name,
    team_id: teamId,
  };
}

function access(
  userId: string,
  role: ProjectRole,
  o: { has_direct_grant?: boolean; origin?: string; id?: string } = {},
): Row {
  return {
    id: o.id ?? `pa-${userId}`,
    project_id: PROJECT,
    user_id: userId,
    role,
    origin: o.origin ?? 'direct',
    capabilities: {},
    has_direct_grant: o.has_direct_grant ?? true,
  };
}

interface SetupOptions {
  /** Defaults: the consultant owns the project. */
  projectAccess?: Row[];
  talentEngagement?: Partial<Record<string, unknown>>;
  clientEngagement?: Partial<Record<string, unknown>> | null;
  secondClientEngagement?: boolean;
  /** Active links on the project. Default: the client engagement only. */
  links?: string[];
  assignments?: Row[];
  timeEntries?: Row[];
  managedTeams?: string[];
  policy?: { timezone: string; retroactive_days: number | null };
}

async function setup(o: SetupOptions = {}) {
  const db = new FakeDb();
  db.tables.engagements = [
    { ...engagement(TALENT_ENG, 'talent_services'), ...o.talentEngagement },
  ];
  db.tables.engagement_parties = [
    party(
      TALENT_ENG,
      'hirer',
      CONSULTANT,
      'consultant',
      'Jo Consultant',
      'team-hirer',
    ),
    party(TALENT_ENG, 'provider', TALENT, 'talent', 'Leo Talent'),
  ];
  if (o.clientEngagement !== null) {
    db.tables.engagements.push({
      ...engagement(CLIENT_ENG, 'client_services'),
      ...o.clientEngagement,
    });
    db.tables.engagement_parties.push(
      party(CLIENT_ENG, 'hirer', CLIENT, 'client', 'Acme Corp'),
      party(
        CLIENT_ENG,
        'provider',
        CONSULTANT,
        'consultant',
        'Jo Consultant',
        'team-provider',
      ),
    );
  }
  if (o.secondClientEngagement) {
    db.tables.engagements.push(engagement(CLIENT_ENG_2, 'client_services'));
    db.tables.engagement_parties.push(
      party(CLIENT_ENG_2, 'hirer', 'u-client-2', 'client', 'Beta Ltd'),
      party(
        CLIENT_ENG_2,
        'provider',
        CONSULTANT,
        'consultant',
        'Jo Consultant',
      ),
    );
  }
  db.tables.engagement_project_links = (
    o.links ?? (o.clientEngagement === null ? [] : [CLIENT_ENG])
  ).map((engagementId, index) => ({
    id: `link-${index}`,
    engagement_id: engagementId,
    project_id: PROJECT,
    basis: 'operational_assignment',
    status: 'active',
  }));
  db.tables.projects = [{ id: PROJECT, title: 'Aurora', owner_id: CONSULTANT }];
  db.tables.teams = [
    { id: 'team-hirer', name: 'Hirer Team' },
    { id: 'team-provider', name: 'Provider Team' },
    { id: 'team-other', name: 'Other Team' },
  ];
  db.tables.project_access = o.projectAccess ?? [access(CONSULTANT, 'owner')];
  db.tables.engagement_assignments = o.assignments ?? [];
  db.tables.time_entries = o.timeEntries ?? [];
  db.tables.contracts = [];
  const managed = new Set(o.managedTeams ?? []);
  db.rpcResults.can_manage_team = (args) => managed.has(String(args.p_team_id));

  const sb = db.client();
  const accessRow = (userId: string, projectId: string) =>
    db
      .rows('project_access')
      .find((row) => row.user_id === userId && row.project_id === projectId);
  const projectAuth = {
    resolvePermissions: jest.fn((userId: string, projectId: string) => {
      const row = accessRow(userId, projectId);
      return Promise.resolve(
        row
          ? resolvePermissions(
              row.role as ProjectRole,
              (row.capabilities as Record<string, unknown>) ?? null,
            )
          : null,
      );
    }),
    getUserProjectRole: jest.fn((userId: string, projectId: string) =>
      Promise.resolve((accessRow(userId, projectId)?.role as string) ?? null),
    ),
  };
  const policy = {
    resolve: jest
      .fn()
      .mockResolvedValue(
        o.policy ?? { timezone: 'UTC', retroactive_days: null },
      ),
  };
  const notifications = {
    timerAutoStopped: jest.fn().mockResolvedValue(undefined),
  };
  const cache = { bumpEpoch: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      EngagementAssignmentsService,
      { provide: SUPABASE_ADMIN, useValue: sb },
      { provide: EngagementsService, useValue: new EngagementsService(sb) },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
      { provide: TimePolicyService, useValue: policy },
      { provide: TimeNotificationsService, useValue: notifications },
      { provide: TimeCacheService, useValue: cache },
      { provide: AuditService, useValue: audit },
    ],
  }).compile();

  return {
    db,
    service: moduleRef.get(EngagementAssignmentsService),
    projectAuth,
    policy,
    notifications,
    cache,
    audit,
  };
}

function assignmentRow(o: Partial<Row> = {}): Row {
  return {
    id: 'asg-1',
    project_id: PROJECT,
    project_title_snapshot: 'Aurora',
    worker_user_id: TALENT,
    client_engagement_id: CLIENT_ENG,
    talent_engagement_id: TALENT_ENG,
    team_id: 'team-hirer',
    team_name_snapshot: 'Hirer Team',
    role_title: 'Designer',
    status: 'active',
    started_at: '2026-09-01T00:00:00.000Z',
    ended_at: null,
    ...o,
  };
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected a rejection');
}

function bodyOf(error: HttpException): Record<string, unknown> {
  return error.getResponse() as Record<string, unknown>;
}

// ── list ────────────────────────────────────────────────────────────────────

describe('EngagementAssignmentsService.list', () => {
  it('is 404 to anyone who holds no seat on the engagement', async () => {
    const { service } = await setup({ assignments: [assignmentRow()] });
    await expect(service.list(STRANGER, TALENT_ENG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('names the worker to both seats of the talent engagement', async () => {
    const { service } = await setup({ assignments: [assignmentRow()] });

    for (const viewer of [CONSULTANT, TALENT]) {
      const [view] = await service.list(viewer, TALENT_ENG);
      expect(view).toMatchObject({
        id: 'asg-1',
        engagement_id: TALENT_ENG,
        worker_user_id: TALENT,
        worker_label: 'Leo Talent',
        talent_engagement_id: TALENT_ENG,
        client_engagement_id: CLIENT_ENG,
        project_title_snapshot: 'Aurora',
      });
    }
  });

  it('names the worker to the client provider (provider-side, L22)', async () => {
    const { service } = await setup({ assignments: [assignmentRow()] });
    const [view] = await service.list(CONSULTANT, CLIENT_ENG);
    expect(view.worker_user_id).toBe(TALENT);
    expect(view.worker_label).toBe('Leo Talent');
    expect(view.engagement_id).toBe(CLIENT_ENG);
  });

  it('shows the client hirer a delivery team, never the worker or the talent agreement', async () => {
    const { service, db } = await setup({
      assignments: [
        assignmentRow(),
        assignmentRow({
          id: 'asg-2',
          worker_user_id: CONSULTANT,
          talent_engagement_id: null,
          team_id: 'team-provider',
        }),
      ],
    });
    const before = db.writes.length;

    const views = await service.list(CLIENT, CLIENT_ENG);

    expect(views).toHaveLength(2);
    for (const view of views) {
      expect(view.worker_user_id).toBeNull();
      expect(view.worker_label).toBe(MASKED_WORKER_LABEL);
      expect(view.talent_engagement_id).toBeNull();
      expect(view.client_engagement_id).toBe(CLIENT_ENG);
    }
    expect(db.writes.length).toBe(before);
  });

  it('lists ended assignments too, oldest first', async () => {
    const { service } = await setup({
      assignments: [
        assignmentRow({ id: 'asg-b', started_at: '2026-09-02T00:00:00.000Z' }),
        assignmentRow({
          id: 'asg-a',
          status: 'ended',
          started_at: '2026-08-01T00:00:00.000Z',
          ended_at: '2026-08-31T00:00:00.000Z',
        }),
      ],
    });
    const views = await service.list(CONSULTANT, TALENT_ENG);
    expect(views.map((view) => view.id)).toEqual(['asg-a', 'asg-b']);
    expect(views[0].status).toBe('ended');
  });
});

// ── create: talent engagement ───────────────────────────────────────────────

describe('EngagementAssignmentsService.create (talent engagement)', () => {
  it('E33: bills through the one client agreement the hirer delivers on the project', async () => {
    const { service, db } = await setup({ links: [CLIENT_ENG] });

    const view = await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
    });

    const [insert] = db.writesTo('engagement_assignments', 'insert');
    expect(insert.payload).toMatchObject({
      project_id: PROJECT,
      project_title_snapshot: 'Aurora',
      worker_user_id: TALENT,
      talent_engagement_id: TALENT_ENG,
      client_engagement_id: CLIENT_ENG,
      status: 'active',
      assigned_by: CONSULTANT,
    });
    expect(view).toMatchObject({
      engagement_id: TALENT_ENG,
      worker_user_id: TALENT,
      worker_label: 'Leo Talent',
      client_engagement_id: CLIENT_ENG,
    });
  });

  it('E33: several qualifying client agreements need a choice, and nothing is written', async () => {
    const { service, db } = await setup({
      secondClientEngagement: true,
      links: [CLIENT_ENG, CLIENT_ENG_2],
    });

    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(error)).toMatchObject({
      code: 'ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED',
      client_engagements: expect.arrayContaining([
        { id: CLIENT_ENG, label: 'Acme Corp' },
        { id: CLIENT_ENG_2, label: 'Beta Ltd' },
      ]),
    });
    expect(db.writesTo('engagement_assignments')).toHaveLength(0);
    expect(db.writesTo('engagement_project_links')).toHaveLength(0);
  });

  it('E33: the chosen client agreement wins when several qualify', async () => {
    const { service, db } = await setup({
      secondClientEngagement: true,
      links: [CLIENT_ENG, CLIENT_ENG_2],
    });

    await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
      client_engagement_id: CLIENT_ENG_2,
    });

    expect(
      db.writesTo('engagement_assignments', 'insert')[0].payload,
    ).toMatchObject({ client_engagement_id: CLIENT_ENG_2 });
  });

  it('refuses a client agreement the hirer does not deliver', async () => {
    const { service } = await setup({ links: [CLIENT_ENG] });
    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, {
        project_id: PROJECT,
        client_engagement_id: '00000000-0000-0000-0000-00000000dead',
      }),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(error).code).toBe('ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER');
  });

  it('carries no client agreement when none is on the project', async () => {
    const { service, db } = await setup({
      clientEngagement: null,
      links: [TALENT_ENG],
    });
    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });
    expect(
      db.writesTo('engagement_assignments', 'insert')[0].payload,
    ).toMatchObject({
      client_engagement_id: null,
      talent_engagement_id: TALENT_ENG,
    });
  });

  it('E34: team_id defaults to the hirer party team, with its name snapshot', async () => {
    const { service, db } = await setup();
    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });
    expect(
      db.writesTo('engagement_assignments', 'insert')[0].payload,
    ).toMatchObject({
      team_id: 'team-hirer',
      team_name_snapshot: 'Hirer Team',
    });
  });

  it('takes another team only when the caller manages it', async () => {
    const managed = await setup({ managedTeams: ['team-other'] });
    await managed.service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
      team_id: 'team-other',
    });
    expect(
      managed.db.writesTo('engagement_assignments', 'insert')[0].payload,
    ).toMatchObject({
      team_id: 'team-other',
      team_name_snapshot: 'Other Team',
    });

    const unmanaged = await setup();
    await expect(
      unmanaged.service.create(CONSULTANT, TALENT_ENG, {
        project_id: PROJECT,
        team_id: 'team-other',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('places a flexible engagement on the project with an operational link (project admin)', async () => {
    const { service, db } = await setup({ links: [CLIENT_ENG] });
    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });

    const [link] = db.writesTo('engagement_project_links', 'insert');
    expect(link.payload).toMatchObject({
      engagement_id: TALENT_ENG,
      project_id: PROJECT,
      project_title_snapshot: 'Aurora',
      basis: 'operational_assignment',
      linked_by: CONSULTANT,
    });
  });

  it('does not re-link an engagement that is already on the project', async () => {
    const { service, db } = await setup({ links: [CLIENT_ENG, TALENT_ENG] });
    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });
    expect(db.writesTo('engagement_project_links')).toHaveLength(0);
  });

  it('asks for a project admin to place the agreement when the hirer is only an editor', async () => {
    const { service, db } = await setup({
      projectAccess: [access(CONSULTANT, 'editor')],
    });
    db.tables.projects[0].owner_id = OUTSIDER_ADMIN;

    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(bodyOf(error).code).toBe('ASSIGNMENT_PROJECT_LINK_REQUIRED');
    expect(db.writesTo('engagement_assignments')).toHaveLength(0);
  });

  it('never places a project-specific agreement on another project', async () => {
    const { service, db } = await setup({
      talentEngagement: { scope_mode: 'project_specific' },
    });
    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(error).code).toBe('TALENT_ENGAGEMENT_PROJECT_NOT_LINKED');
    expect(db.writesTo('engagement_project_links')).toHaveLength(0);
  });

  it('is 404 for a project the hirer cannot open and the agreement is not on', async () => {
    const { service, db } = await setup({ projectAccess: [] });
    db.tables.projects[0].owner_id = OUTSIDER_ADMIN;
    await expect(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is 404 to a non-party and 403 to the talent seat', async () => {
    const { service } = await setup();
    await expect(
      service.create(STRANGER, TALENT_ENG, { project_id: PROJECT }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.create(TALENT, TALENT_ENG, { project_id: PROJECT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a worker other than the talent provider', async () => {
    const { service } = await setup();
    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, {
        project_id: PROJECT,
        worker_user_id: STRANGER,
      }),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(error).code).toBe('ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER');
  });

  it('refuses an inactive talent agreement with a 422', async () => {
    const { service } = await setup({ talentEngagement: { status: 'ended' } });
    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(error).code).toBe('TALENT_ENGAGEMENT_NOT_ACTIVE');
  });

  it('is 409 when the same assignment is already active', async () => {
    const { service, db } = await setup({ assignments: [assignmentRow()] });
    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(bodyOf(error).code).toBe('ASSIGNMENT_ALREADY_ACTIVE');
    expect(db.writesTo('engagement_project_links')).toHaveLength(0);
  });

  it('maps the guard: ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER → 422, and ends the link it created', async () => {
    const { service, db } = await setup();
    db.failures.push({
      table: 'engagement_assignments',
      op: 'insert',
      error: { code: 'P0001', message: 'ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER' },
    });

    const error = await rejection(
      service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT }),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(bodyOf(error).code).toBe('ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER');
    const [retract] = db.writesTo('engagement_project_links', 'update');
    expect(retract.payload).toMatchObject({ status: 'ended' });
    expect(retract.rows[0].engagement_id).toBe(TALENT_ENG);
  });

  it('bumps the logging-for epoch once the assignment exists', async () => {
    const { service, cache } = await setup();
    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(1);
  });

  describe('started_at', () => {
    it('defaults to now', async () => {
      const { service, db, policy } = await setup();
      const before = Date.now();
      await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });
      const startedAt = Date.parse(
        (db.writesTo('engagement_assignments', 'insert')[0].payload as Row)
          .started_at as string,
      );
      expect(startedAt).toBeGreaterThanOrEqual(before - 1);
      expect(startedAt).toBeLessThanOrEqual(Date.now() + 1);
      expect(policy.resolve).not.toHaveBeenCalled();
    });

    it('may be backdated inside the window, resolved on the engagement policy', async () => {
      const { service, db, policy } = await setup({
        policy: { timezone: 'Asia/Manila', retroactive_days: 30 },
      });
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();

      await service.create(CONSULTANT, TALENT_ENG, {
        project_id: PROJECT,
        started_at: tenDaysAgo,
      });

      expect(policy.resolve).toHaveBeenCalledWith(
        { kind: 'engagement', ref: TALENT_ENG },
        null,
        expect.any(Date),
      );
      expect(
        (db.writesTo('engagement_assignments', 'insert')[0].payload as Row)
          .started_at,
      ).toBe(tenDaysAgo);
    });

    it('never goes past the retroactive window', async () => {
      const { service } = await setup({
        policy: { timezone: 'UTC', retroactive_days: 7 },
      });
      const error = await rejection(
        service.create(CONSULTANT, TALENT_ENG, {
          project_id: PROJECT,
          started_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        }),
      );
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(bodyOf(error).code).toBe('RETROACTIVE_WINDOW');
    });

    it('never starts before the agreement or in the future', async () => {
      const { service } = await setup({
        talentEngagement: { started_at: '2026-06-01T00:00:00.000Z' },
      });
      await expect(
        service.create(CONSULTANT, TALENT_ENG, {
          project_id: PROJECT,
          started_at: '2026-05-31T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(CONSULTANT, TALENT_ENG, {
          project_id: PROJECT,
          started_at: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

// ── create: project_access (E58, L25) ───────────────────────────────────────

describe('EngagementAssignmentsService.create — project access (E58)', () => {
  it('inserts an editor row with the engagement origin and a direct grant', async () => {
    const { service, db, audit } = await setup();

    const view = await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
    });

    expect(view.access_needed).toBe(false);
    const [insert] = db.writesTo('project_access', 'insert');
    expect(insert.payload).toMatchObject({
      project_id: PROJECT,
      user_id: TALENT,
      role: 'editor',
      origin: `engagement:${TALENT_ENG}`,
      has_direct_grant: true,
      granted_by: CONSULTANT,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        action: 'access.granted',
        metadata: expect.objectContaining({ target_user_id: TALENT }),
      }),
    );
  });

  it('raises a lower role to editor and sets the direct grant, leaving origin alone', async () => {
    const { service, db } = await setup({
      projectAccess: [
        access(CONSULTANT, 'owner'),
        access(TALENT, 'viewer', {
          has_direct_grant: false,
          origin: 'team:team-hirer',
        }),
      ],
    });

    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });

    expect(db.writesTo('project_access', 'insert')).toHaveLength(0);
    const [update] = db.writesTo('project_access', 'update');
    expect(update.payload).toEqual({
      has_direct_grant: true,
      role: 'editor',
      granted_by: CONSULTANT,
    });
    expect(update.rows[0]).toMatchObject({
      user_id: TALENT,
      role: 'editor',
      origin: 'team:team-hirer',
      has_direct_grant: true,
    });
  });

  it('never downgrades: an admin stays admin and only gains the direct grant', async () => {
    const { service, db } = await setup({
      projectAccess: [
        access(CONSULTANT, 'owner'),
        access(TALENT, 'admin', { has_direct_grant: false, origin: 'team:x' }),
      ],
    });

    await service.create(CONSULTANT, TALENT_ENG, { project_id: PROJECT });

    const [update] = db.writesTo('project_access', 'update');
    expect(update.payload).toEqual({ has_direct_grant: true });
    expect(update.rows[0]).toMatchObject({ role: 'admin', origin: 'team:x' });
  });

  it('writes nothing when the worker already holds a direct editor row', async () => {
    const { service, db } = await setup({
      projectAccess: [access(CONSULTANT, 'owner'), access(TALENT, 'editor')],
    });
    const view = await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
    });
    expect(db.writesTo('project_access')).toHaveLength(0);
    expect(view.access_needed).toBe(false);
  });

  it('access_needed: without members.manage the assignment is created and nothing is granted', async () => {
    const { service, db } = await setup({
      links: [CLIENT_ENG, TALENT_ENG],
      projectAccess: [access(CONSULTANT, 'editor')],
    });
    db.tables.projects[0].owner_id = OUTSIDER_ADMIN;

    const view = await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
    });

    expect(db.writesTo('engagement_assignments', 'insert')).toHaveLength(1);
    expect(db.writesTo('project_access')).toHaveLength(0);
    expect(view.access_needed).toBe(true);
  });

  it('access_needed is false without members.manage when the worker can already log', async () => {
    const { service, db } = await setup({
      links: [CLIENT_ENG, TALENT_ENG],
      projectAccess: [access(CONSULTANT, 'editor'), access(TALENT, 'editor')],
    });
    db.tables.projects[0].owner_id = OUTSIDER_ADMIN;

    const view = await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
    });
    expect(view.access_needed).toBe(false);
    expect(db.writesTo('project_access')).toHaveLength(0);
  });

  it('a failed grant still returns the assignment, with access_needed', async () => {
    const { service, db } = await setup();
    db.failures.push({
      table: 'project_access',
      op: 'insert',
      error: { code: '42501', message: 'nope' },
    });
    const view = await service.create(CONSULTANT, TALENT_ENG, {
      project_id: PROJECT,
    });
    expect(view.access_needed).toBe(true);
    expect(db.writesTo('engagement_assignments', 'insert')).toHaveLength(1);
  });
});

// ── create: client engagement ───────────────────────────────────────────────

describe('EngagementAssignmentsService.create (client engagement)', () => {
  it('assigns the consultant to their own client agreement, team = provider party team', async () => {
    const { service, db } = await setup();

    const view = await service.create(CONSULTANT, CLIENT_ENG, {
      project_id: PROJECT,
      role_title: '  Lead  ',
    });

    expect(
      db.writesTo('engagement_assignments', 'insert')[0].payload,
    ).toMatchObject({
      worker_user_id: CONSULTANT,
      client_engagement_id: CLIENT_ENG,
      talent_engagement_id: null,
      team_id: 'team-provider',
      team_name_snapshot: 'Provider Team',
      role_title: 'Lead',
    });
    expect(view).toMatchObject({
      worker_user_id: CONSULTANT,
      worker_label: 'Jo Consultant',
      access_needed: false,
    });
    expect(db.writesTo('project_access')).toHaveLength(0);
  });

  it('L25: needs the consultant to hold time.log already', async () => {
    const { service, db } = await setup({
      projectAccess: [access(CONSULTANT, 'viewer')],
    });
    db.tables.projects[0].owner_id = OUTSIDER_ADMIN;
    const error = await rejection(
      service.create(CONSULTANT, CLIENT_ENG, { project_id: PROJECT }),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(bodyOf(error).code).toBe('NO_LOGGING_CONTEXT');
  });

  it('is 403 to the client hirer and 422 for another worker', async () => {
    const { service } = await setup();
    await expect(
      service.create(CLIENT, CLIENT_ENG, { project_id: PROJECT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const error = await rejection(
      service.create(CONSULTANT, CLIENT_ENG, {
        project_id: PROJECT,
        worker_user_id: TALENT,
      }),
    );
    expect(bodyOf(error).code).toBe(
      'UNCONTRACTED_WORKER_REQUIRES_TALENT_ENGAGEMENT',
    );
  });

  it('is 404 for a project the consultant cannot open', async () => {
    const { service, db } = await setup({ projectAccess: [] });
    db.tables.projects[0].owner_id = OUTSIDER_ADMIN;
    await expect(
      service.create(CONSULTANT, CLIENT_ENG, { project_id: PROJECT }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── end ─────────────────────────────────────────────────────────────────────

describe('EngagementAssignmentsService.end', () => {
  function runningEntry(o: Partial<Row> = {}): Row {
    return {
      id: 'entry-run',
      member_user_id: TALENT,
      context_kind: 'assignment',
      team_id: null,
      engagement_assignment_id: 'asg-1',
      started_at: '2026-10-04T08:00:00.000Z',
      ended_at: null,
      ...o,
    };
  }

  /** M3 A3: ending the assignment stops its running entries. */
  function stopOnEnd(db: FakeDb): void {
    db.afterUpdate = (table, rows) => {
      if (table !== 'engagement_assignments') return;
      for (const assignment of rows) {
        if (assignment.status !== 'ended') continue;
        for (const entry of db.rows('time_entries')) {
          if (
            entry.engagement_assignment_id === assignment.id &&
            entry.ended_at === null
          ) {
            entry.ended_at = assignment.ended_at;
            entry.flagged_reason = 'stopped_by_assignment_end';
          }
        }
      }
    };
  }

  it('reads the running entries, ends the assignment, notifies each one and bumps the epoch', async () => {
    const { service, db, notifications, cache } = await setup({
      assignments: [assignmentRow()],
      timeEntries: [
        runningEntry(),
        runningEntry({
          id: 'entry-done',
          ended_at: '2026-10-03T10:00:00.000Z',
        }),
      ],
    });
    stopOnEnd(db);

    const view = await service.end(CONSULTANT, TALENT_ENG, 'asg-1', {
      reason: 'Project wrapped',
    });

    const [update] = db.writesTo('engagement_assignments', 'update');
    expect(update.payload).toMatchObject({
      status: 'ended',
      status_reason: 'Project wrapped',
    });
    expect(typeof (update.payload as Row).ended_at).toBe('string');
    expect(notifications.timerAutoStopped).toHaveBeenCalledTimes(1);
    expect(notifications.timerAutoStopped).toHaveBeenCalledWith(
      {
        id: 'entry-run',
        member_user_id: TALENT,
        context_kind: 'assignment',
        team_id: null,
      },
      'stopped_by_assignment_end',
    );
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({
      id: 'asg-1',
      status: 'ended',
      worker_user_id: TALENT,
    });
    expect(
      db.rows('time_entries').find((entry) => entry.id === 'entry-run'),
    ).toMatchObject({ flagged_reason: 'stopped_by_assignment_end' });
    // TS never writes time entries here: the trigger stops them.
    expect(db.writesTo('time_entries')).toHaveLength(0);
  });

  it('sends nothing when no timer was running', async () => {
    const { service, notifications, cache } = await setup({
      assignments: [assignmentRow()],
    });
    await service.end(CONSULTANT, TALENT_ENG, 'asg-1', {});
    expect(notifications.timerAutoStopped).not.toHaveBeenCalled();
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(1);
  });

  it('a failed notification never fails the end', async () => {
    const { service, notifications } = await setup({
      assignments: [assignmentRow()],
      timeEntries: [runningEntry()],
    });
    notifications.timerAutoStopped.mockRejectedValueOnce(
      new Error('push down'),
    );
    await expect(
      service.end(CONSULTANT, TALENT_ENG, 'asg-1', {}),
    ).resolves.toMatchObject({ status: 'ended' });
  });

  it('works through the client engagement for the talent hirer too', async () => {
    const { service } = await setup({ assignments: [assignmentRow()] });
    await expect(
      service.end(CONSULTANT, CLIENT_ENG, 'asg-1', {}),
    ).resolves.toMatchObject({ status: 'ended' });
  });

  it('is 404 to a non-party and for an assignment under another engagement', async () => {
    const { service } = await setup({
      assignments: [assignmentRow({ client_engagement_id: null })],
    });
    await expect(
      service.end(STRANGER, TALENT_ENG, 'asg-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.end(CONSULTANT, CLIENT_ENG, 'asg-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is 403 to the talent and to the client hirer', async () => {
    const { service } = await setup({ assignments: [assignmentRow()] });
    await expect(
      service.end(TALENT, TALENT_ENG, 'asg-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.end(CLIENT, CLIENT_ENG, 'asg-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the consultant ends their own client assignment', async () => {
    const { service } = await setup({
      assignments: [
        assignmentRow({
          worker_user_id: CONSULTANT,
          talent_engagement_id: null,
        }),
      ],
    });
    await expect(
      service.end(CONSULTANT, CLIENT_ENG, 'asg-1', {}),
    ).resolves.toMatchObject({
      status: 'ended',
      worker_label: 'Jo Consultant',
    });
  });

  it('is 409 for an assignment that already ended', async () => {
    const { service } = await setup({
      assignments: [
        assignmentRow({
          status: 'ended',
          ended_at: '2026-09-30T00:00:00.000Z',
        }),
      ],
    });
    const error = await rejection(
      service.end(CONSULTANT, TALENT_ENG, 'asg-1', {}),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(bodyOf(error).code).toBe('ASSIGNMENT_NOT_ACTIVE');
  });

  it('refuses an end before the start, in the future, or before time already logged', async () => {
    const { service, db } = await setup({
      assignments: [assignmentRow()],
      timeEntries: [
        runningEntry({
          id: 'entry-done',
          ended_at: '2026-09-20T10:00:00.000Z',
        }),
      ],
    });
    for (const endedAt of [
      '2026-08-31T00:00:00.000Z',
      new Date(Date.now() + 86_400_000).toISOString(),
      '2026-09-15T00:00:00.000Z',
    ]) {
      await expect(
        service.end(CONSULTANT, TALENT_ENG, 'asg-1', { ended_at: endedAt }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(db.writesTo('engagement_assignments')).toHaveLength(0);

    await expect(
      service.end(CONSULTANT, TALENT_ENG, 'asg-1', {
        ended_at: '2026-09-21T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ ended_at: '2026-09-21T00:00:00.000Z' });
  });

  it('maps a guard refusal and hides Postgres text otherwise', async () => {
    const guarded = await setup({ assignments: [assignmentRow()] });
    guarded.db.failures.push({
      table: 'engagement_assignments',
      op: 'update',
      error: {
        code: 'P0001',
        message: 'ENGAGEMENT_ASSIGNMENT_HAS_RUNNING_TIMER',
      },
    });
    const error = await rejection(
      guarded.service.end(CONSULTANT, TALENT_ENG, 'asg-1', {}),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(guarded.cache.bumpEpoch).not.toHaveBeenCalled();

    const broken = await setup({ assignments: [assignmentRow()] });
    broken.db.failures.push({
      table: 'engagement_assignments',
      op: 'update',
      error: { code: 'XX000', message: 'relation "secret" exploded' },
    });
    const failure = await rejection(
      broken.service.end(CONSULTANT, TALENT_ENG, 'asg-1', {}),
    );
    expect(failure).toBeInstanceOf(InternalServerErrorException);
    expect(JSON.stringify(failure.getResponse())).not.toContain('secret');
  });
});

// ── ensureProviderAssignment ────────────────────────────────────────────────

describe('EngagementAssignmentsService.ensureProviderAssignment', () => {
  it("creates the consultant's own client assignment with the provider party team", async () => {
    const { service, db, cache } = await setup();

    await service.ensureProviderAssignment(CLIENT_ENG, PROJECT, CONSULTANT);

    const [insert] = db.writesTo('engagement_assignments', 'insert');
    expect(insert.payload).toMatchObject({
      project_id: PROJECT,
      worker_user_id: CONSULTANT,
      client_engagement_id: CLIENT_ENG,
      talent_engagement_id: null,
      team_id: 'team-provider',
      assigned_by: CONSULTANT,
      status: 'active',
    });
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(1);
  });

  it('is idempotent', async () => {
    const { service, db, cache } = await setup({
      assignments: [
        assignmentRow({
          worker_user_id: CONSULTANT,
          talent_engagement_id: null,
        }),
      ],
    });
    await service.ensureProviderAssignment(CLIENT_ENG, PROJECT, CONSULTANT);
    expect(db.writesTo('engagement_assignments')).toHaveLength(0);
    expect(cache.bumpEpoch).not.toHaveBeenCalled();
  });

  it('does nothing for a talent engagement or an unlinked project', async () => {
    const { service, db } = await setup({ links: [] });
    await service.ensureProviderAssignment(TALENT_ENG, PROJECT, CONSULTANT);
    await service.ensureProviderAssignment(CLIENT_ENG, PROJECT, CONSULTANT);
    expect(db.writesTo('engagement_assignments')).toHaveLength(0);
  });

  it('treats a concurrent duplicate as done', async () => {
    const { service, db } = await setup();
    db.failures.push({
      table: 'engagement_assignments',
      op: 'insert',
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "uq_engagement_assignments_active_exact"',
      },
    });
    await expect(
      service.ensureProviderAssignment(CLIENT_ENG, PROJECT, CONSULTANT),
    ).resolves.toBeUndefined();
  });
});

// ── mapAssignmentDbError ────────────────────────────────────────────────────

describe('mapAssignmentDbError', () => {
  it.each([
    ['CLIENT_ENGAGEMENT_NOT_ACTIVE', 422],
    ['TALENT_ENGAGEMENT_NOT_ACTIVE', 422],
    ['CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED', 422],
    ['TALENT_ENGAGEMENT_PROJECT_NOT_LINKED', 422],
    ['ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER', 422],
    ['UNCONTRACTED_WORKER_REQUIRES_TALENT_ENGAGEMENT', 422],
    ['ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER', 422],
    ['ENGAGEMENT_ASSIGNMENT_STATUS_INVALID', 409],
    ['ENGAGEMENT_ASSIGNMENT_HAS_RUNNING_TIMER', 409],
  ])('%s → %i with the code and copy', (code, status) => {
    const mapped = mapAssignmentDbError({ code: 'P0001', message: code });
    expect(mapped?.getStatus()).toBe(status);
    const body = mapped?.getResponse() as Record<string, unknown>;
    expect(body.code).toBe(code);
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toBe(code);
  });

  it('maps the active-assignment unique index to 409 and leaves other errors alone', () => {
    expect(
      mapAssignmentDbError({
        code: '23505',
        message: 'duplicate key',
        details: 'uq_engagement_assignments_active_exact',
      })?.getStatus(),
    ).toBe(409);
    expect(
      mapAssignmentDbError({ code: '23505', message: 'other_index' }),
    ).toBeNull();
    expect(mapAssignmentDbError({ code: 'XX000', message: 'boom' })).toBeNull();
    expect(mapAssignmentDbError(null)).toBeNull();
  });
});
