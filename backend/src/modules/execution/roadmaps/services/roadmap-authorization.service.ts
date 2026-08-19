import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { ProjectsService } from '../../projects/projects.service';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import type { ProjectPermissions } from '../../projects/permissions/project-permissions';

/**
 * Roadmap-scoped capabilities the authorization walkers accept. A subset of the
 * project `PermissionPath` catalog. `roadmap.assign` is distinct from
 * `roadmap.edit` so a per-user override can grant task editing while withholding
 * the ability to (un)assign members.
 */
export type RoadmapPermission =
  | 'roadmap.edit'
  | 'roadmap.assign'
  | 'roadmap.create_tasks'
  | 'roadmap.edit_tasks'
  | 'roadmap.view_internal'
  | 'roadmap.comment'
  | 'roadmap.promote';

/**
 * Everything the parent-chain walk resolved on the way to a permission verdict.
 *
 * The walkers used to return `void`, so every caller that needed the owning
 * roadmap (to address the realtime room) re-ran the exact same lookups right
 * after the assert. Returning the scope instead deletes those duplicate
 * round-trips and gives write services the project id they need to record
 * activity without paying for it.
 */
export interface RoadmapWriteContext {
  roadmapId: string;
  /** null for a personal roadmap — there is no project to log or notify against. */
  projectId: string | null;
  ownerId: string | null;
  /** Resolved permission set, or null for a personal roadmap (owner-only check). */
  permissions: ProjectPermissions | null;
  /**
   * Title of the epic/feature/task the walk started from, when it started from
   * one. Carried for the same reason the rest of this context is: the scope
   * walk already reads the row, so a caller that needs the title for a
   * human-facing message (mention notifications say "in <title>") should not
   * pay for a second round-trip. Undefined on roadmap- or project-first walks,
   * which have no single entity to name.
   */
  entityTitle?: string | null;
}

/** Task walks additionally resolve the parent feature. */
export interface TaskWriteContext extends RoadmapWriteContext {
  featureId: string;
}

/** Scope for the project-first entry points, which have no roadmap in hand. */
export interface ProjectWriteContext {
  projectId: string;
  permissions: ProjectPermissions;
}

@Injectable()
export class RoadmapAuthorizationService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly projectsService: ProjectsService,
  ) {}

  private async getRoadmapMeta(roadmapId: string): Promise<{
    project_id: string | null;
    owner_id: string | null;
  } | null> {
    const { data, error } = await this.db
      .from('roadmaps')
      .select('project_id, owner_id')
      .eq('id', roadmapId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
      project_id: (data.project_id as string | null | undefined) ?? null,
      owner_id: (data.owner_id as string | null | undefined) ?? null,
    };
  }

  private async getRoadmapIdByMilestoneId(
    milestoneId: string,
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from('roadmap_milestones')
      .select('roadmap_id')
      .eq('id', milestoneId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.roadmap_id as string | null | undefined) ?? null;
  }

  /**
   * Resolve an epic's owning roadmap AND its title in one query. The title is
   * free here (same row, one more column) and saves mention notifications a
   * second read to name the thing they link to.
   */
  private async getEpicScope(
    epicId: string,
  ): Promise<{ roadmapId: string | null; title: string | null } | null> {
    const { data, error } = await this.db
      .from('roadmap_epics')
      .select('roadmap_id, title')
      .eq('id', epicId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      roadmapId: (data.roadmap_id as string | null | undefined) ?? null,
      title: (data.title as string | null | undefined) ?? null,
    };
  }

  /** Feature equivalent of `getEpicScope`. */
  private async getFeatureScope(
    featureId: string,
  ): Promise<{ roadmapId: string | null; title: string | null } | null> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select('roadmap_id, title')
      .eq('id', featureId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      roadmapId: (data.roadmap_id as string | null | undefined) ?? null,
      title: (data.title as string | null | undefined) ?? null,
    };
  }

  private async getFeatureIdByTaskId(taskId: string): Promise<string | null> {
    const scope = await this.getTaskScope(taskId);
    return scope?.featureId ?? null;
  }

  /**
   * Resolve a task's parent feature AND roadmap in a single query.
   * `roadmap_features.roadmap_id` is denormalized (the activity-cascade
   * triggers rely on the same shortcut), so the task -> feature -> roadmap
   * walk does not need two sequential round-trips.
   */
  private async getTaskScope(taskId: string): Promise<{
    featureId: string;
    roadmapId: string | null;
    title: string | null;
  } | null> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(
        'feature_id, title, feature:roadmap_features!roadmap_tasks_feature_id_fkey(roadmap_id)',
      )
      .eq('id', taskId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const featureId = (data?.feature_id as string | null | undefined) ?? null;
    if (!featureId) return null;

    // PostgREST types a to-one embed as an object, but the generated client
    // widens it to a possible array — normalize both shapes.
    const embedded = (data as { feature?: unknown } | null)?.feature;
    const feature = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { roadmap_id?: string | null }
      | null
      | undefined;

    return {
      featureId,
      roadmapId: feature?.roadmap_id ?? null,
      title: (data?.title as string | null | undefined) ?? null,
    };
  }

  /**
   * Resolve the project_id that owns the given roadmap. Returns null if the
   * roadmap is not found or is not attached to a project (personal roadmaps).
   */
  async resolveProjectId(roadmapId: string): Promise<string | null> {
    const meta = await this.getRoadmapMeta(roadmapId);
    return meta?.project_id ?? null;
  }

  /**
   * Resolve the owning roadmap id from whichever entity id is available.
   * Used by write services to address the realtime room. Reuses the same
   * lookups the permission checks walk. Returns null if nothing resolves.
   */
  async resolveRoadmapId(ref: {
    roadmapId?: string | null;
    milestoneId?: string | null;
    epicId?: string | null;
    featureId?: string | null;
    taskId?: string | null;
  }): Promise<string | null> {
    if (ref.roadmapId) return ref.roadmapId;
    if (ref.milestoneId) return this.getRoadmapIdByMilestoneId(ref.milestoneId);
    if (ref.epicId)
      return (await this.getEpicScope(ref.epicId))?.roadmapId ?? null;
    if (ref.featureId)
      return (await this.getFeatureScope(ref.featureId))?.roadmapId ?? null;
    if (ref.taskId) {
      const scope = await this.getTaskScope(ref.taskId);
      return scope?.roadmapId ?? null;
    }
    return null;
  }

  /**
   * Can this user VIEW the roadmap (owner, or a member of its project)? Mirrors
   * the access scoping in RoadmapsRepository.findFull — i.e. exactly who can
   * load the roadmap — so the realtime collab room is joinable by every viewer,
   * not just editors. Cheap: one roadmap-meta read + one project_access probe.
   */
  async canViewRoadmap(roadmapId: string, userId: string): Promise<boolean> {
    const roadmap = await this.getRoadmapMeta(roadmapId);
    return this.canViewResolvedRoadmap(roadmap, userId);
  }

  /** View check against already-loaded meta, so callers holding it don't re-read. */
  private async canViewResolvedRoadmap(
    roadmap: { project_id: string | null; owner_id: string | null } | null,
    userId: string,
  ): Promise<boolean> {
    if (!roadmap) return false;
    if (roadmap.owner_id === userId) return true;
    if (!roadmap.project_id) return false;

    const { data, error } = await this.db
      .from('project_access')
      .select('id')
      .eq('project_id', roadmap.project_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return false;
    return !!data;
  }

  /**
   * Narrow a set of user ids to those who can actually VIEW the roadmap.
   *
   * Mention targets arrive as client-supplied `data-user-id` attributes inside
   * comment HTML, so they are untrusted input: without this filter a crafted
   * comment notifies any user id the author cares to type, whether or not that
   * person can see the roadmap. Chat already does the equivalent check against
   * room membership (see ChatService.fireMentionNotifications) — this is the
   * roadmap-side counterpart.
   *
   * One meta read plus one bulk probe, regardless of how many ids come in.
   */
  async filterUsersWhoCanViewRoadmap(
    roadmapId: string,
    userIds: string[],
  ): Promise<string[]> {
    const unique = Array.from(new Set(userIds));
    if (unique.length === 0) return [];

    const roadmap = await this.getRoadmapMeta(roadmapId);
    if (!roadmap) return [];

    const allowed = new Set<string>();
    // The owner always qualifies, including on a personal roadmap that has no
    // project_access rows at all.
    if (roadmap.owner_id && unique.includes(roadmap.owner_id)) {
      allowed.add(roadmap.owner_id);
    }
    if (!roadmap.project_id) return Array.from(allowed);

    const { data, error } = await this.db
      .from('project_access')
      .select('user_id')
      .eq('project_id', roadmap.project_id)
      .in('user_id', unique);

    // Fail closed: a probe error must not turn into "notify everyone".
    if (error) return Array.from(allowed);

    for (const row of data ?? []) {
      const id = (row as { user_id?: string | null }).user_id;
      if (id) allowed.add(id);
    }
    return Array.from(allowed);
  }

  /**
   * Assert VIEW-level access to a roadmap. 404 on denial so we never leak the
   * existence of a roadmap the caller cannot see. Use for read endpoints.
   */
  async assertCanViewRoadmap(roadmapId: string, userId: string): Promise<void> {
    const ok = await this.canViewRoadmap(roadmapId, userId);
    if (!ok) throw new NotFoundException('Roadmap not found');
  }

  /**
   * View-level authorization resolved from whichever child id is available
   * (task/feature/epic/milestone/roadmap) — mirrors the write-side assert*
   * walkers but only requires that the caller can VIEW the owning roadmap.
   * 404 on an unresolvable ref or a roadmap the caller cannot see.
   */
  async assertViewPermission(
    ref: {
      roadmapId?: string | null;
      milestoneId?: string | null;
      epicId?: string | null;
      featureId?: string | null;
      taskId?: string | null;
    },
    userId: string,
  ): Promise<RoadmapWriteContext> {
    const roadmapId = await this.resolveRoadmapId(ref);
    if (!roadmapId) throw new NotFoundException('Not found');

    // Load meta once and reuse it for both the view verdict and the returned
    // scope — assertCanViewRoadmap would read the same row a second time.
    const meta = await this.getRoadmapMeta(roadmapId);
    const ok = await this.canViewResolvedRoadmap(meta, userId);
    if (!ok) throw new NotFoundException('Roadmap not found');

    return {
      roadmapId,
      projectId: meta?.project_id ?? null,
      ownerId: meta?.owner_id ?? null,
      permissions: null,
    };
  }

  async assertRoadmapPermission(
    roadmapId: string,
    userId: string,
    permission: RoadmapPermission,
  ): Promise<RoadmapWriteContext> {
    const roadmap = await this.getRoadmapMeta(roadmapId);

    if (!roadmap) {
      throw new NotFoundException('Roadmap not found');
    }

    if (!roadmap.project_id) {
      if (roadmap.owner_id !== userId) {
        throw new MissingPermissionException({
          path: null,
          requiredRole: 'owner',
          label: 'edit this roadmap',
        });
      }
      return {
        roadmapId,
        projectId: null,
        ownerId: roadmap.owner_id,
        permissions: null,
      };
    }

    const permissions = await this.projectsService.assertProjectPermission(
      roadmap.project_id,
      userId,
      permission,
    );

    return {
      roadmapId,
      projectId: roadmap.project_id,
      ownerId: roadmap.owner_id,
      permissions,
    };
  }

  async assertProjectRoadmapPermission(
    projectId: string,
    userId: string,
    permission: RoadmapPermission,
  ): Promise<ProjectWriteContext> {
    const permissions = await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      permission,
    );
    return { projectId, permissions };
  }

  async assertMilestonePermission(
    milestoneId: string,
    userId: string,
    permission: RoadmapPermission,
  ): Promise<RoadmapWriteContext> {
    const roadmapId = await this.getRoadmapIdByMilestoneId(milestoneId);
    if (!roadmapId) throw new NotFoundException('Milestone not found');
    return this.assertRoadmapPermission(roadmapId, userId, permission);
  }

  async assertEpicPermission(
    epicId: string,
    userId: string,
    permission: RoadmapPermission,
  ): Promise<RoadmapWriteContext> {
    const scope = await this.getEpicScope(epicId);
    if (!scope?.roadmapId) throw new NotFoundException('Epic not found');
    const ctx = await this.assertRoadmapPermission(
      scope.roadmapId,
      userId,
      permission,
    );
    return { ...ctx, entityTitle: scope.title };
  }

  async assertFeaturePermission(
    featureId: string,
    userId: string,
    permission: RoadmapPermission,
  ): Promise<RoadmapWriteContext> {
    const scope = await this.getFeatureScope(featureId);
    if (!scope?.roadmapId) throw new NotFoundException('Feature not found');
    const ctx = await this.assertRoadmapPermission(
      scope.roadmapId,
      userId,
      permission,
    );
    return { ...ctx, entityTitle: scope.title };
  }

  async assertTaskPermission(
    taskId: string,
    userId: string,
    permission: RoadmapPermission,
  ): Promise<TaskWriteContext> {
    // One query resolves both parents (see getTaskScope), so this walk costs
    // two round-trips instead of the three the feature-delegating form took.
    const scope = await this.getTaskScope(taskId);
    if (!scope) throw new NotFoundException('Task not found');
    if (!scope.roadmapId) throw new NotFoundException('Feature not found');
    const ctx = await this.assertRoadmapPermission(
      scope.roadmapId,
      userId,
      permission,
    );
    return { ...ctx, featureId: scope.featureId, entityTitle: scope.title };
  }

  async assertRoadmapCommentPermission(
    roadmapId: string,
    userId: string,
  ): Promise<RoadmapWriteContext> {
    const roadmap = await this.getRoadmapMeta(roadmapId);

    if (!roadmap) {
      throw new NotFoundException('Roadmap not found');
    }

    if (!roadmap.project_id) {
      if (roadmap.owner_id !== userId) {
        throw new MissingPermissionException({
          path: null,
          requiredRole: 'owner',
          label: 'edit this roadmap',
        });
      }
      return {
        roadmapId,
        projectId: null,
        ownerId: roadmap.owner_id,
        permissions: null,
      };
    }

    const permissions = await this.projectsService.assertProjectAnyPermission(
      roadmap.project_id,
      userId,
      ['roadmap.comment', 'roadmap.edit'],
    );

    return {
      roadmapId,
      projectId: roadmap.project_id,
      ownerId: roadmap.owner_id,
      permissions,
    };
  }

  async assertProjectRoadmapCommentPermission(
    projectId: string,
    userId: string,
  ): Promise<ProjectWriteContext> {
    const permissions = await this.projectsService.assertProjectAnyPermission(
      projectId,
      userId,
      ['roadmap.comment', 'roadmap.edit'],
    );
    return { projectId, permissions };
  }

  async assertEpicCommentPermission(
    epicId: string,
    userId: string,
  ): Promise<RoadmapWriteContext> {
    const scope = await this.getEpicScope(epicId);
    if (!scope?.roadmapId) throw new NotFoundException('Epic not found');
    const ctx = await this.assertRoadmapCommentPermission(
      scope.roadmapId,
      userId,
    );
    return { ...ctx, entityTitle: scope.title };
  }

  async assertFeatureCommentPermission(
    featureId: string,
    userId: string,
  ): Promise<RoadmapWriteContext> {
    const scope = await this.getFeatureScope(featureId);
    if (!scope?.roadmapId) throw new NotFoundException('Feature not found');
    const ctx = await this.assertRoadmapCommentPermission(
      scope.roadmapId,
      userId,
    );
    return { ...ctx, entityTitle: scope.title };
  }

  async assertTaskCommentPermission(
    taskId: string,
    userId: string,
  ): Promise<TaskWriteContext> {
    const scope = await this.getTaskScope(taskId);
    if (!scope) throw new NotFoundException('Task not found');
    if (!scope.roadmapId) throw new NotFoundException('Feature not found');
    const ctx = await this.assertRoadmapCommentPermission(
      scope.roadmapId,
      userId,
    );
    return { ...ctx, featureId: scope.featureId, entityTitle: scope.title };
  }
}
