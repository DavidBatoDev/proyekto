import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { ProjectsRepository } from './projects.repository.interface';
import {
  Project,
  ProjectResourceFolder,
  ProjectResourceLink,
} from '../../../../common/entities';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectResourceFolderDto,
  CreateProjectResourceLinkDto,
  InviteProjectByEmailDto,
  ProjectInviteQueryDto,
  ReorderProjectResourceFoldersDto,
  ReorderProjectResourceLinksDto,
  RespondProjectInviteDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateProjectMemberPermissionsDto,
  UpdateProjectResourceFolderDto,
  UpdateProjectResourceLinkDto,
} from '../dto/project.dto';
import type { ProjectPermissions } from '../permissions/project-permissions';
import type {
  DashboardProject,
  ProjectResourceFolderWithLinks,
  ProjectResourcesPayload,
  ProjectRoadmapSummary,
} from './projects.repository.interface';
import { isActiveConsultantEnrollment } from '../../../../common/auth/consultant-capability';
import {
  type ProjectRole,
  roleSatisfies,
} from '../authorization/project-authorization.service';

const PROJECT_MEMBER_SELECT =
  'members:project_access(user_id, role, origin, has_direct_grant, granted_at, user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, headline, email))';

// Mirrors get_task_progress in the roadmap canvas schema so the dashboard
// progress bar agrees with the canvas cascade.
const TASK_STATUS_PROGRESS: Record<string, number> = {
  todo: 0,
  in_progress: 25,
  in_review: 75,
  done: 100,
  blocked: 0,
};

type RoadmapSummaryRow = {
  id: string;
  name: string;
  project_id: string | null;
  updated_at: string;
  epics?: Array<{
    id: string;
    features?: Array<{
      id: string;
      tasks?: Array<{ status: string }>;
    }>;
  }>;
};

const average = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

function buildRoadmapSummary(row: RoadmapSummaryRow): ProjectRoadmapSummary {
  const epics = row.epics ?? [];
  let featureCount = 0;
  let taskCount = 0;
  let doneTaskCount = 0;

  const epicProgress = epics.map((epic) => {
    const features = epic.features ?? [];
    featureCount += features.length;
    const featureProgress = features.map((feature) => {
      const tasks = feature.tasks ?? [];
      taskCount += tasks.length;
      doneTaskCount += tasks.filter((task) => task.status === 'done').length;
      return average(
        tasks.map((task) => TASK_STATUS_PROGRESS[task.status] ?? 0),
      );
    });
    return average(featureProgress);
  });

  return {
    roadmap_id: row.id,
    name: row.name,
    epic_count: epics.length,
    feature_count: featureCount,
    task_count: taskCount,
    done_task_count: doneTaskCount,
    progress: Math.round(average(epicProgress)),
  };
}

@Injectable()
export class SupabaseProjectsRepository implements ProjectsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getCreatorProfileForProjectCreation(
    userId: string,
  ): Promise<{ id: string } | null> {
    // Existence only. The consultant-capability embed that used to ride along
    // here moved to ProjectAuthorizationService.isActiveConsultant, so this
    // query no longer touches a marketplace table.
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return { id: data.id as string };
  }

  private toProjectsTablePayload(
    dto: CreateProjectDto | UpdateProjectDto,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (dto.title !== undefined) payload.title = dto.title;
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.duration !== undefined) payload.duration = dto.duration;
    if (dto.currency !== undefined)
      payload.currency = dto.currency.toUpperCase() || 'USD';

    return payload;
  }

  async findByUser(userId: string): Promise<Project[]> {
    // Slice 3b: project membership lives in project_shares.
    const { data } = await this.supabase
      .from('project_access')
      .select(
        `project:projects(*, owner:profiles!projects_owner_id_fkey(id, display_name, avatar_url, email), ${PROJECT_MEMBER_SELECT})`,
      )
      .eq('user_id', userId);

    return (data || [])
      .map((r: Record<string, unknown>) => r.project)
      .filter(Boolean) as Project[];
  }

  async findDashboardByUser(userId: string): Promise<DashboardProject[]> {
    const [ownedResult, memberResult] = await Promise.all([
      this.supabase
        .from('projects')
        .select(
          `*, owner:profiles!projects_owner_id_fkey(id, display_name, avatar_url, email), ${PROJECT_MEMBER_SELECT}`,
        )
        .eq('owner_id', userId),
      // Slice 3b: project_shares is the source of truth for membership.
      this.supabase
        .from('project_access')
        .select(
          `project:projects(*, owner:profiles!projects_owner_id_fkey(id, display_name, avatar_url, email), ${PROJECT_MEMBER_SELECT})`,
        )
        .eq('user_id', userId),
    ]);

    if (ownedResult.error) {
      throw new Error(ownedResult.error.message);
    }

    if (memberResult.error) {
      throw new Error(memberResult.error.message);
    }

    const memberProjects = (memberResult.data || [])
      .map((row: Record<string, unknown>) => row.project)
      .filter(Boolean) as Project[];

    const ownedProjects = (ownedResult.data || []) as unknown as Project[];

    const deduped = new Map<string, DashboardProject>();
    for (const project of [...ownedProjects, ...memberProjects]) {
      deduped.set(project.id, project);
    }

    const summaries = await this.fetchRoadmapSummaries(
      Array.from(deduped.keys()),
    );
    for (const project of deduped.values()) {
      project.roadmap_summary = summaries.get(project.id) ?? null;
    }

    return Array.from(deduped.values()).sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }

  /**
   * One aggregate query for the dashboard: every linked roadmap with just the
   * ids/statuses needed to derive counts and cascade progress. When a project
   * has several roadmaps, the most recently updated one represents it.
   */
  private async fetchRoadmapSummaries(
    projectIds: string[],
  ): Promise<Map<string, ProjectRoadmapSummary>> {
    const summaries = new Map<string, ProjectRoadmapSummary>();
    if (projectIds.length === 0) return summaries;

    const { data, error } = await this.supabase
      .from('roadmaps')
      .select(
        'id, name, project_id, updated_at, epics:roadmap_epics(id, features:roadmap_features(id, tasks:roadmap_tasks(status)))',
      )
      .in('project_id', projectIds);

    if (error || !data) return summaries;

    const latestByProject = new Map<string, RoadmapSummaryRow>();
    for (const row of data as unknown as RoadmapSummaryRow[]) {
      if (!row.project_id) continue;
      const current = latestByProject.get(row.project_id);
      if (!current || row.updated_at > current.updated_at) {
        latestByProject.set(row.project_id, row);
      }
    }

    for (const [projectId, row] of latestByProject) {
      summaries.set(projectId, buildRoadmapSummary(row));
    }
    return summaries;
  }

  async findById(id: string): Promise<
    | (Project & {
        client?: unknown;
        consultant?: unknown;
        members?: unknown[];
      })
    | null
  > {
    // Slice 3b: members are sourced from project_shares. The legacy
    // `position` and `permissions_json` fields are dropped from the response
    // shape — UI uses display_name + role instead. We synthesize a `role`
    // text matching the legacy values where downstream code still expects
    // those strings (consultant/client/member); see the post-query mapping.
    const { data, error } = await this.supabase
      .from('projects')
      .select(
        `
        *,
        owner:profiles!projects_owner_id_fkey(id, display_name, avatar_url, headline, email),
        members:project_access(id, project_id, user_id, role, origin, has_direct_grant, position, capabilities, granted_at, user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name))
      `,
      )
      .eq('id', id)
      .single();

    if (error || !data) return null;

    return data as Project & { members?: unknown[] };
  }

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    const projectPayload = this.toProjectsTablePayload(dto);

    const { data: project, error } = (await this.supabase
      .from('projects')
      .insert({
        ...projectPayload,
        owner_id: userId,
      })
      .select()
      .single()) as unknown as {
      data: Project | null;
      error: { message: string } | null;
    };

    if (error || !project)
      throw new Error(error?.message ?? 'Failed to create project');

    const summary = dto.description?.trim();
    if (summary) {
      const { error: briefError } = (await this.supabase
        .from('project_briefs')
        .insert({
          project_id: project.id,
          project_summary: summary,
          custom_fields: [],
          updated_by: userId,
          version: 1,
        })) as unknown as { error: { message: string } | null };
      if (briefError) {
        await this.supabase.from('projects').delete().eq('id', project.id);
        throw new Error(briefError.message || 'Failed to create project brief');
      }
    }

    // Slice 3b: project_members write removed. project_shares write happens
    // in ProjectsService.createProject (admin role for client mode, owner
    // role for consultant mode) via ProjectAuthorizationService.grant.

    return project;
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    const projectPayload = this.toProjectsTablePayload(dto);

    if (Object.keys(projectPayload).length === 0) {
      const existing = await this.findById(id);
      if (!existing) {
        throw new NotFoundException('Project not found');
      }
      return existing as Project;
    }

    const { data, error } = await this.supabase
      .from('projects')
      .update(projectPayload)
      .eq('id', id)
      .select('id')
      .single();
    if (error || !data)
      throw new Error(error?.message ?? 'Failed to update project');
    const updated = await this.findById(id);
    if (!updated) throw new NotFoundException('Project not found');
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('projects')
      .delete()
      .eq('id', id);

    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to delete project.',
      );
    }
  }

  async transferOwner(
    projectId: string,
    previousOwnerId: string,
    newOwnerId: string,
  ): Promise<Project> {
    const { data: targetProfile, error: targetProfileError } =
      await this.supabase
        .from('profiles')
        .select('id')
        .eq('id', newOwnerId)
        .maybeSingle();

    if (targetProfileError || !targetProfile) {
      throw new NotFoundException('Target owner profile not found');
    }

    const { data: currentProject, error: currentProjectError } =
      await this.supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .single();

    if (currentProjectError || !currentProject) {
      throw new NotFoundException('Project not found');
    }

    const { data: updatedProject, error: updateProjectError } =
      await this.supabase
        .from('projects')
        .update({ owner_id: newOwnerId })
        .eq('id', projectId)
        .select('id')
        .single();

    if (updateProjectError || !updatedProject) {
      throw new BadRequestException(
        updateProjectError?.message || 'Failed to transfer project owner.',
      );
    }

    // Slice 3b: project_members syncing dropped. project_shares is the
    // source of truth and is updated at the service layer via
    // ProjectAuthorizationService.grant/revoke on transferOwner.
    const updated = await this.findById(projectId);
    if (!updated) throw new NotFoundException('Project not found');
    return updated;
  }

  async isOwner(projectId: string, userId: string): Promise<boolean> {
    const [projectResult, accessResult] = await Promise.all([
      this.supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('owner_id', userId)
        .maybeSingle(),
      this.supabase
        .from('project_access')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId),
    ]);
    if (projectResult.data) return true;
    return (accessResult.data ?? []).some((row) =>
      roleSatisfies(row.role as ProjectRole, 'owner'),
    );
  }

  async isActiveConsultant(userId: string): Promise<boolean> {
    return isActiveConsultantEnrollment(this.supabase, userId);
  }

  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
  ): Promise<unknown> {
    const { data: projectRow } = await this.supabase
      .from('projects')
      .select('id, owner_id')
      .eq('id', projectId)
      .single();

    if (!projectRow) {
      throw new NotFoundException('Project not found');
    }

    let userId: string | null = null;

    if (dto.email) {
      // Resolve user by email
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('id')
        .eq('email', dto.email)
        .single();

      if (!profile) {
        throw new NotFoundException(
          `No registered user found with email ${dto.email}`,
        );
      }
      userId = profile.id as string;
    }

    // Slice 3b: addMember writes a project_shares row directly. Default
    // role for direct adds (vs invite-accept) is `editor`. The caller's
    // controller endpoint should validate they have admin+ role.
    if (!userId) {
      throw new BadRequestException(
        'addMember requires a registered user — invite by email instead.',
      );
    }
    const { data, error } = await this.supabase
      .from('project_access')
      .insert({
        project_id: projectId,
        user_id: userId,
        role: 'editor',
        origin: 'invited',
      })
      .select(
        'id, project_id, user_id, role, origin, has_direct_grant, position, capabilities, granted_at, user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)',
      )
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getProfileDisplayName(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return null;

    const displayName =
      typeof data.display_name === 'string' ? data.display_name.trim() : '';
    if (displayName) return displayName;

    const firstName =
      typeof data.first_name === 'string' ? data.first_name.trim() : '';
    const lastName =
      typeof data.last_name === 'string' ? data.last_name.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    const email = typeof data.email === 'string' ? data.email.trim() : '';
    return email || null;
  }

  async getInviterProfile(
    userId: string,
  ): Promise<{ displayName: string | null; avatarUrl: string | null }> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return { displayName: null, avatarUrl: null };

    const displayName =
      (typeof data.display_name === 'string' && data.display_name.trim()) ||
      `${typeof data.first_name === 'string' ? data.first_name.trim() : ''} ${
        typeof data.last_name === 'string' ? data.last_name.trim() : ''
      }`.trim() ||
      (typeof data.email === 'string' ? data.email.trim() : '') ||
      null;

    const avatarUrl =
      typeof data.avatar_url === 'string' && data.avatar_url.trim().length > 0
        ? data.avatar_url.trim()
        : null;

    return { displayName, avatarUrl };
  }

  async inviteByEmail(
    projectId: string,
    invitedBy: string,
    dto: InviteProjectByEmailDto,
  ): Promise<unknown> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const memberRole = dto.role ?? 'member';
    const invitedPosition =
      memberRole === 'consultant' || memberRole === 'client'
        ? memberRole
        : dto.position?.trim() || 'Member';
    const inviteMessage = dto.message?.trim();

    if (!normalizedEmail) {
      throw new BadRequestException('Email is required.');
    }

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    const { data, error } = await this.supabase
      .from('project_invites')
      .upsert(
        {
          project_id: projectId,
          invited_by: invitedBy,
          invitee_id: (profile?.id as string | undefined) || null,
          invitee_email: normalizedEmail,
          invited_position: invitedPosition,
          default_role: dto.default_role ?? null,
          message:
            inviteMessage && inviteMessage.length > 0 ? inviteMessage : null,
          status: 'pending',
          updated_at: new Date().toISOString(),
          responded_at: null,
        },
        { onConflict: 'project_id,invitee_email' },
      )
      .select(
        'id, project_id, invited_by, invitee_id, invitee_email, invited_position, default_role, status, message, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      throw new BadRequestException(error?.message || 'Failed to send invite.');
    }

    return data;
  }

  async listProjectInvites(projectId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase
      .from('project_invites')
      .select(
        'id, project_id, invited_by, invitee_id, invitee_email, status, invited_position, created_at, inviter:profiles!project_invites_invited_by_fkey(id, display_name, avatar_url)',
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async cancelInvite(projectId: string, inviteId: string): Promise<void> {
    const { error } = await this.supabase
      .from('project_invites')
      .delete()
      .eq('id', inviteId)
      .eq('project_id', projectId)
      .eq('status', 'pending');

    if (error) throw new BadRequestException(error.message);
  }

  async listInvitesForUser(
    userId: string,
    query?: ProjectInviteQueryDto,
  ): Promise<unknown[]> {
    let dbQuery = this.supabase
      .from('project_invites')
      .select(
        'id, project_id, invited_by, invitee_id, invitee_email, invited_position, status, message, created_at, updated_at, responded_at',
      )
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false });

    if (query?.project_id) {
      dbQuery = dbQuery.eq('project_id', query.project_id);
    }

    const { data: invites, error } = await dbQuery;

    if (error) {
      throw new BadRequestException(error.message);
    }

    if (!invites?.length) {
      return [];
    }

    const projectIds = [...new Set(invites.map((invite) => invite.project_id))];
    const inviterIds = [...new Set(invites.map((invite) => invite.invited_by))];

    const [projectsRes, invitersRes] = await Promise.all([
      this.supabase
        .from('projects')
        .select('id, title, status')
        .in('id', projectIds),
      this.supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', inviterIds),
    ]);

    const projectById = new Map(
      (projectsRes.data || []).map((project) => [
        project.id as string,
        project,
      ]),
    );
    const inviterById = new Map(
      (invitersRes.data || []).map((inviter) => [
        inviter.id as string,
        inviter,
      ]),
    );

    return invites.map((invite) => ({
      ...invite,
      project: (() => {
        const project = projectById.get(invite.project_id as string);
        if (!project) return null;
        return {
          id: project.id as string,
          title: (project.title as string) || 'Untitled Project',
          status: (project.status as string) || 'unknown',
        };
      })(),
      inviter: (() => {
        const inviter = inviterById.get(invite.invited_by as string);
        if (!inviter) return null;
        return {
          id: inviter.id as string,
          display_name: (inviter.display_name as string | null) || null,
          avatar_url: (inviter.avatar_url as string | null) || null,
        };
      })(),
    }));
  }

  async respondInvite(
    userId: string,
    inviteId: string,
    dto: RespondProjectInviteDto,
  ): Promise<unknown> {
    const { data: invite, error: inviteError } = await this.supabase
      .from('project_invites')
      .select(
        'id, project_id, invited_by, invitee_id, invited_position, status',
      )
      .eq('id', inviteId)
      .single();

    if (inviteError || !invite) {
      throw new NotFoundException('Invite not found.');
    }

    if (invite.invitee_id !== userId) {
      throw new BadRequestException(
        'Only the invitee can respond to this invite.',
      );
    }

    if (invite.status !== 'pending') {
      throw new BadRequestException('Invite has already been responded to.');
    }

    const nowIso = new Date().toISOString();

    const { data: updatedInvite, error: updateError } = await this.supabase
      .from('project_invites')
      .update({ status: dto.status, responded_at: nowIso, updated_at: nowIso })
      .eq('id', inviteId)
      .select('id, project_id, invited_by, status')
      .single();

    if (updateError || !updatedInvite) {
      throw new BadRequestException(
        updateError?.message || 'Failed to update invite.',
      );
    }

    // Slice 3b: project_shares grant on accept now happens at the service
    // layer (ProjectsService.respondInvite calls ProjectAuthorizationService.
    // grant with the invite's default_role). Repository no longer writes
    // membership rows. Returning the updated invite is sufficient.
    return updatedInvite;
  }

  async updateMember(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<unknown> {
    // project_shares CRUD. memberId is the project_shares.id. Role updates
    // map legacy role names ('member'|'client'|'consultant') to share_role
    // values; passing a share_role directly also works. `position` is the
    // free-form display label restored as a real column.
    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) {
      const r = String(dto.role).toLowerCase();
      patch.role =
        r === 'consultant'
          ? 'owner'
          : r === 'client'
            ? 'admin'
            : r === 'member'
              ? 'editor'
              : r; // already a share_role value
    }
    if (dto.position !== undefined) {
      patch.position = dto.position?.trim() || null;
    }

    const selectShape =
      'id, project_id, user_id, role, origin, has_direct_grant, position, capabilities, granted_at, user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)';

    if (Object.keys(patch).length === 0) {
      const { data: current } = await this.supabase
        .from('project_access')
        .select(selectShape)
        .eq('id', memberId)
        .eq('project_id', projectId)
        .single();
      return current;
    }

    const { data, error } = await this.supabase
      .from('project_access')
      .update(patch)
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select(selectShape)
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Persist the capabilities JSONB delta on a project_shares row.
   * Used by updateMemberPermissions in projects.service after diffing
   * the desired ProjectPermissions against the (role, origin) baseline.
   */
  async updateMemberCapabilities(
    projectId: string,
    memberId: string,
    capabilities: Record<string, boolean>,
  ): Promise<unknown> {
    const { data, error } = await this.supabase
      .from('project_access')
      .update({ capabilities })
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select(
        'id, project_id, user_id, role, origin, has_direct_grant, position, capabilities, granted_at',
      )
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Update only the `position` label on a share row. Caller authorization
   * (self / admin / members.edit_position) is enforced in the service.
   */
  async updateMemberPosition(
    projectId: string,
    memberId: string,
    position: string | null,
  ): Promise<unknown> {
    const { data, error } = await this.supabase
      .from('project_access')
      .update({ position: position?.trim() || null })
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select(
        'id, project_id, user_id, role, origin, has_direct_grant, position, capabilities, granted_at',
      )
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    // Slice 3b: removeMember deletes the project_shares row. Last-owner
    // protection lives in ProjectAuthorizationService.revoke; the controller
    // should call that instead for proper enforcement. This direct delete is
    // kept as a low-level repository primitive for legacy callers.
    const { error } = await this.supabase
      .from('project_access')
      .delete()
      .eq('id', memberId)
      .eq('project_id', projectId);

    if (error) throw new BadRequestException(error.message);
  }

  async unassignTasksForMemberInProject(
    projectId: string,
    userId: string,
  ): Promise<number> {
    const { data: roadmapRows, error: roadmapError } = await this.supabase
      .from('roadmaps')
      .select('id')
      .eq('project_id', projectId);

    if (roadmapError) {
      throw new BadRequestException(
        roadmapError.message || 'Failed to resolve project roadmaps.',
      );
    }

    const roadmapIds = (roadmapRows || [])
      .map((row) => String((row as { id?: string }).id || ''))
      .filter((id) => id.length > 0);

    if (roadmapIds.length === 0) {
      return 0;
    }

    const { data: featureRows, error: featureError } = await this.supabase
      .from('roadmap_features')
      .select('id')
      .in('roadmap_id', roadmapIds);

    if (featureError) {
      throw new BadRequestException(
        featureError.message || 'Failed to resolve roadmap features.',
      );
    }

    const featureIds = (featureRows || [])
      .map((row) => String((row as { id?: string }).id || ''))
      .filter((id) => id.length > 0);

    if (featureIds.length === 0) {
      return 0;
    }

    const { data: tasksToUnassign, error: taskSelectError } =
      await this.supabase
        .from('roadmap_tasks')
        .select('id')
        .in('feature_id', featureIds)
        .eq('assignee_id', userId);

    if (taskSelectError) {
      throw new BadRequestException(
        taskSelectError.message || 'Failed to resolve assigned tasks.',
      );
    }

    const targetTaskIds = (tasksToUnassign || [])
      .map((row) => String((row as { id?: string }).id || ''))
      .filter((id) => id.length > 0);

    if (targetTaskIds.length === 0) {
      return 0;
    }

    const { error: unassignError } = await this.supabase
      .from('roadmap_tasks')
      .update({ assignee_id: null })
      .in('id', targetTaskIds);

    if (unassignError) {
      throw new BadRequestException(
        unassignError.message || 'Failed to unassign roadmap tasks.',
      );
    }

    return targetTaskIds.length;
  }

  async getMemberById(
    projectId: string,
    memberId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    origin: string | null;
    position: string | null;
    capabilities: Record<string, unknown>;
    permissions_json?: Record<string, unknown> | null;
  } | null> {
    // memberId is the project_shares.id. Reads the full row including the
    // restored `position` column and the `capabilities` JSONB delta.
    const { data, error } = await this.supabase
      .from('project_access')
      .select('id, user_id, role, origin, position, capabilities')
      .eq('project_id', projectId)
      .eq('id', memberId)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id as string,
      user_id: data.user_id as string | null,
      role: String(data.role),
      origin: (data.origin as string | null) ?? null,
      position: (data.position as string | null) ?? null,
      capabilities: (data.capabilities as Record<string, unknown> | null) ?? {},
      permissions_json: null,
    };
  }

  async getMemberByProjectAndUserId(
    projectId: string,
    userId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    origin: string | null;
    position: string | null;
    capabilities: Record<string, unknown>;
    permissions_json?: Record<string, unknown> | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('id, user_id, role, origin, position, capabilities')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id as string,
      user_id: data.user_id as string | null,
      role: String(data.role),
      origin: (data.origin as string | null) ?? null,
      position: (data.position as string | null) ?? null,
      capabilities: (data.capabilities as Record<string, unknown> | null) ?? {},
      permissions_json: null,
    };
  }

  async getMemberPermissions(
    _projectId: string,
    _memberId: string,
  ): Promise<ProjectPermissions | null> {
    // Slice 3b: per-member permissions_json is gone. Authority comes from
    // project_shares.role; per-share capabilities (a small JSONB on the
    // share row) handle overrides. Legacy callers requesting "what's the
    // permissions_json for this member" get null — they should switch to
    // role-based checks.
    return null;
  }

  async updateMemberPermissions(
    projectId: string,
    memberId: string,
    _dto: UpdateProjectMemberPermissionsDto,
  ): Promise<unknown> {
    // Slice 3b: permissions_json updates are no-ops. Roles + capabilities
    // on project_shares are the source of truth — a controller should
    // either change role (via updateMember) or set a capability flag
    // explicitly (future). Returning the share row keeps the API contract
    // shape stable for existing UI; the permissions_json field is empty.
    const member = await this.getMemberById(projectId, memberId);
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }

  private normalizeRequiredText(
    value: string | undefined,
    field: string,
  ): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new BadRequestException(`${field} is required.`);
    }
    return normalized;
  }

  private normalizeOptionalText(value?: string): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async assertResourceFolderBelongsToProject(
    projectId: string,
    folderId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('project_resource_folders')
      .select('id')
      .eq('id', folderId)
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to validate resource folder.',
      );
    }

    if (!data) {
      throw new NotFoundException('Resource folder not found.');
    }
  }

  private async getNextResourceFolderPosition(
    projectId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('project_resource_folders')
      .select('position')
      .eq('project_id', projectId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to compute next folder position.',
      );
    }

    return typeof data?.position === 'number' ? data.position + 1 : 0;
  }

  private async getNextResourceLinkPosition(
    projectId: string,
    folderId: string | null,
  ): Promise<number> {
    let query = this.supabase
      .from('project_resource_links')
      .select('position')
      .eq('project_id', projectId)
      .order('position', { ascending: false })
      .limit(1);

    if (folderId === null) {
      query = query.is('folder_id', null);
    } else {
      query = query.eq('folder_id', folderId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to compute next link position.',
      );
    }

    return typeof data?.position === 'number' ? data.position + 1 : 0;
  }

  private normalizeReorderItems(
    items: Array<{ id: string; position: number }>,
    existingIds: string[],
    subject: string,
  ): Array<{ id: string; position: number }> {
    const seenIds = new Set<string>();
    for (const item of items) {
      if (seenIds.has(item.id)) {
        throw new BadRequestException(
          `${subject} reorder payload contains duplicate ids.`,
        );
      }
      seenIds.add(item.id);
    }

    if (items.length !== existingIds.length) {
      throw new BadRequestException(
        `${subject} reorder payload must include all items in the container.`,
      );
    }

    const existingIdSet = new Set(existingIds);
    for (const item of items) {
      if (!existingIdSet.has(item.id)) {
        throw new BadRequestException(
          `${subject} reorder payload contains ids outside the container.`,
        );
      }
    }

    const sorted = [...items].sort((a, b) => a.position - b.position);
    sorted.forEach((item, index) => {
      if (item.position !== index) {
        throw new BadRequestException(
          `${subject} reorder positions must be contiguous and start at 0.`,
        );
      }
    });

    return sorted;
  }

  private async compactResourceLinksContainer(
    projectId: string,
    folderId: string | null,
  ): Promise<void> {
    let query = this.supabase
      .from('project_resource_links')
      .select('id, position')
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (folderId === null) {
      query = query.is('folder_id', null);
    } else {
      query = query.eq('folder_id', folderId);
    }

    const { data, error } = await query;
    if (error) {
      throw new BadRequestException(error.message);
    }

    const links =
      (data as Array<{ id: string; position: number }> | null) ?? [];
    if (links.length === 0) return;

    const maxPosition = links.reduce((max, link) => {
      const pos = typeof link.position === 'number' ? link.position : 0;
      return Math.max(max, pos);
    }, 0);
    const tempBase = maxPosition + links.length + 1000;

    for (const [index, link] of links.entries()) {
      const { error: tempError } = await this.supabase
        .from('project_resource_links')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.id)
        .eq('project_id', projectId);
      if (tempError) throw new BadRequestException(tempError.message);
    }

    for (const [index, link] of links.entries()) {
      const { error: finalError } = await this.supabase
        .from('project_resource_links')
        .update({
          position: index,
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.id)
        .eq('project_id', projectId);
      if (finalError) throw new BadRequestException(finalError.message);
    }
  }

  async listProjectResources(
    projectId: string,
  ): Promise<ProjectResourcesPayload> {
    const [foldersResult, linksResult] = await Promise.all([
      this.supabase
        .from('project_resource_folders')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true }),
      this.supabase
        .from('project_resource_links')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ]);

    if (foldersResult.error) {
      throw new BadRequestException(foldersResult.error.message);
    }
    if (linksResult.error) {
      throw new BadRequestException(linksResult.error.message);
    }

    const folders =
      (foldersResult.data as ProjectResourceFolder[] | null)?.map((folder) => ({
        ...folder,
        links: [],
      })) ?? [];
    const folderMap = new Map<string, ProjectResourceFolderWithLinks>(
      folders.map((folder) => [folder.id, folder]),
    );

    const uncategorizedLinks: ProjectResourceLink[] = [];
    const links = (linksResult.data as ProjectResourceLink[] | null) ?? [];
    for (const link of links) {
      if (link.folder_id && folderMap.has(link.folder_id)) {
        folderMap.get(link.folder_id)!.links.push(link);
      } else {
        uncategorizedLinks.push(link);
      }
    }

    return {
      folders,
      uncategorized_links: uncategorizedLinks,
    };
  }

  async createProjectResourceFolder(
    projectId: string,
    dto: CreateProjectResourceFolderDto,
  ): Promise<ProjectResourceFolder> {
    const name = this.normalizeRequiredText(dto.name, 'Folder name');
    const position = await this.getNextResourceFolderPosition(projectId);

    const { data, error } = await this.supabase
      .from('project_resource_folders')
      .insert({
        project_id: projectId,
        name,
        position,
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Failed to create resource folder.',
      );
    }

    return data as ProjectResourceFolder;
  }

  async updateProjectResourceFolder(
    projectId: string,
    folderId: string,
    dto: UpdateProjectResourceFolderDto,
  ): Promise<ProjectResourceFolder> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      patch.name = this.normalizeRequiredText(dto.name, 'Folder name');
    }
    if (dto.icon !== undefined) patch.icon = dto.icon;
    if (dto.color !== undefined) patch.color = dto.color;

    if (Object.keys(patch).length === 0) {
      const { data, error } = await this.supabase
        .from('project_resource_folders')
        .select('*')
        .eq('project_id', projectId)
        .eq('id', folderId)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new NotFoundException('Resource folder not found.');
      return data as ProjectResourceFolder;
    }

    const { data, error } = await this.supabase
      .from('project_resource_folders')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', projectId)
      .eq('id', folderId)
      .select('*')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Resource folder not found.');
    return data as ProjectResourceFolder;
  }

  async deleteProjectResourceFolder(
    projectId: string,
    folderId: string,
  ): Promise<void> {
    const { data: existing, error: findError } = await this.supabase
      .from('project_resource_folders')
      .select('id')
      .eq('project_id', projectId)
      .eq('id', folderId)
      .maybeSingle();
    if (findError) throw new BadRequestException(findError.message);
    if (!existing) throw new NotFoundException('Resource folder not found.');

    const { error } = await this.supabase
      .from('project_resource_folders')
      .delete()
      .eq('project_id', projectId)
      .eq('id', folderId);

    if (error) throw new BadRequestException(error.message);
  }

  async reorderProjectResourceFolders(
    projectId: string,
    dto: ReorderProjectResourceFoldersDto,
  ): Promise<ProjectResourceFolder[]> {
    const { data, error } = await this.supabase
      .from('project_resource_folders')
      .select('id, position')
      .eq('project_id', projectId)
      .order('position', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const existing =
      (data as Array<{ id: string; position: number }> | null) ?? [];
    if (existing.length === 0) {
      throw new BadRequestException('No resource folders found to reorder.');
    }

    const sortedItems = this.normalizeReorderItems(
      dto.items,
      existing.map((item) => item.id),
      'Folder',
    );

    const maxPosition = existing.reduce((max, item) => {
      const pos = typeof item.position === 'number' ? item.position : 0;
      return Math.max(max, pos);
    }, 0);
    const tempBase = maxPosition + sortedItems.length + 1000;

    for (const [index, item] of sortedItems.entries()) {
      const { error: tempError } = await this.supabase
        .from('project_resource_folders')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('id', item.id);
      if (tempError) throw new BadRequestException(tempError.message);
    }

    for (const item of sortedItems) {
      const { error: finalError } = await this.supabase
        .from('project_resource_folders')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('id', item.id);
      if (finalError) throw new BadRequestException(finalError.message);
    }

    const { data: refreshed, error: refreshError } = await this.supabase
      .from('project_resource_folders')
      .select('*')
      .eq('project_id', projectId)
      .order('position', { ascending: true });
    if (refreshError) throw new BadRequestException(refreshError.message);
    return (refreshed as ProjectResourceFolder[] | null) ?? [];
  }

  async createProjectResourceLink(
    projectId: string,
    dto: CreateProjectResourceLinkDto,
  ): Promise<ProjectResourceLink> {
    const title = this.normalizeRequiredText(dto.title, 'Link title');
    const url = this.normalizeRequiredText(dto.url, 'Link URL');
    const description = this.normalizeOptionalText(dto.description);
    const folderId = dto.folder_id ?? null;

    if (folderId) {
      await this.assertResourceFolderBelongsToProject(projectId, folderId);
    }

    const position = await this.getNextResourceLinkPosition(
      projectId,
      folderId,
    );

    const { data, error } = await this.supabase
      .from('project_resource_links')
      .insert({
        project_id: projectId,
        folder_id: folderId,
        title,
        url,
        description,
        position,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Failed to create resource link.',
      );
    }

    return data as ProjectResourceLink;
  }

  async updateProjectResourceLink(
    projectId: string,
    linkId: string,
    dto: UpdateProjectResourceLinkDto,
  ): Promise<ProjectResourceLink> {
    const { data: existing, error: existingError } = await this.supabase
      .from('project_resource_links')
      .select('*')
      .eq('project_id', projectId)
      .eq('id', linkId)
      .maybeSingle();

    if (existingError) throw new BadRequestException(existingError.message);
    if (!existing) throw new NotFoundException('Resource link not found.');

    const existingLink = existing as ProjectResourceLink;
    const patch: Record<string, unknown> = {};
    let shouldCompactSourceContainer = false;

    if (dto.title !== undefined) {
      patch.title = this.normalizeRequiredText(dto.title, 'Link title');
    }
    if (dto.url !== undefined) {
      patch.url = this.normalizeRequiredText(dto.url, 'Link URL');
    }
    if (dto.description !== undefined) {
      patch.description = this.normalizeOptionalText(dto.description);
    }

    const hasFolderIdInPayload = Object.prototype.hasOwnProperty.call(
      dto,
      'folder_id',
    );
    let sourceFolderIdForCompaction: string | null =
      existingLink.folder_id ?? null;
    if (hasFolderIdInPayload) {
      const nextFolderId = dto.folder_id ?? null;
      if (nextFolderId !== null) {
        await this.assertResourceFolderBelongsToProject(
          projectId,
          nextFolderId,
        );
      }

      patch.folder_id = nextFolderId;
      if (nextFolderId !== (existingLink.folder_id ?? null)) {
        shouldCompactSourceContainer = true;
        patch.position = await this.getNextResourceLinkPosition(
          projectId,
          nextFolderId,
        );
      } else {
        sourceFolderIdForCompaction = null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return existingLink;
    }

    const { data, error } = await this.supabase
      .from('project_resource_links')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', projectId)
      .eq('id', linkId)
      .select('*')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Resource link not found.');

    if (shouldCompactSourceContainer) {
      await this.compactResourceLinksContainer(
        projectId,
        sourceFolderIdForCompaction,
      );
    }

    return data as ProjectResourceLink;
  }

  async deleteProjectResourceLink(
    projectId: string,
    linkId: string,
  ): Promise<void> {
    const { data: existing, error: findError } = await this.supabase
      .from('project_resource_links')
      .select('id, folder_id')
      .eq('project_id', projectId)
      .eq('id', linkId)
      .maybeSingle();

    if (findError) throw new BadRequestException(findError.message);
    if (!existing) throw new NotFoundException('Resource link not found.');

    const sourceFolderId = (existing.folder_id as string | null) ?? null;

    const { error } = await this.supabase
      .from('project_resource_links')
      .delete()
      .eq('project_id', projectId)
      .eq('id', linkId);

    if (error) throw new BadRequestException(error.message);

    await this.compactResourceLinksContainer(projectId, sourceFolderId);
  }

  async reorderProjectResourceLinks(
    projectId: string,
    dto: ReorderProjectResourceLinksDto,
  ): Promise<ProjectResourceLink[]> {
    const folderId = dto.folder_id ?? null;
    if (folderId) {
      await this.assertResourceFolderBelongsToProject(projectId, folderId);
    }

    let query = this.supabase
      .from('project_resource_links')
      .select('id, position')
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (folderId === null) {
      query = query.is('folder_id', null);
    } else {
      query = query.eq('folder_id', folderId);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const existing =
      (data as Array<{ id: string; position: number }> | null) ?? [];
    if (existing.length === 0) {
      throw new BadRequestException('No resource links found to reorder.');
    }

    const sortedItems = this.normalizeReorderItems(
      dto.items,
      existing.map((item) => item.id),
      'Link',
    );

    const maxPosition = existing.reduce((max, item) => {
      const pos = typeof item.position === 'number' ? item.position : 0;
      return Math.max(max, pos);
    }, 0);
    const tempBase = maxPosition + sortedItems.length + 1000;

    for (const [index, item] of sortedItems.entries()) {
      const { error: tempError } = await this.supabase
        .from('project_resource_links')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('id', item.id);
      if (tempError) throw new BadRequestException(tempError.message);
    }

    for (const item of sortedItems) {
      const { error: finalError } = await this.supabase
        .from('project_resource_links')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('id', item.id);
      if (finalError) throw new BadRequestException(finalError.message);
    }

    let refreshQuery = this.supabase
      .from('project_resource_links')
      .select('*')
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (folderId === null) {
      refreshQuery = refreshQuery.is('folder_id', null);
    } else {
      refreshQuery = refreshQuery.eq('folder_id', folderId);
    }

    const { data: refreshed, error: refreshError } = await refreshQuery;
    if (refreshError) throw new BadRequestException(refreshError.message);
    return (refreshed as ProjectResourceLink[] | null) ?? [];
  }
}
