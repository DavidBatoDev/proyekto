// The layered time policy (backend.md "Policy Resolver") and its two write surfaces: the workspace policy and
// the team override. SQL answers the layers (time_resolve_policy, time_sheet_scope_for); this service adds the
// two TypeScript layers (member caps, client_hours_detail_level, D24) and owns every time_policies write.
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import type { EntitlementRef } from '../../shared/entitlements/entitlement-keys';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { isTeamManager } from '../teams/team-authority';
import {
  POLICY_HISTORY_DEFAULT_LIMIT,
  POLICY_HISTORY_MAX_LIMIT,
  type TeamTimePolicyInput,
  type WorkspaceTimePolicyInput,
} from './dto/policies.dto';
import { TimeCacheService } from './time-cache';
import {
  type PgErrorLike,
  mapTimeDbError,
  timeError,
  timeNotFound,
} from './time-errors';
import { isValidTimezone, localDate, safeTimezone } from './time-periods';
import type {
  ClientHoursLevel,
  ContextKind,
  MemberCaps,
  Paged,
  PolicyHistoryKind,
  PolicyHistoryRow,
  RateType,
  ResolvedTimePolicy,
  SheetScopeRef,
  SheetScopeResult,
  TeamPolicyView,
  WorkspacePolicyView,
} from './time.types';

/** A policy's timezone and ISO week start (1 = Monday … 7 = Sunday). */
export interface PeriodBasics {
  timezone: string;
  week_start: number;
}

/** 1..7, else Monday (time_policies CHECK; the SQL default). */
function safeWeekStart(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : 1;
}

// ── Policy history (A7) ─────────────────────────────────────────────────────────────────────────────────────

const POLICY_EVENT_SELECT =
  'id, policy_id, actor_user_id, changes, scope, team_id, workspace_id, created_at';

interface PolicyEventRow {
  id: number;
  policy_id: string | null;
  actor_user_id: string | null;
  changes: unknown;
  scope: string | null;
  team_id: string | null;
  workspace_id: string | null;
  created_at: string;
}

/** Row columns that are not settings: never shown as a change. `updated_by` alone is the "Looks right" stamp. */
const POLICY_BOOKKEEPING_KEYS: ReadonlySet<string> = new Set([
  'id',
  'scope',
  'team_id',
  'workspace_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pure. One `time_policy_events.changes` value (tg_time_policies_events, M3) as a history line:
 * an INSERT stores the new row (`id` present, scalar values), an UPDATE `{ key: [old, new] }` of the changed
 * columns only, the M3 delete event `{ deleted: true, row }`. Settings only; nulls are left out of created and
 * deleted rows (a team override's null field means "inherit").
 */
export function policyEventChanges(raw: unknown): {
  kind: PolicyHistoryKind;
  changes: Record<string, [unknown, unknown]>;
} {
  const changes: Record<string, [unknown, unknown]> = {};
  if (!isRecord(raw)) return { kind: 'changed', changes };
  if (raw.deleted === true) {
    const row = isRecord(raw.row) ? raw.row : {};
    for (const [key, value] of Object.entries(row)) {
      if (POLICY_BOOKKEEPING_KEYS.has(key) || value === null) continue;
      changes[key] = [value, null];
    }
    return { kind: 'deleted', changes };
  }
  if ('id' in raw && !Array.isArray(raw.id)) {
    for (const [key, value] of Object.entries(raw)) {
      if (POLICY_BOOKKEEPING_KEYS.has(key) || value === null) continue;
      changes[key] = [null, value];
    }
    return { kind: 'created', changes };
  }
  for (const [key, value] of Object.entries(raw)) {
    if (POLICY_BOOKKEEPING_KEYS.has(key)) continue;
    changes[key] =
      Array.isArray(value) && value.length === 2
        ? [value[0] as unknown, value[1] as unknown]
        : [null, value];
  }
  return {
    kind: Object.keys(changes).length > 0 ? 'changed' : 'confirmed',
    changes,
  };
}

// ── Shared readers (also used by TimeRatesService, which cannot call back into this service's caps) ──────────

/** The team_member_rates columns the time module reads. The table keys on `user_id` (CC20). */
export const TEAM_MEMBER_RATE_SELECT =
  'id, team_id, user_id, project_id, rate_type, hourly_rate, training_hourly_rate, currency, ' +
  'start_date, end_date, weekly_limit_hours, monthly_limit_hours, overtime_requires_approval';

export interface TeamMemberRateRow {
  id: string;
  team_id: string;
  user_id: string;
  /** NOT NULL today; a NULL row would be the team default (blueprint P06), so the reader allows it. */
  project_id: string | null;
  rate_type: RateType;
  hourly_rate: number | string | null;
  training_hourly_rate: number | string | null;
  currency: string | null;
  start_date: string | null;
  end_date: string | null;
  weekly_limit_hours: number | string | null;
  monthly_limit_hours: number | string | null;
  overtime_requires_approval: boolean | null;
}

/** PostgREST numerics may arrive as strings; null and garbage read as null. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure. The team_member_rates row in force on local date `d` (L10, E43): `start_date ≤ d ≤ coalesce(end_date, ∞)`
 * (a NULL `start_date` has always applied). A row for `projectId` wins over a team default (`project_id IS NULL`);
 * then the latest `start_date`, then the lowest `id`. Rows for another project never apply.
 */
export function pickMemberRateInForce(
  rows: TeamMemberRateRow[],
  projectId: string | null,
  d: string,
): TeamMemberRateRow | null {
  const projectRank = (row: TeamMemberRateRow): number => {
    const rowProject = row.project_id ?? null;
    if (projectId !== null && rowProject === projectId) return 0;
    return rowProject === null ? 1 : -1;
  };
  const candidates = rows.filter(
    (row) =>
      projectRank(row) >= 0 &&
      (row.start_date === null || row.start_date <= d) &&
      (row.end_date === null || d <= row.end_date),
  );
  candidates.sort((a, b) => {
    const byProject = projectRank(a) - projectRank(b);
    if (byProject !== 0) return byProject;
    const aStart = a.start_date ?? '';
    const bStart = b.start_date ?? '';
    if (aStart !== bStart) return aStart < bStart ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
  return candidates[0] ?? null;
}

/** The member layer of a policy (backend.md: weekly/monthly limit hours, overtime approval). */
export function memberCapsFromRate(row: TeamMemberRateRow): MemberCaps {
  return {
    weekly_limit_hours: toNumberOrNull(row.weekly_limit_hours),
    monthly_limit_hours: toNumberOrNull(row.monthly_limit_hours),
    overtime_requires_approval: row.overtime_requires_approval === true,
  };
}

const sharedLogger = new Logger('TimeMemberRates');

/**
 * Every rate row of (team, member), filtered in TypeScript to `projectId` (or the team default) and to the row in
 * force on `d`. One small read; the in-force rule lives in `pickMemberRateInForce` only.
 */
export async function loadMemberRateInForce(
  sb: SupabaseClient,
  teamId: string,
  memberId: string,
  projectId: string | null,
  d: string,
): Promise<TeamMemberRateRow | null> {
  const { data, error } = await sb
    .from('team_member_rates')
    .select(TEAM_MEMBER_RATE_SELECT)
    .eq('team_id', teamId)
    .eq('user_id', memberId);
  if (error) {
    sharedLogger.error(
      `team_member_rates read failed team=${teamId} code=${(error as PgErrorLike).code ?? 'none'} message=${error.message}`,
    );
    throw new InternalServerErrorException(
      "Proyekto couldn't load the team's rates. Try again.",
    );
  }
  return pickMemberRateInForce(
    (data ?? []) as unknown as TeamMemberRateRow[],
    projectId,
    d,
  );
}

// ── Policy rows ─────────────────────────────────────────────────────────────────────────────────────────────

/** Columns a workspace PUT may set (the DTO's fields minus `confirm`). */
const WORKSPACE_FIELDS = [
  'tracking_enabled',
  'period_kind',
  'week_start',
  'timezone',
  'period_anchor',
  'approval_required',
  'allow_manual_entries',
  'retroactive_days',
  'rounding_minutes',
  'weekly_limit_minutes',
  'reminder_days',
  'hidden_presets',
] as const satisfies readonly (keyof WorkspaceTimePolicyInput)[];

/** Workspace rows keep these non-NULL (time_policies_scope_check), so a PUT may not send null for them. */
const WORKSPACE_NOT_NULL_FIELDS: ReadonlySet<string> = new Set([
  'tracking_enabled',
  'period_kind',
  'week_start',
  'timezone',
  'approval_required',
  'allow_manual_entries',
  'rounding_minutes',
  'reminder_days',
  'hidden_presets',
]);

/** Writable without `time_tracking` (backend.md: tz and week start always; tracking only to switch it off). */
const WORKSPACE_PLAN_FREE_FIELDS: ReadonlySet<string> = new Set([
  'timezone',
  'week_start',
]);

/** Columns a team override PUT may set. NULL = inherit. */
const TEAM_FIELDS = [
  'period_kind',
  'week_start',
  'timezone',
  'period_anchor',
  'approval_required',
  'approver_scope',
  'allow_manual_entries',
  'retroactive_days',
  'rounding_minutes',
  'weekly_limit_minutes',
  'reminder_days',
] as const satisfies readonly (keyof TeamTimePolicyInput)[];

/**
 * Team override fields only the team owner may change (backend.md: "PUT approval/money fields … owner").
 * approval_required / approver_scope decide who signs off paid time; retroactive_days is the same setting as
 * teams.retroactive_log_days, which TeamsService already keeps owner-only (TEAM_OWNER_ONLY_UPDATE_FIELDS);
 * rounding_minutes changes payable hours and so amounts.
 */
const TEAM_OWNER_ONLY_POLICY_FIELDS: readonly (typeof TEAM_FIELDS)[number][] = [
  'approval_required',
  'approver_scope',
  'retroactive_days',
  'rounding_minutes',
];

const TEAM_OVERRIDE_SELECT =
  'id, team_id, period_kind, week_start, timezone, period_anchor, approval_required, approver_scope, ' +
  'allow_manual_entries, retroactive_days, rounding_minutes, weekly_limit_minutes, reminder_days, ' +
  'created_by, updated_by, created_at, updated_at';

const TEAM_SELECT = 'id, name, owner_id, workspace_id, member_rates_enabled';

interface TeamRow {
  id: string;
  name: string;
  owner_id: string | null;
  workspace_id: string | null;
  member_rates_enabled: boolean;
}

/** ux.md Team Override: the copy for a refused approval switch while member rates are on. */
const APPROVAL_STAYS_ON_MESSAGE =
  'Approval stays on while member rates are on.';

/** time_policies.retroactive_days CHECK (0..3650); teams.retroactive_log_days has no upper bound. */
const MAX_RETROACTIVE_DAYS = 3650;

const INVALID_TEXT_REPRESENTATION = '22P02';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
/** PostgREST 416: a counted read asked for an offset past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

const CLIENT_HOURS_LEVELS: readonly ClientHoursLevel[] = [
  'none',
  'summary',
  'detailed',
];

function toClientHoursLevel(value: unknown): ClientHoursLevel {
  return CLIENT_HOURS_LEVELS.includes(value as ClientHoursLevel)
    ? (value as ClientHoursLevel)
    : 'none';
}

/** The keys of `input` that were sent (`undefined` = not sent; `null` is a value). */
function sentFields<K extends string>(
  input: object,
  fields: readonly K[],
): Partial<Record<K, unknown>> {
  const source = input as Record<string, unknown>;
  const patch: Partial<Record<K, unknown>> = {};
  for (const key of fields) {
    if (Object.hasOwn(source, key) && source[key] !== undefined) {
      patch[key] = source[key];
    }
  }
  return patch;
}

/** supabase-js rpc results, typed once (the untyped client answers `any`). */
type RpcResult = { data: unknown; error: PgErrorLike | null };

function errorCode(e: HttpException): string | null {
  const body = e.getResponse();
  return body && typeof body === 'object' && 'code' in body
    ? String((body as { code: unknown }).code)
    : null;
}

@Injectable()
export class TimePolicyService {
  private readonly logger = new Logger(TimePolicyService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
    private readonly cache: TimeCacheService,
  ) {}

  /** rpc time_resolve_policy + member caps (team scope with memberUserId: TMR in force on the local date)
   *  + client_hours_detail_level (engagement scope: settingsInForceOn). */
  async resolve(
    scope: SheetScopeRef,
    policyWorkspaceId: string | null,
    at: Date,
    o: { memberUserId?: string; teamId?: string; projectId?: string } = {},
  ): Promise<ResolvedTimePolicy> {
    const { data, error } = (await this.sb.rpc('time_resolve_policy', {
      p_scope_kind: scope.kind,
      p_scope_ref: scope.ref,
      p_policy_workspace_id: policyWorkspaceId,
      p_at: at.toISOString(),
    })) as RpcResult;
    if (error) this.fail('resolve', error);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      this.invariant('resolve', 'time_resolve_policy returned no policy');
    }
    const base = data as Omit<
      ResolvedTimePolicy,
      'member' | 'client_hours_detail_level'
    >;
    const policy: ResolvedTimePolicy = {
      ...base,
      hidden_presets: Array.isArray(base.hidden_presets)
        ? base.hidden_presets
        : [],
      sources: { ...(base.sources ?? {}) },
      member: null,
      client_hours_detail_level: null,
    };
    const tz = safeTimezone(policy.timezone);

    // Member layer: team context only. The sheet may be workspace scope (a team without an override), so the
    // caller's teamId wins over the scope; caps are windows per (member, team) (D46).
    const teamId = o.teamId ?? (scope.kind === 'team' ? scope.ref : undefined);
    if (teamId && o.memberUserId) {
      const row = await loadMemberRateInForce(
        this.sb,
        teamId,
        o.memberUserId,
        o.projectId ?? null,
        localDate(at, tz),
      );
      if (row) {
        policy.member = memberCapsFromRate(row);
        policy.sources.member = 'member';
      }
    }

    // Contract layer's TS half (D24): the settings row the SQL contract layer picked. SQL dates it in the
    // timezone resolved *before* the contract layer, so a contract-set timezone is not the one to use.
    if (scope.kind === 'engagement') {
      const dateTz =
        policy.sources.timezone === 'contract'
          ? await this.workspaceTimezone(policyWorkspaceId)
          : tz;
      const settings = await this.engagements.settingsInForceOn(
        scope.ref,
        localDate(at, dateTz),
      );
      // No settings in force: a legacy contract (L22) or none at all.
      policy.client_hours_detail_level = toClientHoursLevel(
        settings?.client_hours_detail_level,
      );
      if (settings) policy.sources.client_hours_detail_level = 'contract';
    }
    return policy;
  }

  sheetScopeFor(
    kind: ContextKind,
    ref: string | null,
    projectId: string,
  ): Promise<SheetScopeResult | null> {
    return this.scopeFor(kind, ref, projectId);
  }

  async ensureWorkspacePolicy(
    workspaceId: string,
    tzHint?: string | null,
    memberId?: string | null,
  ): Promise<string | null> {
    if (!workspaceId) return null;
    const hint =
      typeof tzHint === 'string' && isValidTimezone(tzHint) ? tzHint : null;
    const { data, error } = (await this.sb.rpc('time_ensure_workspace_policy', {
      p_workspace_id: workspaceId,
      p_timezone_hint: hint,
      p_member_user_id: memberId ?? null,
    })) as RpcResult;
    if (error) this.fail('ensure_workspace', error, 'save');
    return typeof data === 'string' && data.length > 0 ? data : null;
  }

  /** can_manage_workspace → the editable view; else a `workspace_members` row → the read-only view (A4); else 404. */
  async getWorkspacePolicy(
    callerId: string,
    workspaceId: string,
    tzHint?: string,
  ): Promise<WorkspacePolicyView> {
    if (await this.canManageWorkspace(workspaceId, callerId)) {
      // Only a manager's browser timezone seeds the row (CHANGE-11); without ?tz= a GET never writes.
      if (tzHint) {
        await this.ensureWorkspacePolicy(workspaceId, tzHint, callerId);
      }
      return this.workspaceView(workspaceId, true);
    }
    // A4: a member reads the policy and never materialises or seeds it, so `?tz=` is ignored. Without a row the
    // view is the resolved defaults with policy_unconfirmed.
    if (!(await this.isWorkspaceMember(workspaceId, callerId))) {
      throw timeNotFound('scope');
    }
    return this.workspaceView(workspaceId, false);
  }

  /**
   * A7: the audit trail of the workspace policy and of the overrides of the workspace's teams, newest first.
   * Managers only (404 otherwise); not plan-gated. Read from `time_policy_events` (L23), whose rows the triggers
   * write. Team rows are matched by the workspace's current teams, so a team that left the workspace, or was
   * deleted, no longer shows here (the audit export matches the same way).
   */
  async workspacePolicyHistory(
    callerId: string,
    workspaceId: string,
    q: { page?: number; limit?: number } = {},
  ): Promise<Paged<PolicyHistoryRow>> {
    await this.assertCanManageWorkspace(workspaceId, callerId);
    const page = Math.max(1, Math.trunc(q.page ?? 1));
    const limit = Math.min(
      POLICY_HISTORY_MAX_LIMIT,
      Math.max(1, Math.trunc(q.limit ?? POLICY_HISTORY_DEFAULT_LIMIT)),
    );
    const offset = (page - 1) * limit;

    const teamsRes = await this.sb
      .from('teams')
      .select('id, name')
      .eq('workspace_id', workspaceId);
    if (teamsRes.error) {
      this.fail('history_teams', teamsRes.error as PgErrorLike);
    }
    const teamNames = new Map(
      ((teamsRes.data ?? []) as Array<{ id: string; name: string | null }>).map(
        (t) => [t.id.toLowerCase(), t.name ?? 'Team'],
      ),
    );
    const owners = [
      `workspace_id.eq.${workspaceId}`,
      ...(teamNames.size > 0
        ? [`team_id.in.(${[...teamNames.keys()].join(',')})`]
        : []),
    ];
    const eventsRes = await this.sb
      .from('time_policy_events')
      .select(POLICY_EVENT_SELECT, { count: 'exact' })
      .or(owners.join(','))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (eventsRes.error) {
      // A counted read whose offset is past the last row is PostgREST's 416 PGRST103: a page past the end is an
      // empty page with the real total, never a 500.
      if ((eventsRes.error as PgErrorLike).code === RANGE_NOT_SATISFIABLE) {
        const head = await this.sb
          .from('time_policy_events')
          .select('id', { count: 'exact', head: true })
          .or(owners.join(','));
        if (head.error) this.fail('history_count', head.error as PgErrorLike);
        return { items: [], total: head.count ?? 0, page, limit };
      }
      this.fail('history_events', eventsRes.error as PgErrorLike);
    }
    const events = (eventsRes.data ?? []) as unknown as PolicyEventRow[];

    const actorIds = [
      ...new Set(
        events
          .map((e) => e.actor_user_id)
          .filter((id): id is string => typeof id === 'string' && id !== ''),
      ),
    ];
    const names = new Map<string, string | null>();
    if (actorIds.length > 0) {
      const profilesRes = await this.sb
        .from('profiles')
        .select('id, display_name')
        .in('id', actorIds);
      if (profilesRes.error) {
        this.fail('history_actors', profilesRes.error as PgErrorLike);
      }
      for (const p of (profilesRes.data ?? []) as Array<{
        id: string;
        display_name: string | null;
      }>) {
        names.set(p.id, p.display_name ?? null);
      }
    }

    const items = events.map((e): PolicyHistoryRow => {
      const { kind, changes } = policyEventChanges(e.changes);
      const teamId = e.team_id ?? null;
      return {
        id: e.id,
        created_at: e.created_at,
        actor:
          e.actor_user_id && names.has(e.actor_user_id)
            ? {
                id: e.actor_user_id,
                display_name: names.get(e.actor_user_id) ?? null,
              }
            : null,
        changes,
        scope: teamId !== null || e.scope === 'team' ? 'team' : 'workspace',
        team_id: teamId,
        team_name:
          teamId !== null
            ? (teamNames.get(teamId.toLowerCase()) ?? null)
            : null,
        kind,
      };
    });
    return {
      items,
      total: eventsRes.count ?? offset + items.length,
      page,
      limit,
    };
  }

  async putWorkspacePolicy(
    callerId: string,
    workspaceId: string,
    input: WorkspaceTimePolicyInput,
  ): Promise<WorkspacePolicyView> {
    await this.assertCanManageWorkspace(workspaceId, callerId);
    const patch: Record<string, unknown> = sentFields(input, WORKSPACE_FIELDS);

    const nulled = Object.keys(patch).filter(
      (key) => patch[key] === null && WORKSPACE_NOT_NULL_FIELDS.has(key),
    );
    if (nulled.length > 0) {
      throw timeError('TIME_POLICY_INVALID', undefined, { fields: nulled });
    }
    if (Array.isArray(patch.hidden_presets)) {
      patch.hidden_presets = [...new Set(patch.hidden_presets as string[])];
    }

    const needsPlan = Object.keys(patch).some(
      (key) =>
        !WORKSPACE_PLAN_FREE_FIELDS.has(key) &&
        !(key === 'tracking_enabled' && patch.tracking_enabled === false),
    );
    if (needsPlan) {
      await this.entitlements.assertFeature(workspaceId, 'time_tracking');
    }

    // Never INSERT a workspace row from TS (CC16): the row needs all 8 core columns, so materialise it through
    // the RPC first, then UPDATE only what was sent. Every PUT stamps updated_by; with nothing else sent that
    // is the "Looks right" confirmation.
    const policyId =
      (await this.ensureWorkspacePolicy(
        workspaceId,
        typeof patch.timezone === 'string' ? patch.timezone : null,
        callerId,
      )) ??
      this.invariant(
        'workspace_put',
        'time_ensure_workspace_policy gave no id',
      );
    const { error } = await this.sb
      .from('time_policies')
      .update({ ...patch, updated_by: callerId })
      .eq('id', policyId)
      .eq('scope', 'workspace');
    if (error) this.fail('workspace_update', error as PgErrorLike, 'save');

    await this.cache.bumpEpoch();
    return this.workspaceView(workspaceId, true);
  }

  /** isTeamManager else 404 */
  async getTeamPolicy(
    callerId: string,
    teamId: string,
  ): Promise<TeamPolicyView> {
    const team = await this.managedTeam(callerId, teamId);
    return this.teamView(team, callerId);
  }

  /** owner for approval/money fields; time_team_rules */
  async putTeamPolicy(
    callerId: string,
    teamId: string,
    input: TeamTimePolicyInput,
  ): Promise<TeamPolicyView> {
    const team = await this.managedTeam(callerId, teamId);
    const patch: Record<string, unknown> = sentFields(input, TEAM_FIELDS);

    const ownerFields = TEAM_OWNER_ONLY_POLICY_FIELDS.filter((key) =>
      Object.hasOwn(patch, key),
    );
    if (ownerFields.length > 0 && !(await this.isTeamOwner(team, callerId))) {
      // The teams.service.ts updateTeam wording, so both team settings surfaces refuse alike.
      throw new ForbiddenException(
        `Only the team owner can change: ${ownerFields.join(', ')}`,
      );
    }

    await this.entitlements.assertFeature(
      await this.planRefForTeam(team),
      'time_team_rules',
    );

    // trg_time_policies_guard refuses this too (mapped below); checking first keeps the ux.md copy exact.
    if (patch.approval_required === false && team.member_rates_enabled) {
      throw timeError('TEAM_RATES_REQUIRE_APPROVAL', APPROVAL_STAYS_ON_MESSAGE);
    }

    // An empty PUT writes nothing: inserting an all-inherit row would still move a Business team's future
    // sheets to team scope (D28).
    if (Object.keys(patch).length > 0) {
      await this.writeTeamRow(team.id, patch, callerId);
      await this.cache.bumpEpoch();
    }
    return this.teamView(team, callerId);
  }

  /** owner; ungated; rpc time_policy_delete */
  async deleteTeamPolicy(callerId: string, teamId: string): Promise<void> {
    const team = await this.managedTeam(callerId, teamId);
    if (!(await this.isTeamOwner(team, callerId))) {
      throw new ForbiddenException(
        "Only the team owner can remove this team's time rules.",
      );
    }
    const row = await this.readTeamRowId(team.id);
    if (!row) return;
    // Through the RPC so the BEFORE DELETE audit event records who deleted it (D23).
    const { error } = (await this.sb.rpc('time_policy_delete', {
      p_policy_id: row.id,
      p_actor: callerId,
    })) as RpcResult;
    if (error) this.fail('team_delete', error, 'save');
    await this.cache.bumpEpoch();
  }

  /** TeamsService write-through (D28). Bumps the logging-for epoch. */
  async setTeamRetroactiveDays(
    teamId: string,
    days: number | null,
    actorId: string,
  ): Promise<void> {
    const n =
      typeof days === 'number' && Number.isFinite(days)
        ? Math.min(MAX_RETROACTIVE_DAYS, Math.trunc(days))
        : 0;
    if (n > 0) {
      await this.writeTeamRow(teamId, { retroactive_days: n }, actorId);
    } else {
      // 0 / null = no limit: clear an existing override's value, never create a row for it.
      const row = await this.readTeamRowId(teamId);
      if (row) {
        const { error } = await this.sb
          .from('time_policies')
          .update({ retroactive_days: null, updated_by: actorId })
          .eq('id', row.id);
        if (error) this.fail('team_retroactive', error as PgErrorLike, 'save');
      }
    }
    await this.cache.bumpEpoch();
  }

  /** policy row tz, else 'UTC'; never materialises */
  async workspaceTimezone(workspaceId: string | null): Promise<string> {
    if (!workspaceId) return 'UTC';
    const { data, error } = await this.sb
      .from('time_policies')
      .select('timezone')
      .eq('scope', 'workspace')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) {
      if ((error as PgErrorLike).code === INVALID_TEXT_REPRESENTATION)
        return 'UTC';
      this.fail('workspace_timezone', error as PgErrorLike);
    }
    return safeTimezone(
      (data as { timezone?: string | null } | null)?.timezone,
    );
  }

  /** resolve(team scope via sheetScopeFor).timezone */
  async teamTimezone(teamId: string): Promise<string> {
    return (await this.teamPeriodBasics(teamId)).timezone;
  }

  /** The team policy's timezone and week start, resolved on the team's routed sheet scope (A5 report weeks). */
  async teamPeriodBasics(teamId: string): Promise<PeriodBasics> {
    const scope = await this.scopeFor('team', teamId, null);
    const policy = await this.resolve(
      scope
        ? { kind: scope.scope_kind, ref: scope.scope_ref }
        : { kind: 'team', ref: teamId },
      scope?.policy_workspace_id ?? null,
      new Date(),
    );
    return {
      timezone: safeTimezone(policy.timezone),
      week_start: safeWeekStart(policy.week_start),
    };
  }

  /** The workspace policy row's timezone and week start, else UTC and Monday; never materialises (A5). */
  async workspacePeriodBasics(
    workspaceId: string | null,
  ): Promise<PeriodBasics> {
    if (!workspaceId) return { timezone: 'UTC', week_start: 1 };
    const { data, error } = await this.sb
      .from('time_policies')
      .select('timezone, week_start')
      .eq('scope', 'workspace')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) {
      if ((error as PgErrorLike).code === INVALID_TEXT_REPRESENTATION) {
        return { timezone: 'UTC', week_start: 1 };
      }
      this.fail('workspace_period', error as PgErrorLike);
    }
    const row = data as {
      timezone?: string | null;
      week_start?: number | null;
    } | null;
    return {
      timezone: safeTimezone(row?.timezone),
      week_start: safeWeekStart(row?.week_start),
    };
  }

  /** D26: team.workspace_id ?? entitlements.resolveScopeForTeam(team.id). Never null. */
  async planRefForTeam(team: {
    id: string;
    workspace_id: string | null;
  }): Promise<EntitlementRef> {
    // Never pass raw null: EntitlementsService reads null as exempt.
    if (team.workspace_id) return team.workspace_id;
    return await this.entitlements.resolveScopeForTeam(team.id);
  }

  // ── private ───────────────────────────────────────────────────────────────────────────────────────────

  private async scopeFor(
    kind: ContextKind,
    ref: string | null,
    projectId: string | null,
  ): Promise<SheetScopeResult | null> {
    if (kind === 'personal') return null;
    if (!ref) throw timeError('LOGGING_FOR_INVALID');
    const { data, error } = (await this.sb.rpc('time_sheet_scope_for', {
      p_context_kind: kind,
      p_context_ref: ref,
      p_project_id: projectId,
    })) as RpcResult;
    if (error) this.fail('sheet_scope', error);
    const rows = (
      Array.isArray(data) ? data : data ? [data] : []
    ) as SheetScopeResult[];
    const row = rows[0];
    if (!row) return null;
    return {
      scope_kind: row.scope_kind,
      scope_ref: row.scope_ref,
      policy_workspace_id: row.policy_workspace_id ?? null,
      scope_label: row.scope_label,
    };
  }

  private async workspaceView(
    workspaceId: string,
    canEdit: boolean,
  ): Promise<WorkspacePolicyView> {
    const [rowRes, policy] = await Promise.all([
      this.sb
        .from('time_policies')
        .select('id, updated_by')
        .eq('scope', 'workspace')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      this.resolve(
        { kind: 'workspace', ref: workspaceId },
        workspaceId,
        new Date(),
      ),
    ]);
    if (rowRes.error) this.fail('workspace_row', rowRes.error as PgErrorLike);
    const row = rowRes.data as { id: string; updated_by: string | null } | null;
    return {
      workspace_id: workspaceId,
      policy,
      // CHANGE-11: missing row, or nobody has saved or confirmed it yet.
      policy_unconfirmed: !row || row.updated_by === null,
      // Managers: timezone / week start stay writable on every plan. Members read only (A4).
      can_edit: canEdit,
    };
  }

  private async teamView(
    team: TeamRow,
    callerId: string,
  ): Promise<TeamPolicyView> {
    const planRef = await this.planRefForTeam(team);
    const [overrideRes, scope, isOwner, hasTeamRules] = await Promise.all([
      this.sb
        .from('time_policies')
        .select(TEAM_OVERRIDE_SELECT)
        .eq('scope', 'team')
        .eq('team_id', team.id)
        .maybeSingle(),
      this.scopeFor('team', team.id, null),
      this.isTeamOwner(team, callerId),
      this.entitlements.hasFeature(planRef, 'time_team_rules'),
    ]);
    if (overrideRes.error) {
      this.fail('team_override', overrideRes.error as PgErrorLike);
    }
    const effective = await this.resolve(
      scope
        ? { kind: scope.scope_kind, ref: scope.scope_ref }
        : { kind: 'team', ref: team.id },
      scope?.policy_workspace_id ?? team.workspace_id,
      new Date(),
      { teamId: team.id },
    );
    return {
      team_id: team.id,
      override:
        (overrideRes.data as unknown as Record<string, unknown> | null) ?? null,
      effective,
      can_edit_money_fields: isOwner,
      has_team_rules: hasTeamRules,
    };
  }

  /** The team, when the caller manages it; otherwise 404 (never 403: a non-manager learns nothing). */
  private async managedTeam(
    callerId: string,
    teamId: string,
  ): Promise<TeamRow> {
    const { data, error } = await this.sb
      .from('teams')
      .select(TEAM_SELECT)
      .eq('id', teamId)
      .maybeSingle();
    if (error) {
      if ((error as PgErrorLike).code === INVALID_TEXT_REPRESENTATION) {
        throw timeNotFound('scope');
      }
      this.fail('team', error as PgErrorLike);
    }
    const team = data as TeamRow | null;
    if (!team || !(await isTeamManager(this.sb, team.id, callerId))) {
      throw timeNotFound('scope');
    }
    return team;
  }

  /** `teams.owner_id`, or a `team_members` row with role 'owner' (TeamsService.resolveViewerRole). */
  private async isTeamOwner(team: TeamRow, userId: string): Promise<boolean> {
    if (team.owner_id === userId) return true;
    const { data, error } = await this.sb
      .from('team_members')
      .select('role')
      .eq('team_id', team.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) this.fail('team_role', error as PgErrorLike);
    return (data as { role?: string } | null)?.role === 'owner';
  }

  private async assertCanManageWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    if (!(await this.canManageWorkspace(workspaceId, userId))) {
      throw timeNotFound('scope');
    }
  }

  /** rpc can_manage_workspace; a malformed id is a miss (404), never a 500. */
  private async canManageWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = (await this.sb.rpc('can_manage_workspace', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
    })) as RpcResult;
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) {
        throw timeNotFound('scope');
      }
      this.fail('can_manage_workspace', error);
    }
    return data === true;
  }

  /** A `workspace_members` row (the seat; A4's reader rule). */
  private async isWorkspaceMember(
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = await this.sb
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if ((error as PgErrorLike).code === INVALID_TEXT_REPRESENTATION) {
        throw timeNotFound('scope');
      }
      this.fail('workspace_member', error as PgErrorLike);
    }
    return data !== null && data !== undefined;
  }

  private async readTeamRowId(teamId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.sb
      .from('time_policies')
      .select('id')
      .eq('scope', 'team')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) this.fail('team_row', error as PgErrorLike);
    return (data as { id: string } | null) ?? null;
  }

  /**
   * Select-then-update-or-insert (PostgREST cannot upsert onto the partial unique index uq_time_policies_team).
   * A concurrent insert that wins the race turns ours into an update.
   */
  private async writeTeamRow(
    teamId: string,
    patch: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const existing = await this.readTeamRowId(teamId);
    if (existing) {
      await this.updateTeamRow(existing.id, patch, actorId);
      return;
    }
    const { error } = await this.sb.from('time_policies').insert({
      ...patch,
      scope: 'team',
      team_id: teamId,
      created_by: actorId,
      updated_by: actorId,
    });
    if (!error) return;
    if ((error as PgErrorLike).code === UNIQUE_VIOLATION) {
      const winner = await this.readTeamRowId(teamId);
      if (winner) {
        await this.updateTeamRow(winner.id, patch, actorId);
        return;
      }
    }
    this.fail('team_insert', error as PgErrorLike, 'save');
  }

  private async updateTeamRow(
    policyId: string,
    patch: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const { error } = await this.sb
      .from('time_policies')
      .update({ ...patch, updated_by: actorId })
      .eq('id', policyId);
    if (error) this.fail('team_update', error as PgErrorLike, 'save');
  }

  /** Time sentinels map through time-errors; a CHECK violation is an invalid setting; anything else is a 500
   *  whose Postgres text stays in the log. */
  private fail(
    op: string,
    err: PgErrorLike,
    verb: 'load' | 'save' = 'load',
  ): never {
    if (err.code === CHECK_VIOLATION) throw timeError('TIME_POLICY_INVALID');
    const mapped = mapTimeDbError(err);
    if (mapped) {
      if (errorCode(mapped) === 'TEAM_RATES_REQUIRE_APPROVAL') {
        throw timeError(
          'TEAM_RATES_REQUIRE_APPROVAL',
          APPROVAL_STAYS_ON_MESSAGE,
        );
      }
      throw mapped;
    }
    this.logger.error(
      `time_policy_${op}_failed code=${err.code ?? 'none'} message=${err.message ?? ''}`,
    );
    throw new InternalServerErrorException(
      `Proyekto couldn't ${verb} the time settings. Try again.`,
    );
  }

  private invariant(op: string, what: string): never {
    this.logger.error(`time_policy_${op}_invariant ${what}`);
    throw new InternalServerErrorException(
      "Proyekto couldn't load the time settings. Try again.",
    );
  }
}
