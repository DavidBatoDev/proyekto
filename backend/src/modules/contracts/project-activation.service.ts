import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
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

/** Economics plus the per-member split, as the Financials panel reads it. */
export interface ProjectEconomicsWithAllocations extends ProjectEconomicsRow {
  allocations: ProjectMemberAllocationRow[];
}

export type ChecklistSeverity = 'blocker' | 'warning';

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  severity: ChecklistSeverity;
  /** Human-readable reason when `ok` is false. */
  detail: string | null;
  /** Where in the app the consultant fixes this. */
  fixPath: string | null;
}

export interface ActivationChecklist {
  project_id: string;
  ready: boolean;
  items: ChecklistItem[];
}

interface MemberRateRow {
  user_id: string;
  rate_type: 'hourly' | 'fixed' | null;
  hourly_rate: number | null;
  fixed_amount: number | null;
  currency: string;
  weekly_limit_hours: number | null;
  monthly_limit_hours: number | null;
  end_date: string | null;
}

/**
 * Owns the gate between a `draft` project and an `active` one.
 *
 * "Active" means the project is paying the consultant and the team, so every
 * input the billing and payout machinery needs must be present BEFORE the flip:
 * a signed contract (what the client owes), an economics split (how revenue
 * divides), and a rate for every member (what each person is owed). Activating
 * without these produces invoices with no price and payouts with no rate.
 */
@Injectable()
export class ProjectActivationService {
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
    // Guard in the service as well as the DB CHECK so the caller gets a usable
    // message instead of a raw constraint violation.
    if (Math.abs(company + team - 100) > 1e-9) {
      throw new BadRequestException(
        `Company and team percentages must add up to 100 (got ${company + team}).`,
      );
    }

    const existing = await this.getEconomicsRow(projectId);
    const contract = await this.contracts.getLiveContract(projectId);
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

    // Allocations first, percentages second: if the allocation write fails, the
    // split the consultant already trusts is left exactly as it was rather than
    // half-applied against a set of member amounts that never landed.
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

    const { data, error } = await this.supabase
      .from('finance_project_settings')
      .upsert(payload, { onConflict: 'project_id' })
      .select('*')
      .single();
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

  /** Every stored per-member slice on the project. */
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

  /**
   * Make the stored allocations match the payload exactly.
   *
   * Deletion is how "remove this member from the split" persists — an upsert
   * alone would leave a removed member's slice behind, still drawing from the
   * pool in every later calculation.
   */
  private async replaceAllocations(
    projectId: string,
    currency: string,
    callerId: string,
    allocations: ProjectMemberAllocationInput[],
  ): Promise<void> {
    if (allocations.length > 0) {
      const rows = allocations.map((a) => ({
        project_id: projectId,
        team_id: a.team_id,
        user_id: a.user_id,
        monthly_allocation:
          a.monthly_allocation == null ? null : Number(a.monthly_allocation),
        currency,
        created_by: callerId,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await this.supabase
        .from('finance_member_allocations')
        .upsert(rows, { onConflict: 'project_id,team_id,user_id' });
      if (error) throw new BadRequestException(error.message);
    }

    const keep = new Set(allocations.map((a) => `${a.team_id}:${a.user_id}`));
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

  async getChecklist(
    callerId: string,
    projectId: string,
  ): Promise<ActivationChecklist> {
    await this.projectAuth.assertRole(callerId, projectId, 'admin');
    return this.buildChecklist(projectId);
  }

  /**
   * Throws with the failing item keys unless the project is ready to activate.
   * Called by ProjectsService when a status update targets `active`.
   */
  async assertActivationReady(projectId: string): Promise<void> {
    const checklist = await this.buildChecklist(projectId);
    if (checklist.ready) return;
    const blockers = checklist.items.filter(
      (item) => !item.ok && item.severity === 'blocker',
    );
    throw new BadRequestException({
      message:
        'This project is not ready to be activated yet. Complete the outstanding items in the Contract tab.',
      code: 'PROJECT_ACTIVATION_INCOMPLETE',
      items: blockers.map((item) => ({
        key: item.key,
        label: item.label,
        detail: item.detail,
        fixPath: item.fixPath,
      })),
    });
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async buildChecklist(
    projectId: string,
  ): Promise<ActivationChecklist> {
    const financialsPath = `/finance?tab=overview&projectId=${projectId}`;
    const timePath = `/project/${projectId}/settings/time`;
    const teamsPath = `/project/${projectId}/settings/teams`;

    const [contract, economics, teamRows, project, consultantId] =
      await Promise.all([
        this.contracts.getLiveContract(projectId),
        this.getEconomicsRow(projectId),
        this.getCuratedMembers(projectId),
        this.getProject(projectId),
        this.projectAuth.getProjectConsultantId(projectId),
      ]);

    // Existing agreements now have a focused document route. When there is no
    // live agreement yet, the project-filtered list resolves its latest draft
    // and carries the requested inspector section forward.
    const contractPath = (section: string) =>
      contract
        ? `/finance/${contract.id}?section=${section}`
        : `/finance?tab=contracts&projectId=${projectId}&step=${section}`;

    const items: ChecklistItem[] = [];

    // 1 — a fully signed contract with usable commercial terms.
    const missingTerms: string[] = [];
    if (contract) {
      if (!contract.service_start_date || !contract.service_end_date) {
        missingTerms.push('service dates');
      }
      if (
        (contract.billing_mode === 'retainer' ||
          contract.billing_mode === 'hybrid') &&
        !(Number(contract.recurring_fee) > 0)
      ) {
        missingTerms.push('recurring fee');
      }
      if (
        (contract.billing_mode === 'time_based' ||
          contract.billing_mode === 'hybrid') &&
        !(Number(contract.client_hourly_rate) > 0)
      ) {
        missingTerms.push('client hourly rate');
      }
    }
    items.push({
      key: 'contract_signed',
      label: 'Signed contract with complete commercial terms',
      ok: Boolean(contract) && missingTerms.length === 0,
      severity: 'blocker',
      detail: !contract
        ? 'No signed contract yet — both the consultant and the client must sign.'
        : missingTerms.length > 0
          ? `Contract is missing: ${missingTerms.join(', ')}.`
          : null,
      fixPath: contractPath(contract ? 'signatures' : 'terms'),
    });

    // 2 — the revenue split.
    const splitOk =
      Boolean(economics) &&
      Math.abs(
        Number(economics?.company_percent ?? 0) +
          Number(economics?.team_percent ?? 0) -
          100,
      ) < 1e-9;
    items.push({
      key: 'economics_set',
      label: 'Budget split set (company vs team)',
      ok: splitOk,
      severity: 'blocker',
      detail: splitOk
        ? null
        : 'Set what percentage of project revenue goes to the company and what goes to the team pool.',
      // Lives in Financials now, not on the contract — the split is internal
      // and contracts get built on screen shares with the client.
      fixPath: financialsPath,
    });

    // 3 — a team with curated members.
    items.push({
      key: 'team_attached',
      label: 'Delivery team attached with members',
      ok: teamRows.length > 0,
      severity: 'blocker',
      detail:
        teamRows.length > 0
          ? null
          : 'Attach a team and curate at least one member onto this project.',
      fixPath: teamsPath,
    });

    // 4/5 — every curated member has a usable rate, and hourly members have a
    // cap (or the consultant explicitly opted out).
    const rateIssues: string[] = [];
    const capIssues: string[] = [];
    if (teamRows.length > 0) {
      const rates = await this.getActiveMemberRates(projectId);
      for (const member of teamRows) {
        const rate = rates.get(`${member.team_id}:${member.user_id}`);
        const label = member.label;
        if (!rate) {
          rateIssues.push(`${label} (no rate)`);
          continue;
        }
        const rateType = rate.rate_type ?? 'hourly';
        if (rateType === 'fixed') {
          if (!(Number(rate.fixed_amount) > 0)) {
            rateIssues.push(`${label} (fixed rate has no amount)`);
          }
        } else {
          if (!(Number(rate.hourly_rate) > 0)) {
            rateIssues.push(`${label} (hourly rate is zero)`);
          }
          const hasCap =
            rate.weekly_limit_hours != null || rate.monthly_limit_hours != null;
          if (!hasCap) capIssues.push(label);
        }
      }
    }

    items.push({
      key: 'member_rates_set',
      label: 'Every project member has a rate',
      ok: teamRows.length > 0 && rateIssues.length === 0,
      severity: 'blocker',
      detail:
        teamRows.length === 0
          ? 'Attach a team first.'
          : rateIssues.length > 0
            ? `Missing or incomplete rates: ${rateIssues.join(', ')}.`
            : null,
      fixPath: timePath,
    });

    const capsAcknowledged = economics?.metadata?.hour_limits_ack === true;
    items.push({
      key: 'hour_limits_set',
      label: 'Hourly members have weekly or monthly hour limits',
      ok: capIssues.length === 0 || capsAcknowledged,
      severity: 'blocker',
      detail:
        capIssues.length === 0 || capsAcknowledged
          ? null
          : `No hour limit set for: ${capIssues.join(', ')}. Set a weekly or monthly cap, or acknowledge running without caps.`,
      fixPath: timePath,
    });

    // 6 — someone to bill.
    const ownerIdentified = Boolean(
      project?.owner_id && project.owner_id !== consultantId,
    );
    const clientOnContract = Boolean(
      contract?.client_user_id ||
      contract?.client_email ||
      contract?.client_name,
    );
    items.push({
      key: 'client_identified',
      label: 'Client identified for invoicing',
      ok: ownerIdentified || clientOnContract,
      severity: 'blocker',
      detail:
        ownerIdentified || clientOnContract
          ? null
          : 'Add the client to the project, or fill in the client details on the contract.',
      fixPath: contractPath('parties'),
    });

    // 7 — currency consistency. A warning, not a blocker: payouts are already
    // single-currency per bucket, so a mismatch degrades reporting rather than
    // breaking billing.
    const currencyMismatch = await this.findCurrencyMismatch(
      projectId,
      contract?.currency ?? economics?.currency ?? null,
    );
    items.push({
      key: 'currency_consistent',
      label: 'Contract and member rates use the same currency',
      ok: currencyMismatch === null,
      severity: 'warning',
      detail: currencyMismatch,
      fixPath: timePath,
    });

    const ready = items.every((item) => item.ok || item.severity === 'warning');
    return { project_id: projectId, ready, items };
  }

  private async getEconomicsRow(
    projectId: string,
  ): Promise<ProjectEconomicsRow | null> {
    const { data, error } = await this.supabase
      .from('finance_project_settings')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
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

  private async getProject(projectId: string): Promise<{
    owner_id: string | null;
    status: string | null;
  } | null> {
    const { data } = await this.supabase
      .from('projects')
      .select('owner_id, status')
      .eq('id', projectId)
      .maybeSingle();
    return (
      (data as {
        owner_id: string | null;
        status: string | null;
      } | null) ?? null
    );
  }

  /** Curated members across every team attached to the project. */
  private async getCuratedMembers(
    projectId: string,
  ): Promise<Array<{ team_id: string; user_id: string; label: string }>> {
    const { data, error } = await this.supabase
      .from('project_team_members')
      .select(
        'team_id, user_id, user:profiles!project_team_members_user_id_fkey(display_name, first_name, last_name, email)',
      )
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);

    return (
      (data ?? []) as unknown as Array<{
        team_id: string;
        user_id: string;
        user:
          | Array<Record<string, string | null>>
          | Record<string, string | null>
          | null;
      }>
    ).map((row) => {
      const profile = Array.isArray(row.user) ? row.user[0] : row.user;
      const composed = [profile?.first_name, profile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      return {
        team_id: row.team_id,
        user_id: row.user_id,
        label:
          profile?.display_name || composed || profile?.email || row.user_id,
      };
    });
  }

  /** Active (open-ended) rate per `${team_id}:${user_id}` for this project. */
  private async getActiveMemberRates(
    projectId: string,
  ): Promise<Map<string, MemberRateRow & { team_id: string }>> {
    const { data, error } = await this.supabase
      .from('team_member_rates')
      .select(
        'team_id, user_id, rate_type, hourly_rate, fixed_amount, currency, weekly_limit_hours, monthly_limit_hours, end_date',
      )
      .eq('project_id', projectId)
      .is('end_date', null);
    if (error) throw new Error(error.message);

    const map = new Map<string, MemberRateRow & { team_id: string }>();
    for (const row of (data ?? []) as Array<
      MemberRateRow & { team_id: string }
    >) {
      map.set(`${row.team_id}:${row.user_id}`, row);
    }
    return map;
  }

  private async findCurrencyMismatch(
    projectId: string,
    expected: string | null,
  ): Promise<string | null> {
    if (!expected) return null;
    const { data, error } = await this.supabase
      .from('team_member_rates')
      .select('currency')
      .eq('project_id', projectId)
      .is('end_date', null);
    if (error) return null;

    const currencies = new Set(
      ((data ?? []) as Array<{ currency: string }>).map((r) =>
        (r.currency ?? '').toUpperCase(),
      ),
    );
    currencies.delete('');
    const target = expected.toUpperCase();
    const others = [...currencies].filter((c) => c !== target);
    if (others.length === 0) return null;
    return `Contract is in ${target} but some member rates use ${others.join(', ')}. Margin reporting will mix currencies.`;
  }
}
