import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { MissingPermissionException } from '../projects/authorization/missing-permission.exception';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  UpdateTeamDto,
  UpdateTeamMemberDto,
} from './dto/teams.dto';

export interface TeamRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  hourly_rate: number | null;
  currency: string | null;
  custom_id: string | null;
  start_date: string | null;
  end_date: string | null;
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

const RATE_FIELDS: Array<keyof AddTeamMemberDto> = [
  'hourly_rate',
  'currency',
  'custom_id',
  'start_date',
  'end_date',
];

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
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
    return [...((owned.data ?? []) as TeamRow[]), ...extras];
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

  async addMember(
    teamId: string,
    callerId: string,
    dto: AddTeamMemberDto,
  ): Promise<TeamMemberRow> {
    const team = await this.fetchTeamOrThrow(teamId);
    await this.assertCanManageMembers(team, callerId);
    if (this.dtoTouchesRateFields(dto)) {
      await this.assertOwnerIsConsultant(team);
    }
    const payload = {
      team_id: teamId,
      user_id: dto.user_id,
      role: dto.role ?? 'member',
      hourly_rate: dto.hourly_rate ?? null,
      currency: dto.currency ?? null,
      custom_id: dto.custom_id ?? null,
      start_date: dto.start_date ?? null,
      end_date: dto.end_date ?? null,
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
    if (this.dtoTouchesRateFields(dto)) {
      await this.assertOwnerIsConsultant(team);
    }
    if (targetUserId === team.owner_id && dto.role && dto.role !== ('owner' as 'admin' | 'member')) {
      throw new ForbiddenException('Cannot change the role of the team owner');
    }
    const patch: Record<string, unknown> = {};
    if (dto.role !== undefined) patch.role = dto.role;
    for (const f of RATE_FIELDS) {
      const v = (dto as unknown as Record<string, unknown>)[f];
      if (v !== undefined) patch[f] = v;
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
    const { error } = await this.supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', targetUserId);
    if (error) throw new Error(error.message);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async fetchTeamOrThrow(teamId: string): Promise<TeamRow> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Team not found');
    return data as TeamRow;
  }

  private async assertCanRead(team: TeamRow, userId: string): Promise<void> {
    if (team.owner_id === userId) return;
    const { count } = await this.supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', team.id)
      .eq('user_id', userId);
    if ((count ?? 0) > 0) return;
    throw new ForbiddenException('You do not have access to this team');
  }

  private async assertCanManageMembers(
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

  private async assertOwnerIsConsultant(team: TeamRow): Promise<void> {
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

  private dtoTouchesRateFields(
    dto: AddTeamMemberDto | UpdateTeamMemberDto,
  ): boolean {
    const d = dto as Record<string, unknown>;
    return RATE_FIELDS.some((f) => d[f] !== undefined);
  }
}
