import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LIVE_SUBSCRIPTION_STATUSES } from '../../../execution/workspaces/workspaces.service';
import type { WorkspaceSubscriptionStatus } from '../../../execution/workspaces/workspaces.service';
import {
  ADMIN_WORKSPACES_PAGE_SIZE_DEFAULT,
  type AdminWorkspacesQueryDto,
  type SetWorkspaceCompDto,
  type UpdatePlanLimitsDto,
} from '../dto/entitlements.dto';
import {
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  isPlanId,
  PLAN_IDS,
  PLAN_RANK,
  type CompPlan,
  type EntitlementKeyDef,
  type KeyMeta,
  type LimitCell,
  type LimitMatrix,
  type PlanId,
  type PlanSource,
  type WorkspacePlanState,
} from '../entitlement-keys';
import { buildMatrix, overLimitKeys, planLabel } from '../entitlements.logic';
import {
  EntitlementsService,
  type LargestRoadmap,
} from '../entitlements.service';
import {
  ENTITLEMENTS_ADMIN_REPOSITORY,
  EntitlementsAdminQueryError,
  type AdminAuditEntry,
  type AdminWorkspaceHeader,
  type AdminWorkspaceListRow,
  type EntitlementsAdminRepository,
  type PlanLimitCellWrite,
} from '../repositories/entitlements-admin.repository.interface';
import {
  ENTITLEMENTS_REPOSITORY,
  type EntitlementsRepository,
  type PlanLimitRow,
} from '../repositories/entitlements.repository.interface';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** A cell as the admin editor sees it: who last changed it, and when. */
export type AdminLimitCell = LimitCell & {
  /** Null only for a cell the database is missing (drift). */
  updated_at: string | null;
  updated_by: string | null;
};

export interface AdminKeyMeta extends KeyMeta {
  /** The smallest value the editor accepts (members: an owner must fit). */
  min: number | null;
}

export interface AdminPlanLimits {
  plans: PlanId[];
  keys: AdminKeyMeta[];
  cells: Record<PlanId, Record<string, AdminLimitCell>>;
  version: string | null;
  drift: LimitMatrix['drift'];
}

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  owner: { id: string; email: string | null } | null;
  members: number;
  pending_invites: number;
  projects: number;
  teams: number;
  subscription: {
    plan: PlanId;
    status: string | null;
    has_provider_subscription: boolean;
  };
  complimentary: {
    plan: CompPlan;
    since: string | null;
    until: string | null;
    active: boolean;
  } | null;
  effective_plan: PlanId;
  plan_source: PlanSource;
  /** Workspace counts above the effective plan's limit (grandfathered). */
  over_limit: string[];
}

export interface AdminWorkspaceDetail extends AdminWorkspaceRow {
  largest_roadmaps: LargestRoadmap[];
  audit: AdminAuditEntry[];
}

export interface AdminWorkspacePage {
  items: AdminWorkspaceRow[];
  page: number;
  page_size: number;
  total: number;
}

export const WORKSPACE_HAS_LIVE_SUBSCRIPTION =
  'workspace_has_live_subscription';

const AUDIT_ENTRIES = 20;
const LARGEST_ROADMAPS = 5;
/**
 * A second invalidation after a limits save. An instance that began loading
 * the matrix just before the write committed can put the old matrix back in
 * Redis after the first invalidation; this clears it again.
 */
const LIMITS_REINVALIDATE_MS = 1_500;

const PLANS_BY_RANK: readonly PlanId[] = [...PLAN_IDS].sort(
  (a, b) => PLAN_RANK[a] - PLAN_RANK[b],
);

/** SQL tokens the admin RPCs raise with SQLSTATE 22023 (or that a caller can cause). */
const BAD_REQUEST_TOKENS = [
  'plan_limits_unknown_cell',
  'plan_limits_duplicate_cell',
  'plan_limits_invalid_changes',
  'workspace_comp_invalid_plan',
  'admin_list_workspaces_invalid_filter',
  'entitlement_subject_unknown_kind',
] as const;

/** SQLSTATEs that mean the request, not the server, was wrong. */
const BAD_REQUEST_SQLSTATES = new Set(['22023', '23514', '23503', '22P02']);

/** Escapes LIKE metacharacters; admin_list_workspaces uses the default `\` escape. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Maps an admin RPC failure to HTTP by its message text: the functions raise
 * bare tokens (`RAISE EXCEPTION 'plan_limits_stale'`) whose SQLSTATE is the
 * default P0001, so the text is the only reliable signal.
 */
export function mapAdminRpcError(error: unknown): Error {
  if (error instanceof HttpException) return error;
  const message = errorMessage(error);
  if (message.includes('plan_limits_stale')) {
    return new ConflictException({
      code: 'plan_limits_stale',
      message:
        'Someone saved the plan limits after you loaded them. Reload, then apply your changes again.',
    });
  }
  if (message.includes('workspace_not_found')) {
    return new NotFoundException('Workspace not found');
  }
  const token = BAD_REQUEST_TOKENS.find((t) => message.includes(t));
  if (token) return badRequest(token, message);
  if (
    error instanceof EntitlementsAdminQueryError &&
    error.code !== null &&
    BAD_REQUEST_SQLSTATES.has(error.code)
  ) {
    return badRequest('plan_limits_invalid', message);
  }
  return error instanceof Error ? error : new Error(message);
}

/** The registry floor for a key (members: 1), or null when it has none. */
function keyMinimum(key: string): number | null {
  if (!isEntitlementKey(key)) return null;
  const def: EntitlementKeyDef = ENTITLEMENT_KEYS[key];
  return def.min ?? null;
}

function isLiveSubscription(
  hasProviderSubscription: boolean,
  status: string | null,
): boolean {
  return (
    hasProviderSubscription &&
    status !== null &&
    LIVE_SUBSCRIPTION_STATUSES.includes(status as WorkspaceSubscriptionStatus)
  );
}

function isPlanSource(value: unknown): value is PlanSource {
  return (
    value === 'complimentary' || value === 'subscription' || value === 'default'
  );
}

function isCompPlan(value: unknown): value is CompPlan {
  return isPlanId(value) && value !== 'free';
}

/**
 * The staff side of plan limits: the limits editor and complimentary plans.
 *
 * Reads are open to any active admin (support needs to explain why a customer
 * is blocked); the controllers add SuperAdminGuard to every write. Each write
 * goes through one audited SQL function, then invalidates the caches that
 * enforcement reads, so the change applies within seconds.
 */
@Injectable()
export class EntitlementsAdminService {
  private readonly logger = new Logger(EntitlementsAdminService.name);

  constructor(
    @Inject(ENTITLEMENTS_ADMIN_REPOSITORY)
    private readonly repo: EntitlementsAdminRepository,
    // The core's read repository: the editor reads the tables fresh, past the
    // enforcement caches, so it always shows what is actually stored.
    @Inject(ENTITLEMENTS_REPOSITORY)
    private readonly limitsRepo: EntitlementsRepository,
    private readonly entitlements: EntitlementsService,
  ) {}

  // -------------------------------------------------------------------------
  // Plan limits
  // -------------------------------------------------------------------------

  async getPlanLimits(): Promise<AdminPlanLimits> {
    const [keyRows, limitRows] = await Promise.all([
      this.limitsRepo.listLimitKeys(),
      this.limitsRepo.listLimits(),
    ]);
    return this.toAdminPlanLimits(buildMatrix(keyRows, limitRows), limitRows);
  }

  async updatePlanLimits(
    dto: UpdatePlanLimitsDto,
    actorId: string,
  ): Promise<AdminPlanLimits & { warnings: string[] }> {
    const [keyRows, limitRows] = await Promise.all([
      this.limitsRepo.listLimitKeys(),
      this.limitsRepo.listLimits(),
    ]);
    const matrix = buildMatrix(keyRows, limitRows);
    const writes = this.toCellWrites(dto, matrix, limitRows);

    try {
      await this.repo.updatePlanLimits(
        writes,
        actorId,
        dto.note?.trim() || null,
        dto.base_version ?? null,
      );
    } catch (error) {
      throw mapAdminRpcError(error);
    }

    await this.entitlements.invalidateLimits();
    this.scheduleReinvalidation();

    const updated = await this.getPlanLimits();
    const touched = [...new Set(writes.map((write) => write.limit_key))];
    return { ...updated, warnings: this.tierInversions(updated, touched) };
  }

  // -------------------------------------------------------------------------
  // Workspaces
  // -------------------------------------------------------------------------

  async listWorkspaces(
    query: AdminWorkspacesQueryDto,
  ): Promise<AdminWorkspacePage> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? ADMIN_WORKSPACES_PAGE_SIZE_DEFAULT;
    const needle = query.search?.trim();
    const params = {
      search: needle ? escapeLikePattern(needle) : null,
      filter: query.filter ?? 'all',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };

    let rows: AdminWorkspaceListRow[];
    let total: number;
    try {
      rows = await this.repo.listWorkspaces(params);
      total = rows[0]?.total_count ?? 0;
      if (rows.length === 0 && page > 1) {
        // Past the last page the function returns no row to carry the total.
        const probe = await this.repo.listWorkspaces({
          ...params,
          limit: 1,
          offset: 0,
        });
        total = probe[0]?.total_count ?? 0;
      }
    } catch (error) {
      throw mapAdminRpcError(error);
    }

    const matrix = await this.matrixForDisplay();
    const now = Date.now();
    return {
      items: rows.map((row) => this.toAdminWorkspaceRow(row, matrix, now)),
      page,
      page_size: pageSize,
      total,
    };
  }

  async getWorkspace(workspaceId: string): Promise<AdminWorkspaceDetail> {
    // The row first, so an unknown id is a clean 404.
    const row = await this.getWorkspaceRow(workspaceId);
    const [largest, audit] = await Promise.all([
      this.entitlements.getLargestRoadmaps(workspaceId, LARGEST_ROADMAPS),
      this.repo.listWorkspaceAudit(workspaceId, AUDIT_ENTRIES),
    ]);
    return { ...row, largest_roadmaps: largest, audit };
  }

  async setComp(
    workspaceId: string,
    dto: SetWorkspaceCompDto,
    actorId: string,
  ): Promise<{ workspace: AdminWorkspaceRow; warnings: string[] }> {
    const until = this.parseUntil(dto.until);
    const note = dto.note.trim();
    if (!note) {
      throw badRequest('workspace_comp_note_required', 'Add a note.');
    }

    try {
      await this.repo.setWorkspaceComp(
        workspaceId,
        dto.plan,
        until,
        note,
        actorId,
      );
    } catch (error) {
      throw mapAdminRpcError(error);
    }
    await this.entitlements.invalidateWorkspace(workspaceId);

    const workspace = await this.getWorkspaceRow(workspaceId);
    // A comp never cancels a subscription: that moves money and needs the
    // owner. Staff are told so they can follow up.
    const warnings = isLiveSubscription(
      workspace.subscription.has_provider_subscription,
      workspace.subscription.status,
    )
      ? [WORKSPACE_HAS_LIVE_SUBSCRIPTION]
      : [];
    return { workspace, warnings };
  }

  /** Idempotent: clearing a workspace with no comp changes nothing and still answers 200. */
  async clearComp(
    workspaceId: string,
    note: string | null | undefined,
    actorId: string,
  ): Promise<{ workspace: AdminWorkspaceRow }> {
    try {
      await this.repo.clearWorkspaceComp(
        workspaceId,
        note?.trim() || null,
        actorId,
      );
    } catch (error) {
      throw mapAdminRpcError(error);
    }
    await this.entitlements.invalidateWorkspace(workspaceId);
    return { workspace: await this.getWorkspaceRow(workspaceId) };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Turns the request into full cells, checking each against the live key
   * registry. Omitted fields keep the stored value.
   */
  private toCellWrites(
    dto: UpdatePlanLimitsDto,
    matrix: LimitMatrix,
    limitRows: PlanLimitRow[],
  ): PlanLimitCellWrite[] {
    const metaByKey = new Map(matrix.keys.map((meta) => [meta.key, meta]));
    const rowByCell = new Map(
      limitRows.map((row) => [`${row.plan}:${row.limit_key}`, row]),
    );
    const seen = new Set<string>();

    return dto.changes.map((change) => {
      const cellId = `${change.plan}:${change.key}`;
      const where = `${planLabel(change.plan)} · ${change.key}`;
      if (seen.has(cellId)) {
        throw badRequest(
          'plan_limits_duplicate_cell',
          `${where} appears more than once in this change.`,
        );
      }
      seen.add(cellId);

      const meta = metaByKey.get(change.key);
      if (!meta) {
        throw badRequest(
          'plan_limits_unknown_key',
          `"${change.key}" is not a plan limit.`,
        );
      }
      const row = rowByCell.get(cellId);
      if (!row || row.kind !== meta.kind) {
        throw badRequest(
          'plan_limits_unknown_cell',
          `${where} has no stored value to edit. Apply the plan-limits migration first.`,
        );
      }
      if (
        change.value === undefined &&
        (change.enabled === undefined || change.enabled === null) &&
        (change.per_seat === undefined || change.per_seat === null) &&
        change.display_label === undefined
      ) {
        throw badRequest(
          'plan_limits_empty_change',
          `${where} has nothing to change.`,
        );
      }

      const displayLabel =
        change.display_label === undefined
          ? row.display_label
          : change.display_label?.trim() || null;

      if (meta.kind === 'feature') {
        if (change.value !== undefined) {
          throw badRequest(
            'plan_limits_kind_mismatch',
            `${meta.label} is a feature: send enabled, not value.`,
          );
        }
        if (change.per_seat === true) {
          throw badRequest(
            'plan_limits_per_seat_invalid',
            `Only quotas can be per seat; ${meta.label} is a feature.`,
          );
        }
        return {
          plan: change.plan,
          limit_key: change.key,
          int_value: null,
          bool_value:
            typeof change.enabled === 'boolean'
              ? change.enabled
              : row.bool_value !== false,
          per_seat: false,
          display_label: displayLabel,
        };
      }

      if (change.enabled !== undefined && change.enabled !== null) {
        throw badRequest(
          'plan_limits_kind_mismatch',
          `${meta.label} is a ${meta.kind} limit: send value, not enabled.`,
        );
      }
      const value = change.value === undefined ? row.int_value : change.value;
      if (value !== null) {
        if (meta.kind === 'days' && value < 1) {
          throw badRequest(
            'plan_limits_below_minimum',
            `${meta.label} must be at least 1 day, or unlimited.`,
          );
        }
        const min = keyMinimum(change.key);
        if (min !== null && value < min) {
          throw badRequest(
            'plan_limits_below_minimum',
            `${meta.label} must be at least ${min}, or unlimited.`,
          );
        }
      }
      const perSeat =
        typeof change.per_seat === 'boolean' ? change.per_seat : row.per_seat;
      if (perSeat && meta.kind !== 'quota') {
        throw badRequest(
          'plan_limits_per_seat_invalid',
          `Only quotas can be per seat; ${meta.label} is a ${meta.kind} limit.`,
        );
      }
      return {
        plan: change.plan,
        limit_key: change.key,
        int_value: value,
        bool_value: null,
        per_seat: perSeat,
        display_label: displayLabel,
      };
    });
  }

  /**
   * A cheaper plan more generous than the next plan up, for the keys a save
   * touched. Warned, never blocked: staff may mean it.
   */
  private tierInversions(limits: AdminPlanLimits, keys: string[]): string[] {
    const warnings: string[] = [];
    for (const key of keys) {
      const label = limits.keys.find((meta) => meta.key === key)?.label ?? key;
      for (let i = 0; i < PLANS_BY_RANK.length - 1; i += 1) {
        const lower = PLANS_BY_RANK[i];
        const higher = PLANS_BY_RANK[i + 1];
        const a = limits.cells[lower]?.[key];
        const b = limits.cells[higher]?.[key];
        if (!a || !b) continue;
        let inverted = false;
        if (a.kind === 'feature' && b.kind === 'feature') {
          inverted = a.enabled && !b.enabled;
        } else if (a.kind !== 'feature' && b.kind !== 'feature') {
          // A per-workspace quota and a per-seat one are not comparable.
          if (a.per_seat !== b.per_seat) continue;
          const av = a.value ?? Number.POSITIVE_INFINITY;
          const bv = b.value ?? Number.POSITIVE_INFINITY;
          inverted = av > bv;
        }
        if (inverted) {
          warnings.push(
            `${planLabel(lower)} is more generous than ${planLabel(higher)} for ${label}.`,
          );
        }
      }
    }
    return warnings;
  }

  private toAdminPlanLimits(
    matrix: LimitMatrix,
    limitRows: PlanLimitRow[],
  ): AdminPlanLimits {
    const rowByCell = new Map(
      limitRows.map((row) => [`${row.plan}:${row.limit_key}`, row]),
    );
    const cells = Object.fromEntries(
      matrix.plans.map((plan) => [
        plan,
        Object.fromEntries(
          Object.entries(matrix.cells[plan] ?? {}).map(([key, cell]) => {
            const row = rowByCell.get(`${plan}:${key}`);
            return [
              key,
              {
                ...cell,
                updated_at: row?.updated_at ?? null,
                updated_by: row?.updated_by ?? null,
              },
            ];
          }),
        ),
      ]),
    ) as Record<PlanId, Record<string, AdminLimitCell>>;

    return {
      plans: matrix.plans,
      keys: matrix.keys.map((meta) => ({
        ...meta,
        min: keyMinimum(meta.key),
      })),
      cells,
      version: matrix.version,
      drift: matrix.drift,
    };
  }

  /** One workspace in the list's shape, read fresh (after a comp write, say). */
  private async getWorkspaceRow(
    workspaceId: string,
  ): Promise<AdminWorkspaceRow> {
    const header = await this.repo.findWorkspaceHeader(workspaceId);
    if (!header) throw new NotFoundException('Workspace not found');
    const [states, counts, matrix] = await Promise.all([
      this.entitlements.getEffectivePlans([workspaceId]),
      this.entitlements.getUsageCounts(workspaceId),
      this.matrixForDisplay(),
    ]);
    const state = states.get(workspaceId);
    return this.toAdminWorkspaceRow(
      this.toListRow(header, state, counts),
      matrix,
      Date.now(),
      state?.complimentary?.active,
    );
  }

  private toListRow(
    header: AdminWorkspaceHeader,
    state: WorkspacePlanState | undefined,
    counts: {
      members: number;
      pending_invites: number;
      projects: number;
      teams: number;
    },
  ): AdminWorkspaceListRow {
    const comp = state?.complimentary ?? null;
    return {
      ...header,
      ...counts,
      subscription_plan: state?.subscription_plan ?? 'free',
      subscription_status: state?.subscription_status ?? null,
      has_provider_subscription: state?.has_provider_subscription ?? false,
      is_discounted_free: comp !== null,
      discounted_plan: comp?.plan ?? null,
      discounted_at: comp?.since ?? null,
      discounted_until: comp?.until ?? null,
      effective_plan: state?.effective_plan ?? 'free',
      plan_source: state?.plan_source ?? 'default',
      total_count: 1,
    };
  }

  /**
   * `compActive` comes from workspace_plan_state when the caller has it. The
   * list function does not return it, so there it is read off the row with the
   * same rule: flagged, and no expiry or an expiry still ahead.
   */
  private toAdminWorkspaceRow(
    row: AdminWorkspaceListRow,
    matrix: LimitMatrix | null,
    now: number,
    compActive?: boolean,
  ): AdminWorkspaceRow {
    const effective: PlanId = isPlanId(row.effective_plan)
      ? row.effective_plan
      : 'free';
    const compPlan =
      row.is_discounted_free && isCompPlan(row.discounted_plan)
        ? row.discounted_plan
        : null;
    const active =
      compActive ??
      (compPlan !== null &&
        (row.discounted_until === null ||
          Date.parse(row.discounted_until) > now));
    const usage = {
      members: row.members,
      projects: row.projects,
      teams: row.teams,
    };
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      created_at: row.created_at,
      owner: row.owner_id ? { id: row.owner_id, email: row.owner_email } : null,
      members: row.members,
      pending_invites: row.pending_invites,
      projects: row.projects,
      teams: row.teams,
      subscription: {
        plan: isPlanId(row.subscription_plan) ? row.subscription_plan : 'free',
        status: row.subscription_status,
        has_provider_subscription: row.has_provider_subscription,
      },
      complimentary: compPlan
        ? {
            plan: compPlan,
            since: row.discounted_at,
            until: row.discounted_until,
            active,
          }
        : null,
      effective_plan: effective,
      plan_source: isPlanSource(row.plan_source) ? row.plan_source : 'default',
      over_limit: matrix ? overLimitKeys(usage, matrix.cells[effective]) : [],
    };
  }

  /** The cached matrix, for over-limit badges only. A failure just hides the badges. */
  private async matrixForDisplay(): Promise<LimitMatrix | null> {
    try {
      return await this.entitlements.getLimitMatrix();
    } catch (error) {
      this.logger.warn(
        `admin_workspaces_matrix_failed message=${errorMessage(error)}`,
      );
      return null;
    }
  }

  private parseUntil(until: string | null | undefined): string | null {
    if (until === undefined || until === null || until === '') return null;
    const at = Date.parse(until);
    if (Number.isNaN(at)) {
      throw badRequest(
        'workspace_comp_until_invalid',
        'until must be a date and time.',
      );
    }
    if (at <= Date.now()) {
      throw badRequest(
        'workspace_comp_until_past',
        'The complimentary plan must end in the future. Leave the end date empty for no end.',
      );
    }
    return new Date(at).toISOString();
  }

  private scheduleReinvalidation(): void {
    const timer = setTimeout(() => {
      this.entitlements.invalidateLimits().catch((error: unknown) => {
        this.logger.warn(
          `entitlements_reinvalidate_failed message=${errorMessage(error)}`,
        );
      });
    }, LIMITS_REINVALIDATE_MS);
    timer.unref?.();
  }
}
