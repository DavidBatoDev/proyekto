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
  hourly_rate: number;
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
  ): Promise<TeamMemberRateRow[]> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanRead(team, callerId);
    await this.assertMemberExists(teamId, userId);
    const { data, error } = await this.supabase
      .from('team_member_rates')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .order('end_date', { ascending: false, nullsFirst: true })
      .order('start_date', { ascending: false, nullsFirst: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as TeamMemberRateRow[];
  }

  async getActive(
    teamId: string,
    userId: string,
    callerId: string,
  ): Promise<TeamMemberRateRow | null> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanRead(team, callerId);
    const { data, error } = await this.supabase
      .from('team_member_rates')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .is('end_date', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as TeamMemberRateRow | null) ?? null;
  }

  // ─── writes ──────────────────────────────────────────────────────────

  /**
   * Create a new rate row. When end_date is omitted (this becomes a new
   * "active" rate) the previous open-ended row, if any, gets its
   * end_date closed to (start_date - 1) or (today - 1) so the partial
   * unique index stays satisfied.
   */
  async create(
    teamId: string,
    userId: string,
    callerId: string,
    dto: CreateTeamMemberRateDto,
  ): Promise<TeamMemberRateRow> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanManageMembers(team, callerId);
    await this.teams.assertOwnerIsConsultant(team);
    await this.assertMemberExists(teamId, userId);

    if (dto.end_date === undefined) {
      const closeBefore = computePreviousEndDate(dto.start_date);
      await this.closeOpenEnded(teamId, userId, closeBefore);
    }

    const payload = {
      team_id: teamId,
      user_id: userId,
      hourly_rate: dto.hourly_rate,
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
    return data as TeamMemberRateRow;
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
    if (dto.currency !== undefined)
      patch.currency = dto.currency.toUpperCase() || 'USD';
    if (dto.custom_id !== undefined) patch.custom_id = dto.custom_id || null;
    if (dto.start_date !== undefined) patch.start_date = dto.start_date || null;
    if (dto.end_date !== undefined) patch.end_date = dto.end_date || null;

    // If we're moving this row from closed → open-ended, pre-close any
    // existing open-ended row to avoid violating the partial unique index.
    if (
      dto.end_date === null &&
      existing.end_date !== null
    ) {
      const startDate =
        (patch.start_date as string | null) ?? existing.start_date;
      await this.closeOpenEndedExcept(
        teamId,
        userId,
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

  /**
   * Close any open-ended row (end_date IS NULL) for this member by
   * setting its end_date to `closeBefore`. Caller computes the date so
   * we don't introduce a per-row "today" inconsistency.
   */
  private async closeOpenEnded(
    teamId: string,
    userId: string,
    closeBefore: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('team_member_rates')
      .update({ end_date: closeBefore })
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .is('end_date', null);
    if (error) throw new Error(error.message);
  }

  private async closeOpenEndedExcept(
    teamId: string,
    userId: string,
    exceptRateId: string,
    closeBefore: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('team_member_rates')
      .update({ end_date: closeBefore })
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .neq('id', exceptRateId)
      .is('end_date', null);
    if (error) throw new Error(error.message);
  }
}

function computePreviousEndDate(newStartDate: string | undefined): string {
  // If the new active rate carries its own start_date, close the prior
  // active row the day before it starts. Otherwise close at today - 1.
  // Returned as YYYY-MM-DD.
  const anchor = newStartDate
    ? new Date(`${newStartDate}T00:00:00Z`)
    : new Date();
  if (Number.isNaN(anchor.getTime())) {
    throw new BadRequestException('Invalid start_date');
  }
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}
