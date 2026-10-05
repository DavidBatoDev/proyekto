/**
 * M3 rename compatibility (supabase/migrations/20261003110000_rename_time_entries.sql).
 *
 * From M3 the entry tables are time_entries, time_entry_segments and time_entry_comments. The old names
 * stay until M5 as column-for-column, security-invoker views, so the previous backend revision (the
 * rollback target) and every old select string keep working. Against the configured database this spec
 * proves:
 *   - writes through the task_time_logs view (old shape, no context columns) land on time_entries with the
 *     context and work_item derived (trg_10) and a timesheet chosen (trg_30); an old-shape review writes
 *     legacy_reviewed_*; segments and comments round-trip through their views;
 *   - the old FK-name embed hints resolve through the views (MD-15), including the !inner form with an exact
 *     count, and the new column-hint selects (time-entry.select.ts) resolve on the renamed tables;
 *   - anon and authenticated can neither read the 3 views and 3 tables nor execute an M2/M3 function.
 *
 * Two blocks, neither of which boots AppModule:
 *   - the write block runs on the hosted dev project only; fixtures come from Harness (loaded lazily, see
 *     below) and are removed by its cleanup(), which calls time_test_cleanup first;
 *   - the read-only block runs on dev, and on production only when the person running it sets
 *     TIME_RENAME_COMPAT_PROD_READONLY=1. It only SELECTs (service role, limit 1) and probes
 *     anon/authenticated denials with arguments that would be no-ops even if a grant were wrong
 *     (random ids; time_legacy_backfill is never called).
 *
 * This file is the one intended user of the old relation names in backend/ (blueprint §5.4).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

import type { Harness } from './harness';
import {
  COMMENT_SELECT,
  COMMENT_SELECT_WITH_EMAIL,
  ENTRY_AUTH_SELECT,
  ENTRY_BASE_SELECT,
  ENTRY_CONTENT_SELECT,
  ENTRY_COST_SELECT,
  ENTRY_IDENTITY_EMAIL_SELECT,
  ENTRY_IDENTITY_SELECT,
  ENTRY_LEGACY_REVIEW_SELECT,
  ENTRY_SELF_SELECT,
  SEGMENT_SELECT,
  TIMESHEET_DETAIL_SELECT,
  TIMESHEET_EVENT_SELECT,
} from '../../src/modules/execution/time/time-entry.select';

jest.setTimeout(120000);

// Same predicate as harness.describeDevOnly, computed here so the read-only
// block never loads harness.ts (which imports AppModule) on production.
const DEV_PROJECT_REF = 'vyiedlwasdwmjbztqznl';
const PROD_PROJECT_REF = 'byvbnkpiselvvulsvxgo';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ON_DEV = SUPABASE_URL.includes(DEV_PROJECT_REF);
const PROD_READS_ALLOWED =
  SUPABASE_URL.includes(PROD_PROJECT_REF) &&
  process.env.TIME_RENAME_COMPAT_PROD_READONLY === '1';
const describeDevWrites = ON_DEV ? describe : describe.skip;
const describeReadOnly =
  ON_DEV || PROD_READS_ALLOWED ? describe : describe.skip;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[integration] missing ${name}; set it in backend/.env.development.local.`,
    );
  }
  return value;
}

function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A PostgREST client with no JWT (role anon), or with a minted authenticated JWT. */
function publicClient(authenticated: boolean): SupabaseClient {
  const headers: Record<string, string> = {};
  if (authenticated) {
    const token = jwt.sign(
      { sub: randomUUID(), role: 'authenticated', aud: 'authenticated' },
      env('SUPABASE_JWT_SECRET'),
      { algorithm: 'HS256', expiresIn: '10m' },
    );
    headers.Authorization = `Bearer ${token}`;
  }
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Fails with the label and the PostgREST error, so a broken hint names its call site. */
function assertOk(
  label: string,
  error: { message: string; code?: string } | null,
) {
  expect({
    label,
    error: error ? `${error.code}: ${error.message}` : null,
  }).toEqual({
    label,
    error: null,
  });
}

// ── Old backend select strings, verbatim from feat/time-rebuild@91d227aa ────

/** team-time.service.ts:28-40 (also the mutation .select() of every log write). */
const TIME_LOG_SELECT = `
  id, project_id, task_id, member_user_id, team_id, started_at, ended_at,
  duration_seconds, break_minutes, break_seconds, paused_at,
  status, reviewed_by, reviewed_at, review_note, source,
  rate_snapshot, rate_type_snapshot, currency_snapshot, work_type_snapshot,
  member_display_name_snapshot, flagged_reason,
  created_at, updated_at,
  task:roadmap_tasks!task_time_logs_task_id_fkey(id, title, work_type, status),
  member:profiles!task_time_logs_member_user_id_fkey(id, display_name, avatar_url, first_name, last_name, email),
  reviewer:profiles!task_time_logs_reviewed_by_fkey(id, display_name, avatar_url),
  project:projects!task_time_logs_project_id_fkey(id, title)
`;

/** team-time.service.ts:2198-2203: the task-status filter needs an inner join. */
const TIME_LOG_SELECT_INNER = TIME_LOG_SELECT.replace(
  'task:roadmap_tasks!task_time_logs_task_id_fkey(',
  'task:roadmap_tasks!task_time_logs_task_id_fkey!inner(',
);

/** team-time.service.ts:69-74. */
const TIME_LOG_COMMENT_SELECT = `
  id, log_id, author_user_id, body, created_at, updated_at,
  author:profiles!time_log_comments_author_user_id_fkey(
    id, display_name, avatar_url, first_name, last_name, email
  )
`;

/** team-time.service.ts:76. */
const TIME_LOG_SEGMENT_SELECT = `id, log_id, kind, started_at, ended_at, created_at`;

/** Every other old read through the entry view (MD-15 rows). */
const OLD_VIEW_SELECTS: Array<{ site: string; select: string }> = [
  { site: 'team-time.service.ts:28 TIME_LOG_SELECT', select: TIME_LOG_SELECT },
  {
    site: 'team-time.service.ts:1172 member list',
    select:
      'member:profiles!task_time_logs_member_user_id_fkey(id, display_name, avatar_url, email)',
  },
  {
    site: 'payouts.service.ts:388 owed',
    select: `member_user_id, currency_snapshot, duration_seconds, rate_snapshot,
           member:profiles!task_time_logs_member_user_id_fkey(id, display_name, avatar_url, first_name, last_name, email)`,
  },
  {
    site: 'payouts.service.ts:455 payout logs',
    select: `id, project_id, task_id, started_at, ended_at, duration_seconds,
         rate_snapshot, currency_snapshot, status,
         task:roadmap_tasks!task_time_logs_task_id_fkey(id, title),
         project:projects!task_time_logs_project_id_fkey(id, title)`,
  },
  {
    site: 'finance-export.service.ts:125 export rows',
    select: `project_id, member_user_id, started_at, ended_at, duration_seconds,
         break_minutes, status, source, rate_snapshot, currency_snapshot,
         member_display_name_snapshot, flagged_reason,
         project:projects(title),
         task:roadmap_tasks!task_time_logs_task_id_fkey(title)`,
  },
  {
    site: 'invoice-composition.service.ts:169 billable hours',
    select:
      'id, started_at, duration_seconds, status, work_type_snapshot, task:roadmap_tasks!task_time_logs_task_id_fkey(title)',
  },
];

/** The view's 26 columns, in the old tables' ordinal order (prod and dev). */
const OLD_LOG_COLUMNS = [
  'id',
  'project_id',
  'task_id',
  'member_user_id',
  'started_at',
  'ended_at',
  'duration_seconds',
  'status',
  'reviewed_by',
  'reviewed_at',
  'review_note',
  'source',
  'created_at',
  'updated_at',
  'rate_snapshot',
  'currency_snapshot',
  'team_id',
  'work_type_snapshot',
  'payout_id',
  'rate_type_snapshot',
  'break_minutes',
  'paused_at',
  'break_seconds',
  'member_display_name_snapshot',
  'engagement_assignment_id',
  'flagged_reason',
];

/** New column-hint selects on the renamed tables (blueprint §2.4). */
const NEW_SELECTS: Array<{ table: string; name: string; select: string }> = [
  {
    table: 'time_entries',
    name: 'ENTRY_AUTH_SELECT',
    select: ENTRY_AUTH_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_BASE_SELECT',
    select: ENTRY_BASE_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_IDENTITY_SELECT',
    select: ENTRY_IDENTITY_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_IDENTITY_EMAIL_SELECT',
    select: ENTRY_IDENTITY_EMAIL_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_CONTENT_SELECT',
    select: ENTRY_CONTENT_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_COST_SELECT',
    select: ENTRY_COST_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_SELF_SELECT',
    select: ENTRY_SELF_SELECT,
  },
  {
    table: 'time_entries',
    name: 'ENTRY_LEGACY_REVIEW_SELECT',
    select: ENTRY_LEGACY_REVIEW_SELECT,
  },
  {
    table: 'time_entry_segments',
    name: 'SEGMENT_SELECT',
    select: SEGMENT_SELECT,
  },
  {
    table: 'time_entry_comments',
    name: 'COMMENT_SELECT',
    select: COMMENT_SELECT,
  },
  {
    table: 'time_entry_comments',
    name: 'COMMENT_SELECT_WITH_EMAIL',
    select: COMMENT_SELECT_WITH_EMAIL,
  },
  {
    table: 'timesheets',
    name: 'TIMESHEET_DETAIL_SELECT',
    select: TIMESHEET_DETAIL_SELECT,
  },
  {
    table: 'timesheet_events',
    name: 'TIMESHEET_EVENT_SELECT',
    select: TIMESHEET_EVENT_SELECT,
  },
];

/** The two public roles PostgREST serves: no JWT, and a signed-in user. */
const ROLES: Array<[role: string, authenticated: boolean]> = [
  ['anon', false],
  ['authenticated', true],
];

const TIME_RELATIONS = [
  'task_time_logs',
  'task_time_log_segments',
  'time_log_comments',
  'time_entries',
  'time_entry_segments',
  'time_entry_comments',
];

/**
 * Every callable function M2/M3 creates or rebuilds, with arguments that are
 * no-ops if the call ever ran (random ids, an empty id list, a missing QA key).
 * time_legacy_backfill is left out on purpose (it writes markers by fact); the
 * M3 verification block's catalog ACL query covers it. Trigger functions are
 * not callable through PostgREST.
 */
function functionProbes(): Array<{
  fn: string;
  args: Record<string, unknown>;
}> {
  const id = () => randomUUID();
  return [
    { fn: 'time_raise', args: { p_code: 'ITEST_ACL_PROBE' } },
    { fn: 'time_legacy_sheet_facts', args: { p_timesheet_id: id() } },
    { fn: 'time_legacy_freeze', args: { p_timesheet_id: id() } },
    {
      fn: 'create_payout_and_mark_paid',
      args: {
        p_team_id: id(),
        p_member_user_id: id(),
        p_created_by: id(),
        p_currency: 'USD',
        p_log_ids: [id()],
      },
    },
    {
      fn: 'void_payout_and_revert',
      args: { p_payout_id: id(), p_actor: id() },
    },
    { fn: 'time_policy_delete', args: { p_policy_id: id(), p_actor: id() } },
    { fn: 'time_test_cleanup', args: { p_project_id: id() } },
    { fn: 'account_deletion_team_has_open_time', args: { p_team_id: id() } },
    {
      fn: 'account_deletion_workspace_has_open_time',
      args: { p_workspace_id: id() },
    },
    {
      fn: 'account_deletion_close_running_entries_for_workspace',
      args: { p_workspace_id: id() },
    },
    { fn: 'account_deletion_purge_team', args: { p_team_id: id() } },
    { fn: 'account_deletion_purge_workspace', args: { p_workspace_id: id() } },
    { fn: 'account_deletion_preflight', args: { p_user_id: id() } },
    { fn: 'delete_account', args: { p_user_id: id() } },
    { fn: 'reset_qa_fixture', args: { p_key: 'itest-acl-probe-missing' } },
    {
      fn: 'time_timesheet_transition',
      args: {
        p_ids: [id()],
        p_actor: id(),
        p_action: 'withdraw',
        p_expected_revisions: [0],
      },
    },
    {
      fn: 'time_scope_deciders',
      args: {
        p_approver_scope: 'team',
        p_team_id: id(),
        p_policy_workspace_id: id(),
        p_engagement_id: id(),
        p_member_user_id: id(),
      },
    },
    { fn: 'time_timesheet_deciders', args: { p_timesheet_id: id() } },
    { fn: 'time_approval_queue_ids', args: { p_user_id: id() } },
    { fn: 'time_sheet_has_cost_money', args: { p_timesheet_id: id() } },
    { fn: 'time_stop_running_entries', args: { p_ids: [] } },
    { fn: 'time_sheet_routing_preview', args: { p_timesheet_id: id() } },
    { fn: 'time_apply_freeze', args: { p_timesheet_id: id(), p_freeze: {} } },
    { fn: 'time_clear_freeze', args: { p_timesheet_id: id() } },
  ];
}

describeReadOnly('M3 rename compatibility: reads and privileges', () => {
  let sb: SupabaseClient;

  beforeAll(async () => {
    sb = serviceClient();
    const { error } = await sb.from('time_entries').select('id').limit(1);
    if (error) {
      throw new Error(
        `[integration] time_entries is not readable (${error.code}: ${error.message}); ` +
          'is M3 (20261003110000_rename_time_entries.sql) applied on this database?',
      );
    }
  });

  it('each view has exactly the rows of its table', async () => {
    for (const [view, table] of [
      ['task_time_logs', 'time_entries'],
      ['task_time_log_segments', 'time_entry_segments'],
      ['time_log_comments', 'time_entry_comments'],
    ]) {
      const v = await sb
        .from(view)
        .select('id', { count: 'exact', head: true });
      const t = await sb
        .from(table)
        .select('id', { count: 'exact', head: true });
      assertOk(view, v.error);
      assertOk(table, t.error);
      expect({ view, count: v.count }).toEqual({ view, count: t.count });
    }
  });

  it('task_time_logs keeps the old 26 columns, in order', async () => {
    const { data, error } = await sb
      .from('task_time_logs')
      .select('*')
      .limit(1);
    assertOk('task_time_logs *', error);
    if (!data?.length) return; // no rows to inspect; the select itself resolved
    expect(Object.keys(data[0])).toEqual(OLD_LOG_COLUMNS);
  });

  it.each(OLD_VIEW_SELECTS)(
    'old embed resolves through the view: $site',
    async ({ site, select }) => {
      const { error } = await sb.from('task_time_logs').select(select).limit(1);
      assertOk(site, error);
    },
  );

  it('old !inner task embed with an exact count resolves through the view', async () => {
    const { error, count } = await sb
      .from('task_time_logs')
      .select(TIME_LOG_SELECT_INNER, { count: 'exact' })
      .eq('task.status', 'in_progress')
      .order('started_at', { ascending: false })
      .range(0, 0);
    assertOk('team-time.service.ts:2207 !inner + count', error);
    expect(typeof count).toBe('number');
  });

  it('old teams!inner filter (financials uncosted hours) resolves through the view', async () => {
    const { error } = await sb
      .from('task_time_logs')
      .select('duration_seconds, teams!inner(member_rates_enabled)')
      .in('status', ['approved', 'paid'])
      .eq('work_type_snapshot', 'real_work')
      .eq('teams.member_rates_enabled', false)
      .limit(1);
    assertOk('financials.service.ts:359 teams!inner', error);
  });

  it('old comment and segment selects resolve through their views', async () => {
    const comments = await sb
      .from('time_log_comments')
      .select(TIME_LOG_COMMENT_SELECT)
      .limit(1);
    assertOk('team-time.service.ts:69 TIME_LOG_COMMENT_SELECT', comments.error);
    const segments = await sb
      .from('task_time_log_segments')
      .select(TIME_LOG_SEGMENT_SELECT)
      .limit(1);
    assertOk('team-time.service.ts:76 TIME_LOG_SEGMENT_SELECT', segments.error);
  });

  it.each(NEW_SELECTS)(
    'new column-hint select resolves: $table $name',
    async ({ table, name, select }) => {
      const { error } = await sb.from(table).select(select).limit(1);
      assertOk(`${table} ${name}`, error);
    },
  );

  it.each(ROLES)(
    '%s reads nothing from the 3 views and the 3 tables',
    async (role, authenticated) => {
      const client = publicClient(authenticated);
      for (const relation of TIME_RELATIONS) {
        const { data, error } = await client
          .from(relation)
          .select('id')
          .limit(1);
        const outcome = error ? error.code : `rows:${(data ?? []).length}`;
        // Revoked: permission denied. (Zero rows would also mean no access.)
        expect({
          role,
          relation,
          denied: outcome === '42501' || outcome === 'rows:0',
        }).toEqual({
          role,
          relation,
          denied: true,
        });
      }
    },
  );

  it.each(ROLES)(
    '%s cannot execute any M2/M3 function',
    async (role, authenticated) => {
      const client = publicClient(authenticated);
      for (const { fn, args } of functionProbes()) {
        const { error } = await client.rpc(fn, args);
        // 42501 = the function resolved and EXECUTE was refused. PGRST202 would
        // mean the probe's arguments do not match the function (fix the probe).
        expect({ role, fn, code: error?.code ?? 'executed' }).toEqual({
          role,
          fn,
          code: '42501',
        });
      }
    },
  );
});

describeDevWrites(
  'M3 rename compatibility: old-shape writes through the views (dev)',
  () => {
    let h: Harness;
    let sb: SupabaseClient;
    let ownerId: string;
    let memberId: string;
    let workspaceId: string;
    let teamId: string;
    let projectId: string;
    let taskId: string;
    /** Entry written through the view without a task (then reviewed old-style). */
    let plainEntryId: string;
    /** Entry written through the view with a task. */
    let taskEntryId: string;

    const hoursAgo = (n: number) =>
      new Date(Date.now() - n * 3600_000).toISOString();

    beforeAll(async () => {
      // Loaded lazily so the read-only block never imports AppModule (see header).
      const { Harness: HarnessClass } = await import('./harness');
      h = new HarnessClass();
      sb = h.admin;

      const probe = await sb.from('time_entries').select('id').limit(1);
      if (probe.error) {
        throw new Error(
          `[integration] time_entries is not readable (${probe.error.code}: ${probe.error.message}); ` +
            'is M3 (20261003110000_rename_time_entries.sql) applied on dev?',
        );
      }

      const owner = await h.createUser('m3-owner');
      const member = await h.createUser('m3-member');
      ownerId = owner.id;
      memberId = member.id;
      workspaceId = await h.createWorkspace(ownerId, 'm3');
      teamId = await h.createTeam(ownerId, workspaceId, 'itest m3 team');
      await h.setTeamTime(teamId, { time_tracking_enabled: true });
      projectId = await h.createProject(ownerId);
      await h.setProjectWorkspace(projectId, workspaceId);
      await h.attachTeam(projectId, teamId, true);
      await h.addTeamMember(teamId, memberId);
      await h.grantAccess(projectId, memberId, 'editor');
      const roadmapId = await h.createRoadmap(ownerId, projectId);
      const epicId = await h.createEpic(roadmapId);
      const featureId = await h.createFeature(epicId, roadmapId);
      taskId = await h.createTask(featureId, 0, { status: 'in_progress' });
    });

    afterAll(async () => {
      if (h) await h.cleanup();
    });

    it('an old-shape insert through task_time_logs derives the context and picks a timesheet', async () => {
      const { data, error } = await sb
        .from('task_time_logs')
        .insert({
          project_id: projectId,
          task_id: null,
          member_user_id: memberId,
          team_id: teamId,
          started_at: hoursAgo(3),
          ended_at: hoursAgo(2),
          duration_seconds: 3600,
          source: 'manual',
        })
        .select(TIME_LOG_SELECT)
        .single();
      assertOk('insert through task_time_logs', error);
      const row = data as unknown as Record<string, any>;
      plainEntryId = row.id;
      expect(row.status).toBe('pending');
      expect(row.member?.id).toBe(memberId);
      expect(row.project?.id).toBe(projectId);
      expect(row.task).toBeNull();
      expect(row.reviewer).toBeNull();
      expect(Object.keys(row)).toEqual(
        expect.arrayContaining(['reviewed_by', 'reviewed_at', 'review_note']),
      );

      const base = await sb
        .from('time_entries')
        .select(
          'context_kind, context_ref, context_label_snapshot, work_item, timesheet_id',
        )
        .eq('id', plainEntryId)
        .single();
      assertOk('time_entries read-back', base.error);
      const team = await sb
        .from('teams')
        .select('name')
        .eq('id', teamId)
        .single();
      expect(base.data).toMatchObject({
        context_kind: 'team',
        context_ref: teamId,
        context_label_snapshot: team.data?.name,
        work_item: 'other',
      });
      expect(base.data?.timesheet_id).toEqual(expect.any(String));

      // No team override and no team rules: the team's entries sit on the
      // member's workspace-scope sheet, created open by the app.
      const sheet = await sb
        .from('timesheets')
        .select('member_user_id, scope_kind, scope_ref, status, origin')
        .eq('id', base.data!.timesheet_id)
        .single();
      assertOk('timesheet read-back', sheet.error);
      expect(sheet.data).toEqual({
        member_user_id: memberId,
        scope_kind: 'workspace',
        scope_ref: workspaceId,
        status: 'open',
        origin: 'app',
      });
    });

    it('a task entry through the view gets work_item task and the FK-name task embed', async () => {
      const { data, error } = await sb
        .from('task_time_logs')
        .insert({
          project_id: projectId,
          task_id: taskId,
          member_user_id: memberId,
          team_id: teamId,
          started_at: hoursAgo(5),
          ended_at: hoursAgo(4),
          duration_seconds: 3600,
          source: 'timer',
        })
        .select(TIME_LOG_SELECT)
        .single();
      assertOk('task insert through task_time_logs', error);
      const row = data as unknown as Record<string, any>;
      taskEntryId = row.id;
      expect(row.task?.id).toBe(taskId);

      const base = await sb
        .from('time_entries')
        .select('work_item, task_id')
        .eq('id', taskEntryId)
        .single();
      expect(base.data).toEqual({ work_item: 'task', task_id: taskId });
    });

    it('an old-shape review through the view writes legacy_reviewed_* and the reviewer embed resolves', async () => {
      const reviewedAt = new Date().toISOString();
      const { data, error } = await sb
        .from('task_time_logs')
        .update({
          status: 'approved',
          reviewed_by: ownerId,
          reviewed_at: reviewedAt,
          review_note: 'itest review',
        })
        .eq('id', plainEntryId)
        .select(TIME_LOG_SELECT)
        .single();
      assertOk('PATCH through task_time_logs', error);
      const row = data as unknown as Record<string, any>;
      expect(row.status).toBe('approved');
      expect(row.reviewer?.id).toBe(ownerId);
      expect(row.review_note).toBe('itest review');

      const base = await sb
        .from('time_entries')
        .select(ENTRY_LEGACY_REVIEW_SELECT)
        .eq('id', plainEntryId)
        .single();
      assertOk('ENTRY_LEGACY_REVIEW_SELECT', base.error);
      const legacy = base.data as unknown as Record<string, any>;
      expect(legacy.legacy_reviewed_by).toBe(ownerId);
      expect(legacy.legacy_review_note).toBe('itest review');
      expect(legacy.legacy_reviewer?.id).toBe(ownerId);
    });

    it('the !inner task filter with an exact count only keeps the task entry', async () => {
      const inner = await sb
        .from('task_time_logs')
        .select(TIME_LOG_SELECT_INNER, { count: 'exact' })
        .eq('project_id', projectId)
        .eq('task.status', 'in_progress')
        .order('started_at', { ascending: false })
        .range(0, 49);
      assertOk('!inner + count', inner.error);
      expect(inner.count).toBe(1);
      expect(
        (inner.data as unknown as Array<Record<string, any>>).map((r) => r.id),
      ).toEqual([taskEntryId]);

      const all = await sb
        .from('task_time_logs')
        .select(TIME_LOG_SELECT, { count: 'exact' })
        .eq('project_id', projectId)
        .range(0, 49);
      assertOk('plain + count', all.error);
      const base = await sb
        .from('time_entries')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId);
      expect(all.count).toBe(base.count);
      expect(all.count).toBeGreaterThanOrEqual(2);
    });

    it('segments and comments round-trip through their views', async () => {
      const segment = await sb
        .from('task_time_log_segments')
        .insert({
          log_id: plainEntryId,
          kind: 'work',
          started_at: hoursAgo(3),
          ended_at: hoursAgo(2),
        })
        .select(TIME_LOG_SEGMENT_SELECT)
        .single();
      assertOk('segment insert through the view', segment.error);
      expect(segment.data?.log_id).toBe(plainEntryId);
      const segmentBase = await sb
        .from('time_entry_segments')
        .select(SEGMENT_SELECT)
        .eq('id', segment.data!.id)
        .single();
      expect(segmentBase.data?.entry_id).toBe(plainEntryId);
      const segmentsByLog = await sb
        .from('task_time_log_segments')
        .select(TIME_LOG_SEGMENT_SELECT)
        .eq('log_id', plainEntryId);
      expect((segmentsByLog.data ?? []).map((s) => s.id)).toEqual([
        segment.data!.id,
      ]);

      const comment = await sb
        .from('time_log_comments')
        .insert({
          log_id: plainEntryId,
          author_user_id: ownerId,
          body: 'itest comment',
        })
        .select(TIME_LOG_COMMENT_SELECT)
        .single();
      assertOk('comment insert through the view', comment.error);
      const commentRow = comment.data as unknown as Record<string, any>;
      expect(commentRow.log_id).toBe(plainEntryId);
      expect(commentRow.author?.id).toBe(ownerId);
      const commentBase = await sb
        .from('time_entry_comments')
        .select(COMMENT_SELECT_WITH_EMAIL)
        .eq('id', commentRow.id)
        .single();
      assertOk('COMMENT_SELECT_WITH_EMAIL', commentBase.error);
      const baseRow = commentBase.data as unknown as Record<string, any>;
      expect(baseRow.entry_id).toBe(plainEntryId);
      expect(baseRow.author?.id).toBe(ownerId);
    });

    it('the new self select resolves every embed on a view-written entry', async () => {
      const { data, error } = await sb
        .from('time_entries')
        .select(ENTRY_SELF_SELECT)
        .eq('id', taskEntryId)
        .single();
      assertOk('ENTRY_SELF_SELECT', error);
      const row = data as unknown as Record<string, any>;
      expect(row.task?.id).toBe(taskId);
      expect(row.project?.id).toBe(projectId);
      expect(row.member?.id).toBe(memberId);
      expect(row.timesheet?.id).toBe(row.timesheet_id);
      expect(row.timesheet?.status).toBe('open');
    });

    it('an old-shape delete through the view removes the base row', async () => {
      const created = await sb
        .from('task_time_logs')
        .insert({
          project_id: projectId,
          member_user_id: memberId,
          team_id: teamId,
          started_at: hoursAgo(7),
          ended_at: hoursAgo(6),
          duration_seconds: 3600,
          source: 'manual',
        })
        .select('id')
        .single();
      assertOk('insert for delete', created.error);
      const id = created.data!.id as string;

      const removed = await sb.from('task_time_logs').delete().eq('id', id);
      assertOk('DELETE through task_time_logs', removed.error);
      const base = await sb.from('time_entries').select('id').eq('id', id);
      expect(base.data).toEqual([]);
    });
  },
);
