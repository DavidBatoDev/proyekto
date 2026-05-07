import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { ProjectAccessSyncService } from '../projects/access-sync/access-sync.service';
import {
  AddCuratedMemberDto,
  AttachTeamDto,
  ProjectTeamDefaultRole,
  UpdateProjectTeamDto,
} from './dto/teams.dto';

export interface ProjectTeamRow {
  project_id: string;
  team_id: string;
  is_primary: boolean;
  attached_by: string | null;
  attached_at: string;
}

export interface ProjectTeamMemberRow {
  project_id: string;
  team_id: string;
  user_id: string;
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
  private readonly logger = new Logger(ProjectTeamsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly accessSync: ProjectAccessSyncService,
  ) {}

  /** Best-effort sync — never blocks the calling write. Sync drift is
   * always recoverable by invoking `syncUser` again from any code path. */
  private async safeSync(projectId: string, userId: string): Promise<void> {
    try {
      await this.accessSync.syncUser(projectId, userId);
    } catch (err) {
      this.logger.warn(
        `safeSync(${projectId}, ${userId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Look up the user's existing project_access role on this project.
   * Returns null if they have no rows yet — caller will use the picked
   * role for the new team-derived row in that case.
   */
  private async existingRoleFor(
    projectId: string,
    userId: string,
  ): Promise<ProjectTeamDefaultRole | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return data.role as ProjectTeamDefaultRole;
  }

  /**
   * Insert the project_team_members row + the matching project_access
   * row in one go. The trigger no longer fans inserts out, so the
   * application owns both writes. Idempotent on conflict.
   */
  private async curateOne(
    projectId: string,
    teamId: string,
    callerId: string,
    userId: string,
    pickedRole: ProjectTeamDefaultRole,
  ): Promise<void> {
    const existing = await this.existingRoleFor(projectId, userId);
    const roleForRow = existing ?? pickedRole;
    const origin = `team:${teamId}`;

    const { error: ptmErr } = await this.supabase
      .from('project_team_members')
      .insert({
        project_id: projectId,
        team_id: teamId,
        user_id: userId,
        added_by: callerId,
      });
    if (ptmErr) throw new Error(ptmErr.message);

    const { error: paErr } = await this.supabase
      .from('project_access')
      .upsert(
        {
          project_id: projectId,
          user_id: userId,
          role: roleForRow,
          origin,
          granted_by: callerId,
          capabilities: {},
        },
        { onConflict: 'project_id,user_id,origin' },
      );
    if (paErr) throw new Error(paErr.message);

    // Yoke: max-role across this user's rows wins.
    await this.safeSync(projectId, userId);
  }

  async list(
    projectId: string,
    callerId: string,
  ): Promise<ProjectTeamRow[]> {
    await this.projectAuth.assertPermission(callerId, projectId, 'teams.view');
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
    await this.projectAuth.assertPermission(callerId, projectId, 'teams.view');
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
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'members.manage',
    );
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
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'teams.manage',
    );
    const isPrimary = dto.is_primary ?? false;

    if (isPrimary) {
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
        attached_by: callerId,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to attach team');
    }

    // Curate per-member rows. The role picked here is only honored
    // for users without a prior project_access grant; everyone else
    // keeps their existing yoked role.
    const members = dto.members ?? [];
    for (const m of members) {
      await this.curateOne(projectId, dto.team_id, callerId, m.user_id, m.role);
    }

    return data as ProjectTeamRow;
  }

  async detach(
    projectId: string,
    teamId: string,
    callerId: string,
  ): Promise<void> {
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'teams.manage',
    );
    const { data: curated } = await this.supabase
      .from('project_team_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('team_id', teamId);
    const affectedUserIds = (curated ?? []).map((c) => c.user_id as string);

    const { error } = await this.supabase
      .from('project_teams')
      .delete()
      .eq('project_id', projectId)
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);

    // The DELETE trigger cascade-removed the team-derived project_access
    // rows. Surviving rows for these users (other origins) recompute.
    for (const uid of affectedUserIds) {
      await this.safeSync(projectId, uid);
    }
  }

  async updateAttachment(
    projectId: string,
    teamId: string,
    callerId: string,
    dto: UpdateProjectTeamDto,
  ): Promise<ProjectTeamRow> {
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'teams.manage',
    );
    const patch: Record<string, unknown> = {};

    if (dto.is_primary === true) {
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
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'members.manage',
    );
    const { data: attachment, error: attErr } = await this.supabase
      .from('project_teams')
      .select('team_id')
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .maybeSingle();
    if (attErr) throw new Error(attErr.message);
    if (!attachment) {
      throw new NotFoundException('Team is not attached to this project');
    }

    const pickedRole: ProjectTeamDefaultRole = dto.role ?? 'editor';
    await this.curateOne(projectId, teamId, callerId, dto.user_id, pickedRole);

    const { data, error } = await this.supabase
      .from('project_team_members')
      .select(PROJECT_TEAM_MEMBER_SELECT)
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .eq('user_id', dto.user_id)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to load curated member');
    }
    return data as ProjectTeamMemberRow;
  }

  async removeCuratedMember(
    projectId: string,
    teamId: string,
    targetUserId: string,
    callerId: string,
  ): Promise<void> {
    await this.projectAuth.assertPermission(
      callerId,
      projectId,
      'members.manage',
    );
    const { error } = await this.supabase
      .from('project_team_members')
      .delete()
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .eq('user_id', targetUserId);
    if (error) throw new Error(error.message);
    // DELETE trigger cascade-removed the team-derived project_access row.
    await this.safeSync(projectId, targetUserId);
  }
}
