import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ConsultantFinanceAccessService } from '../finance/consultant-finance-access.service';
import {
  billingPeriodsForRange,
  configForCadence,
  lastBillablePeriod,
} from '../contracts/billing-period';
import {
  ContractsService,
  type ContractRow,
} from '../contracts/contracts.service';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
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
 * How far into the future a single catch-up run will draft advance (prepaid)
 * invoices. Without a bound, one "Generate from contract" click on a 12-month
 * prepaid retainer with a long lead time would draft most of the year at once.
 */
const ADVANCE_LOOKAHEAD_DAYS = 45;

/**
 * How far ahead of a contract's service start its first invoice may be raised.
 * Matches `@Max(90)` on `invoice_offset_days`, and is what lets the contract
 * scan reach a prepaid contract whose first invoice predates its start date.
 */
const MAX_ADVANCE_LEAD_DAYS = 90;

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
    private readonly financeAccess: ConsultantFinanceAccessService,
    private readonly projectAuth: ProjectAuthorizationService,
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

  /**
   * On-demand catch-up for ONE project, triggered by the consultant from the
   * Invoices page rather than by the cron.
   *
   * Unlike the nightly run — which bills only the most recently billable
   * period — this drafts every period the contract has not been billed for
   * yet, so a project whose automation was off (or which was set up midway
   * through its term) can be brought current in one click. Duplicate
   * suppression is the same partial unique index, so pressing the button twice
   * is harmless.
   *
   * On an ARREARS contract "not billed yet" means every period that has closed.
   * On an ADVANCE (prepaid) contract it necessarily includes periods that have
   * not started — that is the point — so it is bounded by
   * `ADVANCE_LOOKAHEAD_DAYS` instead. Without that bound, one click on a
   * 12-month prepaid contract with a long lead would draft most of the year at
   * once.
   *
   * Invoices are still created as DRAFTS; nothing reaches the client until the
   * consultant issues it.
   */
  async generateDraftsForProject(
    callerId: string,
    projectId: string,
    today = new Date().toISOString().slice(0, 10),
  ): Promise<InvoiceRunResult> {
    await this.financeAccess.assertProject(callerId, projectId);

    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .eq('project_id', projectId)
      .in('status', ['signed', 'active'])
      .order('version', { ascending: false })
      .limit(1);
    if (error) throw new BadRequestException(error.message);

    const contract = ((data ?? []) as ContractRow[])[0];
    if (!contract) {
      throw new BadRequestException(
        'This project has no signed contract yet. Sign the contract before generating invoices.',
      );
    }
    if (!contract.service_start_date || !contract.service_end_date) {
      throw new BadRequestException(
        'Set the service start date and term on the contract before generating invoices.',
      );
    }

    const teamConfig =
      contract.period_source === 'team_config'
        ? await this.contracts.getTeamPayPeriodConfig(contract.project_id)
        : null;

    const advance = contract.billing_timing === 'advance';
    const lookaheadLimit = advance
      ? addDaysIso(today, ADVANCE_LOOKAHEAD_DAYS)
      : today;

    const allPeriods = billingPeriodsForRange(
      configForCadence(contract.invoice_cadence, teamConfig),
      contract.service_start_date,
      contract.service_end_date,
      {
        invoiceOffsetDays: contract.invoice_offset_days,
        dueDays: contract.due_days,
        billingTiming: contract.billing_timing,
      },
    );
    const periods = allPeriods.filter((p) =>
      advance
        ? // Prepaid: the invoice date has arrived, and the period starts inside
          // the look-ahead window.
          p.invoiceDate <= today && p.periodStart <= lookaheadLimit
        : // Postpaid: only periods that have actually closed.
          p.periodEnd < today && p.invoiceDate <= today,
    );

    // A silently truncated run reads as "everything is billed". Say what was
    // held back so the consultant knows to come back for it.
    if (advance) {
      const deferred = allPeriods.filter(
        (p) => p.invoiceDate <= today && p.periodStart > lookaheadLimit,
      ).length;
      if (deferred > 0) {
        this.logger.log(
          `Contract ${contract.id}: deferred ${deferred} advance period(s) beyond the ${ADVANCE_LOOKAHEAD_DAYS}-day look-ahead.`,
        );
      }
    }

    const result: InvoiceRunResult = {
      scanned: periods.length,
      created: 0,
      skipped: 0,
      failed: 0,
    };

    for (const period of periods) {
      try {
        const invoice = await this.invoices.createScheduledInvoice(
          contract,
          period.periodStart,
          period.periodEnd,
          period.dueDate,
          period.invoiceDate,
        );
        // null means the unique index rejected it — already billed.
        if (!invoice) {
          result.skipped += 1;
          continue;
        }
        result.created += 1;
        try {
          await this.invoices.renderAndStorePdf(invoice, callerId);
        } catch (err) {
          this.logger.error(
            `Invoice ${invoice.id} created but PDF render failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      } catch (err) {
        result.failed += 1;
        this.logger.error(
          `On-demand invoice failed for contract ${contract.id} period ${period.periodStart}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

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
        billingTiming: contract.billing_timing,
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

  /**
   * Active projects whose contract's service window is in play.
   *
   * The start-date filter reaches `MAX_ADVANCE_LEAD_DAYS` into the future
   * rather than stopping at today: a prepaid contract's FIRST invoice is
   * raised before its service starts, so a `service_start_date <= today` scan
   * would never see it and the first period would silently go unbilled.
   * Contracts that are not yet due are then filtered out by
   * `lastBillablePeriod`, which enforces the real invoice date.
   */
  private async findBillableContracts(today: string): Promise<ContractRow[]> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*, project:projects!contracts_project_id_fkey(status)')
      .in('status', ['signed', 'active'])
      .lte('service_start_date', addDaysIso(today, MAX_ADVANCE_LEAD_DAYS));
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
    const consultantId = await this.projectAuth.getProjectConsultantId(
      contract.project_id,
    );
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
        link_url: `/finance?tab=invoices&projectId=${contract.project_id}`,
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
          link_url: `/finance/${row.id}`,
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
