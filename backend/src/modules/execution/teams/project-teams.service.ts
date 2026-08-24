import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
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
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  /**
   * Curate one user onto a team for this project.
   *   - Always inserts the project_team_members marker (idempotent
   *     via ON CONFLICT DO NOTHING semantics in the upsert).
   *   - If the user has no existing project_access row, also inserts
   *     one with origin='team:<teamId>', has_direct_grant=false, and
   *     the picked role (defaulting to 'editor').
   *   - If the user already has a project_access row, picked role is
   *     ignored: the existing row's role is the user's effective
   *     access on this project.
   *   - An explicit direct-invite move changes only the origin label and
   *     direct-grant flag; role, capabilities, and position stay intact.
   */
  private async curateOne(
    projectId: string,
    teamId: string,
    callerId: string,
    userId: string,
    pickedRole?: ProjectTeamDefaultRole,
    moveDirectGrant = false,
  ): Promise<void> {
    const { data: existing, error: lookupErr } = await this.supabase
      .from('project_access')
      .select('id, origin, has_direct_grant')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupErr) throw new Error(lookupErr.message);

    const { error: ptmErr } = await this.supabase
      .from('project_team_members')
      .upsert(
        {
          project_id: projectId,
          team_id: teamId,
          user_id: userId,
          added_by: callerId,
        },
        { onConflict: 'project_id,team_id,user_id' },
      );
    if (ptmErr) throw new Error(ptmErr.message);

    if (existing) {
      if (
        moveDirectGrant &&
        existing.origin === 'invited' &&
        existing.has_direct_grant === true
      ) {
        const { error: moveErr } = await this.supabase
          .from('project_access')
          .update({
            origin: `team:${teamId}`,
            has_direct_grant: false,
          })
          .eq('id', existing.id);
        if (moveErr) throw new Error(moveErr.message);
      }
      return;
    }

    const role: ProjectTeamDefaultRole = pickedRole ?? 'editor';
    const { error: paErr } = await this.supabase
      .from('project_access')
      .insert({
        project_id: projectId,
        user_id: userId,
        role,
        origin: `team:${teamId}`,
        granted_by: callerId,
        capabilities: {},
        has_direct_grant: false,
      });
    if (paErr) throw new Error(paErr.message);
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
    // Direct attach: the caller both authorizes the attachment and performs
    // the curation, so they are recorded on both sides.
    return this.performAttach(projectId, dto, {
      attachedBy: callerId,
      curatedBy: callerId,
    });
  }

  /**
   * Attach a team on the authority of an accepted invitation rather than the
   * caller's own project permissions.
   *
   * This is the one path that skips `teams.manage`, and it does so because the
   * project side already gave consent when the invitation was sent — the
   * accepter is the team's owner/admin, who by definition has no role on a
   * project they were invited to. `ProjectTeamInvitesService` is the only
   * caller and is responsible for having verified both halves first.
   *
   * The two actors differ here, unlike in `attach`: the *inviter* is recorded
   * as `attached_by`, because from the project's side they are who authorized
   * this team's presence, while the *accepter* is recorded on each curated
   * member row as the person who actually chose them.
   */
  async attachFromInvite(params: {
    projectId: string;
    teamId: string;
    /** The inviter — a project admin/owner. */
    attachedBy: string;
    /** The accepter — the team's owner or admin. */
    curatedBy: string;
    isPrimary: boolean;
    /** Role for members with no prior grant, fixed by the invitation. */
    memberRole: ProjectTeamDefaultRole;
    memberUserIds: string[];
  }): Promise<ProjectTeamRow> {
    return this.performAttach(
      params.projectId,
      {
        team_id: params.teamId,
        is_primary: params.isPrimary,
        members: params.memberUserIds.map((user_id) => ({
          user_id,
          role: params.memberRole,
        })),
      },
      { attachedBy: params.attachedBy, curatedBy: params.curatedBy },
    );
  }

  private async performAttach(
    projectId: string,
    dto: AttachTeamDto,
    actors: { attachedBy: string; curatedBy: string },
  ): Promise<ProjectTeamRow> {
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
        attached_by: actors.attachedBy,
      })
      .select('*')
      .single();

    // Already attached (23505 on the composite PK). Reachable from the invite
    // path — someone can be invited to bring a team that reached the project
    // by another route in the meantime — and treating that as an error would
    // strand the invitation. Adopt the existing attachment and still curate.
    let attachment = data as ProjectTeamRow | null;
    if (error?.code === '23505') {
      const existing = await this.supabase
        .from('project_teams')
        .select('*')
        .eq('project_id', projectId)
        .eq('team_id', dto.team_id)
        .single();
      if (existing.error || !existing.data) {
        throw new Error(existing.error?.message ?? 'Failed to attach team');
      }
      attachment = existing.data as ProjectTeamRow;
    } else if (error || !attachment) {
      throw new Error(error?.message ?? 'Failed to attach team');
    }

    // Curate per-member rows. Picked role is only honored for users
    // without an existing project_access grant; everyone else keeps
    // their existing role (the structural marker is still added).
    const members = dto.members ?? [];
    for (const m of members) {
      await this.curateOne(
        projectId,
        dto.team_id,
        actors.curatedBy,
        m.user_id,
        m.role,
      );
    }

    return attachment;
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
    // Cascade: deleting project_teams cascade-deletes
    // project_team_members; the DELETE trigger fires per row and
    // garbage-collects project_access rows that no longer have any
    // sustaining source.
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

    await this.curateOne(
      projectId,
      teamId,
      callerId,
      dto.user_id,
      dto.role,
      dto.move_direct_grant,
    );

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
    if (targetUserId === callerId) {
      throw new ForbiddenException(
        'You cannot remove yourself from a project team. Ask another admin.',
      );
    }
    await this.projectAuth.assertActionOutranks(
      callerId,
      targetUserId,
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
    // The DELETE trigger handles project_access cleanup: it deletes
    // the row only if no curations remain and has_direct_grant is
    // false.
  }
}
