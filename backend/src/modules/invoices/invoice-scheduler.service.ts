import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import {
  configForCadence,
  lastBillablePeriod,
} from '../contracts/billing-period';
import {
  ContractsService,
  type ContractRow,
} from '../contracts/contracts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';

export interface InvoiceRunResult {
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  /** Populated when the automation flag is off, so a dry run is obvious. */
  disabled?: boolean;
}

/**
 * Creates the client invoice for each closed billing period.
 *
 * Triggered externally (Cloud Scheduler → `POST /api/invoices/cron/run`), the
 * same shape as the meetings reminder cron — this project has neither
 * `@nestjs/schedule` nor `pg_cron`, and an in-process timer would fire once per
 * Cloud Run instance rather than once per period.
 *
 * The run is safe to repeat: duplicate suppression is the partial unique index
 * on `(contract_id, period_start, period_end) WHERE origin = 'scheduled'`, so a
 * retry after a partial failure cannot double-bill a client.
 *
 * Invoices are always left as DRAFTS. Nothing reaches a client without a
 * consultant reviewing and issuing it.
 */
@Injectable()
export class InvoiceSchedulerService {
  private readonly logger = new Logger(InvoiceSchedulerService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly contracts: ContractsService,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async runDueInvoices(
    today = new Date().toISOString().slice(0, 10),
  ): Promise<InvoiceRunResult> {
    const enabled =
      String(
        this.config.get<string>('INVOICE_AUTOMATION_ENABLED') ?? '',
      ).toLowerCase() === 'true';

    const contracts = await this.findBillableContracts(today);
    const result: InvoiceRunResult = {
      scanned: contracts.length,
      created: 0,
      skipped: 0,
      failed: 0,
    };

    if (!enabled) {
      // Staged rollout: the endpoint stays callable so the schedule and the
      // scan can be verified in production before any invoice is written.
      this.logger.log(
        `Invoice automation is disabled; ${contracts.length} contract(s) would have been considered.`,
      );
      return { ...result, skipped: contracts.length, disabled: true };
    }

    for (const contract of contracts) {
      try {
        const created = await this.billContract(contract, today);
        if (created) result.created += 1;
        else result.skipped += 1;
      } catch (err) {
        result.failed += 1;
        this.logger.error(
          `Scheduled invoice failed for contract ${contract.id} (project ${contract.project_id}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.emitEndingSoonNotices(today);
    return result;
  }

  private async billContract(
    contract: ContractRow,
    today: string,
  ): Promise<boolean> {
    if (!contract.service_start_date || !contract.service_end_date)
      return false;

    const teamConfig =
      contract.period_source === 'team_config'
        ? await this.contracts.getTeamPayPeriodConfig(contract.project_id)
        : null;

    const period = lastBillablePeriod(
      configForCadence(contract.invoice_cadence, teamConfig),
      contract.service_start_date,
      contract.service_end_date,
      today,
      {
        invoiceOffsetDays: contract.invoice_offset_days,
        dueDays: contract.due_days,
      },
    );
    if (!period) return false;

    const invoice = await this.invoices.createScheduledInvoice(
      contract,
      period.periodStart,
      period.periodEnd,
      period.dueDate,
      period.invoiceDate,
    );
    // null means the unique index rejected it — already billed for this period.
    if (!invoice) return false;

    // A failed render must not undo the invoice: the consultant can regenerate
    // the document, but re-running the insert would be suppressed as a
    // duplicate and the period would silently never be billed.
    try {
      await this.invoices.renderAndStorePdf(invoice, contract.created_by);
    } catch (err) {
      this.logger.error(
        `Invoice ${invoice.id} created but PDF render failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.notifyDraftReady(
      contract,
      invoice.id,
      invoice.number,
      period.periodStart,
      period.periodEnd,
    );
    return true;
  }

  /** Active projects whose contract's service window contains today. */
  private async findBillableContracts(today: string): Promise<ContractRow[]> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*, project:projects!contracts_project_id_fkey(status)')
      .in('status', ['signed', 'active'])
      .lte('service_start_date', today);
    if (error) throw new Error(error.message);

    return (
      (data ?? []) as Array<
        ContractRow & {
          project: { status: string } | Array<{ status: string }> | null;
        }
      >
    )
      .filter((row) => {
        const project = Array.isArray(row.project)
          ? row.project[0]
          : row.project;
        // Only an ACTIVE project bills. A paused or completed project keeps its
        // contract but stops generating invoices.
        if (project?.status !== 'active') return false;
        // Keep billing through the final period after service ends, but stop
        // once the wind-down window has also closed.
        const cutoff = row.contract_end_date ?? row.service_end_date;
        return !cutoff || today <= addDaysIso(cutoff, 45);
      })
      .map((row) => {
        // Drop the joined project before returning — downstream code takes a
        // plain ContractRow and must not see the embedded relation.
        const contract = { ...row } as Partial<typeof row>;
        delete contract.project;
        return contract as ContractRow;
      });
  }

  private async notifyDraftReady(
    contract: ContractRow,
    invoiceId: string,
    invoiceNumber: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<void> {
    const { data: project } = await this.supabase
      .from('projects')
      .select('consultant_id, title')
      .eq('id', contract.project_id)
      .maybeSingle();
    const consultantId = (project as { consultant_id: string | null } | null)
      ?.consultant_id;
    if (!consultantId) return;

    try {
      await this.notifications.createNotification({
        user_id: consultantId,
        project_id: contract.project_id,
        // System-generated: no acting user.
        type_name: 'invoice_draft_ready',
        content: {
          invoice_id: invoiceId,
          invoice_number: invoiceNumber,
          period_start: periodStart,
          period_end: periodEnd,
          message: `Invoice ${invoiceNumber} is drafted for ${periodStart} – ${periodEnd}. Review and send it.`,
        },
        link_url: `/project/${contract.project_id}/payments`,
      });
    } catch (err) {
      this.logger.warn(
        `Could not notify consultant about invoice ${invoiceId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Warns the consultant before a contract's service window closes. */
  private async emitEndingSoonNotices(today: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('id, project_id, notice_days, service_end_date, created_by')
      .in('status', ['signed', 'active'])
      .not('service_end_date', 'is', null);
    if (error) return;

    for (const row of (data ?? []) as Array<{
      id: string;
      project_id: string;
      notice_days: number | null;
      service_end_date: string;
      created_by: string | null;
    }>) {
      const lead = row.notice_days ?? 30;
      // Fires on exactly one day so repeated runs do not spam; no claim stamp
      // is needed for a purely advisory notice.
      if (addDaysIso(today, lead) !== row.service_end_date) continue;
      if (!row.created_by) continue;

      try {
        await this.notifications.createNotification({
          user_id: row.created_by,
          project_id: row.project_id,
          // System-generated: no acting user.
          type_name: 'contract_ending_soon',
          content: {
            contract_id: row.id,
            service_end_date: row.service_end_date,
            message: `This contract's service period ends on ${row.service_end_date}. Renew or extend it if the work continues.`,
          },
          link_url: `/project/${row.project_id}/contract`,
        });
      } catch {
        // Advisory only.
      }
    }
  }
}

function addDaysIso(date: string, days: number): string {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
