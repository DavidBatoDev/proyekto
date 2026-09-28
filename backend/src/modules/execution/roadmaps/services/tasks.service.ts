import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import {
  CreateTaskDto,
  QuickCreateTaskFromTimerDto,
  UpdateTaskDto,
  MoveTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';
import {
  RoadmapAuthorizationService,
  type TaskWriteContext,
} from './roadmap-authorization.service';
import { getPermission } from '../../projects/permissions/project-permissions';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';
import { FeatureStatusSyncService } from './derive-feature-status';
import { TaskAssigneeNotifierService } from './task-assignee-notifier.service';
import { RoadmapPlanLimitsService } from './roadmap-plan-limits.service';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');

/**
 * What quick-create-from-timer finds of the project's default roadmap chain
 * (first roadmap, its first epic, that epic's first feature) before writing
 * anything. A missing link is created by materializeTimerFeature.
 */
interface TimerFeaturePlan {
  roadmapId: string | null;
  epicId: string | null;
  featureId: string | null;
}

const TASK_TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'due_date',
  'feature_id',
  'work_type',
];

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly assigneeNotifier: TaskAssigneeNotifierService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
    private readonly featureStatusSync: FeatureStatusSyncService,
    private readonly planLimits: RoadmapPlanLimitsService,
  ) {}

  async findByFeature(featureId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ featureId }, userId);
    return this.repo.findByFeature(featureId);
  }

  async findByRoadmap(roadmapId: string, userId: string) {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId: id }, userId);
    const task = await this.repo.findById(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async create(dto: CreateTaskDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.create_tasks',
    );
    await this.planLimits.assertCanAdd(ctx, 1);
    const task = await this.repo.create(dto, userId);
    await this.notifyTaskAssignees(task, this.assigneeIdsOf(task), userId);
    await this.featureStatusSync.syncAfterTaskChange(dto.feature_id);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_CREATED,
      entityType: 'task',
      entityId: (task as { id?: string })?.id ?? null,
      title: dto.title,
      metadata: { parent: { type: 'feature', id: dto.feature_id } },
    });
    return task;
  }

  async quickCreateFromTimer(dto: QuickCreateTaskFromTimerDto, userId: string) {
    await this.roadmapAuthz.assertProjectRoadmapPermission(
      dto.project_id,
      userId,
      'roadmap.create_tasks',
    );

    // Read the default chain first so the node limit counts the scaffold this
    // create would add (a missing epic and feature) and nothing is written
    // when it is rejected.
    const plan = await this.planTimerFeature(dto.project_id);
    await this.planLimits.assertCanAdd(
      {
        roadmapId: plan.roadmapId,
        projectId: dto.project_id,
        ownerId: null,
      },
      1 + (plan.epicId ? 0 : 1) + (plan.featureId ? 0 : 1),
    );
    const { roadmapId, featureId } = await this.materializeTimerFeature(
      dto.project_id,
      userId,
      plan,
    );
    const task = await this.repo.create(
      {
        feature_id: featureId,
        title: dto.title.trim(),
        priority: 'medium',
        status: 'todo',
        assignee_id: dto.assignee_id,
        due_date: dto.due_date,
        work_type: dto.work_type ?? 'real_work',
      },
      userId,
    );
    await this.notifyTaskAssignees(task, this.assigneeIdsOf(task), userId);
    await this.featureStatusSync.syncAfterTaskChange(featureId);
    // materializeTimerFeature resolved (or created) the whole chain, so the
    // roadmap to notify is already known.
    this.effects.emit(
      {
        roadmapId,
        projectId: dto.project_id,
        ownerId: null,
        permissions: null,
      },
      userId,
      {
        action: ACTIVITY_ACTIONS.TASK_CREATED,
        entityType: 'task',
        entityId: (task as { id?: string })?.id ?? null,
        title: dto.title.trim(),
        metadata: {
          source: 'timer',
          parent: { type: 'feature', id: featureId },
        },
      },
    );
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.edit',
    );
    // (Un)assigning members is a distinct capability: a per-user override can
    // grant task editing while withholding roadmap.assign. Only enforce it when
    // the update actually touches an assignee field — and answer it from the
    // permission set the walk above already resolved rather than re-walking.
    if (dto.assignee_ids !== undefined || dto.assignee_id !== undefined) {
      this.assertAssignCapability(ctx);
    }
    const task = await this.repo.update(id, dto, userId);
    await this.featureStatusSync.syncAfterTaskChange(task.feature_id);
    // Notify only assignees that are newly added by this update.
    const previousAssignees = new Set(this.assigneeIdsOf(existing));
    const currentAssignees = this.assigneeIdsOf(task);
    const newlyAssigned = currentAssignees.filter(
      (assigneeId) => !previousAssignees.has(assigneeId),
    );
    if (newlyAssigned.length) {
      await this.notifyTaskAssignees(task, newlyAssigned, userId);
    }

    // ONE row for the whole PATCH, action picked by precedence
    // (assignment > status > move > generic) with the full diff attached.
    const changes = this.activity.diff(existing, task, TASK_TRACKED_FIELDS);
    const assigneesChanged =
      currentAssignees.length !== previousAssignees.size ||
      currentAssignees.some((a) => !previousAssignees.has(a));
    this.effects.emit(ctx, userId, {
      action: this.activity.taskUpdateAction({
        assigneesChanged,
        assigneesAdded: newlyAssigned.length,
        statusChanged: changes.some((c) => c.field === 'status'),
        featureChanged: changes.some((c) => c.field === 'feature_id'),
      }),
      entityType: 'task',
      entityId: id,
      title: (task as { title?: string })?.title ?? existing.title,
      metadata: {
        changes,
        ...(assigneesChanged
          ? { assignees: this.activity.assigneeSummary(currentAssignees) }
          : {}),
      },
    });
    return task;
  }

  async move(id: string, dto: MoveTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    const sourceCtx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.edit',
    );
    const targetCtx = await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.create_tasks',
    );
    if (targetCtx.roadmapId !== sourceCtx.roadmapId) {
      throw new NotFoundException('Feature not found');
    }

    const task = await this.repo.update(id, dto, userId);
    await this.featureStatusSync.syncAfterTaskChange(task.feature_id);
    if (task.feature_id !== existing.feature_id) {
      await this.featureStatusSync.syncAfterTaskChange(existing.feature_id);
    }
    const changes = this.activity.diff(existing, task, TASK_TRACKED_FIELDS);
    this.effects.emit(sourceCtx, userId, {
      action: this.activity.taskUpdateAction({
        assigneesChanged: false,
        assigneesAdded: 0,
        statusChanged: false,
        featureChanged: true,
      }),
      entityType: 'task',
      entityId: id,
      title: task.title ?? existing.title,
      metadata: { changes },
    });
    return task;
  }

  /**
   * In-memory `roadmap.assign` check against an already-resolved context.
   * A personal roadmap has no permission set — reaching here means the owner
   * check in the authz walk already passed, so assignment is allowed.
   */
  private assertAssignCapability(ctx: TaskWriteContext): void {
    if (!ctx.permissions) return;
    if (!getPermission(ctx.permissions, 'roadmap.assign')) {
      throw new MissingPermissionException({ path: 'roadmap.assign' });
    }
  }

  /**
   * Hidden past the plan's activity retention window (never purged): the
   * cutoff comes from the roadmap's workspace plan; null means no cutoff.
   */
  async getHistory(id: string, userId: string) {
    const ctx = await this.roadmapAuthz.assertViewPermission(
      { taskId: id },
      userId,
    );
    const since = await this.planLimits.retentionCutoff(ctx);
    return this.repo.getHistory(id, since ? { since } : undefined);
  }

  /**
   * Clones a single task, inserted immediately after the source in the same
   * feature. Trailing siblings are bumped via bulkReorder (same as the
   * drag-reorder path) before creating the clone at the freed position;
   * board_order always auto-appends to the end of its Kanban column
   * regardless (see TasksRepositorySupabase.create), which is the desired
   * default here too.
   */
  async duplicate(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.create_tasks',
    );

    await this.planLimits.assertCanAdd(ctx, 1);

    const insertPosition = (existing.position ?? 0) + 1;
    const siblings = await this.repo.findByFeature(existing.feature_id);
    const toShift = siblings.filter(
      (task) => (task.position ?? 0) >= insertPosition,
    );
    if (toShift.length) {
      await this.repo.bulkReorder(existing.feature_id, {
        items: toShift.map((task) => ({
          id: task.id,
          position: (task.position as number) + 1,
        })),
      });
    }

    const clonedTask = await this.repo.create(
      {
        feature_id: existing.feature_id,
        title: `${existing.title} (Copy)`,
        description: existing.description ?? undefined,
        priority: existing.priority ?? undefined,
        status: existing.status ?? undefined,
        due_date: existing.due_date ?? undefined,
        position: insertPosition,
        work_type: existing.work_type ?? undefined,
        checklist: existing.checklist ?? undefined,
      },
      userId,
    );
    await this.featureStatusSync.syncAfterTaskChange(existing.feature_id);

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_DUPLICATED,
      entityType: 'task',
      entityId: (clonedTask as { id?: string })?.id ?? null,
      title: (clonedTask as { title?: string })?.title ?? null,
      metadata: {
        parent: { type: 'feature', id: existing.feature_id },
        source_task_id: id,
      },
    });

    return clonedTask;
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      featureId,
      userId,
      'roadmap.edit_tasks',
    );
    const reordered = await this.repo.bulkReorder(featureId, dto);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_REORDERED,
      entityType: 'task',
      metadata: this.activity.reorderMetadata({
        scopeType: 'feature',
        scopeId: featureId,
        itemCount: dto.items?.length ?? 0,
        moved: dto.items?.map((i) => ({ id: i.id, position: i.position })),
      }),
    });
    return reordered;
  }

  async bulkReorderByStatus(
    roadmapId: string,
    status: string,
    dto: BulkReorderDto,
    userId: string,
  ) {
    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit_tasks',
    );
    const reordered = await this.repo.bulkReorderByStatus(
      roadmapId,
      status,
      dto,
    );
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_REORDERED,
      entityType: 'task',
      metadata: {
        ...this.activity.reorderMetadata({
          scopeType: 'roadmap',
          scopeId: roadmapId,
          itemCount: dto.items?.length ?? 0,
          moved: dto.items?.map((i) => ({ id: i.id, position: i.position })),
        }),
        // Board reorders are scoped to one Kanban column.
        board_status: status,
      },
    });
    return reordered;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    // The authz walk resolves the owning roadmap before the delete, so the
    // notify target survives the row going away.
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.edit_tasks',
    );
    await this.repo.remove(id);
    await this.featureStatusSync.syncAfterTaskChange(existing.feature_id);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_DELETED,
      entityType: 'task',
      entityId: id,
      title: (existing as { title?: string })?.title ?? null,
    });
  }

  /**
   * Reads (never writes) the project's default roadmap chain: its first
   * roadmap, that roadmap's first epic, that epic's first feature.
   */
  private async planTimerFeature(projectId: string): Promise<TimerFeaturePlan> {
    const { data: existingRoadmap, error: roadmapErr } = await this.db
      .from('roadmaps')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (roadmapErr) throw new Error(roadmapErr.message);
    const roadmapId = (existingRoadmap?.id as string | undefined) ?? null;
    if (!roadmapId) return { roadmapId: null, epicId: null, featureId: null };

    const { data: existingEpic, error: epicErr } = await this.db
      .from('roadmap_epics')
      .select('id')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (epicErr) throw new Error(epicErr.message);
    const epicId = (existingEpic?.id as string | undefined) ?? null;
    if (!epicId) return { roadmapId, epicId: null, featureId: null };

    const { data: existingFeature, error: featureErr } = await this.db
      .from('roadmap_features')
      .select('id')
      .eq('epic_id', epicId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (featureErr) throw new Error(featureErr.message);
    const featureId = (existingFeature?.id as string | undefined) ?? null;
    return { roadmapId, epicId, featureId };
  }

  /** Creates whatever links of the planned chain are missing. */
  private async materializeTimerFeature(
    projectId: string,
    userId: string,
    plan: TimerFeaturePlan,
  ): Promise<{ roadmapId: string; featureId: string }> {
    let roadmapId = plan.roadmapId;
    if (!roadmapId) {
      const { data: createdRoadmap, error: createRoadmapErr } = await this.db
        .from('roadmaps')
        .insert({
          project_id: projectId,
          owner_id: userId,
          name: 'Project roadmap',
          status: 'draft',
        })
        .select('id')
        .single();
      if (createRoadmapErr || !createdRoadmap) {
        throw new Error(
          createRoadmapErr?.message ?? 'Failed to create default roadmap',
        );
      }
      roadmapId = createdRoadmap.id as string;
    }

    let epicId = plan.epicId;
    if (!epicId) {
      const { data: createdEpic, error: createEpicErr } = await this.db
        .from('roadmap_epics')
        .insert({
          roadmap_id: roadmapId,
          title: 'General',
          status: 'backlog',
          priority: 'medium',
          position: 0,
        })
        .select('id')
        .single();
      if (createEpicErr || !createdEpic) {
        throw new Error(
          createEpicErr?.message ?? 'Failed to create default epic',
        );
      }
      epicId = createdEpic.id as string;
    }

    if (plan.featureId) return { roadmapId, featureId: plan.featureId };

    const { data: createdFeature, error: createFeatureErr } = await this.db
      .from('roadmap_features')
      .insert({
        epic_id: epicId,
        title: 'General',
        position: 0,
      })
      .select('id')
      .single();
    if (createFeatureErr || !createdFeature) {
      throw new Error(
        createFeatureErr?.message ?? 'Failed to create default feature',
      );
    }
    return { roadmapId, featureId: createdFeature.id as string };
  }

  /** Collects the full assignee id set of a task, tolerating both the legacy
   * single assignee_id and the normalized assignees[] array. */
  private assigneeIdsOf(task: any): string[] {
    const ids = new Set<string>();
    if (Array.isArray(task?.assignees)) {
      for (const a of task.assignees) {
        if (typeof a?.id === 'string') ids.add(a.id);
      }
    }
    if (typeof task?.assignee_id === 'string') ids.add(task.assignee_id);
    return [...ids];
  }

  private async notifyTaskAssignees(
    task: any,
    assigneeIds: string[],
    actorId: string,
  ): Promise<void> {
    const recipients = [...new Set(assigneeIds)].filter(
      (assigneeId) => assigneeId && assigneeId !== actorId,
    );
    if (!recipients.length) return;
    // Shared with the AI commit path — see TaskAssigneeNotifierService.
    const source = (task ?? {}) as {
      id?: unknown;
      title?: unknown;
      feature_id?: unknown;
    };
    await this.assigneeNotifier.notifyNewlyAssigned({
      task: {
        id: typeof source.id === 'string' ? source.id : null,
        title: typeof source.title === 'string' ? source.title : null,
        feature_id:
          typeof source.feature_id === 'string' ? source.feature_id : null,
      },
      assigneeIds: recipients,
      actorId,
    });
  }
}
