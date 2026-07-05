import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ITasksRepository } from './tasks.repository.interface';
import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';

const PROFILE_COLS =
  'id, display_name, avatar_url, email, first_name, last_name';

// Embeds the many-to-many assignees alongside the legacy single assignee. The
// join rows come back as `[{ profile: {...} }]`; normalizeAssignees flattens
// them to a plain `assignees: [{...}]` array for the API contract.
// `profile:profiles!assignee_id(...)` disambiguates the embed: the join table
// has two FKs to profiles (assignee_id and assigned_by), so a bare
// `profiles(...)` is ambiguous and PostgREST rejects it with a 300.
const ASSIGNEES_EMBED = `assignees:roadmap_task_assignees(profile:profiles!assignee_id(${PROFILE_COLS}))`;

@Injectable()
export class TasksRepositorySupabase implements ITasksRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private normalizeAssignees<T extends { assignees?: any }>(
    row: T | null,
  ): T | null {
    if (!row) return row;
    const raw = Array.isArray(row.assignees) ? row.assignees : [];
    const assignees = raw
      .map((entry: any) => entry?.profile)
      .filter((p: any) => p && typeof p.id === 'string');
    return { ...row, assignees };
  }

  /** dto.assignee_ids is canonical when present; otherwise fall back to the
   * legacy single assignee_id. Returns null when the caller didn't touch
   * assignees at all (so update can skip syncing). */
  private resolveAssigneeIds(dto: {
    assignee_ids?: string[];
    assignee_id?: string | null;
  }): string[] | null {
    if (dto.assignee_ids !== undefined) {
      return [...new Set(dto.assignee_ids.filter(Boolean))];
    }
    if (dto.assignee_id !== undefined) {
      return dto.assignee_id ? [dto.assignee_id] : [];
    }
    return null;
  }

  /** Reconciles the join table to exactly `assigneeIds`. Returns which ids were
   * added/removed so callers can drive notifications and audit logging. */
  private async syncTaskAssignees(
    taskId: string,
    assigneeIds: string[],
    userId?: string,
  ): Promise<{ added: string[]; removed: string[] }> {
    const { data: existingRows, error: readErr } = await this.db
      .from('roadmap_task_assignees')
      .select('assignee_id')
      .eq('task_id', taskId);
    if (readErr) throw new Error(readErr.message);

    const existing = new Set(
      (existingRows ?? []).map((r: any) => r.assignee_id as string),
    );
    const next = new Set(assigneeIds);
    const added = [...next].filter((id) => !existing.has(id));
    const removed = [...existing].filter((id) => !next.has(id));

    if (removed.length) {
      const { error } = await this.db
        .from('roadmap_task_assignees')
        .delete()
        .eq('task_id', taskId)
        .in('assignee_id', removed);
      if (error) throw new Error(error.message);
    }
    if (added.length) {
      const { error } = await this.db.from('roadmap_task_assignees').insert(
        added.map((assignee_id) => ({
          task_id: taskId,
          assignee_id,
          assigned_by: userId ?? null,
        })),
      );
      if (error) throw new Error(error.message);
    }
    return { added, removed };
  }

  /** Bumps every existing task in the feature down by one position, highest
   * first so the (feature_id, position) unique constraint is never transiently
   * violated. Frees position 0 so a freshly created task lands at the top. */
  private async shiftTasksDown(featureId: string): Promise<void> {
    const { data: rows, error } = await this.db
      .from('roadmap_tasks')
      .select('id, position')
      .eq('feature_id', featureId)
      .order('position', { ascending: false });
    if (error) throw new Error(error.message);

    for (const row of rows ?? []) {
      const { error: updErr } = await this.db
        .from('roadmap_tasks')
        .update({ position: (row.position as number) + 1 })
        .eq('id', row.id as string);
      if (updErr) throw new Error(updErr.message);
    }
  }

  async findByFeature(featureId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(`*, assignee:profiles!roadmap_tasks_assignee_id_fkey(${PROFILE_COLS}), ${ASSIGNEES_EMBED}`)
      .eq('feature_id', featureId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.normalizeAssignees(row));
  }

  async findByRoadmap(roadmapId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(
        `*,
         assignee:profiles!roadmap_tasks_assignee_id_fkey(${PROFILE_COLS}),
         ${ASSIGNEES_EMBED},
         feature:roadmap_features!inner(
           id,
           title,
           roadmap_id,
           epic_id,
           epic:roadmap_epics(id, title, color),
           milestone_features(milestone_id)
         )`,
      )
      .eq('feature.roadmap_id', roadmapId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.normalizeAssignees(row));
  }

  async findById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(`*, assignee:profiles!roadmap_tasks_assignee_id_fkey(${PROFILE_COLS}), ${ASSIGNEES_EMBED}`)
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return this.normalizeAssignees(data ?? null);
  }

  private async logChanges(
    taskId: string,
    userId: string,
    changes: Array<{ field: string; old: string | null; new: string | null }>,
  ): Promise<void> {
    if (!changes.length) return;
    await this.db.from('task_activity_log').insert(
      changes.map((c) => ({
        task_id: taskId,
        changed_by: userId,
        field_name: c.field,
        old_value: c.old,
        new_value: c.new,
      })),
    );
  }

  async getHistory(taskId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('task_activity_log')
      .select('*, changed_by_user:profiles(id, display_name, avatar_url)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(dto: CreateTaskDto, userId: string): Promise<any> {
    // New tasks default to the top of the list: shift existing tasks down and
    // insert at position 0. An explicit dto.position (targeted insert) wins.
    let resolvedPosition: number;
    if (typeof dto.position === 'number') {
      resolvedPosition = dto.position;
    } else {
      await this.shiftTasksDown(dto.feature_id);
      resolvedPosition = 0;
    }

    const assigneeIds = this.resolveAssigneeIds(dto) ?? [];
    const primaryAssignee = assigneeIds[0] ?? null;

    const dbPayload = {
      feature_id: dto.feature_id,
      title: dto.title,
      description: dto.description ?? null,
      priority: dto.priority,
      status: dto.status ?? 'todo',
      assignee_id: primaryAssignee,
      due_date: dto.due_date,
      position: resolvedPosition,
      work_type: dto.work_type ?? 'real_work',
      checklist: dto.checklist ?? [],
    };
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .insert(dbPayload)
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    if (assigneeIds.length) {
      await this.syncTaskAssignees(data.id, assigneeIds, userId);
    }

    // Log creation
    await this.logChanges(data.id, userId, [
      { field: 'created', old: null, new: dto.title },
    ]).catch(() => {});

    return this.findById(data.id);
  }

  async update(id: string, dto: UpdateTaskDto, userId?: string): Promise<any> {
    let existing: any = null;
    if (userId) {
      existing = await this.findById(id);
    }

    const assigneeIds = this.resolveAssigneeIds(dto);
    const touchesAssignees = assigneeIds !== null;
    const primaryAssignee = touchesAssignees
      ? (assigneeIds[0] ?? null)
      : undefined;

    const dbPayload = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(touchesAssignees && { assignee_id: primaryAssignee }),
      ...(dto.position !== undefined && { position: dto.position }),
      ...(dto.due_date !== undefined && { due_date: dto.due_date }),
      ...(dto.completed_at !== undefined && { completed_at: dto.completed_at }),
      ...(dto.work_type !== undefined && { work_type: dto.work_type }),
      ...(dto.checklist !== undefined && { checklist: dto.checklist }),
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.db
      .from('roadmap_tasks')
      .update(dbPayload)
      .eq('id', id);
    if (error) throw new Error(error.message);

    let assigneeChanges: { added: string[]; removed: string[] } = {
      added: [],
      removed: [],
    };
    if (touchesAssignees) {
      assigneeChanges = await this.syncTaskAssignees(id, assigneeIds, userId);
    }

    // Audit log — only tracked fields
    if (userId && existing) {
      const tracked: Array<{
        field: string;
        old: string | null;
        new: string | null;
      }> = [];
      const check = (
        field: string,
        getter: (t: any) => string | null | undefined,
      ) => {
        const oldVal = getter(existing) ?? null;
        const newVal = getter(dto) ?? null;
        if (newVal !== null && newVal !== oldVal) {
          tracked.push({ field, old: oldVal, new: newVal });
        }
      };
      check('status', (t) => t.status);
      check('priority', (t) => t.priority);
      check('title', (t) => t.title);
      for (const added of assigneeChanges.added) {
        tracked.push({ field: 'assignee_added', old: null, new: added });
      }
      for (const removed of assigneeChanges.removed) {
        tracked.push({ field: 'assignee_removed', old: removed, new: null });
      }
      await this.logChanges(id, userId, tracked).catch(() => {});
    }

    return this.findById(id);
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto): Promise<void> {
    const now = new Date().toISOString();
    const TEMP_OFFSET = 1_000_000;

    // Phase 1: shift all rows to unique temp positions so the
    // (feature_id, position) unique constraint can't be transiently violated
    // while positions are being reassigned.
    const phase1 = dto.items.map((item, idx) =>
      this.db
        .from('roadmap_tasks')
        .update({ position: TEMP_OFFSET + idx, updated_at: now })
        .eq('id', item.id)
        .eq('feature_id', featureId),
    );
    for (const { error } of await Promise.all(phase1)) {
      if (error) throw new Error(error.message);
    }

    // Phase 2: set final positions (all unique, no conflicts).
    const phase2 = dto.items.map((item) =>
      this.db
        .from('roadmap_tasks')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('feature_id', featureId),
    );
    for (const { error } of await Promise.all(phase2)) {
      if (error) throw new Error(error.message);
    }
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('roadmap_tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
