import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { TeamsService } from './teams.service';
import {
  CreateTeamMemberRateDto,
  UpdateTeamMemberRateDto,
} from './dto/teams.dto';

export interface TeamMemberRateRow {
  id: string;
  team_id: string;
  user_id: string;
  project_id: string;
  hourly_rate: number;
  training_hourly_rate: number;
  currency: string;
  custom_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class TeamMemberRatesService {
  private readonly logger = new Logger(TeamMemberRatesService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly teams: TeamsService,
  ) {}

  // ─── reads ───────────────────────────────────────────────────────────

  async listForMember(
    teamId: string,
    userId: string,
    callerId: string,
    projectId?: string,
  ): Promise<TeamMemberRateRow[]> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanRead(team, callerId);
    await this.assertMemberExists(teamId, userId);
    let query = this.supabase
      .from('team_member_rates')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (projectId) query = query.eq('project_id', projectId);
    const { data, error } = await query
      .order('project_id', { ascending: true })
      .order('end_date', { ascending: false, nullsFirst: true })
      .order('start_date', { ascending: false, nullsFirst: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as TeamMemberRateRow[];
  }

  async getActive(
    teamId: string,
    userId: string,
    projectId: string,
    callerId: string,
  ): Promise<TeamMemberRateRow | null> {
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanRead(team, callerId);
    const { data, error } = await this.supabase
      .from('team_member_rates')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .is('end_date', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as TeamMemberRateRow | null) ?? null;
  }

  // ─── writes ──────────────────────────────────────────────────────────

  /**
   * Create rate rows for each project in dto.project_ids. When end_date is
   * omitted the per-(team, user, project) open-ended row is closed first
   * so the partial unique index stays satisfied.
   */
  async create(
    teamId: string,
    userId: string,
    callerId: string,
    dto: CreateTeamMemberRateDto,
  ): Promise<TeamMemberRateRow[]> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanManageMembers(team, callerId);
    await this.teams.assertOwnerIsConsultant(team);
    await this.assertMemberExists(teamId, userId);

    const uniqueProjectIds = Array.from(new Set(dto.project_ids));
    if (uniqueProjectIds.length === 0) {
      throw new BadRequestException('project_ids must not be empty');
    }
    await this.assertProjectsBelongToTeam(teamId, uniqueProjectIds);

    const closeBefore =
      dto.end_date === undefined
        ? computePreviousEndDate(dto.start_date)
        : null;

    const inserted: TeamMemberRateRow[] = [];
    for (const projectId of uniqueProjectIds) {
      if (closeBefore) {
        await this.closeOpenEnded(teamId, userId, projectId, closeBefore);
      }
      const payload = {
        team_id: teamId,
        user_id: userId,
        project_id: projectId,
        hourly_rate: dto.hourly_rate,
        training_hourly_rate: dto.training_hourly_rate,
        currency: (dto.currency ?? 'USD').toUpperCase(),
        custom_id: dto.custom_id ?? null,
        start_date: dto.start_date ?? null,
        end_date: dto.end_date ?? null,
      };
      const { data, error } = await this.supabase
        .from('team_member_rates')
        .insert(payload)
        .select('*')
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create rate');
      }
      inserted.push(data as TeamMemberRateRow);
    }
    return inserted;
  }

  async update(
    teamId: string,
    userId: string,
    rateId: string,
    callerId: string,
    dto: UpdateTeamMemberRateDto,
  ): Promise<TeamMemberRateRow> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanManageMembers(team, callerId);
    await this.teams.assertOwnerIsConsultant(team);
    const existing = await this.fetchOrThrow(teamId, userId, rateId);

    const patch: Record<string, unknown> = {};
    if (dto.hourly_rate !== undefined) patch.hourly_rate = dto.hourly_rate;
    if (dto.training_hourly_rate !== undefined) {
      patch.training_hourly_rate = dto.training_hourly_rate;
    }
    if (dto.currency !== undefined)
      patch.currency = dto.currency.toUpperCase() || 'USD';
    if (dto.custom_id !== undefined) patch.custom_id = dto.custom_id || null;
    if (dto.start_date !== undefined) patch.start_date = dto.start_date || null;
    if (dto.end_date !== undefined) patch.end_date = dto.end_date || null;

    // If moving this row from closed → open-ended, pre-close any sibling
    // open-ended row on the same project to keep the partial unique index intact.
    if (dto.end_date === null && existing.end_date !== null) {
      const startDate =
        (patch.start_date as string | null) ?? existing.start_date;
      await this.closeOpenEndedExcept(
        teamId,
        userId,
        existing.project_id,
        rateId,
        computePreviousEndDate(startDate ?? undefined),
      );
    }

    const { data, error } = await this.supabase
      .from('team_member_rates')
      .update(patch)
      .eq('id', rateId)
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update rate');
    }
    return data as TeamMemberRateRow;
  }

  async delete(
    teamId: string,
    userId: string,
    rateId: string,
    callerId: string,
  ): Promise<void> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanManageMembers(team, callerId);
    await this.teams.assertOwnerIsConsultant(team);
    await this.fetchOrThrow(teamId, userId, rateId);
    const { error } = await this.supabase
      .from('team_member_rates')
      .delete()
      .eq('id', rateId)
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  /**
   * Return ids of every project currently attached to the team. UI uses
   * this to render the "All projects" save-time fan-out shortcut.
   */
  async expandAllProjects(teamId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { project_id: string }) => r.project_id);
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private async fetchOrThrow(
    teamId: string,
    userId: string,
    rateId: string,
  ): Promise<TeamMemberRateRow> {
    const { data, error } = await this.supabase
      .from('team_member_rates')
      .select('*')
      .eq('id', rateId)
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Rate not found');
    return data as TeamMemberRateRow;
  }

  private async assertMemberExists(
    teamId: string,
    userId: string,
  ): Promise<void> {
    const { count, error } = await this.supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    if (!count) throw new NotFoundException('Team member not found');
  }

  private async assertProjectsBelongToTeam(
    teamId: string,
    projectIds: string[],
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId)
      .in('project_id', projectIds);
    if (error) throw new Error(error.message);
    const found = new Set(
      (data ?? []).map((r: { project_id: string }) => r.project_id),
    );
    const missing = projectIds.filter((p) => !found.has(p));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Projects not attached to this team: ${missing.join(', ')}`,
      );
    }
  }

  private async closeOpenEnded(
    teamId: string,
    userId: string,
    projectId: string,
    closeBefore: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('team_member_rates')
      .update({ end_date: closeBefore })
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .is('end_date', null);
    if (error) throw new Error(error.message);
  }

  private async closeOpenEndedExcept(
    teamId: string,
    userId: string,
    projectId: string,
    exceptRateId: string,
    closeBefore: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('team_member_rates')
      .update({ end_date: closeBefore })
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .neq('id', exceptRateId)
      .is('end_date', null);
    if (error) throw new Error(error.message);
  }
}

function computePreviousEndDate(newStartDate: string | undefined): string {
  const anchor = newStartDate
    ? new Date(`${newStartDate}T00:00:00Z`)
    : new Date();
  if (Number.isNaN(anchor.getTime())) {
    throw new BadRequestException('Invalid start_date');
  }
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}
