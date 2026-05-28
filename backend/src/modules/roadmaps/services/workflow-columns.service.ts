import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  CreateTaskDto,
  CreateWorkflowColumnDto,
  UpdateWorkflowColumnDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import { TASKS_REPOSITORY } from './tasks.service';

export interface WorkflowColumnRow {
  id: string;
  roadmap_id: string;
  name: string;
  position: number;
  color: string | null;
  bucket_status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

type TemplateKey = 'discovery_call' | 'proposal' | 'onboarding';

interface TemplateDefinition {
  columns: Array<{
    name: string;
    bucket_status: WorkflowColumnRow['bucket_status'];
    color?: string;
  }>;
  tasks: Array<{
    title: string;
    bucket_status: WorkflowColumnRow['bucket_status'];
  }>;
}

const TEMPLATE_MAP: Record<TemplateKey, TemplateDefinition> = {
  discovery_call: {
    columns: [
      { name: 'Intake', bucket_status: 'todo', color: '#94a3b8' },
      { name: 'In Progress', bucket_status: 'in_progress', color: '#3b82f6' },
      { name: 'Review', bucket_status: 'in_review', color: '#f59e0b' },
      { name: 'Done', bucket_status: 'done', color: '#10b981' },
      { name: 'Blocked', bucket_status: 'blocked', color: '#ef4444' },
    ],
    tasks: [
      { title: 'Collect client context', bucket_status: 'todo' },
      { title: 'Host discovery call', bucket_status: 'in_progress' },
      { title: 'Share summary and next steps', bucket_status: 'in_review' },
    ],
  },
  proposal: {
    columns: [
      { name: 'Backlog', bucket_status: 'todo', color: '#94a3b8' },
      { name: 'Drafting', bucket_status: 'in_progress', color: '#3b82f6' },
      { name: 'Client Review', bucket_status: 'in_review', color: '#f59e0b' },
      { name: 'Accepted', bucket_status: 'done', color: '#10b981' },
      { name: 'Needs Revision', bucket_status: 'blocked', color: '#ef4444' },
    ],
    tasks: [
      { title: 'Draft scope and assumptions', bucket_status: 'todo' },
      { title: 'Draft commercial proposal', bucket_status: 'in_progress' },
      { title: 'Review proposal with client', bucket_status: 'in_review' },
    ],
  },
  onboarding: {
    columns: [
      { name: 'To Prepare', bucket_status: 'todo', color: '#94a3b8' },
      { name: 'In Setup', bucket_status: 'in_progress', color: '#3b82f6' },
      { name: 'Verification', bucket_status: 'in_review', color: '#f59e0b' },
      { name: 'Live', bucket_status: 'done', color: '#10b981' },
      { name: 'Blocked', bucket_status: 'blocked', color: '#ef4444' },
    ],
    tasks: [
      { title: 'Invite team members', bucket_status: 'todo' },
      { title: 'Set project permissions', bucket_status: 'in_progress' },
      { title: 'Confirm kickoff readiness', bucket_status: 'in_review' },
    ],
  },
};

@Injectable()
export class WorkflowColumnsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    @Inject(TASKS_REPOSITORY) private readonly tasksRepo: ITasksRepository,
  ) {}

  async list(roadmapId: string, userId: string): Promise<WorkflowColumnRow[]> {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.comment',
    );
    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkflowColumnRow[];
  }

  async create(
    roadmapId: string,
    userId: string,
    dto: CreateWorkflowColumnDto,
  ): Promise<WorkflowColumnRow> {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const nextPosition = await this.getNextPosition(roadmapId);
    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .insert({
        roadmap_id: roadmapId,
        name: dto.name.trim(),
        bucket_status: dto.bucket_status,
        position: dto.position ?? nextPosition,
        color: dto.color ?? null,
        is_system: false,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create workflow column');
    }
    return data as WorkflowColumnRow;
  }

  async update(
    roadmapId: string,
    columnId: string,
    userId: string,
    dto: UpdateWorkflowColumnDto,
  ): Promise<WorkflowColumnRow> {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const existing = await this.findColumnOrThrow(roadmapId, columnId);
    if (existing.is_system && dto.bucket_status && dto.bucket_status !== existing.bucket_status) {
      throw new BadRequestException(
        'System columns cannot change bucket_status.',
      );
    }
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.color !== undefined) patch.color = dto.color;
    if (!existing.is_system && dto.bucket_status !== undefined) {
      patch.bucket_status = dto.bucket_status;
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .update(patch)
      .eq('id', columnId)
      .eq('roadmap_id', roadmapId)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update workflow column');
    }

    if (patch.bucket_status) {
      await this.syncTaskStatusesForColumn(columnId, patch.bucket_status as WorkflowColumnRow['bucket_status']);
    }

    return data as WorkflowColumnRow;
  }

  async remove(
    roadmapId: string,
    columnId: string,
    userId: string,
  ): Promise<{ deleted: true }> {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const column = await this.findColumnOrThrow(roadmapId, columnId);
    if (column.is_system) {
      throw new BadRequestException('System columns cannot be deleted.');
    }

    const fallback = await this.findFallbackColumn(roadmapId, column.bucket_status);
    if (!fallback) {
      throw new BadRequestException(
        'Cannot delete the last column for this status bucket.',
      );
    }

    const { error: moveErr } = await this.supabase
      .from('roadmap_tasks')
      .update({
        workflow_column_id: fallback.id,
        status: fallback.bucket_status,
        updated_at: new Date().toISOString(),
      })
      .eq('workflow_column_id', columnId);
    if (moveErr) throw new Error(moveErr.message);

    const { error } = await this.supabase
      .from('roadmap_workflow_columns')
      .delete()
      .eq('id', columnId)
      .eq('roadmap_id', roadmapId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }

  async applyTemplate(
    roadmapId: string,
    templateKey: string,
    userId: string,
  ): Promise<{
    applied_template: TemplateKey;
    created_columns: number;
    created_tasks: number;
  }> {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    if (!Object.prototype.hasOwnProperty.call(TEMPLATE_MAP, templateKey)) {
      throw new BadRequestException('Unknown workflow template.');
    }
    const key = templateKey as TemplateKey;
    const template = TEMPLATE_MAP[key];

    const currentColumns = await this.list(roadmapId, userId);
    let createdColumns = 0;

    for (const column of template.columns) {
      const existing = currentColumns.find(
        (c) => c.name.toLowerCase() === column.name.toLowerCase(),
      );
      if (existing) continue;
      await this.create(roadmapId, userId, {
        name: column.name,
        bucket_status: column.bucket_status,
        color: column.color,
      });
      createdColumns += 1;
    }

    const refreshed = await this.list(roadmapId, userId);
    const operationsFeatureId = await this.ensureOperationsFeature(roadmapId, userId);
    let createdTasks = 0;

    for (const item of template.tasks) {
      const targetColumn = await this.pickColumnByBucket(
        refreshed,
        item.bucket_status,
      );
      const dto: CreateTaskDto = {
        feature_id: operationsFeatureId,
        title: item.title,
        priority: 'medium',
        status: item.bucket_status,
        workflow_column_id: targetColumn?.id,
      };
      await this.tasksRepo.create(dto, userId);
      createdTasks += 1;
    }

    return {
      applied_template: key,
      created_columns: createdColumns,
      created_tasks: createdTasks,
    };
  }

  async findColumnOrThrow(
    roadmapId: string,
    columnId: string,
  ): Promise<WorkflowColumnRow> {
    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .select('*')
      .eq('id', columnId)
      .eq('roadmap_id', roadmapId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Workflow column not found');
    return data as WorkflowColumnRow;
  }

  async pickColumnByBucket(
    columns: WorkflowColumnRow[],
    bucket: WorkflowColumnRow['bucket_status'],
  ): Promise<WorkflowColumnRow | null>;
  async pickColumnByBucket(
    roadmapId: string,
    bucket: WorkflowColumnRow['bucket_status'],
  ): Promise<WorkflowColumnRow | null>;
  async pickColumnByBucket(
    arg1: WorkflowColumnRow[] | string,
    bucket: WorkflowColumnRow['bucket_status'],
  ): Promise<WorkflowColumnRow | null> {
    if (Array.isArray(arg1)) {
      const cols = arg1
        .filter((c) => c.bucket_status === bucket)
        .sort((a, b) => a.position - b.position);
      return cols[0] ?? null;
    }
    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .select('*')
      .eq('roadmap_id', arg1)
      .eq('bucket_status', bucket)
      .order('is_system', { ascending: false })
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as WorkflowColumnRow | null) ?? null;
  }

  private async getNextPosition(roadmapId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .select('position')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      throw new Error(error.message);
    }
    return typeof data?.position === 'number' ? data.position + 1 : 0;
  }

  private async findFallbackColumn(
    roadmapId: string,
    bucket: WorkflowColumnRow['bucket_status'],
  ): Promise<WorkflowColumnRow | null> {
    const { data, error } = await this.supabase
      .from('roadmap_workflow_columns')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .eq('bucket_status', bucket)
      .order('is_system', { ascending: false })
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    const list = (data ?? []) as WorkflowColumnRow[];
    return list.find((c) => !c.is_system) ?? list[0] ?? null;
  }

  private async syncTaskStatusesForColumn(
    columnId: string,
    bucket: WorkflowColumnRow['bucket_status'],
  ): Promise<void> {
    const { error } = await this.supabase
      .from('roadmap_tasks')
      .update({
        status: bucket,
        updated_at: new Date().toISOString(),
      })
      .eq('workflow_column_id', columnId);
    if (error) throw new Error(error.message);
  }

  private async ensureOperationsFeature(
    roadmapId: string,
    userId: string,
  ): Promise<string> {
    const { data: existingFeature, error: featureErr } = await this.supabase
      .from('roadmap_features')
      .select('id')
      .eq('roadmap_id', roadmapId)
      .ilike('title', 'Operations')
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (featureErr) throw new Error(featureErr.message);
    if (existingFeature?.id) return existingFeature.id as string;

    const { data: epic, error: epicErr } = await this.supabase
      .from('roadmap_epics')
      .select('id')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (epicErr) throw new Error(epicErr.message);

    let epicId = epic?.id as string | undefined;
    if (!epicId) {
      const { data: createdEpic, error: createEpicErr } = await this.supabase
        .from('roadmap_epics')
        .insert({
          roadmap_id: roadmapId,
          title: 'Operations',
          priority: 'medium',
          status: 'backlog',
          position: 0,
        })
        .select('id')
        .single();
      if (createEpicErr || !createdEpic) {
        throw new Error(createEpicErr?.message ?? 'Failed to create epic');
      }
      epicId = createdEpic.id as string;
    }

    const { data: createdFeature, error: createFeatureErr } = await this.supabase
      .from('roadmap_features')
      .insert({
        roadmap_id: roadmapId,
        epic_id: epicId,
        title: 'Operations',
        position: 0,
      })
      .select('id')
      .single();
    if (createFeatureErr || !createdFeature) {
      throw new Error(
        createFeatureErr?.message ?? 'Failed to create operations feature',
      );
    }
    return createdFeature.id as string;
  }
}
