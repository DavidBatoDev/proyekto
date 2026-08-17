import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ACTIVITY_ACTIONS } from '../../shared/audit/activity-actions';
import { AuditService } from '../../shared/audit/audit.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { getPermission } from '../projects/permissions/project-permissions';
import { normalizeLinkTargets } from './delivery-links';
import type { RiskRow } from './delivery.types';
import type {
  CreateRiskDto,
  ListRisksQueryDto,
  UpdateRiskDto,
} from './dto/delivery.dto';

const TABLE = 'project_risk_register';
const LINKS_TABLE = 'risk_links';

const SELECT =
  'id, project_id, kind, title, description, severity, likelihood, status, ' +
  'impact, mitigation, owner_id, due_date, resolved_at, resolved_by, ' +
  'visibility, source_kind, created_by, created_at, updated_at, ' +
  'links:risk_links(id, epic_id, feature_id, task_id, milestone_id, deliverable_id)';

const LINK_COLUMNS = [
  'epic_id',
  'feature_id',
  'task_id',
  'milestone_id',
  'deliverable_id',
] as const;

/**
 * Risks & issues.
 *
 * Two things here are load-bearing and easy to break:
 *
 * 1. `visibility='internal'` rows are filtered out for anyone without
 *    `risks.view_internal` — granted at admin on the role ladder, and deniable
 *    per member through capabilities. Filtering happens in SQL, not after the fact.
 * 2. Activity metadata for this family NEVER carries a row title. The audit
 *    sensitivity flag is per-action, not per-row, so an internal risk's title
 *    in the feed would re-leak exactly what rule 1 protects. `kind` is the most
 *    that goes in.
 */
@Injectable()
export class RisksService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string, userId: string, query: ListRisksQueryDto) {
    const perms = await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );
    const canViewInternal = getPermission(perms, 'risks.view_internal');

    let builder = this.db
      .from(TABLE)
      .select(SELECT)
      .eq('project_id', projectId)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false });

    if (!canViewInternal) builder = builder.eq('visibility', 'shared');
    if (query.kind) builder = builder.eq('kind', query.kind);
    if (query.status) builder = builder.eq('status', query.status);

    const { data, error } = await builder.overrideTypes<
      RiskRow[],
      { merge: false }
    >();
    if (error) {
      throw new InternalServerErrorException(
        `Failed to list the risk register: ${error.message}`,
      );
    }
    return { items: data ?? [], can_view_internal: canViewInternal };
  }

  /**
   * Blocked work and at-risk milestones that nobody has entered in the register
   * yet.
   *
   * The register overlaps these flags on purpose — the flags carry no owner,
   * severity, mitigation, or history, and vanish when they flip. Surfacing them
   * as promotable candidates is what stops anyone re-keying them by hand.
   */
  async candidates(projectId: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );

    const { data: roadmap } = await this.db
      .from('roadmaps')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle();

    if (!roadmap) return { blocked_tasks: [], at_risk_milestones: [] };

    // Both of these MUST stay scoped to this project. The service role bypasses
    // RLS, so an unscoped .eq('status','blocked') would hand back every blocked
    // task in the database.
    const { data: linked } = await this.db
      .from(LINKS_TABLE)
      .select(
        'task_id, milestone_id, risk:project_risk_register!inner(project_id)',
      )
      .eq('risk.project_id', projectId)
      .overrideTypes<
        Array<{ task_id: string | null; milestone_id: string | null }>,
        { merge: false }
      >();

    const promotedTasks = new Set(
      (linked ?? []).map((row) => row.task_id).filter(Boolean),
    );
    const promotedMilestones = new Set(
      (linked ?? []).map((row) => row.milestone_id).filter(Boolean),
    );

    const { data: tasks } = await this.db
      .from('roadmap_tasks')
      .select(
        'id, title, status, feature_id, feature:roadmap_features!inner(roadmap_id)',
      )
      .eq('status', 'blocked')
      .eq('feature.roadmap_id', roadmap.id)
      .overrideTypes<
        Array<{
          id: string;
          title: string;
          status: string;
          feature_id: string | null;
        }>,
        { merge: false }
      >();

    const { data: milestones } = await this.db
      .from('roadmap_milestones')
      .select('id, title, status, target_date')
      .eq('roadmap_id', roadmap.id)
      .in('status', ['at_risk', 'missed'])
      .overrideTypes<
        Array<{
          id: string;
          title: string;
          status: string;
          target_date: string | null;
        }>,
        { merge: false }
      >();

    return {
      blocked_tasks: (tasks ?? []).filter((t) => !promotedTasks.has(t.id)),
      at_risk_milestones: (milestones ?? []).filter(
        (m) => !promotedMilestones.has(m.id),
      ),
    };
  }

  async create(projectId: string, userId: string, dto: CreateRiskDto) {
    await this.authorization.assertPermission(userId, projectId, 'risks.edit');

    // Mirrors the table's CHECK, but as a 400 rather than a 500.
    if (dto.kind === 'risk' && !dto.likelihood) {
      throw new BadRequestException('A risk needs a likelihood.');
    }
    if (dto.kind === 'issue' && dto.likelihood) {
      throw new BadRequestException(
        'An issue has already happened, so it has no likelihood.',
      );
    }

    const links = normalizeLinkTargets(dto.links, LINK_COLUMNS);

    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        project_id: projectId,
        kind: dto.kind,
        title: dto.title,
        description: dto.description ?? null,
        severity: dto.severity ?? 'medium',
        likelihood: dto.likelihood ?? null,
        impact: dto.impact ?? null,
        mitigation: dto.mitigation ?? null,
        owner_id: dto.owner_id ?? null,
        due_date: dto.due_date ?? null,
        visibility: dto.visibility ?? 'internal',
        source_kind: dto.source_kind ?? 'manual',
        created_by: userId,
      })
      .select(SELECT)
      .single()
      .overrideTypes<RiskRow, { merge: false }>();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to log the ${dto.kind}: ${error?.message ?? 'unknown error'}`,
      );
    }

    if (links.length) {
      const { error: linkError } = await this.db
        .from(LINKS_TABLE)
        .insert(links.map((link) => ({ risk_id: data.id, ...link })));
      if (linkError) {
        throw new InternalServerErrorException(
          `Failed to link the ${dto.kind}: ${linkError.message}`,
        );
      }
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.RISK_CREATED,
      entityType: 'risk',
      entityId: data.id,
      // No title: see the class docstring.
      metadata: { kind: dto.kind, severity: data.severity as string },
    });

    return links.length ? this.loadOrThrow(projectId, data.id) : data;
  }

  async update(
    projectId: string,
    id: string,
    userId: string,
    dto: UpdateRiskDto,
  ) {
    await this.authorization.assertPermission(userId, projectId, 'risks.edit');
    const existing = await this.assertVisible(projectId, id, userId);

    const nextKind = existing.kind;
    if (
      nextKind === 'risk' &&
      dto.likelihood === undefined &&
      !existing.likelihood
    ) {
      throw new BadRequestException('A risk needs a likelihood.');
    }

    const patch = this.pick(dto, [
      'title',
      'description',
      'severity',
      'likelihood',
      'status',
      'impact',
      'mitigation',
      'owner_id',
      'due_date',
      'visibility',
    ]);
    if (Object.keys(patch).length === 0) return existing;

    // The table requires a resolved stamp; set it here rather than making the
    // caller remember.
    if (patch.status === 'resolved') {
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = userId;
    }

    const { data, error } = await this.db
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
      .select(SELECT)
      .single()
      .overrideTypes<RiskRow, { merge: false }>();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to update: ${error?.message ?? 'unknown error'}`,
      );
    }

    const statusChanged =
      patch.status !== undefined && patch.status !== existing.status;
    const ownerChanged =
      patch.owner_id !== undefined && patch.owner_id !== existing.owner_id;

    this.audit.log({
      projectId,
      actorId: userId,
      action: statusChanged
        ? ACTIVITY_ACTIONS.RISK_STATUS_CHANGED
        : ownerChanged
          ? ACTIVITY_ACTIONS.RISK_OWNER_CHANGED
          : ACTIVITY_ACTIONS.RISK_UPDATED,
      entityType: 'risk',
      entityId: id,
      metadata: { kind: data.kind as string, changes: Object.keys(patch) },
    });

    return data;
  }

  async remove(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(userId, projectId, 'risks.edit');
    const existing = await this.assertVisible(projectId, id, userId);

    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to delete: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.RISK_DELETED,
      entityType: 'risk',
      entityId: id,
      metadata: { kind: existing.kind as string },
    });

    return { id, deleted: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Load a row, 404ing when the caller is not allowed to see it.
   *
   * Deliberately a 404 and not a 403: telling someone without
   * `risks.view_internal` that an internal risk exists is itself the leak.
   */
  private async assertVisible(projectId: string, id: string, userId: string) {
    const perms = await this.authorization.resolvePermissions(
      userId,
      projectId,
    );
    const canViewInternal = perms
      ? getPermission(perms, 'risks.view_internal')
      : false;

    const row = await this.loadOrThrow(projectId, id);
    if (row.visibility === 'internal' && !canViewInternal) {
      throw new NotFoundException('Not found');
    }
    return row;
  }

  private async loadOrThrow(projectId: string, id: string) {
    const { data, error } = await this.db
      .from(TABLE)
      .select(SELECT)
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()
      .overrideTypes<RiskRow, { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load: ${error.message}`,
      );
    }
    if (!data) throw new NotFoundException('Not found');
    return data;
  }

  private pick<T extends object>(dto: T, keys: string[]) {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
}
