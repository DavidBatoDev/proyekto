import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectsService } from '../../projects/projects.service';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';

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

  private async getRoadmapIdByEpicId(epicId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('roadmap_epics')
      .select('roadmap_id')
      .eq('id', epicId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.roadmap_id as string | null | undefined) ?? null;
  }

  private async getRoadmapIdByFeatureId(
    featureId: string,
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select('roadmap_id')
      .eq('id', featureId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.roadmap_id as string | null | undefined) ?? null;
  }

  private async getFeatureIdByTaskId(taskId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select('feature_id')
      .eq('id', taskId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.feature_id as string | null | undefined) ?? null;
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
    if (ref.epicId) return this.getRoadmapIdByEpicId(ref.epicId);
    if (ref.featureId) return this.getRoadmapIdByFeatureId(ref.featureId);
    if (ref.taskId) {
      const featureId = await this.getFeatureIdByTaskId(ref.taskId);
      return featureId ? this.getRoadmapIdByFeatureId(featureId) : null;
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

  async assertRoadmapPermission(
    roadmapId: string,
    userId: string,
    permission:
      | 'roadmap.edit'
      | 'roadmap.create_tasks'
      | 'roadmap.edit_tasks'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote',
  ): Promise<void> {
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
      return;
    }

    await this.projectsService.assertProjectPermission(
      roadmap.project_id,
      userId,
      permission,
    );
  }

  async assertProjectRoadmapPermission(
    projectId: string,
    userId: string,
    permission:
      | 'roadmap.edit'
      | 'roadmap.create_tasks'
      | 'roadmap.edit_tasks'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote',
  ): Promise<void> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      permission,
    );
  }

  async assertMilestonePermission(
    milestoneId: string,
    userId: string,
    permission:
      | 'roadmap.edit'
      | 'roadmap.create_tasks'
      | 'roadmap.edit_tasks'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote',
  ): Promise<void> {
    const roadmapId = await this.getRoadmapIdByMilestoneId(milestoneId);
    if (!roadmapId) throw new NotFoundException('Milestone not found');
    await this.assertRoadmapPermission(roadmapId, userId, permission);
  }

  async assertEpicPermission(
    epicId: string,
    userId: string,
    permission:
      | 'roadmap.edit'
      | 'roadmap.create_tasks'
      | 'roadmap.edit_tasks'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote',
  ): Promise<void> {
    const roadmapId = await this.getRoadmapIdByEpicId(epicId);
    if (!roadmapId) throw new NotFoundException('Epic not found');
    await this.assertRoadmapPermission(roadmapId, userId, permission);
  }

  async assertFeaturePermission(
    featureId: string,
    userId: string,
    permission:
      | 'roadmap.edit'
      | 'roadmap.create_tasks'
      | 'roadmap.edit_tasks'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote',
  ): Promise<void> {
    const roadmapId = await this.getRoadmapIdByFeatureId(featureId);
    if (!roadmapId) throw new NotFoundException('Feature not found');
    await this.assertRoadmapPermission(roadmapId, userId, permission);
  }

  async assertTaskPermission(
    taskId: string,
    userId: string,
    permission:
      | 'roadmap.edit'
      | 'roadmap.create_tasks'
      | 'roadmap.edit_tasks'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote',
  ): Promise<void> {
    const featureId = await this.getFeatureIdByTaskId(taskId);
    if (!featureId) throw new NotFoundException('Task not found');
    await this.assertFeaturePermission(featureId, userId, permission);
  }

  async assertRoadmapCommentPermission(
    roadmapId: string,
    userId: string,
  ): Promise<void> {
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
      return;
    }

    await this.projectsService.assertProjectAnyPermission(
      roadmap.project_id,
      userId,
      ['roadmap.comment', 'roadmap.edit'],
    );
  }

  async assertProjectRoadmapCommentPermission(
    projectId: string,
    userId: string,
  ): Promise<void> {
    await this.projectsService.assertProjectAnyPermission(projectId, userId, [
      'roadmap.comment',
      'roadmap.edit',
    ]);
  }

  async assertEpicCommentPermission(
    epicId: string,
    userId: string,
  ): Promise<void> {
    const roadmapId = await this.getRoadmapIdByEpicId(epicId);
    if (!roadmapId) throw new NotFoundException('Epic not found');
    await this.assertRoadmapCommentPermission(roadmapId, userId);
  }

  async assertFeatureCommentPermission(
    featureId: string,
    userId: string,
  ): Promise<void> {
    const roadmapId = await this.getRoadmapIdByFeatureId(featureId);
    if (!roadmapId) throw new NotFoundException('Feature not found');
    await this.assertRoadmapCommentPermission(roadmapId, userId);
  }

  async assertTaskCommentPermission(
    taskId: string,
    userId: string,
  ): Promise<void> {
    const featureId = await this.getFeatureIdByTaskId(taskId);
    if (!featureId) throw new NotFoundException('Task not found');
    await this.assertFeatureCommentPermission(featureId, userId);
  }
}
