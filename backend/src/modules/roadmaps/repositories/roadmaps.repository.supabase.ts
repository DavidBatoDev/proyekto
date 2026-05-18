import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  FindFullRoadmapOptions,
  IRoadmapsRepository,
  RoadmapContextSearchCandidateRecord,
  RoadmapContextSearchNodeType,
} from './roadmaps.repository.interface';
import { CreateRoadmapDto, UpdateRoadmapDto } from '../dto/roadmaps.dto';

@Injectable()
export class RoadmapsRepositorySupabase implements IRoadmapsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private sortByPosition<T extends { position?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => {
      const aPos =
        typeof a?.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const bPos =
        typeof b?.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return aPos - bPos;
    });
  }

  private normalizeFullRoadmapOrdering(roadmap: any): any {
    const epics = this.sortByPosition(
      Array.isArray(roadmap?.epics) ? roadmap.epics : [],
    ).map((epic: any) => {
      const features = this.sortByPosition(
        Array.isArray(epic?.features) ? epic.features : [],
      ).map((feature: any) => ({
        ...feature,
        tasks: this.sortByPosition(
          Array.isArray(feature?.tasks) ? feature.tasks : [],
        ),
      }));

      return {
        ...epic,
        features,
      };
    });

    return {
      ...roadmap,
      epics,
    };
  }

  private async getAccessibleProjectIds(userId: string): Promise<string[]> {
    const [
      { data: principalProjects, error: principalError },
      { data: memberProjects, error: memberError },
    ] = await Promise.all([
      this.db
        .from('projects')
        .select('id')
        .or(`client_id.eq.${userId},consultant_id.eq.${userId}`),
      // Slice 3b: project membership now lives in project_shares.
      this.db
        .from('project_access')
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

    // Slice 3b: project membership lives in project_shares.
    const { data, error } = await this.db
      .from('project_access')
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

  async findUpdatedAt(id: string): Promise<string | null> {
    // Narrow PK-only lookup used by the AI commit path to derive the
    // authoritative post-upsert revision token. Must NOT be served from
    // the authz decision cache (which holds the *pre-commit* row) — this
    // method hits the DB directly every call.
    const { data, error } = await this.db
      .from('roadmaps')
      .select('updated_at')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data || typeof data.updated_at !== 'string') return null;
    return data.updated_at;
  }

  async findFull(
    id: string,
    userId?: string,
    options?: FindFullRoadmapOptions,
  ): Promise<any | null> {
    const includeTaskAssigneeProfile =
      options?.includeTaskAssigneeProfile !== false;
    const taskSelect = includeTaskAssigneeProfile
      ? 'tasks:roadmap_tasks(*, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name))'
      : 'tasks:roadmap_tasks(*)';

    const query = this.db
      .from('roadmaps')
      .select(
        `
        *,
        project:projects(id, title),
        milestones:roadmap_milestones(*),
        epics:roadmap_epics(*, features:roadmap_features(*, ${taskSelect}))
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

    return this.normalizeFullRoadmapOrdering(data);
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

  async searchContextCandidates(
    roadmapId: string,
    query: string,
    options?: {
      nodeType?: RoadmapContextSearchNodeType;
      scanLimit?: number;
    },
  ): Promise<RoadmapContextSearchCandidateRecord[]> {
    const normalizedQuery = this.sanitizeLookupQuery(query);
    if (!normalizedQuery) {
      return [];
    }
    const queryTokens = normalizedQuery
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (queryTokens.length === 0) {
      return [];
    }

    const scanLimit = Math.min(Math.max(options?.scanLimit ?? 200, 1), 1000);
    const nodeType = options?.nodeType;
    const candidates: RoadmapContextSearchCandidateRecord[] = [];

    if (!nodeType || nodeType === 'epic') {
      const epics = await this.searchEpics(
        roadmapId,
        normalizedQuery,
        scanLimit,
      );
      candidates.push(...epics);
    }

    const includeFeatureMatches = !nodeType || nodeType === 'feature';
    let featureMatchRows: Array<{
      id: string;
      title: string;
      description?: string;
      epic_id: string;
      roadmap_id: string;
    }> = [];

    if (includeFeatureMatches) {
      featureMatchRows = await this.searchFeatures(
        roadmapId,
        normalizedQuery,
        scanLimit,
      );
      if (featureMatchRows.length > 0) {
        const features = await this.toFeatureCandidates(
          roadmapId,
          featureMatchRows,
        );
        candidates.push(...features);
      }
    }

    if (!nodeType || nodeType === 'task') {
      const tasks = await this.searchTasks(
        roadmapId,
        normalizedQuery,
        scanLimit,
      );
      candidates.push(...tasks);
    }

    return candidates;
  }

  private async searchEpics(
    roadmapId: string,
    normalizedQuery: string,
    scanLimit: number,
  ): Promise<RoadmapContextSearchCandidateRecord[]> {
    const rows = await this.runBoundedSearchPasses<{
      id: string;
      roadmap_id: string;
      title: string;
      description?: string;
    }>({
      table: 'roadmap_epics',
      select: 'id, roadmap_id, title, description',
      roadmapId,
      query: normalizedQuery,
      scanLimit,
      includeDescriptionPass: true,
    });

    return rows.flatMap((epic) =>
      epic?.id && epic?.roadmap_id
        ? [
            {
              id: String(epic.id),
              type: 'epic' as const,
              title: String(epic.title ?? 'Untitled epic'),
              description:
                typeof epic.description === 'string'
                  ? epic.description
                  : undefined,
              parent_id: String(epic.roadmap_id),
            },
          ]
        : [],
    );
  }

  private async searchFeatures(
    roadmapId: string,
    normalizedQuery: string,
    scanLimit: number,
  ): Promise<
    Array<{
      id: string;
      title: string;
      description?: string;
      epic_id: string;
      roadmap_id: string;
    }>
  > {
    const rows = await this.runBoundedSearchPasses<{
      id: string;
      roadmap_id: string;
      title: string;
      description?: string;
      epic_id: string;
    }>({
      table: 'roadmap_features',
      select: 'id, roadmap_id, title, description, epic_id',
      roadmapId,
      query: normalizedQuery,
      scanLimit,
      includeDescriptionPass: true,
    });

    return rows.flatMap((feature) =>
      feature?.id && feature?.epic_id && feature?.roadmap_id
        ? [
            {
              id: String(feature.id),
              title: String(feature.title ?? 'Untitled feature'),
              description:
                typeof feature.description === 'string'
                  ? feature.description
                  : undefined,
              epic_id: String(feature.epic_id),
              roadmap_id: String(feature.roadmap_id),
            },
          ]
        : [],
    );
  }

  private async toFeatureCandidates(
    roadmapId: string,
    features: Array<{
      id: string;
      title: string;
      description?: string;
      epic_id: string;
      roadmap_id: string;
    }>,
  ): Promise<RoadmapContextSearchCandidateRecord[]> {
    const epicIds = [...new Set(features.map((feature) => feature.epic_id))];
    const epicTitleById = await this.loadEpicTitles(roadmapId, epicIds);

    return features.map((feature) => ({
      id: feature.id,
      type: 'feature' as const,
      title: feature.title,
      description: feature.description,
      parent_id: feature.epic_id,
      parent_title: epicTitleById.get(feature.epic_id),
    }));
  }

  private async searchTasks(
    roadmapId: string,
    normalizedQuery: string,
    scanLimit: number,
  ): Promise<RoadmapContextSearchCandidateRecord[]> {
    const taskRows = await this.runTaskSearchPasses({
      roadmapId,
      query: normalizedQuery,
      scanLimit,
    });

    return taskRows.map((task) => ({
      id: task.id,
      type: 'task' as const,
      title: task.title,
      parent_id: task.feature_id,
      parent_title: task.feature_title,
    }));
  }

  private async loadEpicTitles(
    roadmapId: string,
    epicIds: string[],
  ): Promise<Map<string, string>> {
    if (epicIds.length === 0) {
      return new Map<string, string>();
    }
    const { data, error } = await this.db
      .from('roadmap_epics')
      .select('id, title')
      .eq('roadmap_id', roadmapId)
      .in('id', epicIds);

    if (error) throw new Error(error.message);
    return new Map(
      (data ?? [])
        .filter((epic) => epic?.id)
        .map((epic) => [
          String(epic.id),
          String(epic.title ?? 'Untitled epic'),
        ]),
    );
  }

  private sanitizeLookupQuery(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[%_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 160)
      .trim();
  }

  private async runBoundedSearchPasses<T extends { id?: string }>(params: {
    table: 'roadmap_epics' | 'roadmap_features';
    select: string;
    roadmapId: string;
    query: string;
    scanLimit: number;
    includeDescriptionPass: boolean;
  }): Promise<T[]> {
    const seen = new Set<string>();
    const rows: T[] = [];
    const titlePatterns = [
      params.query,
      `${params.query}%`,
      `%${params.query}%`,
    ];

    for (const pattern of titlePatterns) {
      const data = await this.fetchRows<T>(
        this.db
          .from(params.table)
          .select(params.select)
          .eq('roadmap_id', params.roadmapId)
          .ilike('title', pattern)
          .order('title', { ascending: true })
          .limit(params.scanLimit),
      );
      this.appendUniqueRows(rows, seen, data, params.scanLimit);
      if (rows.length >= params.scanLimit) {
        return this.sortByTitleAndId(rows).slice(0, params.scanLimit);
      }
    }

    if (params.includeDescriptionPass && rows.length < params.scanLimit) {
      const descRows = await this.fetchRows<T>(
        this.db
          .from(params.table)
          .select(params.select)
          .eq('roadmap_id', params.roadmapId)
          .ilike('description', `%${params.query}%`)
          .order('title', { ascending: true })
          .limit(params.scanLimit),
      );
      this.appendUniqueRows(rows, seen, descRows, params.scanLimit);
    }

    return this.sortByTitleAndId(rows).slice(0, params.scanLimit);
  }

  private async runTaskSearchPasses(params: {
    roadmapId: string;
    query: string;
    scanLimit: number;
  }): Promise<
    Array<{
      id: string;
      title: string;
      feature_id: string;
      feature_title?: string;
    }>
  > {
    const rows: Array<{
      id: string;
      title: string;
      feature_id: string;
      feature_title?: string;
    }> = [];
    const seen = new Set<string>();
    const patterns = [params.query, `${params.query}%`, `%${params.query}%`];

    for (const pattern of patterns) {
      const data = await this.fetchRows<any>(
        this.db
          .from('roadmap_tasks')
          .select(
            'id, title, feature_id, roadmap_features!inner(roadmap_id, title)',
          )
          .eq('roadmap_features.roadmap_id', params.roadmapId)
          .ilike('title', pattern)
          .order('title', { ascending: true })
          .limit(params.scanLimit),
      );
      this.appendUniqueRows(
        rows,
        seen,
        data.flatMap((task) => {
          if (!task?.id || !task?.feature_id) return [];
          const feature = Array.isArray(task.roadmap_features)
            ? task.roadmap_features[0]
            : task.roadmap_features;
          return [
            {
              id: String(task.id),
              title: String(task.title ?? 'Untitled task'),
              feature_id: String(task.feature_id),
              feature_title:
                feature?.title == null ? undefined : String(feature.title),
            },
          ];
        }),
        params.scanLimit,
      );
      if (rows.length >= params.scanLimit) {
        return this.sortByTitleAndId(rows).slice(0, params.scanLimit);
      }
    }

    if (rows.length < params.scanLimit) {
      const data = await this.fetchRows<any>(
        this.db
          .from('roadmap_tasks')
          .select(
            'id, title, feature_id, roadmap_features!inner(roadmap_id, title)',
          )
          .eq('roadmap_features.roadmap_id', params.roadmapId)
          .order('title', { ascending: true })
          .limit(params.scanLimit),
      );
      this.appendUniqueRows(
        rows,
        seen,
        data.flatMap((task) => {
          if (!task?.id || !task?.feature_id) return [];
          const feature = Array.isArray(task.roadmap_features)
            ? task.roadmap_features[0]
            : task.roadmap_features;
          return [
            {
              id: String(task.id),
              title: String(task.title ?? 'Untitled task'),
              feature_id: String(task.feature_id),
              feature_title:
                feature?.title == null ? undefined : String(feature.title),
            },
          ];
        }),
        params.scanLimit,
      );
    }

    return this.sortByTitleAndId(rows).slice(0, params.scanLimit);
  }

  private appendUniqueRows<T extends { id?: string }>(
    target: T[],
    seen: Set<string>,
    source: T[],
    maxRows: number,
  ): void {
    for (const item of source) {
      if (!item?.id) continue;
      const key = String(item.id);
      if (seen.has(key)) continue;
      target.push(item);
      seen.add(key);
      if (target.length >= maxRows) break;
    }
  }

  private sortByTitleAndId<T extends { id?: string; title?: string }>(
    rows: T[],
  ): T[] {
    return [...rows].sort((a, b) => {
      const aTitle = String(a.title ?? '');
      const bTitle = String(b.title ?? '');
      if (aTitle !== bTitle) return aTitle.localeCompare(bTitle);
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
  }

  private async fetchRows<T>(query: any): Promise<T[]> {
    const { data, error } = await query;
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
      .select('id, roadmap_id, epic_id, title, position')
      .in('roadmap_id', roadmapIds)
      .order('position', { ascending: true });
    if (featuresError) throw new Error(featuresError.message);

    // Step 4: fetch milestones for those roadmaps
    const { data: milestones, error: milestonesError } = await this.db
      .from('roadmap_milestones')
      .select('id, roadmap_id, title, target_date, status, position')
      .in('roadmap_id', roadmapIds)
      .order('position', { ascending: true });
    if (milestonesError) throw new Error(milestonesError.message);

    // Step 5: fetch tasks for those features (if any)
    const featureIds = (features ?? []).map((f) => f.id);
    let tasks: any[] = [];
    if (featureIds.length > 0) {
      const { data: taskData, error: tasksError } = await this.db
        .from('roadmap_tasks')
        .select(
          'id, feature_id, title, assignee_id, position, status, due_date, updated_at, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name)',
        )
        .in('feature_id', featureIds)
        .order('position', { ascending: true });
      if (tasksError) throw new Error(tasksError.message);
      tasks = taskData ?? [];
    }

    // Step 6: assemble nested structure
    const milestonesByRoadmap = (milestones ?? []).reduce<
      Record<string, any[]>
    >((acc, milestone) => {
      (acc[milestone.roadmap_id] ??= []).push(milestone);
      return acc;
    }, {});

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
      milestones: milestonesByRoadmap[roadmap.id] ?? [],
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
      .select('id, roadmap_id, epic_id, title, position')
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
