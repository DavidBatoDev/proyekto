// The only door ProjectsService uses into the time module (blueprint §2.8, P16): stop a deleted project's running
// timers (E9), the project dashboard's time block (backend.md "Finance, Exports and Dashboard"), the client-hours
// level for my-permissions (L22) and the roster mask (L22, E35, D57).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TimeAuthorityService } from './time-authority.service';
import { TimeEntriesService } from './time-entries.service';
import { ENTRY_AUTH_SELECT } from './time-entry.select';
import { type PgErrorLike, throwTimeDb } from './time-errors';
import {
  localDate,
  monthWindow,
  safeTimezone,
  weekWindow,
} from './time-periods';
import {
  TEAM_MEMBER_RATE_SELECT,
  type TeamMemberRateRow,
  TimePolicyService,
  memberCapsFromRate,
  pickMemberRateInForce,
  toNumberOrNull,
} from './time-policy.service';
import type {
  ClientHoursLevel,
  EntryAuthRow,
  LegacyEntryStatus,
  LegacyStatusMarker,
  TimesheetStatus,
} from './time.types';

/** Roster copy (ux.md "Delivery team / Delivery team member", L22). Entries read MASKED_MEMBER_LABEL instead. */
export const ROSTER_MASKED_LABEL = 'Delivery team member';

/** The dashboard filters the time block honours (ProjectDashboardSummaryQueryDto minus project_id). */
export interface DashboardTimeQuery {
  from?: string;
  to?: string;
  team_id?: string;
  member_user_id?: string;
}

export interface DashboardTime {
  time: {
    total_logs: number;
    total_seconds: number;
    total_hours: number;
    /** The old per-log ladder, derived by the D03 column predicates (kept for the old web). */
    status_counts: {
      pending: number;
      approved: number;
      paid: number;
      rejected: number;
    };
    sheet_status_counts: Record<TimesheetStatus | 'personal', number>;
    total_fees: number;
  };
  overtime: { over_limit_windows: number; overage_hours_total: number };
}

/** The zero shape, for a caller with no projects (ProjectsService returns it without calling the facade). */
export function emptyDashboardTime(): DashboardTime {
  return {
    time: {
      total_logs: 0,
      total_seconds: 0,
      total_hours: 0,
      status_counts: { pending: 0, approved: 0, paid: 0, rejected: 0 },
      sheet_status_counts: {
        open: 0,
        submitted: 0,
        returned: 0,
        approved: 0,
        personal: 0,
      },
      total_fees: 0,
    },
    overtime: { over_limit_windows: 0, overage_hours_total: 0 },
  };
}

/** One project_access member row as the project payloads embed it (getProject, findByUser, findDashboardByUser). */
type RosterRow = Record<string, unknown> & {
  id?: unknown;
  user_id?: unknown;
  user?: unknown;
};

/**
 * Pure. Masks every member row whose user is in `masked` (L22, E35): the profile reads "Delivery team member"
 * with no avatar, email or name, and the user id is replaced by an opaque `masked:<row>` token so the person
 * cannot be looked up (as the alias does for entries, D32). The row's own id, role and capabilities stay, so a
 * manager can still act on the row by member id. Rows of anyone else are returned untouched (same object).
 */
export function maskRosterMembers<T>(
  projectId: string,
  members: T[],
  masked: Set<string>,
): T[] {
  if (masked.size === 0) return members;
  return members.map((member, index) => {
    const row = member as unknown as RosterRow | null;
    if (!row || typeof row !== 'object') return member;
    const userId = typeof row.user_id === 'string' ? row.user_id : null;
    if (!userId || !masked.has(userId)) return member;
    const token = `masked:${typeof row.id === 'string' && row.id ? row.id : `${projectId}:${index}`}`;
    const profile =
      row.user && typeof row.user === 'object'
        ? (row.user as Record<string, unknown>)
        : {};
    const maskedProfile: Record<string, unknown> = {};
    for (const key of Object.keys(profile)) maskedProfile[key] = null;
    maskedProfile.id = token;
    maskedProfile.display_name = ROSTER_MASKED_LABEL;
    maskedProfile.avatar_url = null;
    return {
      ...row,
      user_id: token,
      user: maskedProfile,
    } as unknown as T;
  });
}

/** Pure. A project payload with its `members` masked; anything without a members array is returned as is. */
export function maskProjectRoster<T>(project: T, masked: Set<string>): T {
  const p = project as unknown as {
    id?: unknown;
    members?: unknown;
  } | null;
  if (
    !p ||
    masked.size === 0 ||
    typeof p.id !== 'string' ||
    !Array.isArray(p.members)
  ) {
    return project;
  }
  return {
    ...(project as object),
    members: maskRosterMembers(p.id, p.members, masked),
  } as T;
}

/** D03 column predicates (never `time_entries.status`, which drops in M5). */
export function dashboardStatusOf(row: {
  payout_id: string | null;
  legacy_status: LegacyStatusMarker | null;
  payable_seconds: number | string | null;
}): LegacyEntryStatus {
  if (row.payout_id || row.legacy_status === 'paid_outside') return 'paid';
  if (row.legacy_status === 'rejected') return 'rejected';
  if (toNumberOrNull(row.payable_seconds) !== null) return 'approved';
  return 'pending';
}

/** Rows read for the dashboard: the authorisation columns plus hours, settlement markers and the sheet status. */
const DASHBOARD_ENTRY_SELECT =
  ENTRY_AUTH_SELECT +
  ', duration_seconds, payable_seconds, payout_id, legacy_status, ' +
  'timesheet:timesheets!timesheet_id(status)';

interface DashboardEntryRow extends EntryAuthRow {
  duration_seconds: number | string | null;
  payable_seconds: number | string | null;
  payout_id: string | null;
  legacy_status: LegacyStatusMarker | null;
  timesheet:
    | { status: TimesheetStatus | null }
    | Array<{ status: TimesheetStatus | null }>
    | null;
}

interface WindowSpec {
  timezone: string;
  weekStart: number;
}

interface CapWindow {
  teamId: string;
  memberId: string;
  kind: 'weekly' | 'monthly';
  seconds: number;
  /** The latest entry in the window: its caps decide the window (capContext reads an entry's caps the same way). */
  lastStartedAt: number;
  lastProjectId: string | null;
  lastLocalDate: string;
}

/** `.in()` lists are chunked so a big dashboard never builds an over-long URL. */
const IN_CHUNK = 100;
/** PostgREST answers at most max-rows (1000) per request, so the dashboard pages. */
const PAGE_SIZE = 1000;
/** Only a UUID is ever interpolated into a PostgREST `or()` filter. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) {
    out.push(items.slice(i, i + IN_CHUNK));
  }
  return out;
}

function distinct(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/** Half-up to cents, the dashboard's presentation rule (invoiceRound in ProjectsService). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sheetStatusOf(row: DashboardEntryRow): TimesheetStatus | null {
  const sheet = Array.isArray(row.timesheet) ? row.timesheet[0] : row.timesheet;
  return sheet?.status ?? null;
}

/** Approved = `payable_seconds IS NOT NULL AND legacy_status IS DISTINCT FROM 'rejected'` (CHANGE-5, E64). */
function isApproved(row: DashboardEntryRow): boolean {
  return (
    toNumberOrNull(row.payable_seconds) !== null &&
    row.legacy_status !== 'rejected'
  );
}

@Injectable()
export class TimeProjectsFacade {
  private readonly logger = new Logger(TimeProjectsFacade.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly entries: TimeEntriesService,
    private readonly authority: TimeAuthorityService,
    private readonly policy: TimePolicyService,
  ) {}

  /** E9: called by deleteProject while the project row still exists (rpc time_stop_running_entries). */
  stopRunningForProject(projectId: string): Promise<number> {
    return this.entries.stopRunningForProject(projectId);
  }

  /**
   * The dashboard time and overtime block over `projectIds` (the caller's projects, already authorised by
   * ProjectsService). Personal entries count only when they are the caller's own (personal time is member-only).
   * A `member_user_id` filter naming someone else leaves out the rows whose worker the caller may not name (L22).
   * - `status_counts`: D03 column predicates. `sheet_status_counts`: by the entry's sheet; personal entries under
   *   `personal`; a non-personal entry with no sheet (pre-M2 only) under `open`.
   * - Hours (`total_seconds`): Σ `payable_seconds` of approved entries, so legacy rejected time never shows (E64).
   * - `total_fees`: Σ `amount_snapshot` over approved entries the caller is `costVisible` for, nothing else
   *   (replaces the old `time.view_team_logs` gate). Amounts are summed as stored, across currencies, as before.
   * - Overtime: team-context entries that are not legacy-rejected, in windows per (member, team) in the team's
   *   policy timezone and week start (D46), against the `team_member_rates` caps in force on the window's latest
   *   entry's local date; logged `duration_seconds` count, as in capContext.
   */
  async dashboardTime(
    userId: string,
    projectIds: string[],
    q: DashboardTimeQuery,
  ): Promise<DashboardTime> {
    const result = emptyDashboardTime();
    const ids = distinct(projectIds);
    if (ids.length === 0) return result;

    const rows = await this.unmaskedForPerson(
      userId,
      q,
      await this.loadEntries(userId, ids, q),
    );
    if (rows.length === 0) return result;

    let payableSeconds = 0;
    for (const row of rows) {
      result.time.status_counts[dashboardStatusOf(row)] += 1;
      const bucket: TimesheetStatus | 'personal' =
        row.context_kind === 'personal'
          ? 'personal'
          : (sheetStatusOf(row) ?? 'open');
      result.time.sheet_status_counts[bucket] += 1;
      if (isApproved(row)) {
        payableSeconds += Math.max(0, toNumberOrNull(row.payable_seconds) ?? 0);
      }
    }

    const [fees, overtime] = await Promise.all([
      this.visibleFees(userId, rows),
      this.overtimeWindows(rows),
    ]);

    result.time.total_logs = rows.length;
    result.time.total_seconds = payableSeconds;
    result.time.total_hours = payableSeconds / 3600;
    result.time.total_fees = round2(fees);
    result.overtime = {
      over_limit_windows: overtime.windows,
      overage_hours_total: round2(overtime.overageHours),
    };
    return result;
  }

  /** least(...) over the caller's active client-engagement hirer seats linked to the project (L22). */
  clientHoursLevel(
    userId: string,
    projectId: string,
  ): Promise<ClientHoursLevel> {
    return this.authority.clientHoursLevel(userId, projectId);
  }

  /** Workers of talent assignments on the project the viewer is not a provider-side party for (D57). */
  maskedWorkerIds(projectId: string, viewerId: string): Promise<Set<string>> {
    return this.authority.maskedWorkerIds(projectId, viewerId);
  }

  /**
   * Additive (P16): `maskedWorkerIds` for many projects at once, for the project lists. One probe finds the
   * projects that have any engagement assignment; only those are asked (most projects have none). Projects
   * with nothing to mask are absent from the map.
   */
  async maskedWorkerIdsByProject(
    projectIds: string[],
    viewerId: string,
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const ids = distinct(projectIds);
    if (ids.length === 0) return out;

    const withAssignments = new Set<string>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('engagement_assignments')
        .select('project_id')
        .in('project_id', part);
      if (error) throwTimeDb(error as PgErrorLike);
      for (const row of (data ?? []) as Array<{ project_id: string | null }>) {
        if (row.project_id) withAssignments.add(row.project_id);
      }
    }

    await Promise.all(
      [...withAssignments].map(async (projectId) => {
        const masked = await this.authority.maskedWorkerIds(
          projectId,
          viewerId,
        );
        if (masked.size > 0) out.set(projectId, masked);
      }),
    );
    return out;
  }

  // ── private ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * L22 under a person filter (W2 review F1): talent ids are public, so a count filtered by someone else would
   * confirm that a masked worker is placed on the project and how much they log. Rows whose identity the caller
   * may not see (identityVisible: placed-talent assignment rows outside the provider side) are dropped, as
   * TimeReportsService does for its person filter. Without a person filter the totals name nobody, so every row
   * counts; the caller's own rows are always visible.
   */
  private async unmaskedForPerson(
    userId: string,
    q: DashboardTimeQuery,
    rows: DashboardEntryRow[],
  ): Promise<DashboardEntryRow[]> {
    if (!q.member_user_id || q.member_user_id === userId) return rows;
    if (!rows.some((r) => r.context_kind === 'assignment')) return rows;
    const visible = await this.authority.identityVisible(userId, rows);
    return rows.filter((r) => visible.has(r.id));
  }

  private async loadEntries(
    userId: string,
    projectIds: string[],
    q: DashboardTimeQuery,
  ): Promise<DashboardEntryRow[]> {
    const out: DashboardEntryRow[] = [];
    // Personal time is member-only: nobody else's personal entry is even read. A caller id that is not a
    // UUID (it never is for a signed-in user) owns no entry, so it reads no personal time at all.
    const personalFilter = UUID_RE.test(userId)
      ? `context_kind.neq.personal,member_user_id.eq.${userId}`
      : 'context_kind.neq.personal';
    for (const part of chunks(projectIds)) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        let query = this.sb
          .from('time_entries')
          .select(DASHBOARD_ENTRY_SELECT)
          .in('project_id', part)
          .or(personalFilter);
        if (q.from) query = query.gte('started_at', q.from);
        if (q.to) query = query.lte('started_at', q.to);
        if (q.team_id) query = query.eq('team_id', q.team_id);
        if (q.member_user_id) {
          query = query.eq('member_user_id', q.member_user_id);
        }
        const { data, error } = await query
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throwTimeDb(error as PgErrorLike);
        const page = (data ?? []) as unknown as DashboardEntryRow[];
        out.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
    }
    // Belt and braces for the filter above.
    return out.filter(
      (row) => row.context_kind !== 'personal' || row.member_user_id === userId,
    );
  }

  /** Σ amount_snapshot over approved entries whose cost the caller may see; the cost class is read only for them. */
  private async visibleFees(
    userId: string,
    rows: DashboardEntryRow[],
  ): Promise<number> {
    const approved = rows.filter(isApproved);
    if (approved.length === 0) return 0;
    const visible = await this.authority.costVisible(userId, approved);
    const ids = approved.filter((r) => visible.has(r.id)).map((r) => r.id);
    let total = 0;
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('time_entries')
        .select('id, amount_snapshot')
        .in('id', part);
      if (error) throwTimeDb(error as PgErrorLike);
      for (const row of (data ?? []) as Array<{
        amount_snapshot: number | string | null;
      }>) {
        total += toNumberOrNull(row.amount_snapshot) ?? 0;
      }
    }
    return total;
  }

  private async overtimeWindows(
    rows: DashboardEntryRow[],
  ): Promise<{ windows: number; overageHours: number }> {
    const teamRows = rows.filter(
      (r) =>
        r.context_kind === 'team' &&
        !!r.team_id &&
        !!r.member_user_id &&
        r.legacy_status !== 'rejected',
    );
    if (teamRows.length === 0) return { windows: 0, overageHours: 0 };

    const teamIds = distinct(teamRows.map((r) => r.team_id));
    const memberIds = distinct(teamRows.map((r) => r.member_user_id));
    const [specs, rates] = await Promise.all([
      this.windowSpecs(teamIds, teamRows),
      this.memberRates(teamIds, memberIds),
    ]);

    const windows = new Map<string, CapWindow>();
    for (const row of teamRows) {
      const teamId = row.team_id as string;
      const memberId = row.member_user_id as string;
      const spec = specs.get(teamId) ?? { timezone: 'UTC', weekStart: 1 };
      const startedAt = Date.parse(row.started_at);
      if (Number.isNaN(startedAt)) continue;
      const day = localDate(row.started_at, spec.timezone);
      const seconds = Math.max(0, toNumberOrNull(row.duration_seconds) ?? 0);
      const kinds: Array<['weekly' | 'monthly', string]> = [
        ['weekly', weekWindow(day, spec.weekStart).start],
        ['monthly', monthWindow(day).start],
      ];
      for (const [kind, windowStart] of kinds) {
        const key = `${teamId}|${memberId}|${kind}|${windowStart}`;
        let w = windows.get(key);
        if (!w) {
          w = {
            teamId,
            memberId,
            kind,
            seconds: 0,
            lastStartedAt: Number.NEGATIVE_INFINITY,
            lastProjectId: null,
            lastLocalDate: day,
          };
          windows.set(key, w);
        }
        w.seconds += seconds;
        if (startedAt >= w.lastStartedAt) {
          w.lastStartedAt = startedAt;
          w.lastProjectId = row.project_id;
          w.lastLocalDate = day;
        }
      }
    }

    let count = 0;
    let overageHours = 0;
    for (const w of windows.values()) {
      const rate = pickMemberRateInForce(
        rates.get(`${w.teamId}|${w.memberId}`) ?? [],
        w.lastProjectId,
        w.lastLocalDate,
      );
      if (!rate) continue;
      const caps = memberCapsFromRate(rate);
      const limit =
        w.kind === 'weekly'
          ? caps.weekly_limit_hours
          : caps.monthly_limit_hours;
      if (limit === null) continue;
      const hours = w.seconds / 3600;
      if (hours > limit) {
        count += 1;
        overageHours += hours - limit;
      }
    }
    return { windows: count, overageHours };
  }

  /** Per team: the timezone and week start of its effective policy (the sheet scope its entries land on). */
  private async windowSpecs(
    teamIds: string[],
    teamRows: DashboardEntryRow[],
  ): Promise<Map<string, WindowSpec>> {
    const out = new Map<string, WindowSpec>();
    await Promise.all(
      teamIds.map(async (teamId) => {
        const projectId =
          teamRows.find((r) => r.team_id === teamId && r.project_id)
            ?.project_id ?? '';
        out.set(teamId, await this.windowSpec(teamId, projectId));
      }),
    );
    return out;
  }

  private async windowSpec(
    teamId: string,
    projectId: string,
  ): Promise<WindowSpec> {
    try {
      const scope = await this.policy.sheetScopeFor('team', teamId, projectId);
      const resolved = await this.policy.resolve(
        scope
          ? { kind: scope.scope_kind, ref: scope.scope_ref }
          : { kind: 'team', ref: teamId },
        scope?.policy_workspace_id ?? null,
        new Date(),
      );
      return {
        timezone: safeTimezone(resolved.timezone),
        weekStart: resolved.week_start || 1,
      };
    } catch (error) {
      // A display aggregate: one unreadable team policy must not break the dashboard. Fall back to UTC weeks.
      this.logger.warn(
        `TimeProjectsFacade.windowSpec team=${teamId} fell back to UTC: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { timezone: 'UTC', weekStart: 1 };
    }
  }

  /** Every team_member_rates row of the (team, member) pairs, grouped `${team}|${member}`; one read per chunk. */
  private async memberRates(
    teamIds: string[],
    memberIds: string[],
  ): Promise<Map<string, TeamMemberRateRow[]>> {
    const out = new Map<string, TeamMemberRateRow[]>();
    for (const teamPart of chunks(teamIds)) {
      for (const memberPart of chunks(memberIds)) {
        const { data, error } = await this.sb
          .from('team_member_rates')
          .select(TEAM_MEMBER_RATE_SELECT)
          .in('team_id', teamPart)
          .in('user_id', memberPart);
        if (error) throwTimeDb(error as PgErrorLike);
        for (const row of (data ?? []) as unknown as TeamMemberRateRow[]) {
          const key = `${row.team_id}|${row.user_id}`;
          const list = out.get(key);
          if (list) list.push(row);
          else out.set(key, [row]);
        }
      }
    }
    return out;
  }
}
