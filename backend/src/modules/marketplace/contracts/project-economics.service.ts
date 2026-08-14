import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import { ContractsService } from './contracts.service';
import {
  AllocationMode,
  ProjectMemberAllocationDto as ProjectMemberAllocationInput,
  UpdateProjectEconomicsDto,
} from './dto/contracts.dto';

export interface ProjectEconomicsRow {
  project_id: string;
  contract_id: string | null;
  currency: string;
  company_percent: number;
  team_percent: number;
  /** 'equal' derives each slice on read; 'custom' uses the stored amounts. */
  allocation_mode: AllocationMode;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One member's slice of the team pool. INTERNAL — never reaches a client. */
export interface ProjectMemberAllocationRow {
  project_id: string;
  team_id: string;
  user_id: string;
  monthly_allocation: number | null;
  currency: string;
}

export interface ProjectEconomicsWithAllocations extends ProjectEconomicsRow {
  allocations: ProjectMemberAllocationRow[];
}

/** Project-level internal economics, independent of execution lifecycle. */
@Injectable()
export class ProjectEconomicsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly contracts: ContractsService,
  ) {}

  async getEconomics(
    callerId: string,
    projectId: string,
  ): Promise<ProjectEconomicsWithAllocations | null> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    const row = await this.getEconomicsRow(projectId);
    if (!row) return null;
    return { ...row, allocations: await this.getAllocations(projectId) };
  }

  async upsertEconomics(
    callerId: string,
    projectId: string,
    dto: UpdateProjectEconomicsDto,
  ): Promise<ProjectEconomicsWithAllocations> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');

    const company = Number(dto.company_percent);
    const team = Number(dto.team_percent);
    if (Math.abs(company + team - 100) > 1e-9) {
      throw new BadRequestException(
        `Company and team percentages must add up to 100 (got ${company + team}).`,
      );
    }

    const existing = await this.getEconomicsRow(projectId);
    const contract = await this.contracts.getSignedContract(projectId);
    const metadata = { ...(existing?.metadata ?? {}) };
    if (dto.hour_limits_ack !== undefined) {
      metadata.hour_limits_ack = dto.hour_limits_ack;
    }

    const currency = (
      dto.currency ??
      contract?.currency ??
      existing?.currency ??
      'USD'
    ).toUpperCase();

    if (dto.allocations !== undefined) {
      await this.replaceAllocations(
        projectId,
        currency,
        callerId,
        dto.allocations,
      );
    }

    const payload = {
      project_id: projectId,
      contract_id: contract?.id ?? existing?.contract_id ?? null,
      currency,
      company_percent: company,
      team_percent: team,
      allocation_mode:
        dto.allocation_mode ?? existing?.allocation_mode ?? 'equal',
      metadata,
      created_by: existing?.created_by ?? callerId,
      updated_at: new Date().toISOString(),
    };

    const response = await this.supabase
      .from('finance_project_settings')
      .upsert(payload, { onConflict: 'project_id' })
      .select('*')
      .single();
    const data: unknown = response.data;
    const error = response.error;
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to save the project budget split.',
      );
    }
    return {
      ...this.parseEconomics(data),
      allocations: await this.getAllocations(projectId),
    };
  }

  private async getAllocations(
    projectId: string,
  ): Promise<ProjectMemberAllocationRow[]> {
    const { data, error } = await this.supabase
      .from('finance_member_allocations')
      .select('project_id, team_id, user_id, monthly_allocation, currency')
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as ProjectMemberAllocationRow[]).map((row) => ({
      ...row,
      monthly_allocation:
        row.monthly_allocation == null ? null : Number(row.monthly_allocation),
    }));
  }

  private async replaceAllocations(
    projectId: string,
    currency: string,
    callerId: string,
    allocations: ProjectMemberAllocationInput[],
  ): Promise<void> {
    if (allocations.length > 0) {
      const rows = allocations.map((allocation) => ({
        project_id: projectId,
        team_id: allocation.team_id,
        user_id: allocation.user_id,
        monthly_allocation:
          allocation.monthly_allocation == null
            ? null
            : Number(allocation.monthly_allocation),
        currency,
        created_by: callerId,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await this.supabase
        .from('finance_member_allocations')
        .upsert(rows, { onConflict: 'project_id,team_id,user_id' });
      if (error) throw new BadRequestException(error.message);
    }

    const keep = new Set(
      allocations.map(
        (allocation) => `${allocation.team_id}:${allocation.user_id}`,
      ),
    );
    const existingRows = await this.getAllocations(projectId);
    const stale = existingRows.filter(
      (row) => !keep.has(`${row.team_id}:${row.user_id}`),
    );
    for (const row of stale) {
      const { error } = await this.supabase
        .from('finance_member_allocations')
        .delete()
        .eq('project_id', projectId)
        .eq('team_id', row.team_id)
        .eq('user_id', row.user_id);
      if (error) throw new BadRequestException(error.message);
    }
  }

  private async getEconomicsRow(
    projectId: string,
  ): Promise<ProjectEconomicsRow | null> {
    const response = await this.supabase
      .from('finance_project_settings')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
    const data: unknown = response.data;
    const error = response.error;
    if (error) throw new Error(error.message);
    return data ? this.parseEconomics(data) : null;
  }

  private parseEconomics(row: unknown): ProjectEconomicsRow {
    const parsed = row as ProjectEconomicsRow;
    return {
      ...parsed,
      company_percent: Number(parsed.company_percent ?? 0),
      team_percent: Number(parsed.team_percent ?? 0),
      allocation_mode: parsed.allocation_mode ?? 'equal',
      metadata: parsed.metadata ?? {},
    };
  }
}
