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
  consultant_id: string;
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
        .select(
          'id, title, status, currency, owner_id, consultant_id, created_at',
        )
        .eq('id', projectId)
        .eq('consultant_id', callerId)
        .maybeSingle(),
      this.supabase
        .from('project_access')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('user_id', callerId),
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

    let query = this.supabase
      .from('projects')
      .select(
        'id, title, status, currency, owner_id, consultant_id, created_at',
      )
      .eq('consultant_id', callerId)
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
    if (!projects?.length) return [];

    const ids = projects.map((project: { id: string }) => project.id);
    const { data: accessRows, error: accessError } = await this.supabase
      .from('project_access')
      .select('project_id')
      .eq('user_id', callerId)
      .in('project_id', ids);
    if (accessError) throw new Error(accessError.message);

    const accessible = new Set(
      (accessRows ?? []).map((row: { project_id: string }) => row.project_id),
    );
    return (projects as ConsultantFinanceProject[]).filter((project) =>
      accessible.has(project.id),
    );
  }

  private async assertVerified(callerId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('role, is_consultant_verified')
      .eq('id', callerId)
      .maybeSingle();
    if (error || !isActiveConsultant(data)) {
      throw new NotFoundException('Finance project not found');
    }
  }
}
