import {
  BadRequestException,
  ForbiddenException,
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
import {
  computeProgress,
  expandLinkedTasks,
  type FeatureTasks,
  type TaskLike,
} from './deliverable-progress';
import { canDecide, resolveReviewOutcome } from './deliverable-review';
import { normalizeLinkTargets } from './delivery-links';
import type {
  DeliverableCriterionRow,
  DeliverableLinkRow,
  DeliverableRow,
} from './delivery.types';
import type {
  AddDeliverableAttachmentDto,
  AddDeliverableReviewerDto,
  CreateDeliverableCriterionDto,
  CreateDeliverableDto,
  ListDeliverablesQueryDto,
  ReviewDeliverableDto,
  UpdateDeliverableCriterionDto,
  UpdateDeliverableDto,
} from './dto/delivery.dto';

const TABLE = 'project_deliverables';
const LINKS_TABLE = 'deliverable_links';
const ATTACHMENTS_TABLE = 'deliverable_attachments';
const CRITERIA_TABLE = 'deliverable_criteria';
const REVIEWERS_TABLE = 'deliverable_reviewers';

// Full profile shape so the web `Avatar` component can consume it directly —
// it requires email/first_name/last_name for its initials fallback.
const REVIEWER_PROFILE_COLS =
  'id, display_name, avatar_url, email, first_name, last_name';

// Parents are embedded upward from each link so a card can render the
// Epic → Feature → Task trail without a second round trip. Widened to `string`
// because PostgREST's literal-type parser chokes on embeds this deep — the same
// trick `roadmaps.repository.supabase.ts findFull()` uses.
const SELECT: string = `
  id, project_id, roadmap_id, title, description, acceptance_criteria, status,
  owner_id, due_date, position, submitted_by, submitted_at, reviewed_by,
  reviewed_at, review_note, created_by, created_at, updated_at,
  links:deliverable_links(
    id, position, feature_id, task_id, milestone_id,
    task:roadmap_tasks(
      id, title, status,
      feature:roadmap_features(
        id, title, status,
        epic:roadmap_epics(id, title, status)
      )
    ),
    feature:roadmap_features(
      id, title, status,
      epic:roadmap_epics(id, title, status)
    ),
    milestone:roadmap_milestones(id, title, status, target_date)
  ),
  attachments:deliverable_attachments(
    id, kind, category, label, url, mime_type, size_bytes, created_at
  ),
  criteria:deliverable_criteria(
    id, deliverable_id, label, is_met, met_by, met_at, position
  ),
  reviewers:deliverable_reviewers(
    id, deliverable_id, reviewer_id, decision, note, decided_at,
    reviewer:profiles!deliverable_reviewers_reviewer_id_fkey(${REVIEWER_PROFILE_COLS})
  )
`;

const LINK_COLUMNS = ['feature_id', 'task_id', 'milestone_id'] as const;

/**
 * Deliverables — the acceptance layer for work handed over.
 *
 * Reads are gated on `access.delivery`, edits on `deliverables.edit`. Review is
 * capability-based rather than role-based: a deliverable may name any project
 * members as reviewers, and being named is itself the grant to decide (see
 * `deliverable-review.ts`).
 */
@Injectable()
export class DeliverablesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(
    projectId: string,
    userId: string,
    query: ListDeliverablesQueryDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );

    let builder = this.db
      .from(TABLE)
      .select(SELECT)
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (query.status) builder = builder.eq('status', query.status);

    const { data, error } = await builder.overrideTypes<
      DeliverableRow[],
      { merge: false }
    >();
    if (error) {
      throw new InternalServerErrorException(
        `Failed to list deliverables: ${error.message}`,
      );
    }

    return this.attachProgress(data ?? []);
  }

  async get(projectId: string, deliverableId: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );
    return this.loadOrThrow(projectId, deliverableId);
  }

  async create(projectId: string, userId: string, dto: CreateDeliverableDto) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );

    const links = normalizeLinkTargets(dto.links, LINK_COLUMNS);

    // Append rather than fighting over position 0.
    const { data: last } = await this.db
      .from(TABLE)
      .select('position')
      .eq('project_id', projectId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        project_id: projectId,
        roadmap_id: dto.roadmap_id ?? null,
        title: dto.title,
        description: dto.description ?? null,
        acceptance_criteria: dto.acceptance_criteria ?? null,
        owner_id: dto.owner_id ?? null,
        due_date: dto.due_date ?? null,
        position: ((last?.position as number | undefined) ?? -1) + 1,
        created_by: userId,
      })
      .select('id')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to create deliverable: ${error?.message ?? 'unknown error'}`,
      );
    }

    if (links.length) await this.insertLinks(data.id, links, userId);

    if (dto.criteria?.length) {
      const { error: criteriaError } = await this.db
        .from(CRITERIA_TABLE)
        .insert(
          dto.criteria.map((label, index) => ({
            deliverable_id: data.id,
            label,
            position: index,
            created_by: userId,
          })),
        );
      if (criteriaError) {
        throw new InternalServerErrorException(
          `Failed to add acceptance criteria: ${criteriaError.message}`,
        );
      }
    }

    if (dto.reviewer_ids?.length) {
      await this.insertReviewers(data.id, dto.reviewer_ids, userId);
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DELIVERABLE_CREATED,
      entityType: 'deliverable',
      entityId: data.id,
      roadmapId: dto.roadmap_id ?? null,
      metadata: { title: dto.title },
    });

    return this.loadOrThrow(projectId, data.id);
  }

  async update(
    projectId: string,
    deliverableId: string,
    userId: string,
    dto: UpdateDeliverableDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);

    // The review verbs own the rest of the ladder; letting `update` set
    // in_review or approved would sidestep the submitted_by/reviewed_by stamps
    // the table's CHECK constraints require.
    if (
      dto.status &&
      !['not_started', 'in_progress'].includes(existing.status) &&
      existing.status !== dto.status
    ) {
      throw new BadRequestException(
        `A deliverable in ${existing.status} cannot be moved with update; use submit or review.`,
      );
    }

    const patch = this.pick(dto, [
      'title',
      'description',
      'acceptance_criteria',
      'owner_id',
      'due_date',
      'position',
      'status',
    ]);
    if (Object.keys(patch).length === 0) return existing;

    await this.patchRow(projectId, deliverableId, patch);

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DELIVERABLE_UPDATED,
      entityType: 'deliverable',
      entityId: deliverableId,
      metadata: { title: existing.title, changes: Object.keys(patch) },
    });

    return this.loadOrThrow(projectId, deliverableId);
  }

  /** Hand the deliverable to its reviewers. Requires edit, not approve. */
  async submit(projectId: string, deliverableId: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);

    if (existing.status === 'in_review') {
      throw new BadRequestException('This deliverable is already in review.');
    }
    if (existing.status === 'approved') {
      throw new BadRequestException(
        'This deliverable is already accepted. Create a new one for further work.',
      );
    }

    const now = new Date().toISOString();
    await this.patchRow(projectId, deliverableId, {
      status: 'in_review',
      submitted_by: userId,
      submitted_at: now,
      // A resubmission supersedes the previous decision.
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    });

    // Critical: clear every prior sign-off. A resubmission must not inherit
    // approvals given to an earlier version of the work.
    const { error: resetError } = await this.db
      .from(REVIEWERS_TABLE)
      .update({ decision: 'pending', decided_at: null, note: null })
      .eq('deliverable_id', deliverableId);
    if (resetError) {
      throw new InternalServerErrorException(
        `Submitted, but failed to reset reviewers: ${resetError.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DELIVERABLE_SUBMITTED,
      entityType: 'deliverable',
      entityId: deliverableId,
      metadata: { title: existing.title },
    });

    return this.loadOrThrow(projectId, deliverableId);
  }

  /**
   * Cast a decision.
   *
   * With named reviewers the deliverable's status is derived from all of them;
   * with none, whoever holds `deliverables.approve` decides outright.
   */
  async review(
    projectId: string,
    deliverableId: string,
    userId: string,
    dto: ReviewDeliverableDto,
  ) {
    const perms = await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );
    const hasApprove = getPermission(perms, 'deliverables.approve');
    const existing = await this.loadOrThrow(projectId, deliverableId);
    const reviewers = existing.reviewers ?? [];

    if (!canDecide(userId, reviewers, hasApprove)) {
      throw new ForbiddenException(
        'Only a named reviewer, or someone who can approve deliverables, may decide this.',
      );
    }
    if (existing.status !== 'in_review') {
      throw new BadRequestException(
        'Only a deliverable that has been submitted for review can be decided.',
      );
    }

    const now = new Date().toISOString();
    const mine = reviewers.find((r) => r.reviewer_id === userId);

    if (mine) {
      const { error } = await this.db
        .from(REVIEWERS_TABLE)
        .update({
          decision: dto.decision,
          note: dto.review_note ?? null,
          decided_at: now,
        })
        .eq('id', mine.id);
      if (error) {
        throw new InternalServerErrorException(
          `Failed to record your decision: ${error.message}`,
        );
      }
    }

    // Recompute from the full list, including the row just written.
    const next = reviewers.map((reviewer) =>
      reviewer.reviewer_id === userId
        ? { ...reviewer, decision: dto.decision }
        : reviewer,
    );
    const outcome = mine
      ? resolveReviewOutcome(next)
      : // No reviewer row for this user: an approver deciding outright.
        { status: dto.decision, approvals: 0, total: 0, pending: 0 };

    if (outcome.status !== 'in_review') {
      await this.patchRow(projectId, deliverableId, {
        status: outcome.status,
        reviewed_by: userId,
        reviewed_at: now,
        review_note: dto.review_note ?? null,
      });

      this.audit.log({
        projectId,
        actorId: userId,
        action:
          outcome.status === 'approved'
            ? ACTIVITY_ACTIONS.DELIVERABLE_APPROVED
            : ACTIVITY_ACTIONS.DELIVERABLE_CHANGES_REQUESTED,
        entityType: 'deliverable',
        entityId: deliverableId,
        metadata: { title: existing.title },
      });
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  // ── Acceptance criteria ───────────────────────────────────────────────────

  async addCriterion(
    projectId: string,
    deliverableId: string,
    userId: string,
    dto: CreateDeliverableCriterionDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db.from(CRITERIA_TABLE).insert({
      deliverable_id: deliverableId,
      label: dto.label,
      position: existing.criteria?.length ?? 0,
      created_by: userId,
    });
    if (error) {
      throw new InternalServerErrorException(
        `Failed to add criterion: ${error.message}`,
      );
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  async updateCriterion(
    projectId: string,
    deliverableId: string,
    criterionId: string,
    userId: string,
    dto: UpdateDeliverableCriterionDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    await this.loadOrThrow(projectId, deliverableId);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.is_met !== undefined) {
      // The table's CHECK requires attribution and timestamp to move together
      // with the flag, so un-ticking clears both rather than leaving a stale
      // "met by" on an unmet criterion.
      patch.is_met = dto.is_met;
      patch.met_by = dto.is_met ? userId : null;
      patch.met_at = dto.is_met ? new Date().toISOString() : null;
    }

    const { error } = await this.db
      .from(CRITERIA_TABLE)
      .update(patch)
      .eq('id', criterionId)
      .eq('deliverable_id', deliverableId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to update criterion: ${error.message}`,
      );
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  async removeCriterion(
    projectId: string,
    deliverableId: string,
    criterionId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db
      .from(CRITERIA_TABLE)
      .delete()
      .eq('id', criterionId)
      .eq('deliverable_id', deliverableId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to remove criterion: ${error.message}`,
      );
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  // ── Reviewers ─────────────────────────────────────────────────────────────

  async addReviewer(
    projectId: string,
    deliverableId: string,
    userId: string,
    dto: AddDeliverableReviewerDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    await this.loadOrThrow(projectId, deliverableId);

    // A reviewer must actually be on the project — otherwise naming someone
    // would hand a decision to a person who cannot even open the deliverable.
    const { data: member } = await this.db
      .from('project_access')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', dto.reviewer_id)
      .maybeSingle();
    if (!member) {
      throw new BadRequestException(
        'That person is not a member of this project.',
      );
    }

    await this.insertReviewers(deliverableId, [dto.reviewer_id], userId);
    return this.loadOrThrow(projectId, deliverableId);
  }

  async removeReviewer(
    projectId: string,
    deliverableId: string,
    reviewerId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db
      .from(REVIEWERS_TABLE)
      .delete()
      .eq('deliverable_id', deliverableId)
      .eq('reviewer_id', reviewerId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to remove reviewer: ${error.message}`,
      );
    }

    // Removing the last outstanding reviewer can complete the sign-off, so the
    // status has to be re-derived rather than left stale.
    if (existing.status === 'in_review') {
      const remaining = (existing.reviewers ?? []).filter(
        (reviewer) => reviewer.reviewer_id !== reviewerId,
      );
      const outcome = resolveReviewOutcome(remaining);
      if (remaining.length > 0 && outcome.status !== 'in_review') {
        await this.patchRow(projectId, deliverableId, {
          status: outcome.status,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        });
      }
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  // ── Links and attachments ─────────────────────────────────────────────────

  async addLink(
    projectId: string,
    deliverableId: string,
    userId: string,
    link: Record<string, string>,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);
    const [normalized] = normalizeLinkTargets([link], LINK_COLUMNS);

    await this.insertLinks(deliverableId, [normalized], userId);

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DELIVERABLE_LINK_ADDED,
      entityType: 'deliverable_link',
      entityId: deliverableId,
      metadata: { title: existing.title },
    });

    return this.loadOrThrow(projectId, deliverableId);
  }

  async removeLink(
    projectId: string,
    deliverableId: string,
    linkId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db
      .from(LINKS_TABLE)
      .delete()
      .eq('id', linkId)
      .eq('deliverable_id', deliverableId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to remove link: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DELIVERABLE_LINK_REMOVED,
      entityType: 'deliverable_link',
      entityId: deliverableId,
      metadata: { title: existing.title },
    });

    return this.loadOrThrow(projectId, deliverableId);
  }

  async addAttachment(
    projectId: string,
    deliverableId: string,
    userId: string,
    dto: AddDeliverableAttachmentDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db.from(ATTACHMENTS_TABLE).insert({
      deliverable_id: deliverableId,
      kind: dto.kind,
      category: dto.category ?? 'other',
      label: dto.label ?? null,
      url: dto.url,
      storage_key: dto.storage_key ?? null,
      mime_type: dto.mime_type ?? null,
      size_bytes: dto.size_bytes ?? null,
      uploaded_by: userId,
    });
    if (error) {
      throw new InternalServerErrorException(
        `Failed to attach: ${error.message}`,
      );
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  async removeAttachment(
    projectId: string,
    deliverableId: string,
    attachmentId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db
      .from(ATTACHMENTS_TABLE)
      .delete()
      .eq('id', attachmentId)
      .eq('deliverable_id', deliverableId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to remove evidence: ${error.message}`,
      );
    }

    return this.loadOrThrow(projectId, deliverableId);
  }

  async remove(projectId: string, deliverableId: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'deliverables.edit',
    );
    const existing = await this.loadOrThrow(projectId, deliverableId);

    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq('id', deliverableId)
      .eq('project_id', projectId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to delete deliverable: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.DELIVERABLE_DELETED,
      entityType: 'deliverable',
      entityId: deliverableId,
      metadata: { title: existing.title },
    });

    return { id: deliverableId, deleted: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Resolve linked work into task counts for a whole page of deliverables.
   *
   * Batched deliberately: three queries total regardless of how many
   * deliverables are on the page, rather than three per deliverable.
   */
  private async attachProgress(
    rows: DeliverableRow[],
  ): Promise<DeliverableRow[]> {
    const taskIds = new Set<string>();
    const featureIds = new Set<string>();
    const milestoneIds = new Set<string>();

    for (const row of rows) {
      for (const link of row.links ?? []) {
        if (link.task_id) taskIds.add(link.task_id);
        if (link.feature_id) featureIds.add(link.feature_id);
        if (link.milestone_id) milestoneIds.add(link.milestone_id);
      }
    }

    // Milestones reach tasks only through features (milestone_epics was dropped).
    const milestoneFeatureIds = new Map<string, string[]>();
    if (milestoneIds.size) {
      const { data } = await this.db
        .from('milestone_features')
        .select('milestone_id, feature_id')
        .in('milestone_id', [...milestoneIds])
        .overrideTypes<
          Array<{ milestone_id: string; feature_id: string }>,
          { merge: false }
        >();
      for (const row of data ?? []) {
        const list = milestoneFeatureIds.get(row.milestone_id) ?? [];
        list.push(row.feature_id);
        milestoneFeatureIds.set(row.milestone_id, list);
        featureIds.add(row.feature_id);
      }
    }

    const featureTasks: FeatureTasks[] = [];
    if (featureIds.size) {
      const { data } = await this.db
        .from('roadmap_tasks')
        .select('id, status, feature_id')
        .in('feature_id', [...featureIds])
        .overrideTypes<
          Array<{ id: string; status: string; feature_id: string }>,
          { merge: false }
        >();
      const grouped = new Map<string, TaskLike[]>();
      for (const task of data ?? []) {
        const list = grouped.get(task.feature_id) ?? [];
        list.push({ id: task.id, status: task.status });
        grouped.set(task.feature_id, list);
      }
      for (const [featureId, tasks] of grouped) {
        featureTasks.push({ featureId, tasks });
      }
    }

    const directTaskById = new Map<string, TaskLike>();
    if (taskIds.size) {
      const { data } = await this.db
        .from('roadmap_tasks')
        .select('id, status')
        .in('id', [...taskIds])
        .overrideTypes<
          Array<{ id: string; status: string }>,
          { merge: false }
        >();
      for (const task of data ?? []) directTaskById.set(task.id, task);
    }

    return rows.map((row) => {
      const links = row.links ?? [];
      const directTasks = links
        .map((link) =>
          link.task_id ? directTaskById.get(link.task_id) : undefined,
        )
        .filter((task): task is TaskLike => Boolean(task));

      const tasks = expandLinkedTasks({
        links,
        directTasks,
        featureTasks,
        milestoneFeatureIds,
      });

      return {
        ...row,
        progress: computeProgress(tasks, row.criteria ?? []),
      };
    });
  }

  private async patchRow(
    projectId: string,
    deliverableId: string,
    patch: Record<string, unknown>,
  ) {
    const { error } = await this.db
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', deliverableId)
      .eq('project_id', projectId);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to update deliverable: ${error.message}`,
      );
    }
  }

  private async loadOrThrow(
    projectId: string,
    deliverableId: string,
  ): Promise<DeliverableRow> {
    const { data, error } = await this.db
      .from(TABLE)
      .select(SELECT)
      .eq('id', deliverableId)
      .eq('project_id', projectId)
      .maybeSingle()
      .overrideTypes<DeliverableRow, { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load deliverable: ${error.message}`,
      );
    }
    if (!data) throw new NotFoundException('Deliverable not found');

    const [withProgress] = await this.attachProgress([data]);
    return withProgress;
  }

  private async insertLinks(
    deliverableId: string,
    links: Array<Partial<Record<string, string>>>,
    userId: string,
  ) {
    const { error } = await this.db.from(LINKS_TABLE).insert(
      links.map((link, index) => ({
        deliverable_id: deliverableId,
        position: index,
        created_by: userId,
        ...link,
      })),
    );
    if (error) {
      throw new InternalServerErrorException(
        `Failed to link work to the deliverable: ${error.message}`,
      );
    }
  }

  private async insertReviewers(
    deliverableId: string,
    reviewerIds: string[],
    userId: string,
  ) {
    const { error } = await this.db.from(REVIEWERS_TABLE).upsert(
      reviewerIds.map((reviewerId) => ({
        deliverable_id: deliverableId,
        reviewer_id: reviewerId,
        added_by: userId,
      })),
      { onConflict: 'deliverable_id,reviewer_id', ignoreDuplicates: true },
    );
    if (error) {
      throw new InternalServerErrorException(
        `Failed to add reviewer: ${error.message}`,
      );
    }
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

export type { DeliverableCriterionRow, DeliverableLinkRow };
