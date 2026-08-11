import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { isActiveConsultant } from '../../common/auth/consultant-capability';

export interface ConsultantFinanceProject {
  id: string;
  title: string;
  status: string;
  currency: string | null;
  owner_id: string | null;
  created_at: string;
}

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
        .eq('role', 'owner')
        .eq('origin', 'consultant'),
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
      .eq('role', 'owner')
      .eq('origin', 'consultant');
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
    const { data, error } = await this.supabase
      .from('profiles')
      .select('is_consultant_verified')
      .eq('id', callerId)
      .maybeSingle();
    if (error || !isActiveConsultant(data)) {
      throw new NotFoundException('Finance project not found');
    }
  }
}
