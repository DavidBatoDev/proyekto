// Rates for time entries: the write-time display estimate (L10) and the freeze-time re-resolution for one local
// date (CHANGE-4 step 1, E43). Money is decided here and nowhere else in TypeScript; SQL applies what the freeze
// payload carries.
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  type AssignmentContext,
  EngagementsService,
  pickRate,
} from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import type { PgErrorLike } from './time-errors';
import { localDate as toLocalDate, safeTimezone } from './time-periods';
import {
  TimePolicyService,
  loadMemberRateInForce,
  memberCapsFromRate,
  toNumberOrNull,
} from './time-policy.service';
import type {
  ContextKind,
  FrozenRate,
  LoggingOption,
  MemberCaps,
  RateEstimate,
  RateType,
  WorkType,
} from './time.types';

/** Last link of every currency chain. */
const DEFAULT_CURRENCY = 'USD';

interface RateTeamRow {
  id: string;
  workspace_id: string | null;
  member_rates_enabled: boolean;
  default_currency: string | null;
}

/** A rate before the currency chain fills a missing currency. */
interface PartialRate {
  rate: number;
  rateType: RateType;
  currency: string | null;
  amountable: boolean;
}

/** Instant comparison of two timestamptz strings; an unparsable value is never "before". */
function isBefore(a: string, b: string): boolean {
  const am = Date.parse(a);
  const bm = Date.parse(b);
  return Number.isFinite(am) && Number.isFinite(bm) && am < bm;
}

@Injectable()
export class TimeRatesService {
  private readonly logger = new Logger(TimeRatesService.name);
  /** Process cache: the legacy import happens once (M2), so the first non-null answer never changes. */
  private legacyCutoffCache: string | null = null;

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: TimePolicyService,
  ) {}

  /** Write-time display estimate (L10). team: TMR in force today (work_type picks hourly vs training rate),
   *  0 without member_rates_enabled or time_team_rules; assignment: talent cost rate in force, client-only 0;
   *  workspace/personal: 0. Currency: rate row → teams.default_currency → projects.currency → 'USD'. */
  async estimate(
    option: LoggingOption,
    memberId: string,
    projectId: string,
    workType: WorkType,
    at: Date,
  ): Promise<RateEstimate> {
    let rate: PartialRate = {
      rate: 0,
      rateType: 'hourly',
      currency: null,
      amountable: true,
    };

    if (option.kind === 'team' && option.id) {
      const team = await this.loadTeam(option.id);
      if (team) {
        // The local date only matters once there is a rate card to read.
        const d = team.member_rates_enabled
          ? toLocalDate(
              at,
              await this.optionTimezone(option, at, team.workspace_id),
            )
          : '';
        rate = await this.teamRate(team, memberId, projectId, d, workType);
      }
    } else if (option.kind === 'assignment' && option.id) {
      const assignment = await this.engagements.getAssignment(option.id);
      if (assignment) {
        const d = assignment.talent_engagement_id
          ? toLocalDate(at, await this.optionTimezone(option, at, null))
          : '';
        rate = await this.engagementRate(assignment, memberId, d, workType);
        if (!rate.currency && assignment.team_id) {
          const team = await this.loadTeam(assignment.team_id);
          rate.currency = team?.default_currency || null;
        }
      }
    }

    return {
      rate_snapshot: rate.rate,
      rate_type_snapshot: rate.rateType,
      currency_snapshot:
        rate.currency || (await this.projectCurrency(projectId)),
    };
  }

  /** Freeze-time re-resolution for local date d (CHANGE-4 step 1). Legacy entries (created_at < legacyCutoff)
   *  return their stored snapshot (D13). TMR fixed → rateType 'fixed', amountable false. */
  async freezeRate(
    e: {
      context_kind: ContextKind;
      context_ref: string | null;
      team_id: string | null;
      engagement_assignment_id: string | null;
      member_user_id: string;
      project_id: string | null;
      work_type_snapshot: WorkType;
      created_at: string;
      rate_snapshot: number;
      rate_type_snapshot: RateType;
      currency_snapshot: string;
    },
    localDate: string,
    legacyCutoff: string | null,
  ): Promise<FrozenRate> {
    const storedCurrency = e.currency_snapshot || DEFAULT_CURRENCY;

    // D13: imported history keeps the rate it was logged at, whatever the rate card says now.
    if (legacyCutoff && isBefore(e.created_at, legacyCutoff)) {
      const rateType: RateType =
        e.rate_type_snapshot === 'fixed' ? 'fixed' : 'hourly';
      return {
        rate: toNumberOrNull(e.rate_snapshot) ?? 0,
        rateType,
        currency: storedCurrency,
        amountable: rateType === 'hourly',
      };
    }

    let rate: PartialRate;
    switch (e.context_kind) {
      case 'team': {
        const teamId = e.team_id ?? e.context_ref;
        const team = teamId ? await this.loadTeam(teamId) : null;
        // A deleted team has no rate card left.
        rate = team
          ? await this.teamRate(
              team,
              e.member_user_id,
              e.project_id,
              localDate,
              e.work_type_snapshot,
            )
          : { rate: 0, rateType: 'hourly', currency: null, amountable: true };
        break;
      }
      case 'assignment': {
        const assignmentId = e.engagement_assignment_id ?? e.context_ref;
        const assignment = assignmentId
          ? await this.engagements.getAssignment(assignmentId)
          : null;
        rate = assignment
          ? await this.engagementRate(
              assignment,
              e.member_user_id,
              localDate,
              e.work_type_snapshot,
            )
          : { rate: 0, rateType: 'hourly', currency: null, amountable: false };
        break;
      }
      case 'workspace':
        // A workspace sheet carries no cost money (CHANGE-9).
        rate = {
          rate: 0,
          rateType: 'hourly',
          currency: null,
          amountable: true,
        };
        break;
      default:
        // Personal time is never on a sheet, so never frozen; answer "no money" if asked.
        rate = {
          rate: 0,
          rateType: 'hourly',
          currency: null,
          amountable: false,
        };
    }
    return { ...rate, currency: rate.currency || storedCurrency };
  }

  /** team_member_rates row in force on d for (team, member, project ?? null) → caps. */
  async memberCaps(
    teamId: string,
    memberId: string,
    projectId: string | null,
    localDate: string,
  ): Promise<MemberCaps | null> {
    const row = await loadMemberRateInForce(
      this.sb,
      teamId,
      memberId,
      projectId,
      localDate,
    );
    return row ? memberCapsFromRate(row) : null;
  }

  /** min(timesheet_events.created_at) WHERE event='legacy_import'; process-cached after the first non-null read. */
  async legacyCutoff(): Promise<string | null> {
    if (this.legacyCutoffCache) return this.legacyCutoffCache;
    const { data, error } = await this.sb
      .from('timesheet_events')
      .select('created_at')
      .eq('event', 'legacy_import')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) this.fail('legacy_cutoff', error as PgErrorLike);
    const cutoff =
      (data as { created_at?: string | null } | null)?.created_at ?? null;
    if (cutoff) this.legacyCutoffCache = cutoff;
    return cutoff;
  }

  // ── private ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Team rate card (L10): 0 while member rates are off or the team's plan subject lacks time_team_rules (D26);
   * else the team_member_rates row in force on d, training rate for training work, 'fixed' never amountable.
   * Currency: the row's, else the team's default.
   */
  private async teamRate(
    team: RateTeamRow,
    memberId: string,
    projectId: string | null,
    d: string,
    workType: WorkType,
  ): Promise<PartialRate> {
    const zero: PartialRate = {
      rate: 0,
      rateType: 'hourly',
      currency: team.default_currency || null,
      amountable: true,
    };
    if (!team.member_rates_enabled) return zero;
    const hasTeamRules = await this.entitlements.hasFeature(
      await this.policy.planRefForTeam(team),
      'time_team_rules',
    );
    if (!hasTeamRules) return zero;

    const row = await loadMemberRateInForce(
      this.sb,
      team.id,
      memberId,
      projectId,
      d,
    );
    if (!row) return zero;
    const rate =
      toNumberOrNull(
        workType === 'training' ? row.training_hourly_rate : row.hourly_rate,
      ) ?? 0;
    const currency = row.currency || zero.currency;
    return row.rate_type === 'fixed'
      ? { rate, rateType: 'fixed', currency, amountable: false }
      : { rate, rateType: 'hourly', currency, amountable: true };
  }

  /**
   * Assignment rate (L3, L9, E43): the governing talent engagement's `cost` rate in force on d for this worker
   * (pickRate: work_type before NULL, hour before month/fixed). A client-only assignment has no internal cost:
   * 0 and not amountable. A month/fixed unit is 'fixed', not amountable.
   */
  private async engagementRate(
    assignment: AssignmentContext,
    memberId: string,
    d: string,
    workType: WorkType,
  ): Promise<PartialRate> {
    if (!assignment.talent_engagement_id) {
      return { rate: 0, rateType: 'hourly', currency: null, amountable: false };
    }
    const rows = await this.engagements.ratesFor(
      assignment.talent_engagement_id,
      { rateKind: 'cost', workerId: memberId },
    );
    const row = pickRate(rows, d, workType);
    if (!row) {
      return { rate: 0, rateType: 'hourly', currency: null, amountable: true };
    }
    const rate = toNumberOrNull(row.amount) ?? 0;
    const currency = row.currency || null;
    return row.unit === 'hour'
      ? { rate, rateType: 'hourly', currency, amountable: true }
      : { rate, rateType: 'fixed', currency, amountable: false };
  }

  /** The timezone of the sheet the option lands on, for the estimate's local date. */
  private async optionTimezone(
    option: LoggingOption,
    at: Date,
    teamWorkspaceId: string | null,
  ): Promise<string> {
    const scope = option.sheet_scope;
    if (!scope) {
      return option.kind === 'team' && option.id
        ? this.policy.teamTimezone(option.id)
        : 'UTC';
    }
    if (scope.kind === 'workspace') {
      return this.policy.workspaceTimezone(scope.ref);
    }
    const policyWorkspaceId =
      scope.kind === 'team'
        ? teamWorkspaceId
        : await this.engagements.policyWorkspaceFor(scope.ref);
    const resolved = await this.policy.resolve(scope, policyWorkspaceId, at);
    return safeTimezone(resolved.timezone);
  }

  private async loadTeam(teamId: string): Promise<RateTeamRow | null> {
    const { data, error } = await this.sb
      .from('teams')
      .select('id, workspace_id, member_rates_enabled, default_currency')
      .eq('id', teamId)
      .maybeSingle();
    if (error) this.fail('team', error as PgErrorLike);
    return (data as RateTeamRow | null) ?? null;
  }

  /** projects.currency → 'USD'. */
  private async projectCurrency(projectId: string): Promise<string> {
    if (!projectId) return DEFAULT_CURRENCY;
    const { data, error } = await this.sb
      .from('projects')
      .select('currency')
      .eq('id', projectId)
      .maybeSingle();
    if (error) this.fail('project_currency', error as PgErrorLike);
    return (
      (data as { currency?: string | null } | null)?.currency ||
      DEFAULT_CURRENCY
    );
  }

  private fail(op: string, err: PgErrorLike): never {
    this.logger.error(
      `time_rates_${op}_failed code=${err.code ?? 'none'} message=${err.message ?? ''}`,
    );
    throw new InternalServerErrorException(
      "Proyekto couldn't load the rates for this time. Try again.",
    );
  }
}
