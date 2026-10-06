// The For resolver (backend.md "For Resolver", CHANGE-12 steps 0–8). It answers one question for a person on a
// project: which contexts can this time be logged for, and which one does a write use. The DB floor
// (trg_time_entries_10_context) stays viewer-level and curation-free; the editor rule (`time.log`) and the curated
// team rule live only here.
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AssignmentContext,
  EngagementsService,
} from '../../marketplace/engagements/engagements.service';
import type { EntitlementRef } from '../../shared/entitlements/entitlement-keys';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  getPermission,
  ROLE_DEFAULTS,
} from '../projects/permissions/project-permissions';
import { TimeCacheService } from './time-cache';
import { mapTimeDbError, timeError, timeNotFound } from './time-errors';
import type { PgErrorLike } from './time-errors';
import { localDate } from './time-periods';
import { TimePolicyService } from './time-policy.service';
import type {
  ApproverScope,
  ContextKind,
  LoggingForRequest,
  LoggingForResult,
  LoggingOption,
  RateSource,
  ResolvedTimePolicy,
  ResolvePurpose,
  SheetScopeRef,
  SheetScopeResult,
  UnavailableOption,
  WritePurpose,
} from './time.types';

export const PERSONAL_LABEL = 'Just me';

/** A cached read is reused only when it was asked for "now" (the cache key has no `at`). */
const CACHE_NOW_TOLERANCE_MS = 60_000;

/** Postgres `invalid_text_representation`: a non-UUID id reached a uuid column. */
const INVALID_TEXT_REPRESENTATION = '22P02';
/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

interface ProjectRow {
  id: string;
  owner_id: string | null;
  workspace_id: string | null;
}

interface TeamRow {
  id: string;
  name: string | null;
  workspace_id: string | null;
  time_tracking_enabled: boolean | null;
  member_rates_enabled: boolean | null;
}

interface ProjectTeamRow {
  team_id: string;
  is_primary: boolean | null;
  attached_at: string | null;
}

interface DefaultRow {
  context_kind: ContextKind;
  team_id: string | null;
  workspace_id: string | null;
  engagement_assignment_id: string | null;
}

/** One option with the facts the public shape does not carry (policyFor needs them). */
interface Candidate {
  option: LoggingOption;
  policyWorkspaceId: string | null;
  teamId: string | null;
  /** Only assignments: their contract says `tracking_mode = 'required'` (step 5). */
  required: boolean;
}

interface Computed {
  result: LoggingForResult;
  /** Every available option before the step-7 collapse, in resolver order. */
  all: Candidate[];
}

/**
 * The workspace each team `unavailable[]` row answers to, keyed by the row itself; local to one compute. A-4: it
 * fills `UnavailableOption.workspace_name?`, so the chip can say "Prodigitality's plan doesn't include timesheets."
 * / "Prodigitality has time tracking off for this team." (ux.md › For Chip). Additive and optional: omitted when
 * the team has no workspace or the workspace has no name.
 */
type RowWorkspaces = Map<UnavailableOption, string>;

/** The workspace whose plan an entitlement ref reads (a string ref is a workspace id); null for none. */
function planWorkspaceId(ref: EntitlementRef): string | null {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'string') return ref.trim() || null;
  return ref.exempt ? null : (ref.workspaceId ?? null);
}

function sameId(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

/** Does `option` answer `requested`? Personal ignores the id. */
function matches(option: LoggingOption, requested: LoggingForRequest): boolean {
  if (option.kind !== requested.kind) return false;
  return option.kind === 'personal' || sameId(option.id, requested.id);
}

/** Step 7b key: same sheet scope and rate source → the same approver and rate either way. D60: a team that pays
 *  member rates also keys on its id, since two teams' rate cards differ (never one option for both). */
function collapseKey(option: LoggingOption): string {
  const scope = option.sheet_scope
    ? `${option.sheet_scope.kind}:${option.sheet_scope.ref.toLowerCase()}`
    : 'personal';
  const rateCard =
    option.rate_source === 'team_member_rates'
      ? (option.id ?? '').toLowerCase()
      : '';
  return `${scope}|${option.rate_source}|${rateCard}`;
}

/** A listed assignment that is a real option (not unavailable, not without a sheet scope). */
function isAvailable(c: Candidate | UnavailableOption | null): c is Candidate {
  return c !== null && !('reason' in c);
}

function personalOption(): LoggingOption {
  return {
    kind: 'personal',
    id: null,
    label: PERSONAL_LABEL,
    sheet_scope: null,
    rate_source: 'none',
    workspace_tag: null,
    approver_hint: null,
  };
}

function emptyResult(): LoggingForResult {
  return {
    options: [],
    selected: null,
    prefill: null,
    reason: 'none',
    unavailable: [],
  };
}

function toScopeRef(scope: SheetScopeResult): SheetScopeRef {
  return { kind: scope.scope_kind, ref: scope.scope_ref };
}

/** The approver a team or workspace option would route to (the chip's "Who approves this time"). */
function governedApproverHint(
  scope: SheetScopeRef,
  policy: ResolvedTimePolicy,
  rateSource: RateSource,
): ApproverScope {
  if (!policy.approval_required && rateSource === 'none') return 'auto';
  return scope.kind === 'team' && policy.approver_scope === 'team'
    ? 'team'
    : 'workspace';
}

@Injectable()
export class LoggingContextService {
  private readonly logger = new Logger(LoggingContextService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly engagements: EngagementsService,
    private readonly policy: TimePolicyService,
    private readonly entitlements: EntitlementsService,
    private readonly cache: TimeCacheService,
  ) {}

  /** Steps 0–7 of backend.md "For Resolver". 404 (TIME_NOT_FOUND) when the caller has no project_access
   *  row and is not projects.owner_id. Never throws for "no options": returns options [] with reason. */
  async resolve(
    callerId: string,
    projectId: string,
    o: { requested?: LoggingForRequest; at: Date; purpose: ResolvePurpose },
  ): Promise<LoggingForResult> {
    // L60: only plain reads of "now" use the 30 s cache; writes and dated reads always resolve fresh.
    const cacheable =
      o.purpose === 'read' &&
      !o.requested &&
      Math.abs(o.at.getTime() - Date.now()) <= CACHE_NOW_TOLERANCE_MS;
    // D56: the epoch is read once, before the compute, and the write goes under it. A bump while computing
    // (assignment end, policy write, remember) then strands this result under the old epoch, never the new one.
    let epoch: string | null = null;
    if (cacheable) {
      const hit = await this.cache.getLoggingFor(callerId, projectId);
      if (hit.value) return hit.value;
      epoch = hit.epoch;
    }
    const { result } = await this.compute(
      callerId,
      projectId,
      o.at,
      o.purpose,
      o.requested,
    );
    if (cacheable && epoch !== null) {
      await this.cache.setLoggingFor(callerId, projectId, result, epoch);
    }
    return result;
  }

  /** resolve() uncached, then step 7/8: one option or 403 NO_LOGGING_CONTEXT / 422 LOGGING_FOR_INVALID
   *  ({options}) / 409 LOGGING_FOR_REQUIRED ({options, prefill}); 'alias' = prefill ?? first (D44). */
  async select(
    callerId: string,
    projectId: string,
    o: {
      requested?: LoggingForRequest;
      at: Date;
      purpose: WritePurpose;
      remember?: boolean;
    },
  ): Promise<LoggingOption> {
    const { result, all } = await this.compute(
      callerId,
      projectId,
      o.at,
      o.purpose,
      o.requested,
    );
    // 7e: nothing to log for (no time.log). Also the alias answer (D44).
    if (result.options.length === 0) throw timeError('NO_LOGGING_CONTEXT');

    let choice: LoggingOption;
    if (o.requested) {
      // 7a: the request must be one of the caller's own options. The foreign id is never echoed or looked up.
      const requested = o.requested;
      const hit = all.find((c) => matches(c.option, requested));
      if (!hit) {
        throw timeError('LOGGING_FOR_INVALID', undefined, {
          options: result.options,
        });
      }
      choice = hit.option;
    } else if (o.purpose === 'alias') {
      // Step 8: old bundles cannot answer a 409, so the remembered default or the first option wins.
      choice = result.selected ?? result.prefill ?? result.options[0];
    } else if (result.selected) {
      choice = result.selected;
    } else {
      // 7d: several differing options, never chosen silently (L38).
      throw timeError('LOGGING_FOR_REQUIRED', undefined, {
        options: result.options,
        prefill: result.prefill,
      });
    }

    if (o.remember) {
      await this.remember(callerId, projectId, {
        kind: choice.kind,
        id: choice.id,
      });
    }
    return choice;
  }

  /** Upserts time_logging_defaults (select → insert/update; one row per (user, project)). */
  async remember(
    callerId: string,
    projectId: string,
    choice: LoggingForRequest,
  ): Promise<void> {
    const id = choice.id ?? null;
    if (choice.kind !== 'personal' && !id) {
      throw timeError('LOGGING_FOR_INVALID');
    }
    const next: DefaultRow = {
      context_kind: choice.kind,
      team_id: choice.kind === 'team' ? id : null,
      workspace_id: choice.kind === 'workspace' ? id : null,
      engagement_assignment_id: choice.kind === 'assignment' ? id : null,
    };

    const { data, error } = await this.sb
      .from('time_logging_defaults')
      .select('context_kind, team_id, workspace_id, engagement_assignment_id')
      .eq('user_id', callerId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) this.fail('remember.read', error);
    const current = data as DefaultRow | null;
    if (
      current &&
      current.context_kind === next.context_kind &&
      sameId(current.team_id, next.team_id) &&
      sameId(current.workspace_id, next.workspace_id) &&
      sameId(current.engagement_assignment_id, next.engagement_assignment_id)
    ) {
      return;
    }

    const updatedAt = new Date().toISOString();
    if (!current) {
      const inserted = await this.sb.from('time_logging_defaults').insert({
        user_id: callerId,
        project_id: projectId,
        ...next,
        updated_at: updatedAt,
      });
      if (!inserted.error) {
        await this.cache.bumpEpoch();
        return;
      }
      // A concurrent first write won the primary key: fall through and update it.
      if (inserted.error.code !== UNIQUE_VIOLATION) {
        this.fail('remember.insert', inserted.error);
      }
    }
    const updated = await this.sb
      .from('time_logging_defaults')
      .update({ ...next, updated_at: updatedAt })
      .eq('user_id', callerId)
      .eq('project_id', projectId);
    if (updated.error) this.fail('remember.update', updated.error);
    // The cached read carries the prefill; the next GET must see the new default.
    await this.cache.bumpEpoch();
  }

  /** GET /time/projects/:projectId/policy?for= — `forRef` must be one of the caller's resolved options
   *  (else 404, never echoing ids); null = the selected/prefill/first option. Delegates to policy.resolve. */
  async policyFor(
    callerId: string,
    projectId: string,
    forRef: LoggingForRequest | null,
    at: Date,
  ): Promise<ResolvedTimePolicy> {
    // Uncached: the request may name an option the step-7 collapse folded into another one.
    const { result, all } = await this.compute(callerId, projectId, at, 'read');
    let target: Candidate | undefined;
    if (forRef) {
      target = all.find((c) => matches(c.option, forRef));
    } else {
      const first = result.selected ?? result.prefill ?? result.options[0];
      target = first ? all.find((c) => c.option === first) : undefined;
    }
    if (!target) throw timeNotFound('scope');

    const { option } = target;
    if (!option.sheet_scope) {
      // "Just me" has no sheet: the platform defaults (no policy workspace, so no workspace or team layer).
      return this.policy.resolve(
        { kind: 'workspace', ref: projectId },
        null,
        at,
      );
    }
    const policy = await this.policy.resolve(
      option.sheet_scope,
      target.policyWorkspaceId,
      at,
      {
        memberUserId: callerId,
        projectId,
        ...(target.teamId ? { teamId: target.teamId } : {}),
      },
    );
    if (option.kind !== 'assignment') return policy;
    // A8: the governing engagement, whose terms these are ("View terms →", web only). The engagement sheet
    // scope's ref is the same engagement.
    return {
      ...policy,
      engagement_id:
        option.engagement_id ??
        (option.sheet_scope.kind === 'engagement'
          ? option.sheet_scope.ref
          : null),
    };
  }

  // ── The resolver ────────────────────────────────────────────────────────────

  private async compute(
    callerId: string,
    projectId: string,
    at: Date,
    purpose: ResolvePurpose,
    requested?: LoggingForRequest,
  ): Promise<Computed> {
    // Step 1 (first, so a missing project is the same 404 as no access).
    const project = await this.loadProject(projectId);
    if (!project) throw timeNotFound('scope');

    // Step 0: project access floor, then the editor rule (CHANGE-1).
    const isOwner = project.owner_id !== null && project.owner_id === callerId;
    const perms =
      (await this.projectAuth.resolvePermissions(callerId, projectId)) ??
      (isOwner ? ROLE_DEFAULTS.owner : null);
    if (!perms) throw timeNotFound('scope');
    if (!getPermission(perms, 'time.log')) {
      return { result: emptyResult(), all: [] };
    }

    const [assignments, curated, remembered] = await Promise.all([
      // `manual`, `edit`, `alias` and dated reads accept an ended assignment whose window holds `at`.
      this.engagements.listActiveAssignmentsForWorker(callerId, projectId, at, {
        includeEndedWindow: purpose !== 'timer',
      }),
      this.curatedTeams(projectId, callerId),
      this.loadDefault(callerId, projectId),
    ]);

    const unavailable: UnavailableOption[] = [];
    const candidates: Candidate[] = [];
    const rowWorkspaces: RowWorkspaces = new Map();

    // Steps 2 and 3 read in parallel; placement keeps the resolver order (assignments, then teams).
    // Step 3: curated teams, ordered is_primary DESC, attached_at, team_id (L1). L35: a team equal to an
    // assignment's team or its talent engagement's hirer team is suppressed, but still counts as present.
    // D59: only an assignment that is itself available suppresses; an unavailable one (no_settings,
    // contract_disabled, engagement_inactive) never removes the team option. Teams are evaluated alongside
    // the assignments (no added latency) and a suppressed team's result is dropped.
    const [assignmentCandidates, suppressionSets, teamCandidates] =
      await Promise.all([
        Promise.all(
          assignments.map((a) => this.assignmentCandidate(a, projectId, at)),
        ),
        this.suppressionSets(assignments),
        Promise.all(
          curated.map((team) =>
            this.teamCandidate(team, projectId, at, rowWorkspaces),
          ),
        ),
      ]);
    const suppressed = new Set<string>();
    assignmentCandidates.forEach((c, i) => {
      if (!isAvailable(c)) return;
      for (const teamId of suppressionSets[i]) suppressed.add(teamId);
    });
    for (const c of assignmentCandidates) {
      this.place(c, candidates, unavailable);
    }
    curated.forEach((team, i) => {
      if (suppressed.has(team.id.toLowerCase())) return;
      this.place(teamCandidates[i], candidates, unavailable);
    });

    // Step 4: the workspace, only when step 3 found no team at all (L34: an unavailable team blocks it too).
    if (curated.length === 0 && project.workspace_id) {
      this.place(
        await this.workspaceCandidate(
          callerId,
          project.workspace_id,
          projectId,
          at,
        ),
        candidates,
        unavailable,
      );
    }

    // Step 5: an agreement that requires its own time removes every other option.
    let available = candidates;
    if (candidates.some((c) => c.required)) {
      available = candidates.filter((c) => c.option.kind === 'assignment');
    }

    // Step 6: "Just me" only when nothing governed is available (L31).
    let personalReason: LoggingForResult['personal_reason'];
    if (available.length === 0) {
      available = [
        {
          option: personalOption(),
          policyWorkspaceId: null,
          teamId: null,
          required: false,
        },
      ];
      personalReason = unavailable.some((u) => u.reason === 'plan')
        ? 'plan'
        : 'no_governed_option';
    }

    await this.fillWorkspaceNames(
      project,
      available,
      unavailable,
      rowWorkspaces,
    );

    // Step 7b: collapse equal (sheet scope, rate source), keeping the first.
    const representative = new Map<string, LoggingOption>();
    for (const c of available) {
      const key = collapseKey(c.option);
      if (!representative.has(key)) representative.set(key, c.option);
    }
    const options = [...representative.values()];

    // 7a: a valid request is selected as asked (matched before the collapse).
    const asked = requested
      ? available.find((c) => matches(c.option, requested))?.option
      : undefined;
    // 7d: the remembered default, if it is still an option (stale rows are ignored, E26), as a one-tap prefill.
    const rememberedOption = remembered
      ? available.find((c) => matches(c.option, remembered))?.option
      : undefined;
    const prefill =
      options.length > 1 && rememberedOption
        ? (representative.get(collapseKey(rememberedOption)) ?? null)
        : null;
    const selected = asked ?? (options.length === 1 ? options[0] : null);

    const result: LoggingForResult = {
      options,
      selected,
      prefill,
      unavailable,
    };
    if (!selected) result.reason = prefill ? 'confirm' : 'required';
    if (personalReason) result.personal_reason = personalReason;
    return { result, all: available };
  }

  private place(
    candidate: Candidate | UnavailableOption | null,
    candidates: Candidate[],
    unavailable: UnavailableOption[],
  ): void {
    if (!candidate) return;
    if ('reason' in candidate) unavailable.push(candidate);
    else candidates.push(candidate);
  }

  /** Null only when SQL has no sheet scope for it (unreachable for a listed assignment). */
  private async assignmentCandidate(
    a: AssignmentContext,
    projectId: string,
    at: Date,
  ): Promise<Candidate | UnavailableOption | null> {
    const off = (reason: UnavailableOption['reason']): UnavailableOption => ({
      kind: 'assignment',
      id: a.id,
      label: a.hirer_label,
      reason,
    });
    if (a.governing_status !== 'active') return off('engagement_inactive');

    const scope = await this.policy.sheetScopeFor(
      'assignment',
      a.id,
      projectId,
    );
    if (!scope) return null;
    // The contract's local date is read in the policy workspace's timezone, as time_resolve_policy does.
    const tz = await this.policy.workspaceTimezone(scope.policy_workspace_id);
    const settings = await this.engagements.settingsInForceOn(
      a.governing_engagement_id,
      localDate(at, tz),
    );
    if (!settings) return off('no_settings');
    if (settings.tracking_mode === 'disabled') return off('contract_disabled');

    return {
      option: {
        kind: 'assignment',
        id: a.id,
        label: a.hirer_label,
        sheet_scope: toScopeRef(scope),
        // Talent time carries the talent cost rate; a consultant's own client time is 0 (CHANGE-3).
        rate_source: a.talent_engagement_id ? 'engagement_cost' : 'none',
        workspace_tag: null,
        approver_hint:
          a.governing_kind === 'talent_services' ? 'hirer' : 'auto',
        // A8: the engagement whose terms govern (talent, else client), for "View terms →" (web only).
        engagement_id: a.governing_engagement_id,
      },
      policyWorkspaceId: scope.policy_workspace_id,
      teamId: null,
      required: settings.tracking_mode === 'required',
    };
  }

  /** Null only when SQL has no sheet scope for it (unreachable: time_sheet_scope_for always answers a team).
   *  An unavailable row records the workspace it answers to in `rowWorkspaces` (named by fillWorkspaceNames). */
  private async teamCandidate(
    team: TeamRow,
    projectId: string,
    at: Date,
    rowWorkspaces: RowWorkspaces,
  ): Promise<Candidate | UnavailableOption | null> {
    const label = team.name ?? 'Team';
    const off = (
      reason: UnavailableOption['reason'],
      workspaceId: string | null,
    ): UnavailableOption => {
      const row: UnavailableOption = {
        kind: 'team',
        id: team.id,
        label,
        reason,
      };
      if (workspaceId) rowWorkspaces.set(row, workspaceId);
      return row;
    };
    // ux.md: "<team's workspace> has time tracking off for this team."
    if (team.time_tracking_enabled !== true) {
      return off('team_time_off', team.workspace_id);
    }

    // D26: the plan subject is never a raw null.
    const planRef = await this.policy.planRefForTeam({
      id: team.id,
      workspace_id: team.workspace_id,
    });
    if (!(await this.entitlements.hasFeature(planRef, 'time_tracking'))) {
      // Teams have no plan of their own: the name is the workspace whose plan was read.
      return off('plan', planWorkspaceId(planRef));
    }

    const scope = await this.policy.sheetScopeFor('team', team.id, projectId);
    if (!scope) return null;
    const ratesOn =
      team.member_rates_enabled === true &&
      (await this.entitlements.hasFeature(planRef, 'time_team_rules'));
    const rateSource: RateSource = ratesOn ? 'team_member_rates' : 'none';
    const sheetScope = toScopeRef(scope);
    const policy = await this.policy.resolve(
      sheetScope,
      scope.policy_workspace_id,
      at,
    );

    return {
      option: {
        kind: 'team',
        id: team.id,
        label,
        sheet_scope: sheetScope,
        rate_source: rateSource,
        workspace_tag: null,
        approver_hint: governedApproverHint(sheetScope, policy, rateSource),
      },
      policyWorkspaceId: scope.policy_workspace_id,
      teamId: team.id,
      required: false,
    };
  }

  /** Null when the caller has no seat in the workspace or the workspace has tracking off. */
  private async workspaceCandidate(
    callerId: string,
    workspaceId: string,
    projectId: string,
    at: Date,
  ): Promise<Candidate | UnavailableOption | null> {
    const { data, error } = await this.sb
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', callerId)
      .maybeSingle();
    if (error) this.fail('workspaceMember', error);
    if (!data) return null;

    // The label is filled with the workspace name later (fillWorkspaceNames).
    if (!(await this.entitlements.hasFeature(workspaceId, 'time_tracking'))) {
      return { kind: 'workspace', id: workspaceId, label: '', reason: 'plan' };
    }
    const scope = await this.policy.sheetScopeFor(
      'workspace',
      workspaceId,
      projectId,
    );
    if (!scope) return null;
    const sheetScope = toScopeRef(scope);
    const policy = await this.policy.resolve(
      sheetScope,
      scope.policy_workspace_id,
      at,
    );
    // CHANGE-11: the effective workspace switch; off is not an "unavailable" reason, the option is just absent.
    if (!policy.tracking_enabled) return null;

    return {
      option: {
        kind: 'workspace',
        id: workspaceId,
        label: '',
        sheet_scope: sheetScope,
        rate_source: 'none',
        workspace_tag: null,
        approver_hint: governedApproverHint(sheetScope, policy, 'none'),
      },
      policyWorkspaceId: scope.policy_workspace_id,
      teamId: null,
      required: false,
    };
  }

  /** Teams attached to the project (project_teams) on which the caller is curated (project_team_members). */
  private async curatedTeams(
    projectId: string,
    callerId: string,
  ): Promise<TeamRow[]> {
    const [attached, curation] = await Promise.all([
      this.sb
        .from('project_teams')
        .select('team_id, is_primary, attached_at')
        .eq('project_id', projectId),
      this.sb
        .from('project_team_members')
        .select('team_id')
        .eq('project_id', projectId)
        .eq('user_id', callerId),
    ]);
    if (attached.error) this.fail('projectTeams', attached.error);
    if (curation.error) this.fail('projectTeamMembers', curation.error);

    const curatedIds = new Set(
      ((curation.data ?? []) as Array<{ team_id: string }>).map((r) =>
        r.team_id.toLowerCase(),
      ),
    );
    const ordered = ((attached.data ?? []) as ProjectTeamRow[])
      .filter((r) => curatedIds.has(r.team_id.toLowerCase()))
      .sort((a, b) => {
        const primary =
          Number(b.is_primary === true) - Number(a.is_primary === true);
        if (primary !== 0) return primary;
        const atA = a.attached_at ? Date.parse(a.attached_at) : 0;
        const atB = b.attached_at ? Date.parse(b.attached_at) : 0;
        if (atA !== atB) return atA - atB;
        return a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0;
      });
    if (ordered.length === 0) return [];

    const { data, error } = await this.sb
      .from('teams')
      .select(
        'id, name, workspace_id, time_tracking_enabled, member_rates_enabled',
      )
      .in(
        'id',
        ordered.map((r) => r.team_id),
      );
    if (error) this.fail('teams', error);
    const byId = new Map(
      ((data ?? []) as TeamRow[]).map((t) => [t.id.toLowerCase(), t]),
    );
    return ordered
      .map((r) => byId.get(r.team_id.toLowerCase()))
      .filter((t): t is TeamRow => t !== undefined);
  }

  /** L35, per assignment (aligned with `assignments`): its own team and its talent engagement's hirer party
   *  team, lower-cased. Each talent engagement is looked up once. */
  private async suppressionSets(
    assignments: AssignmentContext[],
  ): Promise<string[][]> {
    const hirerTeam = new Map<string, Promise<string | null>>();
    for (const a of assignments) {
      const talentId = a.talent_engagement_id;
      if (talentId && !hirerTeam.has(talentId)) {
        hirerTeam.set(talentId, this.engagements.hirerPartyTeamId(talentId));
      }
    }
    return Promise.all(
      assignments.map(async (a) => {
        const out: string[] = [];
        if (a.team_id) out.push(a.team_id.toLowerCase());
        const talentId = a.talent_engagement_id;
        const teamId = talentId ? await hirerTeam.get(talentId) : null;
        if (teamId) out.push(teamId.toLowerCase());
        return out;
      }),
    );
  }

  /** Workspace option labels (the workspace name), the L57 tag on options governed by another workspace, and the
   *  `workspace_name` of team `unavailable[]` rows (A-4). One `workspaces` read for all of them. */
  private async fillWorkspaceNames(
    project: ProjectRow,
    candidates: Candidate[],
    unavailable: UnavailableOption[],
    rowWorkspaces: RowWorkspaces,
  ): Promise<void> {
    const projectWs = project.workspace_id?.toLowerCase() ?? null;
    const foreign = (c: Candidate): string | null =>
      c.option.kind !== 'workspace' &&
      c.option.kind !== 'personal' &&
      c.policyWorkspaceId &&
      c.policyWorkspaceId.toLowerCase() !== projectWs
        ? c.policyWorkspaceId
        : null;

    const ids = new Set<string>();
    for (const c of candidates) {
      if (c.option.kind === 'workspace' && c.option.id) ids.add(c.option.id);
      const tagged = foreign(c);
      if (tagged) ids.add(tagged);
    }
    for (const u of unavailable) {
      if (u.kind === 'workspace' && u.id) ids.add(u.id);
      const owner = rowWorkspaces.get(u);
      if (owner) ids.add(owner);
    }
    if (ids.size === 0) return;

    const { data, error } = await this.sb
      .from('workspaces')
      .select('id, name')
      .in('id', [...ids]);
    if (error) this.fail('workspaces', error);
    const rows = (data ?? []) as Array<{ id: string; name: string | null }>;
    const names = new Map(
      rows.map((w) => [w.id.toLowerCase(), w.name ?? 'Workspace']),
    );
    const nameOf = (id: string) => names.get(id.toLowerCase()) ?? 'Workspace';
    // A team row's owner name is only ever a real name: without one the web keeps its generic sentence.
    const realNames = new Map(
      rows
        .filter((w) => (w.name ?? '').trim() !== '')
        .map((w) => [w.id.toLowerCase(), (w.name as string).trim()]),
    );

    for (const c of candidates) {
      if (c.option.kind === 'workspace' && c.option.id) {
        c.option.label = nameOf(c.option.id);
      }
      const tagged = foreign(c);
      if (tagged) c.option.workspace_tag = nameOf(tagged);
    }
    for (const u of unavailable) {
      if (u.kind === 'workspace' && u.id) u.label = nameOf(u.id);
      const owner = rowWorkspaces.get(u);
      const ownerName = owner ? realNames.get(owner.toLowerCase()) : undefined;
      if (ownerName) u.workspace_name = ownerName;
    }
  }

  private async loadProject(projectId: string): Promise<ProjectRow | null> {
    const { data, error } = await this.sb
      .from('projects')
      .select('id, owner_id, workspace_id')
      .eq('id', projectId)
      .maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) return null;
      this.fail('project', error);
    }
    return (data as ProjectRow | null) ?? null;
  }

  private async loadDefault(
    callerId: string,
    projectId: string,
  ): Promise<LoggingForRequest | null> {
    const { data, error } = await this.sb
      .from('time_logging_defaults')
      .select('context_kind, team_id, workspace_id, engagement_assignment_id')
      .eq('user_id', callerId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) this.fail('loggingDefault', error);
    const row = data as DefaultRow | null;
    if (!row) return null;
    const id =
      row.context_kind === 'team'
        ? row.team_id
        : row.context_kind === 'workspace'
          ? row.workspace_id
          : row.context_kind === 'assignment'
            ? row.engagement_assignment_id
            : null;
    return { kind: row.context_kind, id };
  }

  /** A time sentinel maps as usual; anything else is a logged 500 with no Postgres text in the body. */
  private fail(operation: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `LoggingContextService.${operation} failed: ${error.message ?? 'unknown error'}`,
    );
    throw new InternalServerErrorException(
      "Proyekto couldn't load where this time can be logged. Try again.",
    );
  }
}
