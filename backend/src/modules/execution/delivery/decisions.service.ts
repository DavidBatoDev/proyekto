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
import type { ProjectPermissions } from '../projects/permissions/project-permissions';
import { normalizeLinkTargets } from './delivery-links';
import type { DecisionRow } from './delivery.types';
import type {
  CreateDecisionDto,
  DecisionOptionInputDto,
  LinkTargetDto,
  ListDecisionsDto,
  UpdateDecisionDto,
  UpdateDecisionOptionDto,
} from './dto/delivery.dto';

const TABLE = 'project_decisions';
const LINKS_TABLE = 'decision_links';
const OPTIONS_TABLE = 'decision_options';

/**
 * Every write returns this shape, not the bare row.
 *
 * That is what lets the web layer patch its cache optimistically and then
 * reconcile from the response instead of refetching the whole list after each
 * click — the same contract the deliverable endpoints already honour.
 */
const SELECT =
  'id, project_id, reference, title, context, decision, rationale, ' +
  'alternatives_considered, category_id, decided_by, decided_on, status, ' +
  'supersedes_decision_id, version, source_chat_message_id, visibility, ' +
  'created_by, created_at, updated_at, ' +
  'category:project_decision_categories(' +
  'id, project_id, name, color, icon, position, created_by, created_at, updated_at' +
  '), ' +
  'links:decision_links(' +
  'id, epic_id, feature_id, task_id, milestone_id, deliverable_id, position, ' +
  'epic:roadmap_epics(id, title, status), ' +
  'feature:roadmap_features(id, title, status, epic:roadmap_epics(id, title, status)), ' +
  'task:roadmap_tasks(' +
  'id, title, status, ' +
  'feature:roadmap_features(id, title, status, epic:roadmap_epics(id, title, status))' +
  '), ' +
  'milestone:roadmap_milestones(id, title, status, target_date), ' +
  'deliverable:project_deliverables(id, title, status)' +
  '), ' +
  'options:decision_options(id, decision_id, title, detail, is_selected, position)';

/** This junction carries every target the roadmap and delivery tree can offer. */
const LINK_COLUMNS = [
  'epic_id',
  'feature_id',
  'task_id',
  'milestone_id',
  'deliverable_id',
] as const;

/**
 * The decision log.
 *
 * Superseding writes a NEW row that points back at the old one rather than
 * editing it, so "why did we do X" stays answerable after the answer changes.
 *
 * Two rules are worth stating up front:
 *
 * - `status` moves to `final` only through `finalize()`, never through PATCH,
 *   so the decided_by/decided_on stamps cannot be skipped. Same reasoning as
 *   the deliverable submit/review endpoints.
 * - `visibility: 'internal'` is filtered here, not by RLS. The database policy
 *   is membership-only; the internal/shared split is a resolved capability
 *   (`decisions.view_internal`), matching how the risk register does it.
 */
@Injectable()
export class DecisionsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string, userId: string, query: ListDecisionsDto = {}) {
    const permissions = await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );

    let request = this.db
      .from(TABLE)
      .select(SELECT)
      .eq('project_id', projectId);

    if (!this.canSeeInternal(permissions)) {
      request = request.eq('visibility', 'shared');
    }
    if (query.status) request = request.eq('status', query.status);
    if (query.category_id)
      request = request.eq('category_id', query.category_id);

    const { data, error } = await request
      .order('decided_on', { ascending: false })
      .order('created_at', { ascending: false })
      .overrideTypes<DecisionRow[], { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to list decisions: ${error.message}`,
      );
    }
    return (data ?? []).map((row) => this.sortChildren(row));
  }

  async get(projectId: string, id: string, userId: string) {
    const permissions = await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );
    const decision = await this.loadOrThrow(projectId, id);

    // A 404 rather than a 403: whether an internal decision exists is itself
    // something the caller is not entitled to learn.
    if (
      decision.visibility === 'internal' &&
      !this.canSeeInternal(permissions)
    ) {
      throw new NotFoundException('Decision not found');
    }
    return decision;
  }

  async create(projectId: string, userId: string, dto: CreateDecisionDto) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );

    let version = 1;
    if (dto.supersedes_decision_id) {
      // assertVisible, not loadOrThrow: superseding retires the named decision,
      // and an id the caller cannot see must not be retirable by guess.
      const previous = await this.assertVisible(
        projectId,
        dto.supersedes_decision_id,
        userId,
      );
      if (previous.status === 'superseded') {
        throw new BadRequestException(
          'That decision has already been superseded; supersede the newer one instead.',
        );
      }
      version = (previous.version ?? 1) + 1;
    }

    // Validated before the insert so a malformed target is a 400 naming the
    // offending row, not a 500 from the num_nonnulls CHECK.
    const links = normalizeLinkTargets(dto.links, LINK_COLUMNS);
    const options = this.normalizeOptions(dto.options);
    const status = dto.status ?? 'final';
    const reference = await this.nextReference(projectId);

    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        project_id: projectId,
        reference,
        title: dto.title,
        context: dto.context ?? null,
        decision: dto.decision,
        rationale: dto.rationale ?? null,
        alternatives_considered: dto.alternatives_considered ?? null,
        category_id: dto.category_id ?? null,
        status,
        // A proposed decision has not been decided by anyone yet, so stamping a
        // decider would be a lie the History panel then repeats.
        decided_by: status === 'proposed' ? null : (dto.decided_by ?? userId),
        decided_on: dto.decided_on ?? new Date().toISOString().slice(0, 10),
        supersedes_decision_id: dto.supersedes_decision_id ?? null,
        version,
        source_chat_message_id: dto.source_chat_message_id ?? null,
        visibility: dto.visibility ?? 'shared',
        created_by: userId,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to record the decision: ${error?.message ?? 'unknown error'}`,
      );
    }

    const decisionId = data.id as string;

    if (links.length) {
      const { error: linkError } = await this.db.from(LINKS_TABLE).insert(
        links.map((link, index) => ({
          decision_id: decisionId,
          ...link,
          position: index,
          created_by: userId,
        })),
      );
      if (linkError) {
        throw new InternalServerErrorException(
          `Recorded the decision but failed to link work: ${linkError.message}`,
        );
      }
    }

    if (options.length) {
      const { error: optionError } = await this.db.from(OPTIONS_TABLE).insert(
        options.map((option, index) => ({
          decision_id: decisionId,
          title: option.title,
          detail: option.detail ?? null,
          is_selected: option.is_selected ?? false,
          position: index,
        })),
      );
      if (optionError) {
        throw new InternalServerErrorException(
          `Recorded the decision but failed to save the options: ${optionError.message}`,
        );
      }
    }

    if (dto.supersedes_decision_id) {
      // Retire the previous row in the same logical write. A failure here would
      // leave two rows claiming to be final, so it is worth surfacing.
      const { error: supersedeError } = await this.db
        .from(TABLE)
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .eq('id', dto.supersedes_decision_id)
        .eq('project_id', projectId);

      if (supersedeError) {
        throw new InternalServerErrorException(
          `Recorded the decision but failed to retire the previous one: ${supersedeError.message}`,
        );
      }

      this.audit.log({
        projectId,
        actorId: userId,
        action: ACTIVITY_ACTIONS.DECISION_SUPERSEDED,
        entityType: 'decision',
        entityId: dto.supersedes_decision_id,
        metadata: { title: dto.title },
      });
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DECISION_CREATED,
      entityType: 'decision',
      entityId: decisionId,
      metadata: { title: dto.title },
    });

    return this.loadOrThrow(projectId, decisionId);
  }

  async update(
    projectId: string,
    id: string,
    userId: string,
    dto: UpdateDecisionDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    const existing = await this.assertEditable(projectId, id, userId);

    const patch = this.pick(dto, [
      'title',
      'context',
      'decision',
      'rationale',
      'alternatives_considered',
      'decided_on',
      'visibility',
      'category_id',
    ]);
    if (Object.keys(patch).length === 0) return existing;

    const { error } = await this.db
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to update the decision: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DECISION_UPDATED,
      entityType: 'decision',
      entityId: id,
      metadata: { title: existing.title, changes: Object.keys(patch) },
    });

    return this.loadOrThrow(projectId, id);
  }

  /**
   * proposed -> final. The one place decided_by/decided_on get stamped, which is
   * why it is not reachable through PATCH.
   */
  async finalize(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    const existing = await this.assertVisible(projectId, id, userId);

    if (existing.status === 'superseded') {
      throw new BadRequestException(
        'A superseded decision is history and cannot be reopened.',
      );
    }
    if (existing.status === 'final') return existing;

    const { error } = await this.db
      .from(TABLE)
      .update({
        status: 'final',
        decided_by: existing.decided_by ?? userId,
        decided_on:
          existing.decided_on ?? new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to finalize the decision: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DECISION_FINALIZED,
      entityType: 'decision',
      entityId: id,
      metadata: { title: existing.title },
    });

    return this.loadOrThrow(projectId, id);
  }

  async remove(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    const existing = await this.assertVisible(projectId, id, userId);

    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to delete the decision: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DECISION_DELETED,
      entityType: 'decision',
      entityId: id,
      metadata: { title: existing.title },
    });

    return { id, deleted: true };
  }

  // ── links ─────────────────────────────────────────────────────────────────

  async addLink(
    projectId: string,
    id: string,
    userId: string,
    target: LinkTargetDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.assertEditable(projectId, id, userId);

    const [normalized] = normalizeLinkTargets([target], LINK_COLUMNS);
    const position = await this.nextLinkPosition(id);

    const { error } = await this.db.from(LINKS_TABLE).insert({
      decision_id: id,
      ...normalized,
      position,
      created_by: userId,
    });

    if (error) {
      // The partial unique indexes make a repeat link a no-op rather than an
      // error the user has to understand.
      if (error.code === '23505') return this.loadOrThrow(projectId, id);
      throw new InternalServerErrorException(
        `Failed to link work: ${error.message}`,
      );
    }

    return this.loadOrThrow(projectId, id);
  }

  async removeLink(
    projectId: string,
    id: string,
    linkId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.assertEditable(projectId, id, userId);

    // Scoped by decision_id as well as id, so a link id belonging to another
    // decision cannot be deleted through this route.
    const { error } = await this.db
      .from(LINKS_TABLE)
      .delete()
      .eq('id', linkId)
      .eq('decision_id', id);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to unlink: ${error.message}`,
      );
    }
    return this.loadOrThrow(projectId, id);
  }

  // ── options ───────────────────────────────────────────────────────────────

  async addOption(
    projectId: string,
    id: string,
    userId: string,
    dto: DecisionOptionInputDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.assertEditable(projectId, id, userId);

    if (dto.is_selected) await this.clearSelected(id);
    const position = await this.nextOptionPosition(id);

    const { error } = await this.db.from(OPTIONS_TABLE).insert({
      decision_id: id,
      title: dto.title,
      detail: dto.detail ?? null,
      is_selected: dto.is_selected ?? false,
      position,
    });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to add the option: ${error.message}`,
      );
    }
    return this.loadOrThrow(projectId, id);
  }

  async updateOption(
    projectId: string,
    id: string,
    optionId: string,
    userId: string,
    dto: UpdateDecisionOptionDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.assertEditable(projectId, id, userId);

    // Order matters: the partial unique index rejects a second selected row, so
    // the sibling has to be cleared before this one is set.
    if (dto.is_selected === true) await this.clearSelected(id, optionId);

    const patch = this.pick(dto, ['title', 'detail', 'is_selected']);
    if (Object.keys(patch).length === 0) return this.loadOrThrow(projectId, id);

    const { error } = await this.db
      .from(OPTIONS_TABLE)
      .update(patch)
      .eq('id', optionId)
      .eq('decision_id', id);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to update the option: ${error.message}`,
      );
    }
    return this.loadOrThrow(projectId, id);
  }

  async removeOption(
    projectId: string,
    id: string,
    optionId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.assertEditable(projectId, id, userId);

    const { error } = await this.db
      .from(OPTIONS_TABLE)
      .delete()
      .eq('id', optionId)
      .eq('decision_id', id);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to remove the option: ${error.message}`,
      );
    }
    return this.loadOrThrow(projectId, id);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private canSeeInternal(permissions: ProjectPermissions): boolean {
    return permissions.decisions.view_internal === true;
  }

  /**
   * Per-project human reference (DEC-024). Racy under true concurrency, which
   * the UNIQUE (project_id, reference) index turns into a retryable error rather
   * than a duplicate — the same trade the change-request numbering makes.
   */
  private async nextReference(projectId: string): Promise<number> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('reference')
      .eq('project_id', projectId)
      .order('reference', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to allocate a decision number: ${error.message}`,
      );
    }
    return ((data?.reference as number | null) ?? 0) + 1;
  }

  private async nextLinkPosition(decisionId: string): Promise<number> {
    const { data } = await this.db
      .from(LINKS_TABLE)
      .select('position')
      .eq('decision_id', decisionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((data?.position as number | undefined) ?? -1) + 1;
  }

  private async nextOptionPosition(decisionId: string): Promise<number> {
    const { data } = await this.db
      .from(OPTIONS_TABLE)
      .select('position')
      .eq('decision_id', decisionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((data?.position as number | undefined) ?? -1) + 1;
  }

  private async clearSelected(decisionId: string, exceptId?: string) {
    let request = this.db
      .from(OPTIONS_TABLE)
      .update({ is_selected: false })
      .eq('decision_id', decisionId)
      .eq('is_selected', true);

    if (exceptId) request = request.neq('id', exceptId);

    const { error } = await request;
    if (error) {
      throw new InternalServerErrorException(
        `Failed to clear the previous selection: ${error.message}`,
      );
    }
  }

  /** At most one option may arrive pre-selected. */
  private normalizeOptions(
    options: DecisionOptionInputDto[] | undefined,
  ): DecisionOptionInputDto[] {
    if (!options?.length) return [];
    const selected = options.filter((option) => option.is_selected);
    if (selected.length > 1) {
      throw new BadRequestException(
        'Only one option can be the one that was chosen.',
      );
    }
    return options;
  }

  /**
   * Load a row, 404ing when the caller is not allowed to see it.
   *
   * Deliberately a 404 and not a 403, and deliberately the same shape as
   * RisksService.assertVisible: telling someone without `decisions.view_internal`
   * that an internal decision exists is itself the leak. `get` applied this from
   * the start; the mutation paths did not, so an editor could patch an internal
   * decision by id and read it back out of the response. Every write goes
   * through here now.
   */
  private async assertVisible(projectId: string, id: string, userId: string) {
    const permissions = await this.authorization.resolvePermissions(
      userId,
      projectId,
    );
    const existing = await this.loadOrThrow(projectId, id);
    if (
      existing.visibility === 'internal' &&
      (!permissions || !this.canSeeInternal(permissions))
    ) {
      throw new NotFoundException('Decision not found');
    }
    return existing;
  }

  private async assertEditable(projectId: string, id: string, userId: string) {
    const existing = await this.assertVisible(projectId, id, userId);
    if (existing.status === 'superseded') {
      throw new BadRequestException(
        'A superseded decision is history and cannot be edited.',
      );
    }
    return existing;
  }

  private async loadOrThrow(projectId: string, id: string) {
    const { data, error } = await this.db
      .from(TABLE)
      .select(SELECT)
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()
      .overrideTypes<DecisionRow, { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load the decision: ${error.message}`,
      );
    }
    if (!data) throw new NotFoundException('Decision not found');
    return this.sortChildren(data);
  }

  /**
   * PostgREST does not order embedded rows, so links and options would come
   * back in an arbitrary order on every read.
   */
  private sortChildren(row: DecisionRow): DecisionRow {
    const byPosition = <T extends { position: number }>(a: T, b: T) =>
      a.position - b.position;
    if (row.links) row.links = [...row.links].sort(byPosition);
    if (row.options) row.options = [...row.options].sort(byPosition);
    return row;
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
