import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { isActiveConsultantEnrollment } from '../../../common/auth/consultant-capability';

export interface ConsultantFinanceProject {
  id: string;
  title: string;
  status: string;
  currency: string | null;
  owner_id: string | null;
  created_at: string;
}

/**
 * Which projects' money a caller may see.
 *
 * Two conditions, ANDed:
 *   1. the caller is a verified consultant (`consultant_profiles.status='verified'`)
 *      — a MARKETPLACE capability, and legitimately a persona question;
 *   2. the caller holds `role='owner'` on the project — an EXECUTION fact.
 *
 * Condition 2 used to also require `origin='consultant'`, which made the
 * execution layer answer "who is the consultant here?" — something a project must
 * not know. Dropping the origin is very nearly a no-op in practice: measured on
 * production, the scope goes from 17 (user, project) pairs to 18, losing none.
 *
 * Deliberately NOT widened to `owner|admin`, even though the finance RLS
 * (20260811092000_finance_rls_project_access_only.sql) is exactly that: only
 * `finance.controller.ts` carries ConsultantOnlyGuard, so on the invoices,
 * contracts, financials and project-economics controllers `assertProject` IS the
 * authorization — and these services use the service-role client, so RLS never
 * backstops them. Staying narrower than the policy is the point.
 */
@Injectable()
export class ConsultantFinanceAccessService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async assertProject(
    callerId: string,
    projectId: string,
  ): Promise<ConsultantFinanceProject> {
    await this.assertVerified(callerId);

    const [projectResult, accessResult] = await Promise.all([
      this.supabase
        .from('projects')
        .select('id, title, status, currency, owner_id, created_at')
        .eq('id', projectId)
        .maybeSingle(),
      this.supabase
        .from('project_access')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('user_id', callerId)
        .eq('role', 'owner'),
    ]);

    if (
      projectResult.error ||
      !projectResult.data ||
      accessResult.error ||
      !accessResult.count
    ) {
      throw new NotFoundException('Finance project not found');
    }

    return projectResult.data as ConsultantFinanceProject;
  }

  async listProjects(
    callerId: string,
    filters: {
      q?: string;
      project_id?: string;
      project_status?: string;
      currency?: string;
    } = {},
  ): Promise<ConsultantFinanceProject[]> {
    await this.assertVerified(callerId);

    const { data: accessRows, error: accessError } = await this.supabase
      .from('project_access')
      .select('project_id')
      .eq('user_id', callerId)
      .eq('role', 'owner');
    if (accessError) throw new Error(accessError.message);

    const projectIds = Array.from(
      new Set(
        (accessRows ?? [])
          .map((row: { project_id: string }) => row.project_id)
          .filter(Boolean),
      ),
    );
    if (projectIds.length === 0) return [];

    let query = this.supabase
      .from('projects')
      .select('id, title, status, currency, owner_id, created_at')
      .in('id', projectIds)
      .order('updated_at', { ascending: false });

    if (filters.project_id) query = query.eq('id', filters.project_id);
    if (filters.project_status) {
      query = query.eq('status', filters.project_status);
    }
    if (filters.currency) {
      query = query.eq('currency', filters.currency.toUpperCase());
    }
    if (filters.q?.trim()) {
      const term = filters.q.trim().replace(/[%_]/g, '');
      query = query.ilike('title', `%${term}%`);
    }

    const { data: projects, error } = await query;
    if (error) throw new Error(error.message);
    return (projects ?? []) as ConsultantFinanceProject[];
  }

  private async assertVerified(callerId: string): Promise<void> {
    const isActive = await isActiveConsultantEnrollment(
      this.supabase,
      callerId,
    );
    if (!isActive) {
      throw new NotFoundException('Finance project not found');
    }
  }
}
