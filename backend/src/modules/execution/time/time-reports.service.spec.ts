import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { ROLE_DEFAULTS } from '../projects/permissions/project-permissions';
import type { ReportQueryDto } from './dto/reports.dto';
import { TimeAuthorityService } from './time-authority.service';
import { ENTRY_AUTH_SELECT, ENTRY_IDENTITY_SELECT } from './time-entry.select';
import { TimePolicyService } from './time-policy.service';
import {
  andOfOrGroups,
  EXPORT_MAX_ROWS,
  TimeReportsService,
  weekLabel,
} from './time-reports.service';
import type { EntryAuthRow, TimeEntryView } from './time.types';

// ── Scripted PostgREST stand-in: every chain is recorded; a per-table handler answers at await time ──────────

type Op = [string, ...unknown[]];
interface Call {
  table: string;
  select: string;
  options?: unknown;
  ops: Op[];
}
interface Answer {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}
type Handler = (call: Call) => Answer;

function fakeDb(handlers: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const answer = () => {
        const r = handlers[table]?.(call) ?? { data: [] };
        return {
          data: r.data ?? null,
          error: r.error ?? null,
          count: r.count ?? null,
        };
      };
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string, options?: unknown) => {
        call.select = columns;
        call.options = options;
        return builder;
      };
      for (const m of [
        'eq',
        'neq',
        'in',
        'not',
        'or',
        'gte',
        'lt',
        'lte',
        'order',
        'range',
        'limit',
      ]) {
        builder[m] = (...args: unknown[]) => {
          call.ops.push([m, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(answer());
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(answer()).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

/** The ids of an `.in('id', [...])` op, if any. */
function inIds(call: Call): string[] | null {
  const op = call.ops.find((o) => o[0] === 'in' && o[1] === 'id');
  return op ? (op[2] as string[]) : null;
}
const offsetOf = (call: Call) =>
  (call.ops.find((o) => o[0] === 'range')?.[1] as number | undefined) ?? 0;
const entryCalls = (calls: Call[]) =>
  calls.filter((c) => c.table === 'time_entries');

// ── Ids ───────────────────────────────────────────────────────────────────────────────────────────────────────

const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TALENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEAM = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const ENGAGEMENT = '44444444-4444-4444-8444-444444444444';
const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
const ASSIGNMENT_2 = '66666666-6666-4666-8666-666666666666';
const PROVIDER_TEAM = '77777777-7777-4777-8777-777777777777';
const LINKED_PROJECT = '88888888-8888-4888-8888-888888888888';

function authRow(partial: Partial<EntryAuthRow> = {}): EntryAuthRow {
  return {
    id: 'e1',
    member_user_id: OTHER,
    project_id: PROJECT,
    context_kind: 'team',
    context_ref: TEAM,
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    timesheet_id: 's1',
    started_at: '2026-09-02T01:00:00.000Z',
    ...partial,
  };
}

function view(partial: Partial<TimeEntryView> = {}): TimeEntryView {
  return {
    id: 'e1',
    context_kind: 'team',
    context_ref: TEAM,
    context_label_snapshot: 'Design team',
    timesheet_id: 's1',
    work_item: 'task',
    started_at: '2026-09-02T01:00:00.000Z',
    ended_at: '2026-09-02T03:00:00.000Z',
    paused_at: null,
    duration_seconds: 7200,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: 5400,
    source: 'timer',
    work_type_snapshot: 'real_work',
    legacy_status: null,
    payout_id: null,
    flagged_reason: null,
    project_id: PROJECT,
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    created_at: '2026-09-02T03:00:00.000Z',
    updated_at: '2026-09-02T03:00:00.000Z',
    timesheet: {
      id: 's1',
      status: 'approved',
      period_start: '2026-08-31',
      period_end: '2026-09-06',
      decision_kind: 'manual',
      decided_by: VIEWER,
      decided_at: '2026-09-07T00:00:00.000Z',
      decision_note: null,
      scope_label_snapshot: 'Acme',
    },
    locked_reason: 'frozen',
    identity: 'visible',
    member_user_id: OTHER,
    member_display_name_snapshot: 'Ann Member',
    member: {
      id: OTHER,
      display_name: 'Ann Member',
      avatar_url: null,
    },
    member_label: null,
    content: 'visible',
    task_id: 't1',
    note: 'Logo pass',
    task: { id: 't1', title: 'Logo', work_type: 'real_work', status: 'done' },
    project: { id: PROJECT, title: 'Acme site' },
    content_label: null,
    cost: 'hidden',
    ...partial,
  };
}

function query(partial: Partial<ReportQueryDto> = {}): ReportQueryDto {
  return {
    scope: `team:${TEAM}`,
    from: '2026-09-01',
    to: '2026-09-30',
    page: 1,
    limit: 100,
    ...partial,
  } as ReportQueryDto;
}

async function build(handlers: Record<string, Handler> = {}) {
  const db = fakeDb({
    teams: () => ({ data: { id: TEAM, workspace_id: WORKSPACE } }),
    projects: () => ({
      data: { id: PROJECT, owner_id: OTHER, workspace_id: WORKSPACE },
    }),
    ...handlers,
  });
  const authority = {
    isTeamManager: jest.fn().mockResolvedValue(true),
    canManageWorkspace: jest.fn().mockResolvedValue(true),
    hydrate: jest.fn((_viewer: string, rows: EntryAuthRow[]) =>
      Promise.resolve(rows.map((r) => view({ id: r.id }))),
    ),
    identityVisible: jest.fn((_viewer: string, rows: EntryAuthRow[]) =>
      Promise.resolve(new Set(rows.map((r) => r.id))),
    ),
    contentVisible: jest.fn((_viewer: string, projectIds: string[]) =>
      Promise.resolve(new Set(projectIds)),
    ),
    costVisible: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const policy = {
    planRefForTeam: jest.fn().mockResolvedValue(WORKSPACE),
    teamTimezone: jest.fn().mockResolvedValue('Asia/Manila'),
    workspaceTimezone: jest.fn().mockResolvedValue('Asia/Manila'),
    resolve: jest.fn().mockResolvedValue({ timezone: 'Asia/Manila' }),
    teamPeriodBasics: jest
      .fn()
      .mockResolvedValue({ timezone: 'Asia/Manila', week_start: 1 }),
    workspacePeriodBasics: jest
      .fn()
      .mockResolvedValue({ timezone: 'Asia/Manila', week_start: 1 }),
  };
  const entitlements = {
    assertFeature: jest.fn().mockResolvedValue(undefined),
  };
  const engagements = {
    getById: jest.fn().mockResolvedValue({
      id: ENGAGEMENT,
      kind: 'talent_services',
      viewer_position: 'hirer',
      project_links: [],
    }),
    policyWorkspaceFor: jest.fn().mockResolvedValue(WORKSPACE),
    settingsInForceOn: jest
      .fn()
      .mockResolvedValue({ client_hours_detail_level: 'detailed' }),
    assignmentIdsForClientEngagement: jest.fn().mockResolvedValue([]),
    providerPartyTeamId: jest.fn().mockResolvedValue(null),
    assignmentsForProject: jest.fn().mockResolvedValue([]),
    engagementKind: jest.fn().mockResolvedValue('talent_services'),
    isParty: jest.fn().mockResolvedValue(null),
  };
  const projectAuth = {
    resolvePermissions: jest.fn().mockResolvedValue(ROLE_DEFAULTS.admin),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeReportsService,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: TimeAuthorityService, useValue: authority },
      { provide: TimePolicyService, useValue: policy },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: EngagementsService, useValue: engagements },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
    ],
  }).compile();
  return {
    service: moduleRef.get(TimeReportsService),
    db,
    authority,
    policy,
    entitlements,
    engagements,
    projectAuth,
  };
}

async function notFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(NotFoundException);
  await promise.catch((err: NotFoundException) => {
    expect(err.getResponse()).toMatchObject({ code: 'TIME_NOT_FOUND' });
  });
}

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────

describe('andOfOrGroups', () => {
  it('sends one group as it is, ANDs several, and skips empty groups', () => {
    expect(andOfOrGroups([])).toBeNull();
    expect(andOfOrGroups([[]])).toBeNull();
    expect(andOfOrGroups([['a.eq.1', 'b.eq.2']])).toBe('a.eq.1,b.eq.2');
    expect(andOfOrGroups([['a.eq.1', 'b.eq.2'], [], ['c.is.null']])).toBe(
      'and(or(a.eq.1,b.eq.2),or(c.is.null))',
    );
  });
});

describe('weekLabel (A5)', () => {
  it('reads "Sep 22–28" in a month, names both months across one, and both years across a year end', () => {
    expect(weekLabel('2026-09-22')).toBe('Sep 22–28');
    expect(weekLabel('2026-09-29')).toBe('Sep 29–Oct 5');
    expect(weekLabel('2026-02-23')).toBe('Feb 23–Mar 1');
    expect(weekLabel('2028-02-23')).toBe('Feb 23–29');
    expect(weekLabel('2025-12-29')).toBe('Dec 29, 2025–Jan 4, 2026');
  });
});

// ── Scopes ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeReportsService.resolveScope', () => {
  it('a malformed scope is a 404, never a 400', async () => {
    const { service } = await build();
    await notFound(service.resolveScope(VIEWER, 'team:not-a-uuid'));
    await notFound(service.resolveScope(VIEWER, `nope:${TEAM}`));
  });

  it('team: managers only; the plan subject comes from planRefForTeam and the team policy timezone', async () => {
    const { service, authority, policy } = await build();
    const scope = await service.resolveScope(VIEWER, `team:${TEAM}`);
    expect(scope).toEqual({
      kind: 'team',
      id: TEAM,
      planRef: WORKSPACE,
      timezone: 'Asia/Manila',
    });
    expect(policy.planRefForTeam).toHaveBeenCalledWith({
      id: TEAM,
      workspace_id: WORKSPACE,
    });

    authority.isTeamManager.mockResolvedValue(false);
    await notFound(service.resolveScope(VIEWER, `team:${TEAM}`));
  });

  it('team: a missing team and a malformed id are 404s', async () => {
    const missing = await build({ teams: () => ({ data: null }) });
    await notFound(missing.service.resolveScope(VIEWER, `team:${TEAM}`));
    const bad = await build({
      teams: () => ({ error: { code: '22P02', message: 'invalid input' } }),
    });
    await notFound(bad.service.resolveScope(VIEWER, `team:${TEAM}`));
  });

  it('project: time.view_team_logs (or the owner); an editor is a 404', async () => {
    const { service, projectAuth } = await build();
    await expect(
      service.resolveScope(VIEWER, `project:${PROJECT}`),
    ).resolves.toMatchObject({
      kind: 'project',
      id: PROJECT,
      planRef: WORKSPACE,
    });
    projectAuth.resolvePermissions.mockResolvedValue(ROLE_DEFAULTS.editor);
    await notFound(service.resolveScope(VIEWER, `project:${PROJECT}`));
    projectAuth.resolvePermissions.mockResolvedValue(null);
    await notFound(service.resolveScope(VIEWER, `project:${PROJECT}`));
  });

  it('project: the owner needs no share row; an unhomed project is never the exempt raw null (D26)', async () => {
    const { service, projectAuth } = await build({
      projects: () => ({
        data: { id: PROJECT, owner_id: VIEWER, workspace_id: null },
      }),
    });
    const scope = await service.resolveScope(VIEWER, `project:${PROJECT}`);
    expect(projectAuth.resolvePermissions).not.toHaveBeenCalled();
    expect(scope.planRef).toEqual({ workspaceId: null, exempt: false });
  });

  it('workspace: can_manage_workspace, then time_reports_export (a 403 plan gate, after the 404 check)', async () => {
    const { service, authority, entitlements } = await build();
    await service.resolveScope(VIEWER, `workspace:${WORKSPACE}`);
    expect(entitlements.assertFeature).toHaveBeenCalledWith(
      WORKSPACE,
      'time_reports_export',
    );

    entitlements.assertFeature.mockClear();
    authority.canManageWorkspace.mockResolvedValue(false);
    await notFound(service.resolveScope(VIEWER, `workspace:${WORKSPACE}`));
    expect(entitlements.assertFeature).not.toHaveBeenCalled();

    authority.canManageWorkspace.mockResolvedValue(true);
    entitlements.assertFeature.mockRejectedValue(
      new ForbiddenException({ code: 'plan_limit' }),
    );
    await expect(
      service.resolveScope(VIEWER, `workspace:${WORKSPACE}`),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('engagement: a non-party is a 404 with time copy; parties get their position', async () => {
    const { service, engagements } = await build();
    await expect(
      service.resolveScope(VIEWER, `engagement:${ENGAGEMENT}`),
    ).resolves.toEqual({
      kind: 'engagement',
      id: ENGAGEMENT,
      planRef: WORKSPACE,
      timezone: 'Asia/Manila',
      viewerPosition: 'hirer',
      clientLevel: null,
    });
    engagements.getById.mockRejectedValue(
      new NotFoundException('Engagement not found'),
    );
    await notFound(service.resolveScope(VIEWER, `engagement:${ENGAGEMENT}`));
  });

  it('engagement: an unexpected read failure is a fixed-copy 500 (D55)', async () => {
    const { service, engagements } = await build();
    engagements.getById.mockRejectedValue(new Error('relation does not exist'));
    const promise = service.resolveScope(VIEWER, `engagement:${ENGAGEMENT}`);
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await promise.catch((err: InternalServerErrorException) => {
      expect(JSON.stringify(err.getResponse())).not.toContain('relation');
    });
  });

  it('engagement: the client hirer reads "Client hours" at its level, 404 at none', async () => {
    const { service, engagements } = await build();
    engagements.getById.mockResolvedValue({
      id: ENGAGEMENT,
      kind: 'client_services',
      viewer_position: 'hirer',
      project_links: [],
    });
    engagements.settingsInForceOn.mockResolvedValue({
      client_hours_detail_level: 'summary',
    });
    await expect(
      service.resolveScope(VIEWER, `engagement:${ENGAGEMENT}`),
    ).resolves.toMatchObject({
      viewerPosition: 'hirer',
      clientLevel: 'summary',
    });

    engagements.settingsInForceOn.mockResolvedValue({
      client_hours_detail_level: 'none',
    });
    await notFound(service.resolveScope(VIEWER, `engagement:${ENGAGEMENT}`));
    // A legacy engagement (no settings) is `none`.
    engagements.settingsInForceOn.mockResolvedValue(null);
    await notFound(service.resolveScope(VIEWER, `engagement:${ENGAGEMENT}`));
  });

  it('engagement: no policy workspace → an unhomed plan subject', async () => {
    const { service, engagements } = await build();
    engagements.policyWorkspaceFor.mockResolvedValue(null);
    const scope = await service.resolveScope(
      VIEWER,
      `engagement:${ENGAGEMENT}`,
    );
    expect(scope.planRef).toEqual({ workspaceId: null, exempt: false });
  });
});

// ── Entries ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeReportsService.entries', () => {
  const rows = [authRow({ id: 'e1' }), authRow({ id: 'e2' })];

  it('team scope: team-context entries in the policy-timezone range, newest first, with email (manager view)', async () => {
    const { service, db, authority } = await build({
      time_entries: () => ({ data: rows, count: 42 }),
    });
    const page = await service.entries(VIEWER, query({ page: 2, limit: 10 }));
    expect(page).toMatchObject({ total: 42, page: 2, limit: 10 });
    expect(page.items.map((i) => i.id)).toEqual(['e1', 'e2']);

    const [call] = entryCalls(db.calls);
    expect(call.select).toBe(ENTRY_AUTH_SELECT);
    expect(call.options).toEqual({ count: 'exact' });
    expect(call.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'context_kind', 'team'],
        ['eq', 'team_id', TEAM],
        // Manila: 2026-09-01 00:00 local = 2026-08-31T16:00Z; to 2026-09-30 inclusive.
        ['gte', 'started_at', '2026-08-31T16:00:00.000Z'],
        ['lt', 'started_at', '2026-09-30T16:00:00.000Z'],
        ['order', 'started_at', { ascending: false }],
        ['range', 10, 19],
      ]),
    );
    expect(authority.hydrate).toHaveBeenCalledWith(VIEWER, rows, {
      withEmail: true,
    });
  });

  it('project scope: governed contexts only (never personal), no email', async () => {
    const { service, db, authority } = await build({
      time_entries: () => ({ data: rows, count: 2 }),
    });
    await service.entries(VIEWER, query({ scope: `project:${PROJECT}` }));
    const [call] = entryCalls(db.calls);
    expect(call.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'project_id', PROJECT],
        ['neq', 'context_kind', 'personal'],
      ]),
    );
    expect(authority.hydrate).toHaveBeenCalledWith(VIEWER, rows, {
      withEmail: false,
    });
  });

  it('workspace scope: sheets whose policy workspace is W, through a column-hint inner embed', async () => {
    const { service, db } = await build({
      time_entries: () => ({ data: [], count: 0 }),
    });
    await service.entries(VIEWER, query({ scope: `workspace:${WORKSPACE}` }));
    const [call] = entryCalls(db.calls);
    expect(call.select).toContain('timesheets!timesheet_id!inner(');
    expect(call.select).not.toMatch(/_fkey/);
    expect(call.ops).toContainEqual([
      'eq',
      'timesheets.policy_workspace_id',
      WORKSPACE,
    ]);
  });

  it('talent engagement: assignment entries on sheets of that engagement', async () => {
    const { service, db } = await build({
      time_entries: () => ({ data: [], count: 0 }),
    });
    await service.entries(VIEWER, query({ scope: `engagement:${ENGAGEMENT}` }));
    const [call] = entryCalls(db.calls);
    expect(call.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'context_kind', 'assignment'],
        ['eq', 'timesheets.engagement_id', ENGAGEMENT],
      ]),
    );
  });

  it('client engagement (provider view): its assignments, plus the provider team on linked projects', async () => {
    const { service, db, engagements } = await build({
      time_entries: () => ({ data: [], count: 0 }),
    });
    engagements.getById.mockResolvedValue({
      id: ENGAGEMENT,
      kind: 'client_services',
      viewer_position: 'provider',
      project_links: [
        { project_id: LINKED_PROJECT, status: 'active' },
        { project_id: PROJECT, status: 'ended' },
      ],
    });
    engagements.assignmentIdsForClientEngagement.mockResolvedValue([
      ASSIGNMENT,
      ASSIGNMENT_2,
    ]);
    engagements.providerPartyTeamId.mockResolvedValue(PROVIDER_TEAM);
    await service.entries(VIEWER, query({ scope: `engagement:${ENGAGEMENT}` }));
    const [call] = entryCalls(db.calls);
    expect(call.ops).toContainEqual([
      'or',
      `engagement_assignment_id.in.(${ASSIGNMENT},${ASSIGNMENT_2}),` +
        `and(context_kind.eq.team,team_id.eq.${PROVIDER_TEAM},project_id.in.(${LINKED_PROJECT}))`,
    ]);
  });

  it('a client engagement with nothing to bill reads no entries', async () => {
    const { service, db, engagements } = await build();
    engagements.getById.mockResolvedValue({
      id: ENGAGEMENT,
      kind: 'client_services',
      viewer_position: 'provider',
      project_links: [],
    });
    await expect(
      service.entries(VIEWER, query({ scope: `engagement:${ENGAGEMENT}` })),
    ).resolves.toEqual({ items: [], total: 0, page: 1, limit: 100 });
    expect(entryCalls(db.calls)).toHaveLength(0);
  });

  it('a sheet-status filter joins the sheet and filters on it', async () => {
    const { service, db } = await build({
      time_entries: () => ({ data: [], count: 0 }),
    });
    await service.entries(VIEWER, query({ status: 'submitted' }));
    const [call] = entryCalls(db.calls);
    expect(call.select).toContain('timesheets!timesheet_id!inner(');
    expect(call.ops).toContainEqual(['eq', 'timesheets.status', 'submitted']);
  });

  it('L22 under a person filter: assignments whose worker the viewer may not name are excluded', async () => {
    const { service, db, authority } = await build({
      time_entries: (call) =>
        call.select.startsWith('engagement_assignment_id')
          ? {
              data: [
                { engagement_assignment_id: ASSIGNMENT, project_id: PROJECT },
                { engagement_assignment_id: ASSIGNMENT_2, project_id: PROJECT },
              ],
            }
          : { data: [], count: 0 },
    });
    // The viewer may name the worker under ASSIGNMENT_2 only.
    authority.identityVisible.mockImplementation(
      (_v: string, probe: EntryAuthRow[]) =>
        Promise.resolve(
          new Set(
            probe
              .filter((r) => r.engagement_assignment_id === ASSIGNMENT_2)
              .map((r) => r.id),
          ),
        ),
    );
    await service.entries(
      VIEWER,
      query({ scope: `project:${PROJECT}`, member_user_id: TALENT }),
    );
    const [probe, main] = entryCalls(db.calls);
    expect(probe.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'member_user_id', TALENT],
        ['eq', 'context_kind', 'assignment'],
      ]),
    );
    expect(main.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'member_user_id', TALENT],
        [
          'or',
          `engagement_assignment_id.is.null,engagement_assignment_id.not.in.(${ASSIGNMENT})`,
        ],
      ]),
    );
  });

  it('the person-filter probe reads every page, so an assignment past row 1000 is still excluded (W2 review F5)', async () => {
    const firstPage = Array.from({ length: 1000 }, () => ({
      engagement_assignment_id: ASSIGNMENT,
      project_id: PROJECT,
    }));
    const { service, db, authority } = await build({
      time_entries: (call) => {
        if (!call.select.startsWith('engagement_assignment_id')) {
          return { data: [], count: 0 };
        }
        return offsetOf(call) === 0
          ? { data: firstPage }
          : {
              data: [
                { engagement_assignment_id: ASSIGNMENT_2, project_id: PROJECT },
              ],
            };
      },
    });
    // The viewer may name neither worker.
    authority.identityVisible.mockResolvedValue(new Set<string>());
    await service.entries(
      VIEWER,
      query({ scope: `project:${PROJECT}`, member_user_id: TALENT }),
    );
    const calls = entryCalls(db.calls);
    const probes = calls.filter((c) =>
      c.select.startsWith('engagement_assignment_id'),
    );
    expect(probes.map(offsetOf)).toEqual([0, 1000]);
    // A stable order, so offset paging never skips or repeats a row.
    expect(probes[0].ops).toEqual(
      expect.arrayContaining([
        ['order', 'engagement_assignment_id', { ascending: true }],
        ['order', 'id', { ascending: true }],
        ['range', 0, 999],
      ]),
    );
    // One identity question per assignment, however many rows it has.
    expect(authority.identityVisible).toHaveBeenCalledTimes(1);
    expect(authority.identityVisible.mock.calls[0][1]).toHaveLength(2);
    const main = calls[calls.length - 1];
    expect(main.ops).toContainEqual([
      'or',
      `engagement_assignment_id.is.null,engagement_assignment_id.not.in.(${ASSIGNMENT},${ASSIGNMENT_2})`,
    ]);
  });

  it('a filter on your own person never probes identity', async () => {
    const { service, db, authority } = await build({
      time_entries: () => ({ data: [], count: 0 }),
    });
    await service.entries(
      VIEWER,
      query({ scope: `project:${PROJECT}`, member_user_id: VIEWER }),
    );
    expect(entryCalls(db.calls)).toHaveLength(1);
    expect(authority.identityVisible).not.toHaveBeenCalled();
  });

  it('dates: from after to and non-dates are 400s', async () => {
    const { service } = await build();
    await expect(
      service.entries(VIEWER, query({ from: '2026-09-30', to: '2026-09-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.entries(VIEWER, query({ from: 'yesterday' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an unmapped database error is a fixed-copy 500 with no Postgres text (D55)', async () => {
    const { service } = await build({
      time_entries: () => ({
        error: {
          code: '42P01',
          message: 'relation "time_entries" does not exist',
        },
      }),
    });
    const promise = service.entries(VIEWER, query());
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await promise.catch((err: InternalServerErrorException) => {
      expect(err.getResponse()).toMatchObject({ code: 'TIME_INTERNAL' });
      expect(JSON.stringify(err.getResponse())).not.toContain('relation');
    });
  });
});

describe('TimeReportsService "Client hours" (client hirer, CHANGE-7, D57)', () => {
  async function clientBuild(
    level: 'summary' | 'detailed',
    handlers: Record<string, Handler> = {},
  ) {
    const built = await build(handlers);
    built.engagements.getById.mockResolvedValue({
      id: ENGAGEMENT,
      kind: 'client_services',
      viewer_position: 'hirer',
      project_links: [{ project_id: LINKED_PROJECT, status: 'active' }],
    });
    built.engagements.settingsInForceOn.mockResolvedValue({
      client_hours_detail_level: level,
    });
    built.engagements.assignmentIdsForClientEngagement.mockResolvedValue([
      ASSIGNMENT,
    ]);
    built.engagements.providerPartyTeamId.mockResolvedValue(PROVIDER_TEAM);
    return built;
  }

  it('at summary there is no per-entry list', async () => {
    const { service } = await clientBuild('summary');
    await notFound(
      service.entries(VIEWER, query({ scope: `engagement:${ENGAGEMENT}` })),
    );
  });

  it('at detailed: approved hours only, the person only for client-only assignment time, never note or cost', async () => {
    const consultantRow = authRow({
      id: 'e-consultant',
      member_user_id: OTHER,
      context_kind: 'assignment',
      context_ref: ASSIGNMENT,
      team_id: null,
      engagement_assignment_id: ASSIGNMENT,
    });
    const teamRow = authRow({ id: 'e-team', team_id: PROVIDER_TEAM });
    const { service, db, authority } = await clientBuild('detailed', {
      time_entries: (call) => {
        if (call.select === ENTRY_AUTH_SELECT) {
          return { data: [consultantRow, teamRow], count: 2 };
        }
        const ids = inIds(call) ?? [];
        if (call.select.startsWith('id, context_kind, work_item')) {
          return {
            data: ids.map((id) => ({
              id,
              context_kind: id === 'e-team' ? 'team' : 'assignment',
              work_item: 'task',
              started_at: '2026-09-02T01:00:00.000Z',
              payable_seconds: 3600,
              source: 'timer',
              work_type_snapshot: 'real_work',
              project_id: LINKED_PROJECT,
              created_at: '2026-09-02T01:00:00.000Z',
              updated_at: '2026-09-02T01:00:00.000Z',
            })),
          };
        }
        if (call.select.startsWith('id, member_user_id')) {
          return {
            data: ids.map((id) => ({
              id,
              member_user_id: OTHER,
              member_display_name_snapshot: 'Chris Consultant',
              member: { id: OTHER, display_name: 'Chris Consultant' },
            })),
          };
        }
        return {
          data: ids.map((id) => ({
            id,
            task_id: 't1',
            task: {
              id: 't1',
              title: 'Logo',
              work_type: 'real_work',
              status: 'done',
            },
            project: { id: LINKED_PROJECT, title: 'Acme site' },
          })),
        };
      },
    });

    const page = await service.entries(
      VIEWER,
      query({
        scope: `engagement:${ENGAGEMENT}`,
        member_user_id: TALENT,
        status: 'open',
      }),
    );
    expect(authority.hydrate).not.toHaveBeenCalled();
    // identityVisible is asked about assignment rows only: team rows are never named to the client.
    expect(authority.identityVisible).toHaveBeenCalledWith(VIEWER, [
      consultantRow,
    ]);

    const [listCall, ...rest] = entryCalls(db.calls);
    // Approved only; the client's person and status filters are ignored.
    expect(listCall.ops).toEqual(
      expect.arrayContaining([['not', 'payable_seconds', 'is', null]]),
    );
    expect(
      listCall.ops.some((o) => o[0] === 'eq' && o[1] === 'member_user_id'),
    ).toBe(false);
    expect(listCall.select).not.toContain('timesheets!');
    const orOp = listCall.ops.find((o) => o[0] === 'or');
    expect(orOp?.[1]).toContain(
      'or(legacy_status.is.null,legacy_status.neq.rejected)',
    );
    for (const call of rest) {
      expect(call.select).not.toMatch(
        /note|rate_snapshot|amount_snapshot|decision/,
      );
    }

    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get('e-consultant')).toMatchObject({
      identity: 'visible',
      member_display_name_snapshot: 'Chris Consultant',
      content: 'visible',
      note: null,
      cost: 'hidden',
      payable_seconds: 3600,
      timesheet: null,
      duration_seconds: null,
    });
    expect(byId.get('e-team')).toMatchObject({
      identity: 'masked',
      member_user_id: null,
      member_label: 'Delivery team',
    });
    expect(byId.get('e-team')).not.toHaveProperty('rate_snapshot');
  });

  it('summary totals are approved hours, grouped by day at summary level, never priced', async () => {
    const { service, authority } = await clientBuild('summary', {
      time_entries: (call) =>
        offsetOf(call) === 0
          ? {
              data: [
                {
                  ...authRow({ id: 'e1' }),
                  duration_seconds: 9000,
                  payable_seconds: 7200,
                  legacy_status: null,
                  work_item: 'task',
                  context_label_snapshot: 'Studio',
                  timesheets: { status: 'approved' },
                },
              ],
            }
          : { data: [] },
    });
    const summary = await service.summary(
      VIEWER,
      query({ scope: `engagement:${ENGAGEMENT}`, group_by: 'member' }),
    );
    expect(summary.total_seconds).toBe(7200);
    expect(summary.payable_seconds).toBe(7200);
    expect(summary.groups).toEqual([
      {
        key: '2026-09-02',
        label: '2026-09-02',
        total_seconds: 7200,
        payable_seconds: 7200,
      },
    ]);
    expect(authority.costVisible).not.toHaveBeenCalled();
  });

  it('A5: "hours by week" at summary and at detailed, in the engagement week, with no identity or cost read', async () => {
    const approvedRow = {
      ...authRow({ id: 'e1' }),
      duration_seconds: 9000,
      payable_seconds: 7200,
      legacy_status: null,
      work_item: 'task',
      context_label_snapshot: 'Studio',
      timesheets: { status: 'approved' },
    };
    const rowsHandler: Record<string, Handler> = {
      time_entries: (call) =>
        offsetOf(call) === 0 ? { data: [approvedRow] } : { data: [] },
    };
    for (const level of ['summary', 'detailed'] as const) {
      const { service, policy, authority } = await clientBuild(
        level,
        rowsHandler,
      );
      policy.resolve.mockResolvedValue({
        timezone: 'Asia/Manila',
        week_start: 1,
      });
      const summary = await service.summary(
        VIEWER,
        query({ scope: `engagement:${ENGAGEMENT}`, group_by: 'week' }),
      );
      expect(summary.groups).toEqual([
        {
          key: '2026-08-31',
          label: 'Aug 31–Sep 6',
          total_seconds: 7200,
          payable_seconds: 7200,
        },
      ]);
      expect(authority.costVisible).not.toHaveBeenCalled();
      expect(authority.identityVisible).not.toHaveBeenCalled();
    }
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeReportsService.summary', () => {
  const summaryRow = (partial: Record<string, unknown>) => ({
    ...authRow(),
    duration_seconds: 3600,
    payable_seconds: null,
    legacy_status: null,
    work_item: 'task',
    context_label_snapshot: 'Design team',
    timesheets: { status: 'open' },
    ...partial,
  });

  const rows = [
    // Approved, capped: 2 h logged, 1.5 h payable, 750 PHP (cost-visible).
    summaryRow({
      id: 'e1',
      timesheet_id: 's1',
      duration_seconds: 7200,
      payable_seconds: 5400,
      timesheets: { status: 'approved' },
    }),
    // Same sheet, approved, cost hidden for this viewer.
    summaryRow({
      id: 'e2',
      timesheet_id: 's1',
      member_user_id: VIEWER,
      payable_seconds: 3600,
      timesheets: { status: 'approved' },
    }),
    // Open sheet, Manila next day (16:30Z = 00:30 local on the 3rd).
    summaryRow({
      id: 'e3',
      timesheet_id: 's2',
      started_at: '2026-09-02T16:30:00.000Z',
    }),
    // Legacy rejected: out of every total (E64).
    summaryRow({
      id: 'e4',
      timesheet_id: 's3',
      duration_seconds: 2_678_400,
      payable_seconds: 0,
      legacy_status: 'rejected',
      timesheets: { status: 'approved' },
    }),
  ];

  function handlers(extra: Record<string, Handler> = {}) {
    return {
      time_entries: (call: Call) => {
        if (call.select.startsWith(ENTRY_AUTH_SELECT)) {
          return offsetOf(call) === 0 ? { data: rows } : { data: [] };
        }
        const ids = inIds(call) ?? [];
        if (call.select.startsWith('id, currency_snapshot')) {
          return {
            data: ids.map((id) => ({
              id,
              currency_snapshot: 'php',
              amount_snapshot: '750.10',
            })),
          };
        }
        if (call.select.startsWith('id, member_user_id')) {
          return {
            data: ids.map((id) => ({
              id,
              member_user_id: id === 'e2' ? VIEWER : OTHER,
              member_display_name_snapshot: id === 'e2' ? 'Me' : 'Ann',
              member: null,
            })),
          };
        }
        if (call.select.startsWith('id, task_id')) {
          return {
            data: ids.map((id) => ({
              id,
              task_id: 't1',
              task: { id: 't1', title: 'Logo' },
              project: { id: PROJECT, title: 'Acme site' },
            })),
          };
        }
        return { data: [] };
      },
      ...extra,
    };
  }

  it('totals: logged seconds and Approved payable_seconds; distinct sheets per status; legacy rejected out', async () => {
    const { service, authority } = await build(handlers());
    authority.costVisible.mockResolvedValue(new Set(['e1']));
    const summary = await service.summary(VIEWER, query());
    expect(summary.scope).toEqual({ kind: 'team', id: TEAM });
    expect(summary.timezone).toBe('Asia/Manila');
    expect(summary.total_seconds).toBe(7200 + 3600 + 3600);
    expect(summary.payable_seconds).toBe(5400 + 3600);
    expect(summary.sheet_status_counts).toEqual({
      open: 1,
      submitted: 0,
      returned: 0,
      approved: 1,
    });
    // Day groups in the scope's timezone, ascending; amounts only for cost-visible rows, rounded once.
    expect(summary.groups).toEqual([
      {
        key: '2026-09-02',
        label: '2026-09-02',
        total_seconds: 10800,
        payable_seconds: 9000,
        amounts_by_currency: { PHP: 750.1 },
      },
      {
        key: '2026-09-03',
        label: '2026-09-03',
        total_seconds: 3600,
        payable_seconds: 0,
      },
    ]);
  });

  it('cost is fetched only for cost-visible, approved rows', async () => {
    const { service, db, authority } = await build(handlers());
    authority.costVisible.mockResolvedValue(new Set(['e1', 'e3']));
    await service.summary(VIEWER, query());
    const costCall = entryCalls(db.calls).find((c) =>
      c.select.startsWith('id, currency_snapshot'),
    );
    expect(inIds(costCall as Call)).toEqual(['e1']);
  });

  it('group_by member: names only where identity is visible; masked rows group per assignment as "Delivery team"', async () => {
    const masked = summaryRow({
      id: 'e5',
      member_user_id: TALENT,
      context_kind: 'assignment',
      context_ref: ASSIGNMENT,
      team_id: null,
      engagement_assignment_id: ASSIGNMENT,
    });
    const { service, db, authority } = await build({
      time_entries: (call: Call) => {
        if (call.select.startsWith(ENTRY_AUTH_SELECT)) {
          return offsetOf(call) === 0
            ? { data: [rows[0], masked] }
            : { data: [] };
        }
        return handlers().time_entries(call);
      },
    });
    authority.identityVisible.mockResolvedValue(new Set(['e1']));
    const summary = await service.summary(
      VIEWER,
      query({ scope: `project:${PROJECT}`, group_by: 'member' }),
    );
    const identityCall = entryCalls(db.calls).find(
      (c) => c.select === ENTRY_IDENTITY_SELECT,
    );
    expect(inIds(identityCall as Call)).toEqual(['e1']);
    expect(summary.groups.map((g) => [g.key, g.label])).toEqual(
      expect.arrayContaining([
        [OTHER, 'Ann'],
        [`masked:${ASSIGNMENT}`, 'Delivery team'],
      ]),
    );
    expect(JSON.stringify(summary)).not.toContain(TALENT);
  });

  it('group_by project: a project the viewer cannot open reads "A project you can\'t open"', async () => {
    const { service, authority } = await build(handlers());
    authority.contentVisible.mockResolvedValue(new Set<string>());
    const outsider = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const summary = await service.summary(
      outsider,
      query({ group_by: 'project' }),
    );
    expect(summary.groups.map((g) => g.label)).toEqual([
      "A project you can't open",
    ]);
  });

  it('team scope adds "Under agreements": hours of assignments whose team_id is the team (L35)', async () => {
    const { service, engagements } = await build({
      ...handlers(),
      project_teams: () => ({
        data: [{ project_id: PROJECT }, { project_id: LINKED_PROJECT }],
      }),
      time_entries: (call: Call) => {
        if (call.select === 'id, duration_seconds, legacy_status') {
          return offsetOf(call) === 0
            ? {
                data: [
                  { duration_seconds: 1800, legacy_status: null },
                  { duration_seconds: 99_999, legacy_status: 'rejected' },
                ],
              }
            : { data: [] };
        }
        return handlers().time_entries(call);
      },
    });
    engagements.assignmentsForProject.mockImplementation((p: string) =>
      Promise.resolve(
        p === PROJECT
          ? [
              { id: ASSIGNMENT, team_id: TEAM },
              { id: ASSIGNMENT_2, team_id: PROVIDER_TEAM },
            ]
          : [],
      ),
    );
    const summary = await service.summary(VIEWER, query());
    expect(summary.under_agreements_seconds).toBe(1800);
  });

  // ── A5: group_by=week ──
  // 2026-09-02 is a Wednesday. 2026-09-06T20:00Z is Sunday in UTC but Monday 04:00 in Manila.
  const weekRows = [
    summaryRow({
      id: 'w1',
      timesheet_id: 's1',
      duration_seconds: 7200,
      payable_seconds: 3600,
      timesheets: { status: 'approved' },
    }),
    summaryRow({
      id: 'w2',
      timesheet_id: 's1',
      started_at: '2026-09-02T16:30:00.000Z',
    }),
    summaryRow({
      id: 'w3',
      timesheet_id: 's2',
      started_at: '2026-09-06T20:00:00.000Z',
      duration_seconds: 1800,
    }),
    // Legacy rejected: never in a week total (E64).
    summaryRow({
      id: 'w4',
      timesheet_id: 's3',
      duration_seconds: 99_999,
      payable_seconds: 0,
      legacy_status: 'rejected',
      timesheets: { status: 'approved' },
    }),
  ];
  const weekHandlers = (): Record<string, Handler> => ({
    time_entries: (call: Call) =>
      call.select.startsWith(ENTRY_AUTH_SELECT) && offsetOf(call) === 0
        ? { data: weekRows }
        : { data: [] },
  });

  it('A5 team scope: weeks of the team policy (timezone and Monday start), keyed by week start, ascending', async () => {
    const { service, policy } = await build(weekHandlers());
    const summary = await service.summary(VIEWER, query({ group_by: 'week' }));
    expect(summary.groups).toEqual([
      {
        key: '2026-08-31',
        label: 'Aug 31–Sep 6',
        total_seconds: 7200 + 3600,
        payable_seconds: 3600,
      },
      {
        key: '2026-09-07',
        label: 'Sep 7–13',
        total_seconds: 1800,
        payable_seconds: 0,
      },
    ]);
    expect(summary.total_seconds).toBe(7200 + 3600 + 1800);
    expect(policy.teamPeriodBasics).toHaveBeenCalledWith(TEAM);
    expect(policy.workspacePeriodBasics).not.toHaveBeenCalled();
  });

  it('A5: the policy week start moves the week (Sunday)', async () => {
    const { service, policy } = await build(weekHandlers());
    policy.teamPeriodBasics.mockResolvedValue({
      timezone: 'Asia/Manila',
      week_start: 7,
    });
    const summary = await service.summary(VIEWER, query({ group_by: 'week' }));
    expect(summary.groups.map((g) => [g.key, g.label])).toEqual([
      ['2026-08-30', 'Aug 30–Sep 5'],
      ['2026-09-06', 'Sep 6–12'],
    ]);
  });

  it('A5 project and workspace scopes read the week start of the governing workspace policy row', async () => {
    const project = await build(weekHandlers());
    project.policy.workspacePeriodBasics.mockResolvedValue({
      timezone: 'Asia/Manila',
      week_start: 3,
    });
    const byProject = await project.service.summary(
      VIEWER,
      query({ scope: `project:${PROJECT}`, group_by: 'week' }),
    );
    expect(project.policy.workspacePeriodBasics).toHaveBeenCalledWith(
      WORKSPACE,
    );
    // Wednesday start: Sep 2 opens its own week.
    expect(byProject.groups.map((g) => g.key)).toEqual(['2026-09-02']);

    const ws = await build(weekHandlers());
    await ws.service.summary(
      VIEWER,
      query({ scope: `workspace:${WORKSPACE}`, group_by: 'week' }),
    );
    expect(ws.policy.workspacePeriodBasics).toHaveBeenCalledWith(WORKSPACE);
    expect(ws.policy.teamPeriodBasics).not.toHaveBeenCalled();
  });

  it('A5 engagement scope: the week start comes from the same resolve as the timezone (no extra read)', async () => {
    const { service, policy } = await build(weekHandlers());
    policy.resolve.mockResolvedValue({
      timezone: 'Asia/Manila',
      week_start: 7,
    });
    const summary = await service.summary(
      VIEWER,
      query({ scope: `engagement:${ENGAGEMENT}`, group_by: 'week' }),
    );
    expect(summary.groups.map((g) => g.key)).toEqual([
      '2026-08-30',
      '2026-09-06',
    ]);
    expect(policy.teamPeriodBasics).not.toHaveBeenCalled();
    expect(policy.workspacePeriodBasics).not.toHaveBeenCalled();
  });

  it('A5: other groupings never read the week start', async () => {
    const { service, policy } = await build(weekHandlers());
    await service.summary(VIEWER, query({ group_by: 'day' }));
    await service.summary(VIEWER, query());
    expect(policy.teamPeriodBasics).not.toHaveBeenCalled();
    expect(policy.workspacePeriodBasics).not.toHaveBeenCalled();
  });
});

// ── Exports ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeReportsService.export', () => {
  const csvText = (body: Buffer) => body.subarray(3).toString('utf8');

  it('gates every export on time_reports_export of the scope plan subject (team → planRefForTeam)', async () => {
    const { service, entitlements, db } = await build();
    entitlements.assertFeature.mockRejectedValue(
      new ForbiddenException({ code: 'plan_limit' }),
    );
    await expect(service.export(VIEWER, query())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(entitlements.assertFeature).toHaveBeenCalledWith(
      WORKSPACE,
      'time_reports_export',
    );
    expect(entryCalls(db.calls)).toHaveLength(0);
  });

  it('E68: masked person, hidden content label, no email; cost columns only when a row is cost-visible', async () => {
    const { service, authority } = await build({
      time_entries: (call) =>
        offsetOf(call) === 0
          ? { data: [authRow({ id: 'e1' }), authRow({ id: 'e2' })], count: 2 }
          : { data: [] },
    });
    authority.hydrate.mockResolvedValue([
      view({ id: 'e1' }),
      view({
        id: 'e2',
        identity: 'masked',
        member_user_id: null,
        member_display_name_snapshot: null,
        member: null,
        member_label: 'Delivery team',
        content: 'hidden',
        task_id: null,
        note: null,
        task: null,
        project: null,
        content_label: "A project you can't open",
      }),
    ]);
    const file = await service.export(VIEWER, query());
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.filename).toMatch(
      /^proyekto-time-team-11111111-2026-09-01-2026-09-30\.csv$/,
    );
    const text = csvText(file.body);
    const [header] = text.split('\r\n');
    expect(header).toContain('Approved hours');
    expect(header).toContain('For');
    expect(header).not.toMatch(/email/i);
    expect(header).not.toContain('Rate');
    expect(text).toContain('Delivery team');
    expect(text).toContain("A project you can't open");
    expect(text).toContain('Logo pass');
    expect(text).toContain('2026-09-02');
  });

  it('cost-visible rows carry rate and amount; the others leave them blank', async () => {
    const { service, authority } = await build({
      time_entries: (call) =>
        offsetOf(call) === 0
          ? { data: [authRow({ id: 'e1' }), authRow({ id: 'e2' })], count: 2 }
          : { data: [] },
    });
    authority.hydrate.mockResolvedValue([
      view({
        id: 'e1',
        cost: 'visible',
        rate_snapshot: 500,
        rate_type_snapshot: 'hourly',
        currency_snapshot: 'PHP',
        amount_snapshot: 750,
      }),
      view({ id: 'e2', note: 'second' }),
    ]);
    const file = await service.export(VIEWER, query({ format: 'xlsx' }));
    expect(file.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(file.filename.endsWith('.xlsx')).toBe(true);

    const csv = await service.export(VIEWER, query());
    const lines = csvText(csv.body).split('\r\n');
    expect(lines[0]).toContain('Rate');
    expect(lines[1]).toContain('750');
    expect(lines[2].endsWith(',,,')).toBe(true);
  });

  it(`refuses more than ${EXPORT_MAX_ROWS} entries with a 400`, async () => {
    const { service } = await build({
      time_entries: () => ({ data: [], count: EXPORT_MAX_ROWS + 1 }),
    });
    await expect(service.export(VIEWER, query())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('the client hirer exports "Client hours" at detailed only, with client columns', async () => {
    const { service, engagements, authority } = await build({
      time_entries: (call) => {
        if (call.select === ENTRY_AUTH_SELECT) {
          return offsetOf(call) === 0
            ? { data: [authRow({ id: 'e1' })], count: 1 }
            : { data: [] };
        }
        return { data: [] };
      },
    });
    engagements.getById.mockResolvedValue({
      id: ENGAGEMENT,
      kind: 'client_services',
      viewer_position: 'hirer',
      project_links: [],
    });
    engagements.assignmentIdsForClientEngagement.mockResolvedValue([
      ASSIGNMENT,
    ]);
    engagements.settingsInForceOn.mockResolvedValue({
      client_hours_detail_level: 'summary',
    });
    await notFound(
      service.export(VIEWER, query({ scope: `engagement:${ENGAGEMENT}` })),
    );

    engagements.settingsInForceOn.mockResolvedValue({
      client_hours_detail_level: 'detailed',
    });
    const file = await service.export(
      VIEWER,
      query({ scope: `engagement:${ENGAGEMENT}` }),
    );
    const [header] = csvText(file.body).split('\r\n');
    expect(header).toBe('Date,Person,Project,Task,Work item,Approved hours');
    expect(authority.hydrate).not.toHaveBeenCalled();
  });
});

describe('TimeReportsService.auditExport', () => {
  const audit = (partial: Record<string, unknown> = {}) => ({
    scope: `workspace:${WORKSPACE}`,
    from: '2026-09-01',
    to: '2026-09-30',
    ...partial,
  });

  it('managers only (404), then time_audit_export', async () => {
    const { service, authority, entitlements } = await build();
    authority.canManageWorkspace.mockResolvedValue(false);
    await notFound(service.auditExport(VIEWER, audit() as never));
    expect(entitlements.assertFeature).not.toHaveBeenCalled();

    authority.canManageWorkspace.mockResolvedValue(true);
    entitlements.assertFeature.mockRejectedValue(
      new ForbiddenException({ code: 'plan_limit' }),
    );
    await expect(
      service.auditExport(VIEWER, audit() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(entitlements.assertFeature).toHaveBeenCalledWith(
      WORKSPACE,
      'time_audit_export',
    );
  });

  it('timesheet events and policy changes in time order; placed talent masked from non-parties (L22)', async () => {
    const sheetJoin = (partial: Record<string, unknown>) => ({
      policy_workspace_id: WORKSPACE,
      scope_kind: 'workspace',
      engagement_id: null,
      member_display_name_snapshot: 'Ann',
      scope_label_snapshot: 'Acme',
      period_start: '2026-08-31',
      period_end: '2026-09-06',
      ...partial,
    });
    const { service, db, engagements } = await build({
      timesheet_events: (call) =>
        offsetOf(call) === 0
          ? {
              data: [
                {
                  id: 1,
                  timesheet_id: 's1',
                  actor_user_id: OTHER,
                  event: 'submitted',
                  from_status: 'open',
                  to_status: 'submitted',
                  note: null,
                  total_seconds: 7200,
                  payable_seconds: null,
                  revision: 1,
                  created_at: '2026-09-07T01:00:00.000Z',
                  timesheets: sheetJoin({}),
                },
                {
                  id: 2,
                  timesheet_id: 's2',
                  actor_user_id: null,
                  event: 'approved',
                  from_status: 'submitted',
                  to_status: 'approved',
                  note: null,
                  total_seconds: 3600,
                  payable_seconds: 3600,
                  revision: 2,
                  created_at: '2026-09-08T01:00:00.000Z',
                  timesheets: sheetJoin({
                    scope_kind: 'engagement',
                    engagement_id: ENGAGEMENT,
                    member_display_name_snapshot: 'Leo Talent',
                    scope_label_snapshot: 'Pixel Studio',
                  }),
                },
              ],
            }
          : { data: [] },
      teams: () => ({ data: [{ id: TEAM, name: 'Design team' }] }),
      time_policy_events: (call) =>
        offsetOf(call) === 0
          ? {
              data: [
                {
                  id: 9,
                  policy_id: null,
                  actor_user_id: VIEWER,
                  changes: { deleted: true },
                  scope: 'team',
                  team_id: TEAM,
                  workspace_id: null,
                  created_at: '2026-09-07T12:00:00.000Z',
                },
              ],
            }
          : { data: [] },
      profiles: () => ({
        data: [
          { id: OTHER, display_name: 'Ann' },
          { id: VIEWER, display_name: 'Viewer Admin' },
        ],
      }),
    });
    engagements.engagementKind.mockResolvedValue('talent_services');
    engagements.isParty.mockResolvedValue(null);

    const file = await service.auditExport(VIEWER, audit() as never);
    expect(file.filename).toMatch(/^proyekto-time-audit-33333333-/);
    const lines = file.body.subarray(3).toString('utf8').split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('submitted');
    expect(lines[2]).toContain('Team policy · Design team');
    expect(lines[2]).toContain('deleted');
    expect(lines[3]).toContain('Delivery team');
    expect(lines[3]).toContain('Proyekto');
    expect(lines.join('\n')).not.toContain('Leo Talent');

    const eventsCall = db.calls.find((c) => c.table === 'timesheet_events');
    expect(eventsCall?.select).toContain('timesheets!timesheet_id!inner(');
    expect(eventsCall?.ops).toContainEqual([
      'eq',
      'timesheets.policy_workspace_id',
      WORKSPACE,
    ]);
    const policyCall = db.calls.find((c) => c.table === 'time_policy_events');
    expect(policyCall?.ops).toContainEqual([
      'or',
      `workspace_id.eq.${WORKSPACE},team_id.in.(${TEAM})`,
    ]);
  });
});
