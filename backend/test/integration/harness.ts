/**
 * Real-DB integration harness for the Phase 0 authorization gaps.
 *
 * Boots the actual AppModule (real guards, services, repositories, Supabase and
 * Redis) and drives it over HTTP with supertest, against the live SG project the
 * backend/.env points at. Two side-effecting providers are replaced with no-ops
 * so a test never publishes realtime events or enqueues knowledge embeddings for
 * throwaway fixture data — everything else is real, including the database.
 *
 * Fixtures are created via the service-role client (bypasses RLS), namespaced by
 * a per-run id, and every created row + auth user is torn down in afterAll
 * (LIFO, best-effort). Never part of `npm test` — run explicitly with
 * `npm run test:integration`.
 */
import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { CachePolicyInterceptor } from '../../src/common/interceptors/cache-policy.interceptor';
import { RequestLoggingInterceptor } from '../../src/common/interceptors/request-logging.interceptor';
import { RequestTimeoutInterceptor } from '../../src/common/interceptors/request-timeout.interceptor';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { RealtimePublisher } from '../../src/modules/shared/realtime/realtime-publisher.service';
import { KnowledgeOutboxService } from '../../src/modules/shared/knowledge/knowledge-outbox.service';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[integration] missing ${name} — set it in backend/.env before running ` +
        'the integration suite.',
    );
  }
  return value;
}

/** The hosted development project (backend/.env.development.local). */
export const DEV_PROJECT_REF = 'vyiedlwasdwmjbztqznl';

/**
 * `describe` against the hosted dev project, `describe.skip` anywhere else.
 * For specs that write fixtures the production database must never see.
 * load-env.ts runs as a jest setup file, so SUPABASE_URL is set at import time.
 */
export const describeDevOnly = process.env.SUPABASE_URL?.includes(
  DEV_PROJECT_REF,
)
  ? describe
  : describe.skip;

/** Explicit no-op stubs for the two side-effecting providers. Explicit (not a
 * catch-all Proxy) so DI lifecycle/thenable probes can't misfire on them. */
const realtimeStub = {
  publishRoadmapChange: () => undefined,
  publishChatEvent: () => undefined,
} as unknown;
const knowledgeOutboxStub = { enqueue: () => undefined } as unknown;

type RoleName = 'viewer' | 'commenter' | 'editor' | 'admin' | 'owner';
type WorkspaceRoleName = 'owner' | 'admin' | 'member';
type TeamRoleName = 'admin' | 'member';

/** Optional column overrides for `createTask` (all nullable in the schema). */
interface TaskFields {
  title?: string;
  due_date?: string | null;
  status?: 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | null;
}

interface SeededUser {
  id: string;
  email: string;
  token: string;
}

/**
 * A time entry written straight to `time_entries` (M3 name) with explicit
 * context columns. The context is the assignment, else the team, else the
 * workspace, else personal. The base triggers still run: trg_10 validates
 * project access and team or workspace membership, trg_30 places the entry on
 * its timesheet (and refuses a submitted or approved period), trg_40 locks.
 */
export interface TimeEntryInput {
  projectId: string;
  memberUserId: string;
  teamId?: string | null;
  workspaceId?: string | null;
  engagementAssignmentId?: string | null;
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp; null or omitted = a running timer. */
  endedAt?: string | null;
  /** Default: (endedAt − startedAt) − breakSeconds, or null while running. */
  durationSeconds?: number | null;
  breakSeconds?: number;
  /** A task makes work_item 'task' (trg_10); without one the default is 'other'. */
  taskId?: string | null;
  workItem?: 'meeting' | 'review' | 'admin' | 'other';
  note?: string | null;
  source?: 'timer' | 'manual';
  rateSnapshot?: number;
  rateTypeSnapshot?: 'hourly' | 'fixed';
  currencySnapshot?: string;
  workTypeSnapshot?: 'real_work' | 'training';
}

export interface TimeEntryRow {
  id: string;
  timesheet_id: string | null;
  context_kind: 'assignment' | 'team' | 'workspace' | 'personal';
  context_ref: string | null;
}

export interface TeamTimeSettings {
  time_tracking_enabled?: boolean;
  member_rates_enabled?: boolean;
  payouts_enabled?: boolean;
}

export type CompPlan = 'free' | 'pro' | 'business' | 'enterprise';

/** A tracked fixture row: by id, or by a composite key for id-less tables. */
type TrackedRow =
  | { table: string; id: string }
  | { table: string; match: Record<string, string> };

export class Harness {
  readonly runId = randomUUID().slice(0, 8);
  readonly admin: SupabaseClient;
  private readonly url: string;
  private readonly anonKey: string;
  private readonly jwtSecret: string;

  app!: INestApplication;

  /** LIFO row cleanup: {table,id} (or a composite key) deleted newest-first in teardown. */
  private readonly rows: TrackedRow[] = [];
  private readonly userIds: string[] = [];

  constructor() {
    this.url = requireEnv('SUPABASE_URL');
    this.anonKey = requireEnv('SUPABASE_ANON_KEY');
    this.jwtSecret = requireEnv('SUPABASE_JWT_SECRET');
    requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    this.admin = createClient(
      this.url,
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  /**
   * @param overrides extra provider stubs, e.g. the billing registry. Explicit
   * object literals only — a catch-all Proxy makes DI lifecycle and thenable
   * probes misfire during boot.
   */
  async boot(
    overrides: Array<{ token: unknown; value: unknown }> = [],
  ): Promise<void> {
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RealtimePublisher)
      .useValue(realtimeStub)
      .overrideProvider(KnowledgeOutboxService)
      .useValue(knowledgeOutboxStub);
    for (const override of overrides) {
      builder = builder
        .overrideProvider(override.token as never)
        .useValue(override.value);
    }
    const moduleRef = await builder.compile();

    // rawBody MUST mirror src/main.ts. The harness builds its own app rather
    // than importing main.ts, so without this the billing webhook's raw-body
    // test would pass against a pipeline production does not have — i.e. prove
    // nothing about the thing it exists to protect.
    const app = moduleRef.createNestApplication({ rawBody: true });
    // Mirror the production request pipeline (src/main.ts) so route prefixes,
    // validation, the {data} envelope, and error shapes match prod exactly.
    app.setGlobalPrefix('api', {
      exclude: [
        { path: '/', method: RequestMethod.GET },
        { path: 'mcp', method: RequestMethod.ALL },
        { path: '.well-known/*splat', method: RequestMethod.ALL },
        { path: 'oauth/*splat', method: RequestMethod.ALL },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    const reflector = app.get(Reflector);
    app.useGlobalInterceptors(
      new RequestTimeoutInterceptor(25000),
      new RequestLoggingInterceptor(1500),
      new CachePolicyInterceptor(reflector),
      new ResponseInterceptor(reflector),
    );
    await app.init();
    this.app = app;
  }

  server() {
    return this.app.getHttpServer();
  }

  /** Mint a Supabase-style HS256 access token the SupabaseAuthGuard verifies
   * locally (no network) — signed with the project's real JWT secret. */
  mintToken(userId: string, email: string): string {
    return jwt.sign(
      { sub: userId, email, role: 'authenticated', aud: 'authenticated' },
      this.jwtSecret,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
  }

  /** A PostgREST client acting as `token`'s user, so RLS applies (used to probe
   * the assignee-table policies directly, bypassing the backend). */
  userClient(token: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private track(table: string, id: string): string {
    this.rows.push({ table, id });
    return id;
  }

  private trackMatch(table: string, match: Record<string, string>): void {
    this.rows.push({ table, match });
  }

  private trackedIds(table: string): string[] {
    return this.rows.flatMap((r) =>
      'id' in r && r.table === table ? [r.id] : [],
    );
  }

  async createUser(label: string): Promise<SeededUser> {
    const email = `phase0+${this.runId}-${label}@proyekto-itest.invalid`;
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser(${label}) failed: ${error?.message}`);
    }
    const id = data.user.id;
    this.userIds.push(id);
    // No auth.users trigger creates profiles, so insert one explicitly (the
    // roadmaps/projects FKs point at profiles.id).
    const { error: profileErr } = await this.admin
      .from('profiles')
      .upsert({ id, email }, { onConflict: 'id' });
    if (profileErr) {
      throw new Error(
        `createUser(${label}) profile upsert failed: ${profileErr.message}`,
      );
    }
    return { id, email, token: this.mintToken(id, email) };
  }

  /** Flag a user as a guest so the guest-migration read path can be exercised. */
  async markGuest(userId: string): Promise<void> {
    await this.admin
      .from('profiles')
      .update({ is_guest: true })
      .eq('id', userId);
  }

  async createProject(
    ownerId: string,
    title = 'itest project',
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('projects')
      .insert({ title: `${title} ${this.runId}`, owner_id: ownerId })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createProject failed: ${error?.message}`);
    return this.track('projects', data.id as string);
  }

  async grantAccess(
    projectId: string,
    userId: string,
    role: RoleName,
    capabilities: Record<string, boolean> = {},
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('project_access')
      .insert({
        project_id: projectId,
        user_id: userId,
        role,
        origin: 'direct',
        capabilities,
        has_direct_grant: true,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`grantAccess failed: ${error?.message}`);
    return this.track('project_access', data.id as string);
  }

  async createRoadmap(
    ownerId: string,
    projectId: string | null = null,
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmaps')
      .insert({
        name: `itest roadmap ${this.runId}`,
        owner_id: ownerId,
        project_id: projectId,
        preview_url: '',
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createRoadmap failed: ${error?.message}`);
    return this.track('roadmaps', data.id as string);
  }

  async createEpic(roadmapId: string, title = 'itest epic'): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmap_epics')
      .insert({ roadmap_id: roadmapId, title, position: 0 })
      .select('id')
      .single();
    if (error || !data) throw new Error(`createEpic failed: ${error?.message}`);
    return this.track('roadmap_epics', data.id as string);
  }

  // position is a parameter because roadmap_features has a UNIQUE(epic_id,
  // position): more than one feature under the same epic needs distinct values.
  async createFeature(
    epicId: string,
    roadmapId: string,
    position = 0,
    dates?: { start_date?: string; end_date?: string },
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmap_features')
      .insert({
        epic_id: epicId,
        roadmap_id: roadmapId,
        title: 'itest feature',
        position,
        ...(dates ?? {}),
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createFeature failed: ${error?.message}`);
    return this.track('roadmap_features', data.id as string);
  }

  // `fields` lets a test pin a title, a due_date, or an explicit status
  // (including NULL, which the column allows) without a second update.
  async createTask(
    featureId: string,
    position = 0,
    fields: TaskFields = {},
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmap_tasks')
      .insert({
        feature_id: featureId,
        title: fields.title ?? 'itest task',
        position,
        ...(fields.due_date !== undefined ? { due_date: fields.due_date } : {}),
        ...(fields.status !== undefined ? { status: fields.status } : {}),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`createTask failed: ${error?.message}`);
    return this.track('roadmap_tasks', data.id as string);
  }

  /**
   * A workspace with `createdBy` seated as its owner (the same two rows
   * WorkspacesService.createWorkspace writes). The slug is passed explicitly
   * so the fixture is valid with or without the allocator trigger; `label`
   * must be slug-safe (lowercase letters, digits, hyphens).
   */
  async createWorkspace(createdBy: string, label = 'ws'): Promise<string> {
    const slug = `itest-${label}-${this.runId}`.toLowerCase();
    const { data, error } = await this.admin
      .from('workspaces')
      .insert({
        name: `itest workspace ${label} ${this.runId}`,
        slug,
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createWorkspace failed: ${error?.message}`);
    const id = this.track('workspaces', data.id as string);
    await this.addWorkspaceMember(id, createdBy, 'owner');
    return id;
  }

  async addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRoleName = 'member',
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: userId, role })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`addWorkspaceMember failed: ${error?.message}`);
    return this.track('workspace_members', data.id as string);
  }

  /** Home (or un-home, with null) a project. The column is SET NULL on
   * workspace deletion, so nothing extra to track. */
  async setProjectWorkspace(
    projectId: string,
    workspaceId: string | null,
  ): Promise<void> {
    const { error } = await this.admin
      .from('projects')
      .update({ workspace_id: workspaceId })
      .eq('id', projectId);
    if (error) throw new Error(`setProjectWorkspace failed: ${error.message}`);
  }

  /**
   * A team owned by `ownerId`, optionally homed in a workspace. The owner is
   * deliberately NOT given a team_members row: `team_members_block_owner_delete`
   * refuses to delete an owner's row, which would wedge LIFO cleanup, and
   * every read path (TeamsService.listMyTeams, the refs resolver) already
   * treats `teams.owner_id` as membership.
   */
  async createTeam(
    ownerId: string,
    workspaceId: string | null = null,
    name = 'itest team',
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('teams')
      .insert({
        owner_id: ownerId,
        name: `${name} ${this.runId}`,
        workspace_id: workspaceId,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`createTeam failed: ${error?.message}`);
    return this.track('teams', data.id as string);
  }

  async addTeamMember(
    teamId: string,
    userId: string,
    role: TeamRoleName = 'member',
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('team_members')
      .insert({ team_id: teamId, user_id: userId, role })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`addTeamMember failed: ${error?.message}`);
    return this.track('team_members', data.id as string);
  }

  async createDependency(
    blockedTaskId: string,
    blockingTaskId: string,
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('task_dependencies')
      .insert({
        blocked_task_id: blockedTaskId,
        blocking_task_id: blockingTaskId,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createDependency failed: ${error?.message}`);
    return this.track('task_dependencies', data.id as string);
  }

  async addTaskAssignee(taskId: string, assigneeId: string): Promise<void> {
    const { error } = await this.admin
      .from('roadmap_task_assignees')
      .insert({ task_id: taskId, assignee_id: assigneeId });
    if (error) throw new Error(`addTaskAssignee failed: ${error.message}`);
    // No id column (PK is task_id+assignee_id) — cleaned via task-delete cascade.
  }

  /** Mint an MCP Personal Access Token row directly (service-role) and return
   * the raw `pk_` value the McpAuthGuard will resolve by sha256 hash. */
  async createMcpToken(
    userId: string,
    scopes: string[],
  ): Promise<{ raw: string; id: string }> {
    const raw = 'pk_' + randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const { data, error } = await this.admin
      .from('mcp_personal_access_tokens')
      .insert({
        user_id: userId,
        name: `itest ${this.runId}`,
        token_hash: tokenHash,
        token_prefix: raw.slice(0, 11),
        scopes,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createMcpToken failed: ${error?.message}`);
    return {
      raw,
      id: this.track('mcp_personal_access_tokens', data.id as string),
    };
  }

  /**
   * Attach a team to a project (project_teams has no id column, so it is
   * tracked by its key; the project delete would cascade it anyway, but a team
   * created after the project is deleted first and project_teams.team_id is
   * RESTRICT).
   */
  async attachTeam(
    projectId: string,
    teamId: string,
    isPrimary = false,
  ): Promise<void> {
    const { error } = await this.admin.from('project_teams').insert({
      project_id: projectId,
      team_id: teamId,
      is_primary: isPrimary,
    });
    if (error) throw new Error(`attachTeam failed: ${error.message}`);
    this.trackMatch('project_teams', {
      project_id: projectId,
      team_id: teamId,
    });
  }

  /** Curate a team member onto a project (the resolver's team option needs it). */
  async curateTeamMember(
    projectId: string,
    teamId: string,
    userId: string,
  ): Promise<void> {
    const { error } = await this.admin.from('project_team_members').insert({
      project_id: projectId,
      team_id: teamId,
      user_id: userId,
    });
    if (error) throw new Error(`curateTeamMember failed: ${error.message}`);
    this.trackMatch('project_team_members', {
      project_id: projectId,
      team_id: teamId,
      user_id: userId,
    });
  }

  /** Team time switches (teams columns; the old backend reads the same ones). */
  async setTeamTime(teamId: string, settings: TeamTimeSettings): Promise<void> {
    const { error } = await this.admin
      .from('teams')
      .update(settings)
      .eq('id', teamId);
    if (error) throw new Error(`setTeamTime failed: ${error.message}`);
  }

  /**
   * Comp a workspace onto a plan (the complimentary columns
   * workspace_plan_state reads); 'free' clears the comp. Call it before the
   * first entitlement lookup for the workspace, or invalidate the booted app's
   * cache (EntitlementsService.invalidateWorkspace).
   */
  async compWorkspace(workspaceId: string, plan: CompPlan): Promise<void> {
    const patch =
      plan === 'free'
        ? {
            is_discounted_free: false,
            discounted_plan: null,
            discounted_at: null,
            discounted_until: null,
          }
        : {
            is_discounted_free: true,
            discounted_plan: plan,
            discounted_at: new Date().toISOString(),
            discounted_until: null,
          };
    const { error } = await this.admin
      .from('workspaces')
      .update(patch)
      .eq('id', workspaceId);
    if (error) throw new Error(`compWorkspace failed: ${error.message}`);
  }

  /**
   * Insert a time entry into time_entries (M3 and later) with explicit context
   * columns; see TimeEntryInput. Tracked for LIFO delete, but locked entries
   * only go through cleanup()'s time_test_cleanup call.
   */
  async createTimeEntry(input: TimeEntryInput): Promise<TimeEntryRow> {
    const contextRef =
      input.engagementAssignmentId ?? input.teamId ?? input.workspaceId ?? null;
    const contextKind: TimeEntryRow['context_kind'] =
      input.engagementAssignmentId
        ? 'assignment'
        : input.teamId
          ? 'team'
          : input.workspaceId
            ? 'workspace'
            : 'personal';
    const breakSeconds = input.breakSeconds ?? 0;
    const endedAt = input.endedAt ?? null;
    const durationSeconds =
      input.durationSeconds !== undefined
        ? input.durationSeconds
        : endedAt
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(endedAt) - Date.parse(input.startedAt)) / 1000,
              ) - breakSeconds,
            )
          : null;

    const row: Record<string, unknown> = {
      project_id: input.projectId,
      member_user_id: input.memberUserId,
      context_kind: contextKind,
      context_ref: contextRef,
      team_id: contextKind === 'team' ? input.teamId : null,
      workspace_id: contextKind === 'workspace' ? input.workspaceId : null,
      engagement_assignment_id:
        contextKind === 'assignment' ? input.engagementAssignmentId : null,
      started_at: input.startedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      break_seconds: breakSeconds,
      break_minutes: Math.round(breakSeconds / 60),
      source: input.source ?? 'manual',
    };
    if (input.taskId) row.task_id = input.taskId;
    if (input.workItem) row.work_item = input.workItem;
    if (input.note !== undefined) row.note = input.note;
    if (input.rateSnapshot !== undefined)
      row.rate_snapshot = input.rateSnapshot;
    if (input.rateTypeSnapshot) row.rate_type_snapshot = input.rateTypeSnapshot;
    if (input.currencySnapshot) row.currency_snapshot = input.currencySnapshot;
    if (input.workTypeSnapshot) row.work_type_snapshot = input.workTypeSnapshot;

    const { data, error } = await this.admin
      .from('time_entries')
      .insert(row)
      .select('id, timesheet_id, context_kind, context_ref')
      .single();
    if (error || !data)
      throw new Error(
        `createTimeEntry failed: ${error?.message} ${error?.details ?? ''}`,
      );
    this.track('time_entries', data.id as string);
    return data as TimeEntryRow;
  }

  /** Read the roadmap's current updated_at (the revision token). */
  async roadmapUpdatedAt(roadmapId: string): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmaps')
      .select('updated_at')
      .eq('id', roadmapId)
      .single();
    if (error || !data)
      throw new Error(`roadmapUpdatedAt failed: ${error?.message}`);
    return data.updated_at as string;
  }

  async cleanup(): Promise<void> {
    // Time first (M3): submitted or approved entries are locked and their
    // sheets cannot be deleted through PostgREST, which cannot set
    // app.time_maintenance, so a service-role RPC clears each test project's
    // entries, reservations and emptied sheets. PGRST202 = the function is not
    // there yet (before M3); TIME_TEST_CLEANUP_FORBIDDEN = not a test project.
    for (const projectId of this.trackedIds('projects')) {
      try {
        const { error } = await this.admin.rpc('time_test_cleanup', {
          p_project_id: projectId,
        });
        if (
          error &&
          error.code !== 'PGRST202' &&
          !error.message?.includes('TIME_TEST_CLEANUP_FORBIDDEN')
        ) {
          console.warn(
            `[integration] time_test_cleanup(${projectId}) failed: ${error.message}`,
          );
        }
      } catch {
        /* best-effort */
      }
    }

    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      try {
        if ('id' in row) {
          await this.admin.from(row.table).delete().eq('id', row.id);
        } else {
          await this.admin.from(row.table).delete().match(row.match);
        }
      } catch {
        /* best-effort */
      }
    }

    // A deleted team or workspace keeps its policy audit rows (D23: policy_id
    // becomes NULL); drop the fixtures' ones. Errors (before M3 the columns do
    // not exist) are ignored.
    const teamIds = this.trackedIds('teams');
    const workspaceIds = this.trackedIds('workspaces');
    try {
      if (teamIds.length)
        await this.admin
          .from('time_policy_events')
          .delete()
          .is('policy_id', null)
          .in('team_id', teamIds);
      if (workspaceIds.length)
        await this.admin
          .from('time_policy_events')
          .delete()
          .is('policy_id', null)
          .in('workspace_id', workspaceIds);
    } catch {
      /* best-effort */
    }

    for (let i = this.userIds.length - 1; i >= 0; i--) {
      try {
        await this.admin.auth.admin.deleteUser(this.userIds[i]);
      } catch {
        /* best-effort */
      }
    }
  }

  async close(): Promise<void> {
    if (this.app) await this.app.close();
  }
}
