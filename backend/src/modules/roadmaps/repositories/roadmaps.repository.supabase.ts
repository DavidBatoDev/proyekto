import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { IRoadmapsRepository } from './roadmaps.repository.interface';
import { CreateRoadmapDto, UpdateRoadmapDto } from '../dto/roadmaps.dto';

@Injectable()
export class RoadmapsRepositorySupabase implements IRoadmapsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private async getAccessibleProjectIds(userId: string): Promise<string[]> {
    const [
      { data: principalProjects, error: principalError },
      { data: memberProjects, error: memberError },
    ] = await Promise.all([
      this.db
        .from('projects')
        .select('id')
        .or(`client_id.eq.${userId},consultant_id.eq.${userId}`),
      this.db
        .from('project_members')
        .select('project_id')
        .eq('user_id', userId),
    ]);

    if (principalError) throw new Error(principalError.message);
    if (memberError) throw new Error(memberError.message);

    const ids = new Set<string>();

    for (const project of principalProjects ?? []) {
      if (project?.id) ids.add(String(project.id));
    }

    for (const member of memberProjects ?? []) {
      if (member?.project_id) ids.add(String(member.project_id));
    }

    return [...ids];
  }

  private isMissingRoadmapCategoryColumn(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const maybeError = error as { message?: string; details?: string };
    const text = `${maybeError.message ?? ''} ${maybeError.details ?? ''}`;
    return (
      text.includes('column') &&
      text.includes('category') &&
      text.includes('roadmaps')
    );
  }

  private async canAccessProject(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const { data: project, error: projectError } = await this.db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .or(`client_id.eq.${userId},consultant_id.eq.${userId}`)
      .maybeSingle();

    if (projectError) throw new Error(projectError.message);
    if (project) return true;

    const { data, error } = await this.db
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return !!data;
  }

  private async canAccessRoadmap(
    roadmap: { owner_id?: string; project_id?: string | null },
    userId: string,
  ): Promise<boolean> {
    if (roadmap.owner_id === userId) return true;

    if (!roadmap.project_id) return false;

    return this.canAccessProject(roadmap.project_id, userId);
  }

  async findAll(userId: string): Promise<any[]> {
    const accessibleProjectIds = await this.getAccessibleProjectIds(userId);

    const { data: ownedRoadmaps, error: ownedError } = await this.db
      .from('roadmaps')
      .select('*, project:projects(id, title)')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
    if (ownedError) throw new Error(ownedError.message);

    let sharedRoadmaps: any[] = [];
    if (accessibleProjectIds.length > 0) {
      const { data, error } = await this.db
        .from('roadmaps')
        .select('*, project:projects(id, title)')
        .in('project_id', accessibleProjectIds)
        .neq('owner_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      sharedRoadmaps = data ?? [];
    }

    const deduped = new Map<string, any>();
    for (const roadmap of [...(ownedRoadmaps ?? []), ...sharedRoadmaps]) {
      if (!roadmap?.id) continue;
      deduped.set(String(roadmap.id), roadmap);
    }

    return [...deduped.values()].sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    );
  }

  async findByProjectId(
    projectId: string,
    userId?: string,
  ): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmaps')
      .select('*, project:projects(id, title)')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) return null;

    if (userId) {
      const hasAccess = await this.canAccessRoadmap(data, userId);
      if (!hasAccess) return null;
    }

    return data;
  }

  async findById(id: string, userId?: string): Promise<any | null> {
    const query = this.db
      .from('roadmaps')
      .select('*, project:projects(id, title)')
      .eq('id', id);

    const { data, error } = await query.single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);

    if (!data) return null;

    if (userId) {
      const hasAccess = await this.canAccessRoadmap(data, userId);
      if (!hasAccess) return null;
    }

    return data;
  }

  async findFull(id: string, userId?: string): Promise<any | null> {
    const query = this.db
      .from('roadmaps')
      .select(
        `
        *,
        project:projects(id, title),
        milestones:roadmap_milestones(*),
        epics:roadmap_epics(*, features:roadmap_features(*, tasks:roadmap_tasks(*, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name))))
      `,
      )
      .eq('id', id);

    const { data, error } = await query.single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);

    if (!data) return null;

    if (userId) {
      const hasAccess = await this.canAccessRoadmap(data, userId);
      if (!hasAccess) return null;
    }

    return data;
  }

  async findByUser(userId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmaps')
      .select('*, project:projects(id, title)')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findPreviews(userId: string): Promise<any[]> {
    const accessibleProjectIds = await this.getAccessibleProjectIds(userId);

    // Step 1: fetch owned roadmaps
    const { data: ownedRoadmaps, error: ownedRoadmapsError } = await this.db
      .from('roadmaps')
      .select(
        'id, name, description, status, project_id, preview_url, created_at, updated_at, project:projects(id, title)',
      )
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (ownedRoadmapsError) throw new Error(ownedRoadmapsError.message);

    // Step 1b: fetch project roadmaps user can access but does not own
    let sharedRoadmaps: any[] = [];
    if (accessibleProjectIds.length > 0) {
      const { data, error } = await this.db
        .from('roadmaps')
        .select(
          'id, name, description, status, project_id, preview_url, created_at, updated_at, project:projects(id, title)',
        )
        .in('project_id', accessibleProjectIds)
        .neq('owner_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      sharedRoadmaps = data ?? [];
    }

    const dedupedRoadmaps = new Map<string, any>();
    for (const roadmap of [...(ownedRoadmaps ?? []), ...sharedRoadmaps]) {
      if (!roadmap?.id) continue;
      dedupedRoadmaps.set(String(roadmap.id), roadmap);
    }
    const roadmaps = [...dedupedRoadmaps.values()];

    if (!roadmaps || roadmaps.length === 0) return [];

    const roadmapIds = roadmaps.map((r) => r.id);

    // Step 2: fetch epics for those roadmaps
    const { data: epics, error: epicsError } = await this.db
      .from('roadmap_epics')
      .select('id, roadmap_id, title, position, status')
      .in('roadmap_id', roadmapIds)
      .order('position', { ascending: true });
    if (epicsError) throw new Error(epicsError.message);

    // Step 3: fetch features for those roadmaps
    const { data: features, error: featuresError } = await this.db
      .from('roadmap_features')
      .select('id, roadmap_id, epic_id, title, position, status')
      .in('roadmap_id', roadmapIds)
      .order('position', { ascending: true });
    if (featuresError) throw new Error(featuresError.message);

    // Step 4: fetch tasks for those features (if any)
    const featureIds = (features ?? []).map((f) => f.id);
    let tasks: any[] = [];
    if (featureIds.length > 0) {
      const { data: taskData, error: tasksError } = await this.db
        .from('roadmap_tasks')
        .select('id, feature_id, position, status')
        .in('feature_id', featureIds)
        .order('position', { ascending: true });
      if (tasksError) throw new Error(tasksError.message);
      tasks = taskData ?? [];
    }

    // Step 5: assemble nested structure
    const tasksByFeature = tasks.reduce<Record<string, any[]>>((acc, task) => {
      (acc[task.feature_id] ??= []).push(task);
      return acc;
    }, {});

    const featuresByEpic = (features ?? []).reduce<Record<string, any[]>>(
      (acc, feature) => {
        (acc[feature.epic_id] ??= []).push({
          ...feature,
          tasks: tasksByFeature[feature.id] ?? [],
        });
        return acc;
      },
      {},
    );

    const epicsByRoadmap = (epics ?? []).reduce<Record<string, any[]>>(
      (acc, epic) => {
        (acc[epic.roadmap_id] ??= []).push({
          ...epic,
          features: featuresByEpic[epic.id] ?? [],
        });
        return acc;
      },
      {},
    );

    return roadmaps.map((roadmap) => ({
      ...roadmap,
      epics: epicsByRoadmap[roadmap.id] ?? [],
    }));
  }

  async findConsultantProjectless(userId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmaps')
      .select('*, project:projects(id, title)')
      .eq('owner_id', userId)
      .is('project_id', null)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findPublicTemplatePreviews(): Promise<any[]> {
    const { data: roadmaps, error: roadmapsError } = await this.db
      .from('roadmaps')
      .select(
        'id, name, description, status, project_id, preview_url, is_public, is_templatable, created_at, updated_at, owner:profiles(id, display_name, avatar_url, headline)',
      )
      .is('project_id', null)
      .eq('is_public', true)
      .eq('is_templatable', true)
      .order('updated_at', { ascending: false });

    if (roadmapsError) throw new Error(roadmapsError.message);
    if (!roadmaps || roadmaps.length === 0) return [];

    const roadmapIds = roadmaps.map((r) => r.id);

    const { data: epics, error: epicsError } = await this.db
      .from('roadmap_epics')
      .select('id, roadmap_id, title, position, status')
      .in('roadmap_id', roadmapIds)
      .order('position', { ascending: true });
    if (epicsError) throw new Error(epicsError.message);

    const { data: features, error: featuresError } = await this.db
      .from('roadmap_features')
      .select('id, roadmap_id, epic_id, title, position, status')
      .in('roadmap_id', roadmapIds)
      .order('position', { ascending: true });
    if (featuresError) throw new Error(featuresError.message);

    const featureIds = (features ?? []).map((f) => f.id);
    let tasks: any[] = [];
    if (featureIds.length > 0) {
      const { data: taskData, error: tasksError } = await this.db
        .from('roadmap_tasks')
        .select('id, feature_id, position, status')
        .in('feature_id', featureIds)
        .order('position', { ascending: true });
      if (tasksError) throw new Error(tasksError.message);
      tasks = taskData ?? [];
    }

    const tasksByFeature = tasks.reduce<Record<string, any[]>>((acc, task) => {
      (acc[task.feature_id] ??= []).push(task);
      return acc;
    }, {});

    const featuresByEpic = (features ?? []).reduce<Record<string, any[]>>(
      (acc, feature) => {
        (acc[feature.epic_id] ??= []).push({
          ...feature,
          tasks: tasksByFeature[feature.id] ?? [],
        });
        return acc;
      },
      {},
    );

    const epicsByRoadmap = (epics ?? []).reduce<Record<string, any[]>>(
      (acc, epic) => {
        (acc[epic.roadmap_id] ??= []).push({
          ...epic,
          features: featuresByEpic[epic.id] ?? [],
        });
        return acc;
      },
      {},
    );

    return roadmaps.map((roadmap) => ({
      ...roadmap,
      epics: epicsByRoadmap[roadmap.id] ?? [],
    }));
  }

  async findPublicTemplateById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmaps')
      .select(
        `
        *,
        project:projects(id, title),
        epics:roadmap_epics(*, features:roadmap_features(*, tasks:roadmap_tasks(*)))
      `,
      )
      .eq('id', id)
      .is('project_id', null)
      .eq('is_public', true)
      .eq('is_templatable', true)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async create(dto: CreateRoadmapDto, userId: string): Promise<any> {
    const payload = { ...dto, owner_id: userId };
    const { data, error } = await this.db
      .from('roadmaps')
      .insert(payload)
      .select()
      .single();

    if (error && this.isMissingRoadmapCategoryColumn(error)) {
      const { category: _ignored, ...fallbackPayload } = payload;
      const { data: fallbackData, error: fallbackError } = await this.db
        .from('roadmaps')
        .insert(fallbackPayload)
        .select()
        .single();

      if (fallbackError) throw new Error(fallbackError.message);
      return fallbackData;
    }

    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, dto: UpdateRoadmapDto): Promise<any> {
    const payload = { ...dto, updated_at: new Date().toISOString() };
    const { data, error } = await this.db
      .from('roadmaps')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error && this.isMissingRoadmapCategoryColumn(error)) {
      const { category: _ignored, ...fallbackPayload } = payload;
      const { data: fallbackData, error: fallbackError } = await this.db
        .from('roadmaps')
        .update(fallbackPayload)
        .eq('id', id)
        .select()
        .single();

      if (fallbackError) throw new Error(fallbackError.message);
      return fallbackData;
    }

    if (error) throw new Error(error.message);
    return data;
  }

  async cloneFromTemplate(templateId: string, userId: string): Promise<any> {
    const template = await this.findPublicTemplateById(templateId);
    if (!template) {
      throw new NotFoundException('Template roadmap not found');
    }

    const clonedRoadmapId = randomUUID();

    const fullState = {
      id: clonedRoadmapId,
      name: `${template.name} (Copy)`,
      description: template.description,
      status: 'draft',
      settings: template.settings ?? {},
      roadmap_epics: (template.epics ?? []).map((epic: any) => ({
        title: epic.title,
        description: epic.description,
        status: epic.status,
        priority: epic.priority,
        position: epic.position,
        color: epic.color,
        start_date: epic.start_date,
        end_date: epic.end_date,
        tags: epic.tags ?? [],
        roadmap_features: (epic.features ?? []).map((feature: any) => ({
          title: feature.title,
          description: feature.description,
          status: feature.status,
          position: feature.position,
          is_deliverable: feature.is_deliverable,
          start_date: feature.start_date,
          end_date: feature.end_date,
          roadmap_tasks: (feature.tasks ?? []).map((task: any) => ({
            title: task.title,
            status: task.status,
            priority: task.priority,
            position: task.position,
            due_date: task.due_date,
          })),
        })),
      })),
    };

    const { error } = await this.db.rpc('upsert_full_roadmap', {
      p_roadmap_id: clonedRoadmapId,
      p_owner_id: userId,
      p_full_state: fullState,
      p_create_if_missing: true,
    });

    if (error) throw new Error(error.message);

    return this.findById(clonedRoadmapId, userId);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('roadmaps').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async migrateGuestRoadmaps(
    sessionId: string,
    userId: string,
  ): Promise<{ migrated: number }> {
    // Find roadmaps owned by profile with this guest session
    const { data: guestProfile } = await this.db
      .from('profiles')
      .select('id')
      .eq('guest_session_id', sessionId)
      .eq('is_guest', true)
      .single();

    if (!guestProfile) return { migrated: 0 };

    const { data, error } = await this.db
      .from('roadmaps')
      .update({ owner_id: userId })
      .eq('owner_id', guestProfile.id)
      .select('id');
    if (error) throw new Error(error.message);
    return { migrated: (data ?? []).length };
  }
}
