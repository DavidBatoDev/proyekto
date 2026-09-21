import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { isActiveConsultantEnrollment } from '../../../../common/auth/consultant-capability';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';

export type EngagementStatus = 'engaged' | 'grandfathered' | 'ineligible';

/**
 * Data that pre-dates contract enforcement stays valid. project_access rows
 * and time logs created before this date grandfather their holders.
 */
const ENFORCEMENT_CUTOFF = '2026-08-27T00:00:00Z';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5_000;

interface CacheEntry {
  status: EngagementStatus;
  expires: number;
}

/**
 * The single "is user X contract-engaged on project P" predicate, shared by
 * the timer gate, finance-book payroll membership, and payout eligibility —
 * one definition so the three surfaces can never disagree.
 *
 * - `engaged`: the user holds a SIGNED seat (`contract_positions.signed_at`)
 *   on a live contract (`signed`/`active`) linked to the project — directly
 *   via `contracts.project_id`, or through `engagement_project_links` for
 *   engagement-family contracts.
 * - `grandfathered`: no live seat, but the user predates enforcement — a
 *   verified consultant with a pre-cutoff `project_access` row, or anyone
 *   with pre-cutoff time logs on the project. Finance was free for every
 *   verified consultant before books; enforcement must not strand them.
 * - `ineligible`: neither.
 *
 * Results are cached in-process for 60s (per user+project). Contract
 * signing/amendment therefore takes at most a minute to be reflected — an
 * accepted staleness window; there is deliberately no cross-module
 * invalidation hook, keeping this module dependency-free so both execution
 * (team-time) and marketplace (finance) can import it.
 */
@Injectable()
export class EngagementEligibilityService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getEngagementStatus(
    userId: string,
    projectId: string,
  ): Promise<EngagementStatus> {
    const key = `${userId}:${projectId}`;
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.status;

    const status = await this.computeStatus(userId, projectId);
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
    this.cache.set(key, { status, expires: Date.now() + CACHE_TTL_MS });
    return status;
  }

  /** Test hook and manual invalidation (e.g. right after signing). */
  invalidate(userId?: string, projectId?: string): void {
    if (userId && projectId) {
      this.cache.delete(`${userId}:${projectId}`);
      return;
    }
    this.cache.clear();
  }

  private async computeStatus(
    userId: string,
    projectId: string,
  ): Promise<EngagementStatus> {
    if (await this.hasLiveSignedSeat(userId, projectId)) return 'engaged';
    if (await this.isGrandfathered(userId, projectId)) return 'grandfathered';
    return 'ineligible';
  }

  private async hasLiveSignedSeat(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('contract_positions')
      .select('contract:contracts(id, status, project_id, engagement_id)')
      .eq('user_id', userId)
      .not('signed_at', 'is', null);
    if (error) throw new Error(error.message);

    const contracts = (
      (data ?? []) as unknown as Array<{
        contract: {
          id: string;
          status: string;
          project_id: string | null;
          engagement_id: string | null;
        } | null;
      }>
    )
      .map((row) => row.contract)
      .filter(
        (contract): contract is NonNullable<typeof contract> =>
          Boolean(contract) &&
          ['signed', 'active'].includes(contract?.status ?? ''),
      );
    if (contracts.length === 0) return false;
    if (contracts.some((contract) => contract.project_id === projectId)) {
      return true;
    }

    // Flexible-scope contracts link to projects through the engagement.
    const engagementIds = [
      ...new Set(
        contracts
          .map((contract) => contract.engagement_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (engagementIds.length === 0) return false;

    const { count, error: linkError } = await this.supabase
      .from('engagement_project_links')
      .select('engagement_id', { count: 'exact', head: true })
      .in('engagement_id', engagementIds)
      .eq('project_id', projectId);
    if (linkError) throw new Error(linkError.message);
    return Boolean(count);
  }

  private async isGrandfathered(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const { count: logCount, error: logError } = await this.supabase
      .from('task_time_logs')
      .select('id', { count: 'exact', head: true })
      .eq('member_user_id', userId)
      .eq('project_id', projectId)
      .lt('created_at', ENFORCEMENT_CUTOFF);
    if (logError) throw new Error(logError.message);
    if (logCount) return true;

    const { data: accessRow, error: accessError } = await this.supabase
      .from('project_access')
      .select('granted_at')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .lt('granted_at', ENFORCEMENT_CUTOFF)
      .maybeSingle<{ granted_at: string }>();
    if (accessError) throw new Error(accessError.message);
    if (!accessRow) return false;

    return isActiveConsultantEnrollment(this.supabase, userId);
  }
}
