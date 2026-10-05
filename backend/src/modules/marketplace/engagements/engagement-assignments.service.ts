import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import {
  type ProjectPermissions,
  type ProjectRole,
  getPermission,
  resolvePermissions as resolveRolePermissions,
  roleSatisfies,
} from '../../execution/projects/permissions/project-permissions';
import { isTeamManager } from '../../execution/teams/team-authority';
import { TimeCacheService } from '../../execution/time/time-cache';
import {
  type PgErrorLike,
  mapTimeDbError,
  timeError,
} from '../../execution/time/time-errors';
import { TimeNotificationsService } from '../../execution/time/time-notifications.service';
import { localDate, retroactiveFloor } from '../../execution/time/time-periods';
import { TimePolicyService } from '../../execution/time/time-policy.service';
import type { ContextKind } from '../../execution/time/time.types';
import { AuditService } from '../../shared/audit/audit.service';
import type {
  CreateAssignmentDto,
  EndAssignmentDto,
} from './dto/engagements.dto';
import {
  type EngagementKind,
  type EngagementPosition,
  EngagementsService,
} from './engagements.service';

/**
 * One assignment as a party of the engagement may see it (L22).
 *
 * The worker is named only to provider-side parties: both seats of a talent
 * engagement and the consultant provider of a client engagement. The client
 * hirer sees `worker_user_id: null`, `worker_label: 'Delivery team'` and no
 * `talent_engagement_id` (the talent agreement is the other commercial side,
 * which a client never reads).
 */
export interface AssignmentView {
  id: string;
  /** The engagement the view was read through (the route's `:id`). */
  engagement_id: string;
  /** Null once the project was deleted (FK ON DELETE SET NULL). */
  project_id: string | null;
  project_title_snapshot: string;
  worker_user_id: string | null;
  worker_label: string;
  client_engagement_id: string | null;
  talent_engagement_id: string | null;
  team_id: string | null;
  role_title: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

const ASSIGNMENT_COLUMNS =
  'id, project_id, project_title_snapshot, worker_user_id, client_engagement_id, ' +
  'talent_engagement_id, team_id, role_title, status, started_at, ended_at';

interface AssignmentRecord {
  id: string;
  project_id: string | null;
  project_title_snapshot: string;
  worker_user_id: string;
  client_engagement_id: string | null;
  talent_engagement_id: string | null;
  team_id: string | null;
  role_title: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface EngagementRecord {
  id: string;
  kind: EngagementKind;
  scope_mode: string;
  status: string;
  started_at: string;
}

interface ProjectRecord {
  id: string;
  title: string;
  owner_id: string | null;
}

interface CallerAccess {
  role: ProjectRole;
  perms: ProjectPermissions;
}

/** A running entry on the assignment, read before the end so its member can be told (A3 stops it). */
interface RunningEntry {
  id: string;
  member_user_id: string | null;
  context_kind: ContextKind;
  team_id: string | null;
  started_at: string;
}

/** L22: what a non-provider-side party reads instead of the worker. */
export const MASKED_WORKER_LABEL = 'Delivery team';
/** A provider seat that no longer matches the worker (not expected: the guard pins it). */
const UNKNOWN_WORKER_LABEL = 'Unknown';
/** The role an assignment grant gives (L25: editor, the floor that holds `time.log`). */
const ASSIGNMENT_GRANT_ROLE: ProjectRole = 'editor';
/** Clock skew tolerated on a client-sent start or end. */
const CLOCK_SKEW_MS = 5 * 60_000;
const ACTIVE_ASSIGNMENT_INDEX = 'uq_engagement_assignments_active_exact';

/**
 * `tg_engagement_assignments_guard` (M1 A12, from 20260814020000:444-534) and the
 * pre-M3 running-timer guard raise these bare codes. `ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER`
 * is a time sentinel and goes through `mapTimeDbError`.
 */
const ASSIGNMENT_DB_ERRORS: Record<
  string,
  { status: 409 | 422; message: string }
> = {
  CLIENT_ENGAGEMENT_NOT_ACTIVE: {
    status: 422,
    message: 'The client agreement is no longer active.',
  },
  TALENT_ENGAGEMENT_NOT_ACTIVE: {
    status: 422,
    message: 'This agreement is no longer active.',
  },
  CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED: {
    status: 422,
    message: "The client agreement doesn't cover this project.",
  },
  TALENT_ENGAGEMENT_PROJECT_NOT_LINKED: {
    status: 422,
    message: "This agreement isn't placed on this project.",
  },
  ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER: {
    status: 422,
    message: 'Only the person this agreement hires can be assigned under it.',
  },
  UNCONTRACTED_WORKER_REQUIRES_TALENT_ENGAGEMENT: {
    status: 422,
    message:
      'To assign someone else, hire them under a talent agreement first.',
  },
  ENGAGEMENT_ASSIGNMENT_PROJECT_REQUIRED: {
    status: 422,
    message: 'Choose a project.',
  },
  ENGAGEMENT_ASSIGNMENT_STATUS_INVALID: {
    status: 409,
    message: 'This assignment has already ended.',
  },
  ENGAGEMENT_ASSIGNMENT_IDENTITY_IMMUTABLE: {
    status: 409,
    message: "An assignment's worker, agreements and start can't change.",
  },
  ENGAGEMENT_ASSIGNMENT_DELETE_FORBIDDEN: {
    status: 409,
    message: 'Assignments are ended, not deleted.',
  },
  // Pre-M3 body (20260814021000:489-508). M3 A3 stops the timer instead.
  ENGAGEMENT_ASSIGNMENT_HAS_RUNNING_TIMER: {
    status: 409,
    message: 'Stop the running timer on this assignment first.',
  },
};

const SENTINEL_RE = /^\s*([A-Z][A-Z0-9_]+)(?![A-Za-z0-9_])/;

function assignmentError(
  code: string,
  status: 409 | 422,
  message: string,
  extras: Record<string, unknown> = {},
): HttpException {
  const body = { code, message, ...extras };
  return status === 409
    ? new ConflictException(body)
    : new UnprocessableEntityException(body);
}

function dbCodeError(code: keyof typeof ASSIGNMENT_DB_ERRORS): HttpException {
  const entry = ASSIGNMENT_DB_ERRORS[code];
  return assignmentError(code, entry.status, entry.message);
}

function alreadyActive(): HttpException {
  return assignmentError(
    'ASSIGNMENT_ALREADY_ACTIVE',
    409,
    'This person is already assigned to this project under this agreement.',
  );
}

function notActive(): HttpException {
  return assignmentError(
    'ASSIGNMENT_NOT_ACTIVE',
    409,
    'This assignment has already ended.',
  );
}

const engagementNotFound = () => new NotFoundException('Engagement not found');
const projectNotFound = () => new NotFoundException('Project not found');
const assignmentNotFound = () => new NotFoundException('Assignment not found');

/**
 * Engagement-assignment writes and the DB errors they raise, as HTTP. Exported
 * for the spec. Null: not an assignment error (the caller logs a 500).
 */
export function mapAssignmentDbError(
  err: PgErrorLike | null | undefined,
): HttpException | null {
  if (!err) return null;
  if (err.code === '23505') {
    const text = `${err.message ?? ''} ${err.details ?? ''}`;
    return text.includes(ACTIVE_ASSIGNMENT_INDEX) ? alreadyActive() : null;
  }
  if (err.code === '23514') {
    return new BadRequestException(
      "The assignment's end can't be before its start.",
    );
  }
  const sentinel = SENTINEL_RE.exec(err.message ?? '')?.[1] ?? null;
  if (sentinel && Object.hasOwn(ASSIGNMENT_DB_ERRORS, sentinel)) {
    return dbCodeError(sentinel);
  }
  return mapTimeDbError(err);
}

/**
 * Who works on which project under which agreement (`engagement_assignments`).
 *
 * Party-scoped like the engagement reads: a caller who holds no seat on the
 * engagement gets a 404 for every route. The DB guard owns the invariants
 * (the worker is the talent provider, every referenced engagement is active
 * and placed on the project, the talent hirer delivers the client agreement);
 * this service checks them first only to answer with copy instead of a bare
 * code, and maps whatever still reaches the guard.
 *
 * An assignment never grants project access by itself (L25). A talent
 * assignment created by someone with `members.manage` also upserts the
 * worker's `project_access` row; without it the assignment is created and
 * `access_needed: true` tells the web to ask a project admin.
 */
@Injectable()
export class EngagementAssignmentsService {
  private readonly logger = new Logger(EngagementAssignmentsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly engagements: EngagementsService,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly policy: TimePolicyService,
    private readonly notifications: TimeNotificationsService,
    private readonly cache: TimeCacheService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** `GET /engagements/:id/assignments`: every assignment under the engagement, any status. */
  async list(
    callerId: string,
    engagementId: string,
  ): Promise<AssignmentView[]> {
    const seat = await this.engagements.isParty(engagementId, callerId);
    if (!seat) throw engagementNotFound();
    const engagement = await this.loadEngagement(engagementId);
    if (!engagement) throw engagementNotFound();

    // The guard pins talent_engagement_id to a talent engagement and
    // client_engagement_id to a client one, so the kind picks the column.
    const column =
      engagement.kind === 'talent_services'
        ? 'talent_engagement_id'
        : 'client_engagement_id';
    const { data, error } = await this.sb
      .from('engagement_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq(column, engagementId)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) this.fail('list', error);
    const rows = (data ?? []) as unknown as AssignmentRecord[];

    const providerSide = this.isProviderSide(engagement.kind, seat);
    const labels = providerSide
      ? await this.workerLabels(rows)
      : new Map<string, string>();
    return rows.map((row) =>
      this.toView(
        row,
        engagementId,
        providerSide || row.worker_user_id === callerId,
        labels,
      ),
    );
  }

  /**
   * `POST /engagements/:id/assignments`.
   *
   * Talent engagement (hirer seat): the worker is the talent provider; the
   * client engagement is the one active client agreement on the project the
   * hirer delivers (L8, several → ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED);
   * `team_id` defaults to the hirer party team (L35).
   * Client engagement (consultant provider seat): the worker is the caller,
   * who must already hold `time.log` (L25); `team_id` defaults to the
   * provider party team.
   * A flexible engagement not yet on the project is placed on it with an
   * `operational_assignment` link (project admin only).
   */
  async create(
    callerId: string,
    engagementId: string,
    dto: CreateAssignmentDto,
  ): Promise<AssignmentView & { access_needed: boolean }> {
    const seat = await this.engagements.isParty(engagementId, callerId);
    if (!seat) throw engagementNotFound();
    const engagement = await this.loadEngagement(engagementId);
    if (!engagement) throw engagementNotFound();

    return engagement.kind === 'talent_services'
      ? this.createTalent(callerId, seat, engagement, dto)
      : this.createClient(callerId, seat, engagement, dto);
  }

  /**
   * `POST /engagements/:id/assignments/:aid/end`. The talent hirer ends a
   * talent assignment; the consultant provider ends their own client
   * assignment. The rebuilt running-timer guard (M3 A3) stops the worker's
   * running entry at the end, flagged `stopped_by_assignment_end`; the
   * running entries are read first so each member gets `timer_auto_stopped`.
   */
  async end(
    callerId: string,
    engagementId: string,
    assignmentId: string,
    dto: EndAssignmentDto,
  ): Promise<AssignmentView> {
    const seat = await this.engagements.isParty(engagementId, callerId);
    if (!seat) throw engagementNotFound();

    const row = await this.loadAssignment(assignmentId);
    if (
      !row ||
      (row.talent_engagement_id !== engagementId &&
        row.client_engagement_id !== engagementId)
    ) {
      throw assignmentNotFound();
    }

    const authorityId = row.talent_engagement_id
      ? await this.engagements.hirerUserIdForEngagement(
          row.talent_engagement_id,
        )
      : await this.engagements.providerUserIdForEngagement(
          row.client_engagement_id as string,
        );
    if (authorityId !== callerId) {
      throw new ForbiddenException(
        "Only the agreement's hirer can end this assignment.",
      );
    }
    if (row.status !== 'active') throw notActive();

    const running = await this.runningEntries(assignmentId);
    const endedAt = await this.resolveEnd(dto.ended_at, row, running);

    const { data, error } = await this.sb
      .from('engagement_assignments')
      .update({
        status: 'ended',
        ended_at: endedAt,
        status_reason: dto.reason?.trim() || null,
      })
      .eq('id', assignmentId)
      .eq('status', 'active')
      .select(ASSIGNMENT_COLUMNS);
    if (error) this.throwWrite('end', error);
    const updated = ((data ?? []) as unknown as AssignmentRecord[])[0];
    if (!updated) throw notActive();

    await this.notifyStopped(running);
    await this.cache.bumpEpoch();

    const labels = await this.workerLabels([updated]);
    return this.toView(updated, engagementId, true, labels);
  }

  /**
   * The consultant's own assignment on a project their client engagement was
   * just set up on (`EngagementProjectService.setUp`, after the link). A
   * no-op for anything but an active, linked client engagement, and when the
   * assignment already exists. `team_id` is the provider party team, so the
   * resolver suppresses that team's option on the project (L35).
   */
  async ensureProviderAssignment(
    engagementId: string,
    projectId: string,
    actorId: string,
  ): Promise<void> {
    const engagement = await this.loadEngagement(engagementId);
    if (
      !engagement ||
      engagement.kind !== 'client_services' ||
      engagement.status !== 'active'
    ) {
      return;
    }
    const providerId =
      await this.engagements.providerUserIdForEngagement(engagementId);
    if (!providerId) return;
    if (
      await this.activeAssignmentId(providerId, projectId, engagementId, null)
    ) {
      return;
    }
    if (!(await this.engagements.isLinkedToProject(engagementId, projectId))) {
      return;
    }
    const project = await this.loadProject(projectId);
    if (!project) return;

    const teamId = await this.engagements.providerPartyTeamId(engagementId);
    const { error } = await this.sb.from('engagement_assignments').insert({
      project_id: project.id,
      project_title_snapshot: project.title,
      worker_user_id: providerId,
      client_engagement_id: engagementId,
      talent_engagement_id: null,
      team_id: teamId,
      team_name_snapshot: await this.teamName(teamId),
      role_title: null,
      status: 'active',
      started_at: this.defaultStart([engagement.started_at]),
      assigned_by: actorId,
    });
    if (error) {
      // A concurrent setUp created it first (uq_engagement_assignments_active_exact).
      if (error.code === '23505') return;
      this.throwWrite('ensureProviderAssignment', error);
    }
    await this.cache.bumpEpoch();
  }

  // ── create branches ──────────────────────────────────────────────────────

  private async createTalent(
    callerId: string,
    seat: EngagementPosition,
    engagement: EngagementRecord,
    dto: CreateAssignmentDto,
  ): Promise<AssignmentView & { access_needed: boolean }> {
    if (seat !== 'hirer') {
      throw new ForbiddenException(
        "Only the agreement's hirer can assign work under it.",
      );
    }
    if (engagement.status !== 'active') {
      throw dbCodeError('TALENT_ENGAGEMENT_NOT_ACTIVE');
    }
    const workerId = await this.engagements.providerUserIdForEngagement(
      engagement.id,
    );
    if (!workerId) throw dbCodeError('ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER');
    if (dto.worker_user_id && dto.worker_user_id !== workerId) {
      throw dbCodeError('ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER');
    }

    const project = await this.loadProject(dto.project_id);
    if (!project) throw projectNotFound();
    const access = await this.accessOf(callerId, project);
    const linked = await this.engagements.isLinkedToProject(
      engagement.id,
      project.id,
    );
    // Not on the project and no access to it: never confirm it exists.
    if (!linked && !access) throw projectNotFound();
    if (!linked) this.assertCanPlace(engagement, access);

    const client = await this.pickClientEngagement(
      callerId,
      project.id,
      dto.client_engagement_id,
    );
    const teamId = await this.resolveTeamId(
      callerId,
      dto.team_id,
      await this.engagements.hirerPartyTeamId(engagement.id),
    );
    const startedAt = await this.resolveStart(
      dto.started_at,
      client
        ? [engagement.started_at, client.started_at]
        : [engagement.started_at],
      engagement.id,
    );
    if (
      await this.activeAssignmentId(
        workerId,
        project.id,
        client?.id ?? null,
        engagement.id,
      )
    ) {
      throw alreadyActive();
    }

    const record = await this.insertAssignment(
      {
        project_id: project.id,
        project_title_snapshot: project.title,
        worker_user_id: workerId,
        client_engagement_id: client?.id ?? null,
        talent_engagement_id: engagement.id,
        team_id: teamId,
        team_name_snapshot: await this.teamName(teamId),
        role_title: dto.role_title?.trim() || null,
        status: 'active',
        started_at: startedAt,
        assigned_by: callerId,
      },
      linked ? null : { callerId, engagement, project },
    );

    const accessNeeded = await this.settleAccess(
      callerId,
      access,
      workerId,
      project.id,
      engagement.id,
      record.id,
    );
    await this.cache.bumpEpoch();

    const labels = await this.workerLabels([record]);
    return {
      ...this.toView(record, engagement.id, true, labels),
      access_needed: accessNeeded,
    };
  }

  private async createClient(
    callerId: string,
    seat: EngagementPosition,
    engagement: EngagementRecord,
    dto: CreateAssignmentDto,
  ): Promise<AssignmentView & { access_needed: boolean }> {
    if (seat !== 'provider') {
      throw new ForbiddenException(
        'Only the consultant delivering this agreement can assign work under it.',
      );
    }
    if (engagement.status !== 'active') {
      throw dbCodeError('CLIENT_ENGAGEMENT_NOT_ACTIVE');
    }
    if (dto.worker_user_id && dto.worker_user_id !== callerId) {
      throw dbCodeError('UNCONTRACTED_WORKER_REQUIRES_TALENT_ENGAGEMENT');
    }
    if (
      dto.client_engagement_id &&
      dto.client_engagement_id !== engagement.id
    ) {
      throw new BadRequestException(
        'This is the client agreement. Leave client_engagement_id out.',
      );
    }

    const project = await this.loadProject(dto.project_id);
    const access = project ? await this.accessOf(callerId, project) : null;
    if (!project || !access) throw projectNotFound();
    // L25: a consultant assigns themselves only where they can already log.
    if (!getPermission(access.perms, 'time.log')) {
      throw timeError(
        'NO_LOGGING_CONTEXT',
        "You can't log time on this project yet. Ask a project admin for editor access.",
      );
    }
    const linked = await this.engagements.isLinkedToProject(
      engagement.id,
      project.id,
    );
    if (!linked) this.assertCanPlace(engagement, access);

    const teamId = await this.resolveTeamId(
      callerId,
      dto.team_id,
      await this.engagements.providerPartyTeamId(engagement.id),
    );
    const startedAt = await this.resolveStart(
      dto.started_at,
      [engagement.started_at],
      engagement.id,
    );
    if (
      await this.activeAssignmentId(callerId, project.id, engagement.id, null)
    ) {
      throw alreadyActive();
    }

    const record = await this.insertAssignment(
      {
        project_id: project.id,
        project_title_snapshot: project.title,
        worker_user_id: callerId,
        client_engagement_id: engagement.id,
        talent_engagement_id: null,
        team_id: teamId,
        team_name_snapshot: await this.teamName(teamId),
        role_title: dto.role_title?.trim() || null,
        status: 'active',
        started_at: startedAt,
        assigned_by: callerId,
      },
      linked ? null : { callerId, engagement, project },
    );
    await this.cache.bumpEpoch();

    const labels = await this.workerLabels([record]);
    return {
      ...this.toView(record, engagement.id, true, labels),
      access_needed: false,
    };
  }

  // ── rules ────────────────────────────────────────────────────────────────

  /** L22: provider-side = either seat of a talent engagement, the provider of a client one. */
  private isProviderSide(
    kind: EngagementKind,
    seat: EngagementPosition,
  ): boolean {
    return kind === 'talent_services' || seat === 'provider';
  }

  /**
   * Placing an engagement on a project it is not linked to: flexible scope
   * only (a project-specific agreement already names its project), and only
   * by a project admin.
   */
  private assertCanPlace(
    engagement: EngagementRecord,
    access: CallerAccess | null,
  ): void {
    if (engagement.scope_mode !== 'flexible') {
      throw assignmentError(
        engagement.kind === 'talent_services'
          ? 'TALENT_ENGAGEMENT_PROJECT_NOT_LINKED'
          : 'CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED',
        422,
        'This agreement covers a different project.',
      );
    }
    if (!access) throw projectNotFound();
    if (!roleSatisfies(access.role, 'admin')) {
      throw new ForbiddenException({
        code: 'ASSIGNMENT_PROJECT_LINK_REQUIRED',
        message:
          'Ask a project admin to add this agreement to the project first.',
      });
    }
  }

  /**
   * L8: the client engagement a talent assignment bills through. Candidates
   * are the active `client_services` engagements linked to the project whose
   * provider is the talent hirer (the guard's ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER
   * rule). Exactly one is taken; several need the caller's choice; none means
   * the assignment carries cost only.
   */
  private async pickClientEngagement(
    hirerId: string,
    projectId: string,
    requested: string | undefined,
  ): Promise<{ id: string; started_at: string } | null> {
    const { data: links, error: linksError } = await this.sb
      .from('engagement_project_links')
      .select('engagement_id')
      .eq('project_id', projectId)
      .eq('status', 'active');
    if (linksError) this.fail('pickClientEngagement', linksError);
    const linkedIds = [
      ...new Set(
        ((links ?? []) as Array<{ engagement_id: string }>).map(
          (row) => row.engagement_id,
        ),
      ),
    ];

    let candidates: EngagementRecord[] = [];
    if (linkedIds.length > 0) {
      const { data: seats, error: seatsError } = await this.sb
        .from('engagement_parties')
        .select('engagement_id')
        .in('engagement_id', linkedIds)
        .eq('position', 'provider')
        .eq('user_id', hirerId);
      if (seatsError) this.fail('pickClientEngagement', seatsError);
      const providedIds = (
        (seats ?? []) as Array<{ engagement_id: string }>
      ).map((row) => row.engagement_id);
      if (providedIds.length > 0) {
        const { data: rows, error: rowsError } = await this.sb
          .from('engagements')
          .select('id, kind, scope_mode, status, started_at')
          .in('id', providedIds)
          .eq('kind', 'client_services')
          .order('started_at', { ascending: true })
          .order('id', { ascending: true });
        if (rowsError) this.fail('pickClientEngagement', rowsError);
        candidates = (rows ?? []) as unknown as EngagementRecord[];
      }
    }

    if (requested) {
      const hit = candidates.find((row) => row.id === requested);
      if (hit) {
        if (hit.status !== 'active') {
          throw dbCodeError('CLIENT_ENGAGEMENT_NOT_ACTIVE');
        }
        return { id: hit.id, started_at: hit.started_at };
      }
      // The hirer's own client agreement, just not on this project.
      const position = await this.engagements.isParty(requested, hirerId);
      if (
        position === 'provider' &&
        (await this.engagements.engagementKind(requested)) === 'client_services'
      ) {
        throw dbCodeError('CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED');
      }
      throw timeError('ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER');
    }

    const active = candidates.filter((row) => row.status === 'active');
    if (active.length === 0) return null;
    if (active.length === 1) {
      return { id: active[0].id, started_at: active[0].started_at };
    }

    // The caller provides each of these, so naming their clients leaks nothing.
    const { data: hirers, error: hirersError } = await this.sb
      .from('engagement_parties')
      .select('engagement_id, display_name_snapshot')
      .in(
        'engagement_id',
        active.map((row) => row.id),
      )
      .eq('position', 'hirer');
    if (hirersError) this.fail('pickClientEngagement', hirersError);
    const labels = new Map(
      (
        (hirers ?? []) as Array<{
          engagement_id: string;
          display_name_snapshot: string | null;
        }>
      ).map((row) => [row.engagement_id, row.display_name_snapshot]),
    );
    throw timeError('ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED', undefined, {
      client_engagements: active.map((row) => ({
        id: row.id,
        label: labels.get(row.id) ?? UNKNOWN_WORKER_LABEL,
      })),
    });
  }

  /** The default team (L35), or another team the caller manages. */
  private async resolveTeamId(
    callerId: string,
    requested: string | undefined,
    defaultTeamId: string | null,
  ): Promise<string | null> {
    if (!requested || requested === defaultTeamId) return defaultTeamId;
    if (await isTeamManager(this.sb, requested, callerId)) return requested;
    throw new BadRequestException(
      'Choose one of your own teams for this assignment.',
    );
  }

  /**
   * `started_at` defaults to now (never before the agreements start). A sent
   * value may be backdated, but not before any referenced agreement started
   * nor past the engagement policy's retroactive window; never in the future.
   */
  private async resolveStart(
    raw: string | undefined,
    engagementStarts: string[],
    governingEngagementId: string,
  ): Promise<string> {
    if (!raw) return this.defaultStart(engagementStarts);

    const now = new Date();
    const at = new Date(raw);
    if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw new BadRequestException("An assignment can't start in the future.");
    }
    if (at.getTime() < this.latestInstant(engagementStarts)) {
      throw new BadRequestException(
        "An assignment can't start before its agreement does.",
      );
    }

    const policyWorkspaceId = await this.engagements.policyWorkspaceFor(
      governingEngagementId,
    );
    const policy = await this.policy.resolve(
      { kind: 'engagement', ref: governingEngagementId },
      policyWorkspaceId,
      now,
    );
    const floor = retroactiveFloor(
      now,
      policy.timezone,
      policy.retroactive_days,
    );
    if (floor !== null && localDate(at, policy.timezone) < floor) {
      throw timeError(
        'RETROACTIVE_WINDOW',
        'This start is further back than time can be added under this agreement.',
      );
    }
    return at.toISOString();
  }

  private defaultStart(engagementStarts: string[]): string {
    return new Date(
      Math.max(Date.now(), this.latestInstant(engagementStarts)),
    ).toISOString();
  }

  private latestInstant(values: string[]): number {
    const parsed = values
      .map((value) => Date.parse(value))
      .filter((ms) => Number.isFinite(ms));
    return parsed.length > 0 ? Math.max(...parsed) : 0;
  }

  /**
   * `ended_at` defaults to now. A sent value is never in the future, never
   * before the assignment started, and never before time already logged
   * under it (entries are never re-attributed, and trg_20 refuses an entry
   * outside its assignment's window).
   */
  private async resolveEnd(
    raw: string | undefined,
    row: AssignmentRecord,
    running: RunningEntry[],
  ): Promise<string> {
    const startedMs = Date.parse(row.started_at);
    if (!raw) return new Date(Math.max(Date.now(), startedMs)).toISOString();

    const at = new Date(raw);
    if (at.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException("An assignment can't end in the future.");
    }
    if (at.getTime() < startedMs) {
      throw new BadRequestException(
        "An assignment can't end before it started.",
      );
    }

    const { data, error } = await this.sb
      .from('time_entries')
      .select('ended_at')
      .eq('engagement_assignment_id', row.id)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1);
    if (error) this.fail('resolveEnd', error);
    const latestLogged = this.latestInstant([
      ...((data ?? []) as Array<{ ended_at: string }>).map(
        (entry) => entry.ended_at,
      ),
      ...running.map((entry) => entry.started_at),
    ]);
    if (at.getTime() < latestLogged) {
      throw new BadRequestException(
        'Time is logged under this assignment after that. Pick a later end.',
      );
    }
    return at.toISOString();
  }

  /**
   * L25/E58. With `members.manage`, upsert the worker's one `project_access`
   * row (one row per pair since 20260507000130): a new row is an editor with
   * `origin='engagement:<talent engagement id>'`; an existing row keeps its
   * `origin` and is only ever raised to editor, never lowered. Either way
   * `has_direct_grant` is set, so a later team detach cannot drop the row
   * (owner-lockout rule). Without `members.manage` nothing is written.
   * Returns `access_needed`.
   */
  private async settleAccess(
    callerId: string,
    callerAccess: CallerAccess | null,
    workerId: string,
    projectId: string,
    talentEngagementId: string,
    assignmentId: string,
  ): Promise<boolean> {
    if (callerAccess && getPermission(callerAccess.perms, 'members.manage')) {
      try {
        await this.grantWorkerAccess(
          callerId,
          workerId,
          projectId,
          talentEngagementId,
          assignmentId,
        );
        return false;
      } catch (error) {
        // The assignment is committed; the grant can be retried by an admin.
        this.logger.warn(
          `assignment ${assignmentId}: project_access grant for ${workerId} on ${projectId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return true;
      }
    }
    const workerPerms = await this.projectAuth.resolvePermissions(
      workerId,
      projectId,
    );
    return !(workerPerms && getPermission(workerPerms, 'time.log'));
  }

  private async grantWorkerAccess(
    callerId: string,
    workerId: string,
    projectId: string,
    talentEngagementId: string,
    assignmentId: string,
    retried = false,
  ): Promise<void> {
    const { data: existing, error: readError } = await this.sb
      .from('project_access')
      .select('id, role, has_direct_grant')
      .eq('project_id', projectId)
      .eq('user_id', workerId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const origin = `engagement:${talentEngagementId}`;
    if (existing) {
      const row = existing as {
        id: string;
        role: ProjectRole;
        has_direct_grant: boolean | null;
      };
      const raise = !roleSatisfies(row.role, ASSIGNMENT_GRANT_ROLE);
      if (!raise && row.has_direct_grant === true) return;
      const patch: Record<string, unknown> = { has_direct_grant: true };
      if (raise) {
        patch.role = ASSIGNMENT_GRANT_ROLE;
        patch.granted_by = callerId;
      }
      const { error } = await this.sb
        .from('project_access')
        .update(patch)
        .eq('id', row.id);
      if (error) throw new Error(error.message);
      if (raise) {
        this.auditGrant(
          projectId,
          callerId,
          row.id,
          workerId,
          origin,
          assignmentId,
        );
      }
      return;
    }

    const { data, error } = await this.sb
      .from('project_access')
      .insert({
        project_id: projectId,
        user_id: workerId,
        role: ASSIGNMENT_GRANT_ROLE,
        origin,
        capabilities: {},
        granted_by: callerId,
        has_direct_grant: true,
      })
      .select('id')
      .single();
    if (error) {
      // A row appeared between the read and the insert: raise it instead.
      if (error.code === '23505' && !retried) {
        return this.grantWorkerAccess(
          callerId,
          workerId,
          projectId,
          talentEngagementId,
          assignmentId,
          true,
        );
      }
      throw new Error(error.message);
    }
    this.auditGrant(
      projectId,
      callerId,
      (data as { id: string } | null)?.id ?? null,
      workerId,
      origin,
      assignmentId,
    );
  }

  private auditGrant(
    projectId: string,
    actorId: string,
    accessId: string | null,
    workerId: string,
    origin: string,
    assignmentId: string,
  ): void {
    this.audit?.log({
      projectId,
      actorId,
      action: 'access.granted',
      entityType: 'project_access',
      entityId: accessId,
      metadata: {
        target_user_id: workerId,
        role: ASSIGNMENT_GRANT_ROLE,
        origin,
        engagement_assignment_id: assignmentId,
      },
    });
  }

  /** Each stopped entry's member gets timer_auto_stopped (D51: never throws, awaited). */
  private async notifyStopped(running: RunningEntry[]): Promise<void> {
    if (running.length === 0) return;
    const results = await Promise.allSettled(
      running.map((entry) =>
        this.notifications.timerAutoStopped(
          {
            id: entry.id,
            member_user_id: entry.member_user_id,
            context_kind: entry.context_kind,
            team_id: entry.team_id,
          },
          'stopped_by_assignment_end',
        ),
      ),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `timer_auto_stopped notification failed: ${String(result.reason)}`,
        );
      }
    }
  }

  // ── reads and writes ─────────────────────────────────────────────────────

  private async loadEngagement(id: string): Promise<EngagementRecord | null> {
    const { data, error } = await this.sb
      .from('engagements')
      .select('id, kind, scope_mode, status, started_at')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('loadEngagement', error);
    return (data as EngagementRecord | null) ?? null;
  }

  private async loadAssignment(id: string): Promise<AssignmentRecord | null> {
    const { data, error } = await this.sb
      .from('engagement_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('loadAssignment', error);
    return (data as unknown as AssignmentRecord | null) ?? null;
  }

  private async loadProject(id: string): Promise<ProjectRecord | null> {
    const { data, error } = await this.sb
      .from('projects')
      .select('id, title, owner_id')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('loadProject', error);
    return (data as ProjectRecord | null) ?? null;
  }

  /** The caller's role and permissions on the project; null = no access (404 territory). */
  private async accessOf(
    userId: string,
    project: ProjectRecord,
  ): Promise<CallerAccess | null> {
    const [perms, role] = await Promise.all([
      this.projectAuth.resolvePermissions(userId, project.id),
      this.projectAuth.getUserProjectRole(userId, project.id),
    ]);
    if (perms && role) return { role, perms };
    if (project.owner_id === userId) {
      return { role: 'owner', perms: resolveRolePermissions('owner', null) };
    }
    return null;
  }

  private async teamName(teamId: string | null): Promise<string | null> {
    if (!teamId) return null;
    const { data, error } = await this.sb
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .maybeSingle();
    if (error) this.fail('teamName', error);
    return (data as { name: string | null } | null)?.name ?? null;
  }

  /** The active assignment for exactly this (worker, project, client, talent), the unique index's key. */
  private async activeAssignmentId(
    workerId: string,
    projectId: string,
    clientEngagementId: string | null,
    talentEngagementId: string | null,
  ): Promise<string | null> {
    let query = this.sb
      .from('engagement_assignments')
      .select('id')
      .eq('worker_user_id', workerId)
      .eq('project_id', projectId)
      .eq('status', 'active');
    query = clientEngagementId
      ? query.eq('client_engagement_id', clientEngagementId)
      : query.is('client_engagement_id', null);
    query = talentEngagementId
      ? query.eq('talent_engagement_id', talentEngagementId)
      : query.is('talent_engagement_id', null);
    const { data, error } = await query.limit(1);
    if (error) this.fail('activeAssignmentId', error);
    return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  }

  private async runningEntries(assignmentId: string): Promise<RunningEntry[]> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select('id, member_user_id, context_kind, team_id, started_at')
      .eq('engagement_assignment_id', assignmentId)
      .is('ended_at', null);
    if (error) this.fail('runningEntries', error);
    return (data ?? []) as unknown as RunningEntry[];
  }

  /**
   * Inserts the assignment. When `place` is set the engagement is first put
   * on the project with an `operational_assignment` link; if the assignment
   * insert then fails, the link this call created is ended again (links are
   * never deleted, `tg_engagement_project_links_guard`).
   */
  private async insertAssignment(
    row: Record<string, unknown>,
    place: {
      callerId: string;
      engagement: EngagementRecord;
      project: ProjectRecord;
    } | null,
  ): Promise<AssignmentRecord> {
    const linkId = place ? await this.placeOnProject(place) : null;

    const { data, error } = await this.sb
      .from('engagement_assignments')
      .insert(row)
      .select(ASSIGNMENT_COLUMNS)
      .single();
    if (error || !data) {
      if (linkId) await this.retractLink(linkId);
      if (error) this.throwWrite('create', error);
      throw new InternalServerErrorException(
        "Proyekto couldn't save the assignment. Try again.",
      );
    }
    return data as unknown as AssignmentRecord;
  }

  /** Returns the new link's id, or null when a concurrent call linked it first. */
  private async placeOnProject(place: {
    callerId: string;
    engagement: EngagementRecord;
    project: ProjectRecord;
  }): Promise<string | null> {
    const { data, error } = await this.sb
      .from('engagement_project_links')
      .insert({
        engagement_id: place.engagement.id,
        project_id: place.project.id,
        project_title_snapshot: place.project.title,
        basis: 'operational_assignment',
        linked_by: place.callerId,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return null;
      this.fail('placeOnProject', error);
    }
    return (data as { id: string } | null)?.id ?? null;
  }

  private async retractLink(linkId: string): Promise<void> {
    const { error } = await this.sb
      .from('engagement_project_links')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        status_reason: 'assignment_not_created',
      })
      .eq('id', linkId)
      .eq('status', 'active');
    if (error) {
      this.logger.warn(
        `operational link ${linkId} left active after a failed assignment: ${error.message}`,
      );
    }
  }

  /**
   * The worker's name for provider-side views: the provider seat's
   * display-name snapshot on the governing engagement (talent, else client),
   * which is the worker by the guard. Keyed by assignment id.
   */
  private async workerLabels(
    rows: AssignmentRecord[],
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    if (rows.length === 0) return labels;
    const governing = (row: AssignmentRecord) =>
      row.talent_engagement_id ?? row.client_engagement_id;
    const ids = [
      ...new Set(
        rows
          .map(governing)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    if (ids.length === 0) return labels;

    const { data, error } = await this.sb
      .from('engagement_parties')
      .select('engagement_id, user_id, display_name_snapshot')
      .in('engagement_id', ids)
      .eq('position', 'provider');
    if (error) this.fail('workerLabels', error);
    const seats = new Map(
      (
        (data ?? []) as Array<{
          engagement_id: string;
          user_id: string;
          display_name_snapshot: string | null;
        }>
      ).map((seat) => [seat.engagement_id, seat]),
    );
    for (const row of rows) {
      const id = governing(row);
      const seat = id ? seats.get(id) : undefined;
      labels.set(
        row.id,
        seat &&
          seat.user_id === row.worker_user_id &&
          seat.display_name_snapshot
          ? seat.display_name_snapshot
          : UNKNOWN_WORKER_LABEL,
      );
    }
    return labels;
  }

  private toView(
    row: AssignmentRecord,
    engagementId: string,
    workerVisible: boolean,
    labels: Map<string, string>,
  ): AssignmentView {
    return {
      id: row.id,
      engagement_id: engagementId,
      project_id: row.project_id,
      project_title_snapshot: row.project_title_snapshot,
      worker_user_id: workerVisible ? row.worker_user_id : null,
      worker_label: workerVisible
        ? (labels.get(row.id) ?? UNKNOWN_WORKER_LABEL)
        : MASKED_WORKER_LABEL,
      client_engagement_id: row.client_engagement_id,
      talent_engagement_id: workerVisible ? row.talent_engagement_id : null,
      team_id: row.team_id,
      role_title: row.role_title,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
    };
  }

  /** A write the guard refused, as HTTP; anything else is a logged 500 with no Postgres text. */
  private throwWrite(operation: string, error: PgErrorLike): never {
    const mapped = mapAssignmentDbError(error);
    if (mapped) throw mapped;
    this.fail(operation, error);
  }

  private fail(operation: string, error: { message?: string }): never {
    this.logger.error(
      `EngagementAssignmentsService.${operation} failed: ${error.message ?? 'unknown error'}`,
    );
    throw new InternalServerErrorException(
      "Proyekto couldn't load the assignment details. Try again.",
    );
  }
}
