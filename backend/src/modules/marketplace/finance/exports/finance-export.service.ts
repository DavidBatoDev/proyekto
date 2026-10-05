import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  MASKED_MEMBER_LABEL,
  TimeAuthorityService,
} from '../../../execution/time/time-authority.service';
import { failTimeRead } from '../../../execution/time/time-reports.service';
import type {
  ContextKind,
  EntryAuthRow,
} from '../../../execution/time/time.types';
import {
  FinanceBookAccessService,
  type FinanceBookRow,
} from '../books/finance-book-access.service';
import {
  type ExportColumn,
  exportColumns,
  type ExportKind,
  timeEntryStatus,
} from './export-columns';
import {
  buildCsv,
  buildPdf,
  buildXlsx,
  type ExportRow,
} from './export-formats';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportOptions {
  kind: ExportKind;
  format: ExportFormat;
  from?: string;
  to?: string;
}

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/** One `time_entries` row of a time export (M3 names; column-hint embeds only). */
interface TimeEntryExportRow extends EntryAuthRow {
  member_display_name_snapshot: string | null;
  context_label_snapshot: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  payable_seconds: number | null;
  break_seconds: number | null;
  break_minutes: number | null;
  source: string | null;
  flagged_reason: string | null;
  legacy_status: string | null;
  payout_id: string | null;
  rate_snapshot?: number | string | null;
  currency_snapshot?: string | null;
  amount_snapshot?: number | string | null;
  project: { title: string | null } | null;
  task: { title: string | null } | null;
  timesheet: {
    status: string | null;
    period_start: string | null;
    period_end: string | null;
  } | null;
}

const TIME_EXPORT_SELECT =
  'id, project_id, member_user_id, member_display_name_snapshot, context_kind, context_ref, ' +
  'context_label_snapshot, team_id, workspace_id, engagement_assignment_id, timesheet_id, started_at, ' +
  'ended_at, duration_seconds, payable_seconds, break_seconds, break_minutes, source, flagged_reason, ' +
  'legacy_status, payout_id, project:projects!project_id(title), task:roadmap_tasks!task_id(title), ' +
  'timesheet:timesheets!timesheet_id(status, period_start, period_end)';

const FOR_FALLBACK: Record<ContextKind, string> = {
  team: 'Team',
  workspace: 'Workspace',
  assignment: 'Agreement',
  personal: 'Just me',
};

function toHours(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  return Number((Number(seconds) / 3600).toFixed(2));
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface PayoutRow {
  member_user_id: string | null;
  currency: string | null;
  total_amount: number | null;
  status: string | null;
  paid_at: string | null;
  reference_number: string | null;
  method_label: string | null;
  note: string | null;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Builds role-filtered downloadable files (CSV/XLSX/PDF) for a finance book.
 *
 * Access: the caller must hold `export` on the book, and time-log exports
 * additionally require `view_time` — misses throw NotFound, matching
 * `FinanceBookAccessService` so a response never confirms a book exists.
 *
 * Cost redaction happens entirely in `exportColumns`: without `view_costs`
 * the rate/amount columns simply do not exist in the file.
 */
@Injectable()
export class FinanceExportService {
  private readonly logger = new Logger(FinanceExportService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: FinanceBookAccessService,
    /** L22 on project books. Absent only in unit harnesses: then every assignment row is masked (fail closed). */
    @Optional() private readonly timeAuthority?: TimeAuthorityService,
  ) {}

  async export(
    callerId: string,
    bookId: string,
    opts: ExportOptions,
  ): Promise<ExportFile> {
    const { book, permissions } = await this.access.assertBookCapability(
      callerId,
      bookId,
      'export',
    );
    if (opts.kind === 'time_logs' && !permissions.view_time) {
      throw new NotFoundException('Finance book not found');
    }

    const columns = exportColumns(opts.kind, permissions);
    const rows =
      opts.kind === 'time_logs'
        ? await this.fetchTimeLogs(callerId, book, columns, opts)
        : await this.fetchPayouts(book, opts);

    const filename = this.filename(book, opts);
    const title =
      opts.kind === 'time_logs' ? 'Time logs export' : 'Payouts export';

    let buffer: Buffer;
    if (opts.format === 'csv') buffer = buildCsv(columns, rows);
    else if (opts.format === 'xlsx')
      buffer = await buildXlsx(columns, rows, title);
    else buffer = await buildPdf(columns, rows, title);

    return { buffer, filename, contentType: CONTENT_TYPES[opts.format] };
  }

  private async fetchTimeLogs(
    callerId: string,
    book: FinanceBookRow,
    columns: ExportColumn[],
    opts: ExportOptions,
  ): Promise<ExportRow[]> {
    const includeCosts = columns.some((column) => column.key === 'rate');
    // rate_snapshot / amount_snapshot are internal cost: only SELECTED when the
    // resolved columns carry the cost set (i.e. the caller holds view_costs).
    const select = includeCosts
      ? `${TIME_EXPORT_SELECT}, rate_snapshot, currency_snapshot, amount_snapshot`
      : TIME_EXPORT_SELECT;
    let query = this.supabase
      .from('time_entries')
      .select(select)
      .order('started_at', { ascending: true });

    if (book.kind === 'personal') {
      query = query.eq('member_user_id', book.owner_user_id);
    } else if (book.kind === 'team') {
      query = query.eq('team_id', book.owner_team_id);
    } else {
      query = query
        .eq('project_id', book.project_id)
        .neq('context_kind', 'personal');
    }
    if (opts.from) query = query.gte('started_at', opts.from);
    if (opts.to) query = query.lte('started_at', opts.to);

    const { data, error } = await query;
    if (error) {
      failTimeRead(this.logger, 'FinanceExportService.fetchTimeLogs', error);
    }
    const entries = (data ?? []) as unknown as TimeEntryExportRow[];
    const masked =
      book.kind === 'project'
        ? await this.maskedRows(callerId, entries)
        : new Set<string>();

    return entries.map((entry) => {
      const hidden = masked.has(entry.id);
      const row: ExportRow = {
        date: entry.started_at ? entry.started_at.slice(0, 10) : null,
        member: hidden
          ? MASKED_MEMBER_LABEL
          : (entry.member_display_name_snapshot ?? entry.member_user_id),
        // The For label names a team, a workspace or the agreement's hirer, never the worker.
        logging_for:
          entry.context_label_snapshot ?? FOR_FALLBACK[entry.context_kind],
        project: entry.project?.title ?? entry.project_id,
        task: entry.task?.title ?? null,
        started_at: entry.started_at,
        ended_at: entry.ended_at,
        duration_hours: toHours(entry.duration_seconds) ?? 0,
        payable_hours: toHours(entry.payable_seconds),
        break_minutes:
          entry.break_seconds !== null && entry.break_seconds !== undefined
            ? Math.round(entry.break_seconds / 60)
            : (entry.break_minutes ?? 0),
        status: timeEntryStatus(entry),
        timesheet_status: entry.timesheet?.status ?? null,
        period_start: entry.timesheet?.period_start ?? null,
        period_end: entry.timesheet?.period_end ?? null,
        source: entry.source,
        flagged_reason: entry.flagged_reason,
      };
      if (includeCosts) {
        row.rate = toNumber(entry.rate_snapshot);
        row.currency = entry.currency_snapshot ?? null;
        // The frozen amount (CHANGE-5); blank until the timesheet is approved,
        // and for fixed-fee or client-only time.
        row.amount = toNumber(entry.amount_snapshot);
      }
      return row;
    });
  }

  /** Project books: someone else's assignment rows whose worker the caller may not name (L22, D57). */
  private async maskedRows(
    callerId: string,
    entries: TimeEntryExportRow[],
  ): Promise<Set<string>> {
    const candidates = entries.filter(
      (e) => e.context_kind === 'assignment' && e.member_user_id !== callerId,
    );
    if (candidates.length === 0) return new Set<string>();
    if (!this.timeAuthority) return new Set(candidates.map((e) => e.id));
    const visible = await this.timeAuthority.identityVisible(
      callerId,
      candidates,
    );
    return new Set(
      candidates.filter((e) => !visible.has(e.id)).map((e) => e.id),
    );
  }

  private async fetchPayouts(
    book: FinanceBookRow,
    opts: ExportOptions,
  ): Promise<ExportRow[]> {
    let query = this.supabase
      .from('payouts')
      .select(
        `member_user_id, currency, total_amount, status, paid_at,
         reference_number, method_label, note`,
      )
      .order('paid_at', { ascending: true });

    if (book.kind === 'personal') {
      query = query.eq('member_user_id', book.owner_user_id);
    } else {
      // Payouts have no project column, so a project (F3) book exports the
      // owning team's payouts wholesale — the simplest correct scope, since
      // splitting a member's payout across projects is not representable.
      // The filename flags the widened scope for project books.
      query = query.eq('team_id', book.owner_team_id);
    }
    if (opts.from) query = query.gte('paid_at', opts.from);
    if (opts.to) query = query.lte('paid_at', opts.to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return ((data ?? []) as PayoutRow[]).map((payout) => ({
      paid_at: payout.paid_at,
      member: payout.member_user_id,
      currency: payout.currency,
      total_amount: payout.total_amount,
      status: payout.status,
      reference_number: payout.reference_number,
      method_label: payout.method_label,
      note: payout.note,
    }));
  }

  private filename(book: FinanceBookRow, opts: ExportOptions): string {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const scope =
      opts.kind === 'payouts' && book.kind === 'project' ? '-team-scope' : '';
    return `proyekto-${opts.kind.replace('_', '-')}${scope}-${book.id.slice(0, 8)}-${stamp}.${opts.format}`;
  }
}
