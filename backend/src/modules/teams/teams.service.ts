import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { MissingPermissionException } from '../projects/authorization/missing-permission.exception';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  InviteTeamMemberDto,
  RespondTeamInviteDto,
  TeamMemberRole,
  UpdateTeamDto,
  UpdateTeamMemberDto,
  UpdateWorkspaceDefaultsDto,
} from './dto/teams.dto';

export interface TeamMemberPreview {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface TeamRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  is_personal: boolean;
  time_tracking_enabled: boolean;
  retroactive_log_days: number | null;
  default_currency: string;
  created_at: string;
  updated_at: string;
  // Populated by listMyTeams for the team-list UI. Other endpoints that
  // return a single TeamRow may leave these undefined.
  members_count?: number;
  members_preview?: Array<TeamMemberPreview | null>;
  // The caller's own role + position within this team — drives the
  // "what am I in this team?" chip on the team-list card. Undefined on
  // endpoints other than listMyTeams.
  viewer_role?: 'owner' | 'admin' | 'member' | null;
  viewer_position?: string | null;
}

const TEAM_LIST_PREVIEW_LIMIT = 6;

export interface TeamMemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  position: string | null;
  joined_at: string;
  user?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

const TEAM_MEMBER_SELECT =
  '*, user:profiles!team_members_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)';

export interface TeamInviteRow {
  id: string;
  team_id: string;
  invited_by: string | null;
  invitee_id: string | null;
  invitee_email: string | null;
  role: TeamMemberRole;
  position: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  message: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  team?: { id: string; name: string; avatar_url: string | null } | null;
  invited_by_profile?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
  invitee?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
}

const TEAM_INVITE_SELECT = `
  *,
  team:teams!team_invites_team_id_fkey(id, name, avatar_url),
  invited_by_profile:profiles!team_invites_invited_by_fkey(id, display_name, avatar_url, email),
  invitee:profiles!team_invites_invitee_id_fkey(id, display_name, avatar_url, email)
`;

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Idempotently create the user's single personal team. Called by
   * AuthService.completeOnboarding for consultant-lane signups. Returns
   * the existing personal team on re-runs (partial unique index on
   * teams(owner_id) WHERE is_personal is the source of truth).
   */
  async provisionPersonalTeam(userId: string): Promise<TeamRow> {
    const existing = await this.findPersonalTeam(userId);
    if (existing) return existing;

    const name = await this.buildDefaultPersonalTeamName(userId);

    const { data: created, error } = await this.supabase
      .from('teams')
      .insert({
        owner_id: userId,
        name,
        is_personal: true,
      })
      .select('*')
      .single();

    if (error) {
      // Race: another caller won the partial unique index. Re-fetch.
      if (error.code === '23505') {
        const survivor = await this.findPersonalTeam(userId);
        if (survivor) return survivor;
      }
      this.logger.error(
        `Failed to create personal team for ${userId}: ${error.message}`,
      );
      throw new Error(error.message);
    }
    if (!created) throw new Error('Personal team insert returned no row');

    // Owner gets a team_members row, mirroring createTeam().
    const insertOwner = await this.supabase
      .from('team_members')
      .insert({
        team_id: (created as TeamRow).id,
        user_id: userId,
        role: 'owner',
      });
    if (insertOwner.error) {
      this.logger.error(
        `Personal team ${(created as TeamRow).id} created but owner team_members insert failed: ${insertOwner.error.message}`,
      );
      throw new Error(insertOwner.error.message);
    }
    return created as TeamRow;
  }

  async findPersonalTeam(userId: string): Promise<TeamRow | null> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_personal', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as TeamRow | null) ?? null;
  }

  private async buildDefaultPersonalTeamName(userId: string): Promise<string> {
    const { data } = await this.supabase
      .from('profiles')
      .select('first_name, display_name')
      .eq('id', userId)
      .maybeSingle();

    const name =
      (data?.first_name as string | undefined)?.trim() ||
      (data?.display_name as string | undefined)?.trim() ||
      'My';
    return `${name}'s Team`;
  }

  async listMyTeams(userId: string): Promise<TeamRow[]> {
    // Teams I own + teams where I'm a member.
    const owned = await this.supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId);
    if (owned.error) throw new Error(owned.error.message);

    const memberships = await this.supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId);
    if (memberships.error) throw new Error(memberships.error.message);

    const memberTeamIds = (memberships.data ?? []).map((m) => m.team_id);
    const ownedIds = new Set((owned.data ?? []).map((t) => t.id));
    const extraIds = memberTeamIds.filter((id) => !ownedIds.has(id));

    let extras: TeamRow[] = [];
    if (extraIds.length > 0) {
      const { data, error } = await this.supabase
        .from('teams')
        .select('*')
        .in('id', extraIds);
      if (error) throw new Error(error.message);
      extras = (data ?? []) as TeamRow[];
    }

    const teams: TeamRow[] = [
      ...((owned.data ?? []) as TeamRow[]),
      ...extras,
    ];
    if (teams.length === 0) return teams;

    // Fetch member previews for all visible teams in one batched query
    // so the team-list UI can render an avatar stack without N+1 calls.
    // Also pulls role/position so we can fold the viewer's own row into
    // each team for the per-card "what am I here?" chip.
    const teamIds = teams.map((t) => t.id);
    const { data: allMembers, error: memErr } = await this.supabase
      .from('team_members')
      .select(
        `team_id, user_id, role, position, joined_at,
         user:profiles!team_members_user_id_fkey(id, display_name, avatar_url, email, first_name, last_name)`,
      )
      .in('team_id', teamIds)
      .order('joined_at', { ascending: true });
    if (memErr) throw new Error(memErr.message);

    const byTeam = new Map<
      string,
      Array<{ user: TeamMemberPreview | null }>
    >();
    const viewerByTeam = new Map<
      string,
      { role: 'owner' | 'admin' | 'member'; position: string | null }
    >();
    // Supabase's typed embedded relation widens FK joins to arrays even
    // when the relation is one-to-one; cast through unknown then narrow.
    const memberRows = (allMembers ?? []) as unknown as Array<{
      team_id: string;
      user_id: string;
      role: 'owner' | 'admin' | 'member';
      position: string | null;
      user: TeamMemberPreview | null;
    }>;
    for (const row of memberRows) {
      const arr = byTeam.get(row.team_id) ?? [];
      arr.push({ user: row.user });
      byTeam.set(row.team_id, arr);
      if (row.user_id === userId) {
        viewerByTeam.set(row.team_id, {
          role: row.role,
          position: row.position,
        });
      }
    }

    return teams.map((t) => {
      const members = byTeam.get(t.id) ?? [];
      const viewer = viewerByTeam.get(t.id) ?? null;
      return {
        ...t,
        members_count: members.length,
        members_preview: members
          .slice(0, TEAM_LIST_PREVIEW_LIMIT)
          .map((m) => m.user),
        viewer_role: viewer?.role ?? null,
        viewer_position: viewer?.position ?? null,
      };
    });
  }

  async getTeam(teamId: string, userId: string): Promise<TeamRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanRead(team, userId);
    return team;
  }

  async createTeam(userId: string, dto: CreateTeamDto): Promise<TeamRow> {
    const { data, error } = await this.supabase
      .from('teams')
      .insert({
        owner_id: userId,
        name: dto.name,
        description: dto.description ?? null,
        avatar_url: dto.avatar_url ?? null,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create team');
    }
    // Auto-add owner as a team_members row so triggers and RLS treat
    // the owner as a member without needing a separate flow.
    const insertOwner = await this.supabase
      .from('team_members')
      .insert({
        team_id: (data as TeamRow).id,
        user_id: userId,
        role: 'owner',
      });
    if (insertOwner.error) throw new Error(insertOwner.error.message);
    return data as TeamRow;
  }

  async updateTeam(
    teamId: string,
    userId: string,
    dto: UpdateTeamDto,
  ): Promise<TeamRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    if (team.owner_id !== userId) {
      throw new ForbiddenException('Only the team owner can update the team');
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.avatar_url !== undefined) patch.avatar_url = dto.avatar_url;
    if (dto.time_tracking_enabled !== undefined) {
      // Enabling time tracking requires the team owner to be a verified
      // consultant. Disabling is always allowed (owner-only above).
      if (dto.time_tracking_enabled === true) {
        await this.assertOwnerIsConsultant(team);
      }
      patch.time_tracking_enabled = dto.time_tracking_enabled;
    }
    if (dto.retroactive_log_days !== undefined) {
      patch.retroactive_log_days = dto.retroactive_log_days;
    }
    if (dto.default_currency !== undefined) {
      patch.default_currency = dto.default_currency;
    }

    const { data, error } = await this.supabase
      .from('teams')
      .update(patch)
      .eq('id', teamId)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update team');
    }
    return data as TeamRow;
  }

  async deleteTeam(teamId: string, userId: string): Promise<void> {
    const team = await this.fetchTeamOrThrow(teamId);
    if (team.owner_id !== userId) {
      throw new ForbiddenException('Only the team owner can delete the team');
    }
    const { error } = await this.supabase
      .from('teams')
      .delete()
      .eq('id', teamId);
    if (error) {
      // The DB FK from project_teams.team_id ON DELETE RESTRICT raises
      // when the team is still attached. Surface a friendly message.
      if (/violates foreign key constraint/i.test(error.message)) {
        throw new ForbiddenException(
          'Detach this team from all projects before deleting it.',
        );
      }
      throw new Error(error.message);
    }
  }

  /**
   * List the projects this team is currently attached to. Used by the
   * team settings "Projects" tab to show + detach attachments. Reads
   * via service role and gates on the same readership rule as getTeam.
   */
  async listProjectsForTeam(
    teamId: string,
    callerId: string,
  ): Promise<
    Array<{
      project_id: string;
      team_id: string;
      is_primary: boolean;
      attached_at: string;
      viewer_has_access: boolean;
      viewer_role: string | null;
      project: {
        id: string;
        title: string | null;
        status: string | null;
        start_date: string | null;
        custom_start_date: string | null;
        banner_url: string | null;
        client_id: string | null;
        consultant_id: string | null;
        client: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
        } | null;
      } | null;
    }>
  > {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanRead(team, callerId);
    const { data, error } = await this.supabase
      .from('project_teams')
      .select(
        `project_id, team_id, is_primary, attached_at,
         project:projects!project_teams_project_id_fkey(
           id, title, status, start_date, custom_start_date, banner_url, client_id, consultant_id,
           client:profiles!projects_client_id_fkey(id, display_name, avatar_url)
         )`,
      )
      .eq('team_id', teamId)
      .order('attached_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<{
      project_id: string;
      team_id: string;
      is_primary: boolean;
      attached_at: string;
      project: {
        id: string;
        title: string | null;
        status: string | null;
        start_date: string | null;
        custom_start_date: string | null;
        banner_url: string | null;
        client_id: string | null;
        consultant_id: string | null;
        client: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
        } | null;
      } | null;
    }>;
    const projectIds = rows.map((r) => r.project_id).filter(Boolean);
    let accessSet = new Set<string>();
    let roleMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: accessRows } = await this.supabase
        .from('project_access')
        .select('project_id, role')
        .eq('user_id', callerId)
        .in('project_id', projectIds);
      accessSet = new Set((accessRows ?? []).map((r) => r.project_id));
      roleMap = new Map((accessRows ?? []).map((r) => [r.project_id, r.role]));
    }
    return rows.map((r) => ({
      ...r,
      viewer_has_access: accessSet.has(r.project_id),
      viewer_role: roleMap.get(r.project_id) ?? null,
    }));
  }

  async listMembers(teamId: string, userId: string): Promise<TeamMemberRow[]> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanRead(team, userId);
    const { data, error } = await this.supabase
      .from('team_members')
      .select(TEAM_MEMBER_SELECT)
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    return (data ?? []) as TeamMemberRow[];
  }

  async updateWorkspaceDefaults(
    userId: string,
    dto: UpdateWorkspaceDefaultsDto,
  ): Promise<{
    workspace_defaults: {
      default_team_id: string | null;
      default_project_id: string | null;
      last_team_id: string | null;
    };
  }> {
    if (dto.default_team_id) {
      const team = await this.fetchTeamOrThrow(dto.default_team_id);
      await this.assertCanRead(team, userId);
    }
    if (dto.last_team_id) {
      const team = await this.fetchTeamOrThrow(dto.last_team_id);
      await this.assertCanRead(team, userId);
    }

    if (dto.default_project_id) {
      const { data: access, error: accessErr } = await this.supabase
        .from('project_access')
        .select('project_id')
        .eq('project_id', dto.default_project_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (accessErr) throw new Error(accessErr.message);
      if (!access) {
        throw new ForbiddenException(
          'You do not have access to this default project.',
        );
      }

      if (dto.default_team_id) {
        const { count, error: teamProjErr } = await this.supabase
          .from('project_teams')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', dto.default_project_id)
          .eq('team_id', dto.default_team_id);
        if (teamProjErr) throw new Error(teamProjErr.message);
        if (!count) {
          throw new BadRequestException(
            'default_project_id is not attached to default_team_id.',
          );
        }
      }
    }

    const { data: profile, error: profileErr } = await this.supabase
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);

    const currentSettings =
      profile && typeof profile.settings === 'object' && profile.settings
        ? (profile.settings as Record<string, unknown>)
        : {};
    const currentDefaultsRaw = currentSettings.workspace_defaults;
    const currentDefaults =
      currentDefaultsRaw && typeof currentDefaultsRaw === 'object'
        ? (currentDefaultsRaw as Record<string, unknown>)
        : {};

    const workspaceDefaults = {
      default_team_id:
        dto.default_team_id !== undefined
          ? dto.default_team_id ?? null
          : (currentDefaults.default_team_id as string | null | undefined) ?? null,
      default_project_id:
        dto.default_project_id !== undefined
          ? dto.default_project_id ?? null
          : (currentDefaults.default_project_id as string | null | undefined) ??
            null,
      last_team_id:
        dto.last_team_id !== undefined
          ? dto.last_team_id ?? null
          : (currentDefaults.last_team_id as string | null | undefined) ?? null,
    };

    const nextSettings = {
      ...currentSettings,
      workspace_defaults: workspaceDefaults,
    };

    const { error: updateErr } = await this.supabase
      .from('profiles')
      .update({
        settings: nextSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (updateErr) throw new Error(updateErr.message);

    return { workspace_defaults: workspaceDefaults };
  }

  async addMember(
    teamId: string,
    callerId: string,
    dto: AddTeamMemberDto,
  ): Promise<TeamMemberRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanManageMembers(team, callerId);
    const payload = {
      team_id: teamId,
      user_id: dto.user_id,
      role: dto.role ?? 'member',
      position: dto.position?.trim() || null,
    };
    const { data, error } = await this.supabase
      .from('team_members')
      .insert(payload)
      .select(TEAM_MEMBER_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to add team member');
    }
    return data as TeamMemberRow;
  }

  async updateMember(
    teamId: string,
    targetUserId: string,
    callerId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanManageMembers(team, callerId);
    if (targetUserId === team.owner_id && dto.role && dto.role !== ('owner' as 'admin' | 'member')) {
      throw new ForbiddenException('Cannot change the role of the team owner');
    }
    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.position !== undefined) {
      // Empty string clears the position; otherwise trim whitespace.
      const trimmed = dto.position.trim();
      patch.position = trimmed.length === 0 ? null : trimmed;
    }
    const { data, error } = await this.supabase
      .from('team_members')
      .update(patch)
      .eq('team_id', teamId)
      .eq('user_id', targetUserId)
      .select(TEAM_MEMBER_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update team member');
    }
    return data as TeamMemberRow;
  }

  async removeMember(
    teamId: string,
    targetUserId: string,
    callerId: string,
  ): Promise<void> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanManageMembers(team, callerId);
    if (targetUserId === team.owner_id) {
      throw new ForbiddenException(
        'Cannot remove the team owner; transfer ownership or delete the team first.',
      );
    }
    if (targetUserId === callerId) {
      throw new ForbiddenException(
        'You cannot remove yourself from a team. Ask another admin or owner.',
      );
    }
    const { error } = await this.supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', targetUserId);
    if (error) throw new Error(error.message);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  async fetchTeamOrThrow(teamId: string): Promise<TeamRow> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Team not found');
    return data as TeamRow;
  }

  async assertCanRead(team: TeamRow, userId: string): Promise<void> {
    if (team.owner_id === userId) return;
    const { count } = await this.supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', team.id)
      .eq('user_id', userId);
    if ((count ?? 0) > 0) return;
    throw new ForbiddenException('You do not have access to this team');
  }

  async assertCanManageMembers(
    team: TeamRow,
    userId: string,
  ): Promise<void> {
    if (team.owner_id === userId) return;
    const { data, error } = await this.supabase
      .from('team_members')
      .select('role')
      .eq('team_id', team.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.role !== 'admin') {
      throw new ForbiddenException(
        'Only the team owner or team admins can manage members',
      );
    }
  }

  // Public so the team-member-rates service can reuse the same gate.
  async assertOwnerIsConsultant(team: TeamRow): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('is_consultant_verified')
      .eq('id', team.owner_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.is_consultant_verified) {
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'consultant',
        label: 'manage team rates',
        message:
          'Team owner must be a verified consultant to set rate / billing fields.',
      });
    }
  }

  // ─── invites (email-based) ──────────────────────────────────────────────

  /**
   * Invite by email. Mirrors ProjectsService.inviteByEmail:
   *   - lookup profile by lowercased email
   *   - if already a team member, 400
   *   - upsert into team_invites (refresh status to pending, role, message)
   *   - emit notification when invitee profile exists
   *
   * The unique partial indexes on team_invites enforce idempotency at the
   * DB level. We try the matching upsert path first depending on whether
   * we resolved the email to a profile or not.
   */
  async inviteByEmail(
    teamId: string,
    callerId: string,
    dto: InviteTeamMemberDto,
  ): Promise<TeamInviteRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanManageMembers(team, callerId);

    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');

    // Resolve email → profile (case-insensitive on lower(email)).
    const { data: profileMatch } = await this.supabase
      .from('profiles')
      .select('id, email')
      .ilike('email', email)
      .maybeSingle();

    const matchedUserId = (profileMatch as { id?: string } | null)?.id ?? null;

    // Reject duplicate membership.
    if (matchedUserId) {
      const { data: alreadyMember } = await this.supabase
        .from('team_members')
        .select('id', { count: 'exact', head: false })
        .eq('team_id', teamId)
        .eq('user_id', matchedUserId)
        .maybeSingle();
      if (alreadyMember) {
        throw new BadRequestException(
          'This person is already a member of the team.',
        );
      }
    }

    const role: TeamMemberRole = dto.role ?? 'member';
    const position = dto.position?.trim() || null;
    const message = dto.message?.trim() || null;

    // Refresh existing pending row in place if one exists, else insert.
    // We can't use Supabase upsert with a partial unique index target,
    // so do an explicit select-then-update/insert.
    const existingQuery = this.supabase
      .from('team_invites')
      .select('id')
      .eq('team_id', teamId)
      .eq('status', 'pending');
    const { data: existing } = matchedUserId
      ? await existingQuery.eq('invitee_id', matchedUserId).maybeSingle()
      : await existingQuery.eq('invitee_email', email).maybeSingle();

    let row: Record<string, unknown> | null = null;
    if (existing) {
      const { data, error } = await this.supabase
        .from('team_invites')
        .update({
          invited_by: callerId,
          invitee_id: matchedUserId,
          invitee_email: email,
          role,
          position,
          message,
          status: 'pending',
          responded_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id)
        .select(TEAM_INVITE_SELECT)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to refresh invite');
      }
      row = data as Record<string, unknown>;
    } else {
      const { data, error } = await this.supabase
        .from('team_invites')
        .insert({
          team_id: teamId,
          invited_by: callerId,
          invitee_id: matchedUserId,
          invitee_email: email,
          role,
          position,
          message,
          status: 'pending',
        })
        .select(TEAM_INVITE_SELECT)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create invite');
      }
      row = data as Record<string, unknown>;
    }

    // Notify if we resolved to an existing user.
    if (matchedUserId) {
      const inviterName = await this.getDisplayName(callerId);
      const teamName = team.name || 'a team';
      const positionText = role !== 'member' ? ` as ${role}` : '';
      const noteText = message ? ` Note: ${message}` : '';
      const inviteMessage =
        `${inviterName || 'A team owner'} invited you to join ${teamName}${positionText}.${noteText}`;

      try {
        await this.notifications.createNotification({
          user_id: matchedUserId,
          project_id: undefined,
          type_name: 'team_invite_received',
          actor_id: callerId,
          content: {
            invite_id: row.id,
            team_id: teamId,
            team_name: teamName,
            invited_role: role,
            inviter_name: inviterName,
            message: inviteMessage,
            note: message,
          },
          link_url: '/teams/me/invites',
        });
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue team_invite_received notification: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return row as unknown as TeamInviteRow;
  }

  async listInvitesForTeam(
    teamId: string,
    callerId: string,
  ): Promise<TeamInviteRow[]> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanRead(team, callerId);
    const { data, error } = await this.supabase
      .from('team_invites')
      .select(TEAM_INVITE_SELECT)
      .eq('team_id', teamId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TeamInviteRow[];
  }

  async listInvitesForMe(userId: string): Promise<TeamInviteRow[]> {
    const { data, error } = await this.supabase
      .from('team_invites')
      .select(TEAM_INVITE_SELECT)
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TeamInviteRow[];
  }

  async cancelInvite(
    teamId: string,
    inviteId: string,
    callerId: string,
  ): Promise<TeamInviteRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanManageMembers(team, callerId);
    const { data, error } = await this.supabase
      .from('team_invites')
      .update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .eq('team_id', teamId)
      .eq('status', 'pending')
      .select(TEAM_INVITE_SELECT)
      .single();
    if (error || !data) {
      throw new NotFoundException('Pending invite not found');
    }
    return data as unknown as TeamInviteRow;
  }

  async respondInvite(
    inviteId: string,
    userId: string,
    dto: RespondTeamInviteDto,
  ): Promise<TeamInviteRow> {
    // Fetch the invite as-is (service-role bypasses RLS) and authz
    // ourselves: only the matched invitee may respond.
    const { data: invite, error: fetchErr } = await this.supabase
      .from('team_invites')
      .select('*')
      .eq('id', inviteId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.invitee_id !== userId) {
      throw new ForbiddenException('Only the invitee can respond to this invite');
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException(
        `Invite is already ${invite.status}; cannot respond again.`,
      );
    }

    if (dto.status === 'accepted') {
      // Insert membership; tolerate the unique-violation race where the
      // user was somehow added between fetch and insert. Carry over
      // position from the invite so the inviter's intent persists.
      const { error: insertErr } = await this.supabase
        .from('team_members')
        .insert({
          team_id: invite.team_id,
          user_id: userId,
          role: invite.role ?? 'member',
          position: invite.position ?? null,
        });
      if (insertErr && insertErr.code !== '23505') {
        throw new Error(insertErr.message);
      }
    }

    const { data: updated, error: updateErr } = await this.supabase
      .from('team_invites')
      .update({
        status: dto.status,
        responded_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .select(TEAM_INVITE_SELECT)
      .single();
    if (updateErr || !updated) {
      throw new Error(updateErr?.message ?? 'Failed to update invite');
    }

    return updated as unknown as TeamInviteRow;
  }

  private async getDisplayName(userId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', userId)
      .maybeSingle();
    if (!data) return null;
    const composed = [data.first_name, data.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return data.display_name || composed || data.email || null;
  }
}
