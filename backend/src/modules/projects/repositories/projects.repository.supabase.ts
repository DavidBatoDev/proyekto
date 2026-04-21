import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectsRepository } from './projects.repository.interface';
import {
  Project,
  ProjectResourceFolder,
  ProjectResourceLink,
} from '../../../common/entities';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectResourceFolderDto,
  CreateProjectResourceLinkDto,
  InviteProjectByEmailDto,
  ProjectMemberRole,
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
import {
  applyClientInviteRestrictions,
  getTemplateByKey,
  resolvePermissionTemplateKey,
} from '../permissions/project-permissions';
import type { ProjectPermissions } from '../permissions/project-permissions';
import type {
  ProjectResourceFolderWithLinks,
  ProjectResourcesPayload,
} from './projects.repository.interface';

@Injectable()
export class SupabaseProjectsRepository implements ProjectsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getCreatorProfileForProjectCreation(userId: string): Promise<{
    active_persona: string;
    is_consultant_verified: boolean;
  } | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('active_persona, is_consultant_verified')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return {
      active_persona: String(data.active_persona ?? ''),
      is_consultant_verified: data.is_consultant_verified === true,
    };
  }

  private toProjectsTablePayload(
    dto: CreateProjectDto | UpdateProjectDto,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (dto.title !== undefined) payload.title = dto.title;
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.category !== undefined) payload.category = dto.category;
    if (dto.project_state !== undefined)
      payload.project_state = dto.project_state;
    if (dto.skills !== undefined) payload.skills = dto.skills;
    if (dto.duration !== undefined) payload.duration = dto.duration;
    if (dto.budget_range !== undefined) payload.budget_range = dto.budget_range;
    if (dto.funding_status !== undefined)
      payload.funding_status = dto.funding_status;
    if (dto.start_date !== undefined) payload.start_date = dto.start_date;
    if (dto.custom_start_date !== undefined)
      payload.custom_start_date = dto.custom_start_date;

    return payload;
  }

  private getDefaultPermissionsForMember(params: {
    projectId: string;
    clientId: string;
    consultantId?: string | null;
    member: {
      user_id: string | null;
      role: ProjectMemberRole;
    };
  }) {
    const templateKey = resolvePermissionTemplateKey(
      {
        id: params.projectId,
        client_id: params.clientId,
        consultant_id: params.consultantId,
      },
      {
        id: 'n/a',
        user_id: params.member.user_id,
        role: params.member.role,
      },
    );

    return getTemplateByKey(templateKey);
  }

  private enforceConsultantTimePermissions(
    permissions: ProjectPermissions,
    role: string,
  ): ProjectPermissions {
    if (String(role).trim().toLowerCase() !== ProjectMemberRole.CONSULTANT) {
      return permissions;
    }

    return {
      ...permissions,
      time: {
        view: true,
        view_financial: true,
        log: true,
        edit_own: true,
        edit_team: true,
        approve: true,
        manage_rates: true,
        delete_logs: true,
      },
    };
  }

  async findByUser(userId: string): Promise<Project[]> {
    const { data } = await this.supabase
      .from('project_members')
      .select(
        'project:projects(*, client:profiles!projects_client_id_fkey(id, display_name, avatar_url, email))',
      )
      .eq('user_id', userId);

    return (data || [])
      .map((r: Record<string, unknown>) => r.project)
      .filter(Boolean) as Project[];
  }

  async findDashboardByUser(userId: string): Promise<Project[]> {
    const [ownedResult, memberResult] = await Promise.all([
      this.supabase
        .from('projects')
        .select(
          '*, client:profiles!projects_client_id_fkey(id, display_name, avatar_url, email), consultant:profiles!projects_consultant_id_fkey(id, display_name, avatar_url, email)',
        )
        .or(`client_id.eq.${userId},consultant_id.eq.${userId}`),
      this.supabase
        .from('project_members')
        .select(
          'project:projects(*, client:profiles!projects_client_id_fkey(id, display_name, avatar_url, email), consultant:profiles!projects_consultant_id_fkey(id, display_name, avatar_url, email))',
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

    const deduped = new Map<string, Project>();
    for (const project of [...(ownedResult.data || []), ...memberProjects]) {
      deduped.set(project.id, project);
    }

    return Array.from(deduped.values()).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  async findById(id: string): Promise<
    | (Project & {
        client?: unknown;
        consultant?: unknown;
        members?: unknown[];
      })
    | null
  > {
    const { data, error } = await this.supabase
      .from('projects')
      .select(
        `
        *,
        client:profiles!projects_client_id_fkey(id, display_name, avatar_url, headline, email),
        consultant:profiles!projects_consultant_id_fkey(id, display_name, avatar_url, headline, email),
        members:project_members(id, project_id, user_id, role, position, permissions_json, joined_at, user:profiles(id, display_name, avatar_url, email, first_name, last_name, is_consultant_verified))
      `,
      )
      .eq('id', id)
      .single();

    if (error || !data) return null;

    return data as Project & {
      client?: unknown;
      consultant?: unknown;
      members?: unknown[];
    };
  }

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    const projectPayload = this.toProjectsTablePayload(dto);
    const isConsultantMode = dto.creation_mode === 'consultant';

    const { data: project, error } = await this.supabase
      .from('projects')
      .insert({
        ...projectPayload,
        client_id: userId,
        consultant_id: isConsultantMode ? userId : undefined,
      })
      .select()
      .single();

    if (error || !project)
      throw new Error(error?.message ?? 'Failed to create project');

    // Auto-add creator to the team with mode-specific bootstrap permissions.
    await this.supabase.from('project_members').insert({
      project_id: project.id,
      user_id: userId,
      role: isConsultantMode
        ? ProjectMemberRole.CONSULTANT
        : ProjectMemberRole.CLIENT,
      position: isConsultantMode ? 'Main Consultant' : 'Client',
      permissions_json: isConsultantMode
        ? getTemplateByKey('consultant_incubation')
        : getTemplateByKey('client'),
    });

    return project as Project;
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
      .select()
      .single();
    if (error || !data)
      throw new Error(error?.message ?? 'Failed to update project');
    return data as Project;
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
        .select('id, consultant_id')
        .eq('id', projectId)
        .single();

    if (currentProjectError || !currentProject) {
      throw new NotFoundException('Project not found');
    }

    const { data: updatedProject, error: updateProjectError } =
      await this.supabase
        .from('projects')
        .update({ client_id: newOwnerId })
        .eq('id', projectId)
        .select()
        .single();

    if (updateProjectError || !updatedProject) {
      throw new BadRequestException(
        updateProjectError?.message || 'Failed to transfer project owner.',
      );
    }

    const { error: newOwnerMemberError } = await this.supabase
      .from('project_members')
      .upsert(
        {
          project_id: projectId,
          user_id: newOwnerId,
          role: ProjectMemberRole.CLIENT,
          position: 'Client',
          permissions_json: getTemplateByKey('client'),
        },
        { onConflict: 'project_id,user_id' },
      );

    if (newOwnerMemberError) {
      throw new BadRequestException(
        newOwnerMemberError.message ||
          'Failed to update new owner project membership.',
      );
    }

    if (previousOwnerId !== newOwnerId) {
      const consultantId =
        (currentProject.consultant_id as string | null) ?? null;
      const previousOwnerIsConsultant = consultantId === previousOwnerId;

      // Keep consultant identity when the previous owner is also the consultant.
      if (previousOwnerIsConsultant) {
        const { error: previousConsultantError } = await this.supabase
          .from('project_members')
          .upsert(
            {
              project_id: projectId,
              user_id: previousOwnerId,
              role: ProjectMemberRole.CONSULTANT,
              position: 'Main Consultant',
              permissions_json: getTemplateByKey('consultant'),
            },
            { onConflict: 'project_id,user_id' },
          );

        if (previousConsultantError) {
          throw new BadRequestException(
            previousConsultantError.message ||
              'Failed to sync previous owner consultant membership.',
          );
        }
      } else {
        const { error: previousOwnerMemberError } = await this.supabase
          .from('project_members')
          .upsert(
            {
              project_id: projectId,
              user_id: previousOwnerId,
              role: ProjectMemberRole.MEMBER,
              position: 'Member',
              permissions_json: getTemplateByKey('member'),
            },
            { onConflict: 'project_id,user_id' },
          );

        if (previousOwnerMemberError) {
          throw new BadRequestException(
            previousOwnerMemberError.message ||
              'Failed to sync previous owner membership.',
          );
        }
      }
    }

    return updatedProject as Project;
  }

  async reassignConsultant(
    projectId: string,
    ownerId: string,
    previousConsultantId: string | null,
    newConsultantId: string,
  ): Promise<Project> {
    const { data: updatedProject, error: updateProjectError } = await this.supabase
      .from('projects')
      .update({ consultant_id: newConsultantId, status: 'active' })
      .eq('id', projectId)
      .select()
      .single();

    if (updateProjectError || !updatedProject) {
      throw new BadRequestException(
        updateProjectError?.message || 'Failed to reassign consultant.',
      );
    }

    const { error: newConsultantError } = await this.supabase
      .from('project_members')
      .upsert(
        {
          project_id: projectId,
          user_id: newConsultantId,
          role: ProjectMemberRole.CONSULTANT,
          position: 'Main Consultant',
          permissions_json: getTemplateByKey('consultant'),
        },
        { onConflict: 'project_id,user_id' },
      );

    if (newConsultantError) {
      throw new BadRequestException(
        newConsultantError.message || 'Failed to sync new consultant membership.',
      );
    }

    if (previousConsultantId && previousConsultantId !== newConsultantId) {
      const previousConsultantBecomesClient = previousConsultantId === ownerId;

      const { error: previousConsultantError } = await this.supabase
        .from('project_members')
        .upsert(
          {
            project_id: projectId,
            user_id: previousConsultantId,
            role: previousConsultantBecomesClient
              ? ProjectMemberRole.CLIENT
              : ProjectMemberRole.MEMBER,
            position: previousConsultantBecomesClient ? 'Client' : 'Member',
            permissions_json: previousConsultantBecomesClient
              ? getTemplateByKey('client')
              : getTemplateByKey('member'),
          },
          { onConflict: 'project_id,user_id' },
        );

      if (previousConsultantError) {
        throw new BadRequestException(
          previousConsultantError.message ||
            'Failed to sync previous consultant membership.',
        );
      }
    }

    return updatedProject as Project;
  }

  async assignConsultant(
    projectId: string,
    consultantId: string,
  ): Promise<Project> {
    const { data, error } = await this.supabase
      .from('projects')
      .update({ consultant_id: consultantId, status: 'active' })
      .eq('id', projectId)
      .select()
      .single();

    if (error || !data) throw new NotFoundException('Project not found');

    // Upsert consultant as project member
    await this.supabase.from('project_members').upsert(
      {
        project_id: projectId,
        user_id: consultantId,
        role: ProjectMemberRole.CONSULTANT,
        position: 'Main Consultant',
        permissions_json: getTemplateByKey('consultant'),
      },
      { onConflict: 'project_id,user_id' },
    );

    return data as Project;
  }

  async isOwner(projectId: string, userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .or(`client_id.eq.${userId},consultant_id.eq.${userId}`)
      .single();
    return !!data;
  }

  async isConsultantVerified(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('is_consultant_verified')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return false;
    return data.is_consultant_verified === true;
  }

  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
  ): Promise<unknown> {
    const { data: projectRow } = await this.supabase
      .from('projects')
      .select('id, client_id, consultant_id')
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

    const { data, error } = await this.supabase
      .from('project_members')
      .insert({
        project_id: projectId,
        user_id: userId,
        role: ProjectMemberRole.MEMBER,
        position: dto.position,
        permissions_json: this.getDefaultPermissionsForMember({
          projectId,
          clientId: projectRow.client_id as string,
          consultantId: (projectRow.consultant_id as string | null) || null,
          member: {
            user_id: userId,
            role: ProjectMemberRole.MEMBER,
          },
        }),
      })
      .select(
        'id, project_id, user_id, role, position, joined_at, user:profiles(id, display_name, avatar_url, email, first_name, last_name, is_consultant_verified)',
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

  async inviteByEmail(
    projectId: string,
    invitedBy: string,
    dto: InviteProjectByEmailDto,
  ): Promise<unknown> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const invitedPosition = dto.position.trim();
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
          message:
            inviteMessage && inviteMessage.length > 0 ? inviteMessage : null,
          status: 'pending',
          updated_at: new Date().toISOString(),
          responded_at: null,
        },
        { onConflict: 'project_id,invitee_email' },
      )
      .select(
        'id, project_id, invited_by, invitee_id, invitee_email, invited_position, status, message, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      throw new BadRequestException(error?.message || 'Failed to send invite.');
    }

    return data;
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

    if (dto.status === 'accepted') {
      const { data: projectRow } = await this.supabase
        .from('projects')
        .select('id, client_id, consultant_id')
        .eq('id', invite.project_id)
        .single();

      if (!projectRow) {
        throw new NotFoundException('Project not found.');
      }

      const defaultPermissions = this.getDefaultPermissionsForMember({
        projectId: invite.project_id as string,
        clientId: projectRow.client_id as string,
        consultantId: (projectRow.consultant_id as string | null) || null,
        member: {
          user_id: userId,
          role: ProjectMemberRole.MEMBER,
        },
      });
      const invitedByClient =
        String(invite.invited_by || '') === String(projectRow.client_id || '');

      const { error: memberError } = await this.supabase
        .from('project_members')
        .upsert(
          {
            project_id: invite.project_id,
            user_id: userId,
            role: ProjectMemberRole.MEMBER,
            position: invite.invited_position || 'Member',
            permissions_json: applyClientInviteRestrictions(
              defaultPermissions,
              invitedByClient,
            ),
          },
          { onConflict: 'project_id,user_id' },
        );

      if (memberError) {
        throw new BadRequestException(
          memberError.message || 'Failed to add member to project members.',
        );
      }
    }

    return updatedInvite;
  }

  async updateMember(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<unknown> {
    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.position !== undefined) patch.position = dto.position;

    const { data, error } = await this.supabase
      .from('project_members')
      .update(patch)
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select(
        'id, project_id, user_id, role, position, permissions_json, joined_at, user:profiles(id, display_name, avatar_url, email, first_name, last_name, is_consultant_verified)',
      )
      .single();

    if (error) throw new BadRequestException(error.message);

    const role = String((data as Record<string, unknown>).role ?? '')
      .trim()
      .toLowerCase();

    if (role === ProjectMemberRole.CONSULTANT) {
      const currentPermissions =
        (data as { permissions_json?: Record<string, unknown> })
          .permissions_json ?? {};
      const normalized = this.enforceConsultantTimePermissions(
        currentPermissions as ProjectPermissions,
        role,
      );

      const { data: updated, error: updatePermissionsError } =
        await this.supabase
          .from('project_members')
          .update({ permissions_json: normalized })
          .eq('id', memberId)
          .eq('project_id', projectId)
          .select(
            'id, project_id, user_id, role, position, permissions_json, joined_at, user:profiles(id, display_name, avatar_url, email, first_name, last_name, is_consultant_verified)',
          )
          .single();

      if (updatePermissionsError) {
        throw new BadRequestException(updatePermissionsError.message);
      }

      return updated;
    }

    return data;
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    // Prevent removing project leads.
    const { data: existing } = await this.supabase
      .from('project_members')
      .select('id, role')
      .eq('id', memberId)
      .eq('project_id', projectId)
      .single();

    if (!existing) throw new NotFoundException('Member not found');
    const role = String((existing as Record<string, unknown>).role ?? '')
      .trim()
      .toLowerCase();
    if (
      role === ProjectMemberRole.CLIENT ||
      role === ProjectMemberRole.CONSULTANT
    ) {
      throw new BadRequestException('Project leads cannot be removed.');
    }

    const { error } = await this.supabase
      .from('project_members')
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

    const { data: tasksToUnassign, error: taskSelectError } = await this.supabase
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
    position?: string | null;
    permissions_json?: Record<string, unknown> | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('project_members')
      .select('id, user_id, role, position, permissions_json')
      .eq('project_id', projectId)
      .eq('id', memberId)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as {
      id: string;
      user_id: string | null;
      role: string;
      position?: string | null;
      permissions_json?: Record<string, unknown> | null;
    };
  }

  async getMemberByProjectAndUserId(
    projectId: string,
    userId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    position?: string | null;
    permissions_json?: Record<string, unknown> | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('project_members')
      .select('id, user_id, role, position, permissions_json')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as {
      id: string;
      user_id: string | null;
      role: string;
      position?: string | null;
      permissions_json?: Record<string, unknown> | null;
    };
  }

  async getMemberPermissions(
    projectId: string,
    memberId: string,
  ): Promise<ProjectPermissions | null> {
    const { data, error } = await this.supabase
      .from('project_members')
      .select('permissions_json')
      .eq('project_id', projectId)
      .eq('id', memberId)
      .maybeSingle();

    if (error || !data) return null;
    return (data.permissions_json || null) as ProjectPermissions | null;
  }

  async updateMemberPermissions(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberPermissionsDto,
  ): Promise<unknown> {
    const patch: Record<string, unknown> = {};
    if (dto.roadmap !== undefined) patch.roadmap = dto.roadmap;
    if (dto.members !== undefined) patch.members = dto.members;
    if (dto.project !== undefined) patch.project = dto.project;
    if (dto.time !== undefined) patch.time = dto.time;

    const existing = await this.getMemberPermissions(projectId, memberId);
    const member = await this.getMemberById(projectId, memberId);
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const merged: Record<string, unknown> = {
      ...(existing || {}),
      ...patch,
    };
    const normalizedMerged = this.enforceConsultantTimePermissions(
      merged as ProjectPermissions,
      member.role,
    );

    const { data, error } = await this.supabase
      .from('project_members')
      .update({ permissions_json: normalizedMerged })
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select(
        'id, project_id, user_id, role, position, permissions_json, joined_at',
      )
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
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
