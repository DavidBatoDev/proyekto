import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  AddCuratedMemberDto,
  AttachTeamDto,
  ProjectTeamDefaultRole,
  UpdateCuratedMemberDto,
  UpdateProjectTeamDto,
} from './dto/teams.dto';

export interface ProjectTeamRow {
  project_id: string;
  team_id: string;
  is_primary: boolean;
  default_role: ProjectTeamDefaultRole;
  attached_by: string | null;
  attached_at: string;
}

export interface ProjectTeamMemberRow {
  project_id: string;
  team_id: string;
  user_id: string;
  role: ProjectTeamDefaultRole;
  capabilities: Record<string, unknown>;
  added_by: string | null;
  added_at: string;
  user?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

const PROJECT_TEAM_MEMBER_SELECT =
  '*, user:profiles!project_team_members_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)';

@Injectable()
export class ProjectTeamsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  async list(
    projectId: string,
    callerId: string,
  ): Promise<ProjectTeamRow[]> {
    await this.projectAuth.assertRole(callerId, projectId, 'viewer');
    const { data, error } = await this.supabase
      .from('project_teams')
      .select('*')
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
    return (data ?? []) as ProjectTeamRow[];
  }

  async listCuratedMembers(
    projectId: string,
    teamId: string,
    callerId: string,
  ): Promise<ProjectTeamMemberRow[]> {
    await this.projectAuth.assertRole(callerId, projectId, 'viewer');
    const { data, error } = await this.supabase
      .from('project_team_members')
      .select(PROJECT_TEAM_MEMBER_SELECT)
      .eq('project_id', projectId)
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    return (data ?? []) as ProjectTeamMemberRow[];
  }

  async listAvailableMembers(
    projectId: string,
    teamId: string,
    callerId: string,
  ): Promise<
    Array<{
      user_id: string;
      role: string;
      user: {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      } | null;
    }>
  > {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const [{ data: teamMembers, error: tmErr }, { data: curated, error: cErr }] =
      await Promise.all([
        this.supabase
          .from('team_members')
          .select(
            'user_id, role, user:profiles!team_members_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)',
          )
          .eq('team_id', teamId),
        this.supabase
          .from('project_team_members')
          .select('user_id')
          .eq('project_id', projectId)
          .eq('team_id', teamId),
      ]);
    if (tmErr) throw new Error(tmErr.message);
    if (cErr) throw new Error(cErr.message);
    const taken = new Set((curated ?? []).map((c) => c.user_id));
    return ((teamMembers ?? []) as unknown as Array<{
      user_id: string;
      role: string;
      user: {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      } | null;
    }>).filter((m) => !taken.has(m.user_id));
  }

  async attach(
    projectId: string,
    callerId: string,
    dto: AttachTeamDto,
  ): Promise<ProjectTeamRow> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const defaultRole = dto.default_role ?? 'editor';
    const isPrimary = dto.is_primary ?? false;

    if (isPrimary) {
      // Demote any existing primary first.
      await this.supabase
        .from('project_teams')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('is_primary', true);
    }

    const { data, error } = await this.supabase
      .from('project_teams')
      .insert({
        project_id: projectId,
        team_id: dto.team_id,
        is_primary: isPrimary,
        default_role: defaultRole,
        attached_by: callerId,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to attach team');
    }

    // Determine which members to curate. Default: all current members
    // of the team. Caller may pass a specific subset.
    let memberIds = dto.member_user_ids;
    if (!memberIds) {
      const { data: members, error: memErr } = await this.supabase
        .from('team_members')
        .select('user_id')
        .eq('team_id', dto.team_id);
      if (memErr) throw new Error(memErr.message);
      memberIds = (members ?? []).map((m) => m.user_id);
    }

    if (memberIds.length > 0) {
      const rows = memberIds.map((uid) => ({
        project_id: projectId,
        team_id: dto.team_id,
        user_id: uid,
        role: defaultRole,
        added_by: callerId,
      }));
      const { error: insErr } = await this.supabase
        .from('project_team_members')
        .insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    return data as ProjectTeamRow;
  }

  async detach(
    projectId: string,
    teamId: string,
    callerId: string,
  ): Promise<void> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const { error } = await this.supabase
      .from('project_teams')
      .delete()
      .eq('project_id', projectId)
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
  }

  async updateAttachment(
    projectId: string,
    teamId: string,
    callerId: string,
    dto: UpdateProjectTeamDto,
  ): Promise<ProjectTeamRow> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const patch: Record<string, unknown> = {};
    if (dto.default_role !== undefined) patch.default_role = dto.default_role;

    if (dto.is_primary === true) {
      // Demote existing primary first.
      await this.supabase
        .from('project_teams')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('is_primary', true);
      patch.is_primary = true;
    } else if (dto.is_primary === false) {
      patch.is_primary = false;
    }

    const { data, error } = await this.supabase
      .from('project_teams')
      .update(patch)
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .select('*')
      .single();
    if (error || !data) {
      throw new NotFoundException('Project team attachment not found');
    }
    return data as ProjectTeamRow;
  }

  async addCuratedMember(
    projectId: string,
    teamId: string,
    callerId: string,
    dto: AddCuratedMemberDto,
  ): Promise<ProjectTeamMemberRow> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const { data: attachment, error: attErr } = await this.supabase
      .from('project_teams')
      .select('default_role')
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .maybeSingle();
    if (attErr) throw new Error(attErr.message);
    if (!attachment) {
      throw new NotFoundException('Team is not attached to this project');
    }
    const role: ProjectTeamDefaultRole =
      dto.role ?? (attachment.default_role as ProjectTeamDefaultRole);

    const { data, error } = await this.supabase
      .from('project_team_members')
      .insert({
        project_id: projectId,
        team_id: teamId,
        user_id: dto.user_id,
        role,
        added_by: callerId,
      })
      .select(PROJECT_TEAM_MEMBER_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to add curated member');
    }
    return data as ProjectTeamMemberRow;
  }

  async updateCuratedMember(
    projectId: string,
    teamId: string,
    targetUserId: string,
    callerId: string,
    dto: UpdateCuratedMemberDto,
  ): Promise<ProjectTeamMemberRow> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    const { data, error } = await this.supabase
      .from('project_team_members')
      .update(patch)
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .eq('user_id', targetUserId)
      .select(PROJECT_TEAM_MEMBER_SELECT)
      .single();
    if (error || !data) {
      throw new NotFoundException('Curated member not found');
    }
    return data as ProjectTeamMemberRow;
  }

  async removeCuratedMember(
    projectId: string,
    teamId: string,
    targetUserId: string,
    callerId: string,
  ): Promise<void> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const { error } = await this.supabase
      .from('project_team_members')
      .delete()
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .eq('user_id', targetUserId);
    if (error) throw new Error(error.message);
  }
}
