import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  EMPTY_INVOICE_SUMMARY,
  type ProjectCommercePort,
  type ProjectInvoiceSummary,
} from '../../execution/projects/ports/project-commerce.port';

/**
 * Marketplace's implementation of the execution-side commerce port.
 *
 * This is the only place that reads `contracts` and `invoices` on execution's
 * behalf. The queries are the ones that used to live inline in
 * `ProjectsService`, moved rather than rewritten so the behaviour is unchanged.
 *
 * Pre-existing and deliberately not addressed here: the veto and the cascade
 * are separate statements with no transaction around them, so a project can in
 * principle gain a sent contract between the two. Routing them through a port
 * makes that gap easier to see but does not widen it.
 */
@Injectable()
export class ProjectCommerceAdapter implements ProjectCommercePort {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async assertProjectDeletable(projectId: string): Promise<void> {
    const [contractResult, invoiceResult] = await Promise.all([
      this.supabase
        .from('contracts')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .in('status', ['sent', 'signed']),
      this.supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .in('status', ['issued', 'sent']),
    ]);
    if (contractResult.error) throw new Error(contractResult.error.message);
    if (invoiceResult.error) throw new Error(invoiceResult.error.message);
    if ((contractResult.count ?? 0) > 0 || (invoiceResult.count ?? 0) > 0) {
      throw new BadRequestException(
        'Cannot delete this project while it has sent or signed contracts or issued or sent invoices. End or cancel contracts and pay or void invoices, then try again.',
      );
    }
  }

  async purgeDraftCommerce(projectId: string): Promise<void> {
    const { error: invoiceDeleteError } = await this.supabase
      .from('invoices')
      .delete()
      .eq('project_id', projectId)
      .eq('status', 'draft');
    if (invoiceDeleteError) throw new Error(invoiceDeleteError.message);

    const { error: contractDeleteError } = await this.supabase
      .from('contracts')
      .delete()
      .eq('project_id', projectId)
      .eq('status', 'draft');
    if (contractDeleteError) throw new Error(contractDeleteError.message);
  }

  async getInvoiceSummary(
    projectIds: string[],
    range: { from?: string; to?: string },
  ): Promise<ProjectInvoiceSummary> {
    let query = this.supabase
      .from('invoices')
      .select('status, total, project_id, created_at')
      .in('project_id', projectIds);
    if (range.from) query = query.gte('created_at', range.from);
    if (range.to) query = query.lte('created_at', range.to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{
      status: string;
      total: string | number;
    }>;
    const statusCounts: Record<string, number> = {
      ...EMPTY_INVOICE_SUMMARY.status_counts,
    };
    let totalAmount = 0;
    for (const row of rows) {
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
      totalAmount += Number(row.total ?? 0);
    }

    return {
      total_count: rows.length,
      total_amount: totalAmount,
      status_counts: statusCounts,
    };
  }
}
