import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  FinanceBookAccessService,
  type FinanceBookRow,
} from '../books/finance-book-access.service';
import {
  type ExportColumn,
  exportColumns,
  type ExportKind,
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

interface TimeLogRow {
  member_user_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  break_minutes: number | null;
  status: string | null;
  source: string | null;
  rate_snapshot: number | null;
  currency_snapshot: string | null;
  member_display_name_snapshot: string | null;
  flagged_reason: string | null;
  project: { title: string | null } | null;
  task: { title: string | null } | null;
  project_id: string | null;
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
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: FinanceBookAccessService,
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
        ? await this.fetchTimeLogs(book, columns, opts)
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
    book: FinanceBookRow,
    columns: ExportColumn[],
    opts: ExportOptions,
  ): Promise<ExportRow[]> {
    let query = this.supabase
      .from('task_time_logs')
      .select(
        `project_id, member_user_id, started_at, ended_at, duration_seconds,
         break_minutes, status, source, rate_snapshot, currency_snapshot,
         member_display_name_snapshot, flagged_reason,
         project:projects(title),
         task:roadmap_tasks!task_time_logs_task_id_fkey(title)`,
      )
      .order('started_at', { ascending: true });

    if (book.kind === 'personal') {
      query = query.eq('member_user_id', book.owner_user_id);
    } else if (book.kind === 'team') {
      query = query.eq('team_id', book.owner_team_id);
    } else {
      query = query.eq('project_id', book.project_id);
    }
    if (opts.from) query = query.gte('started_at', opts.from);
    if (opts.to) query = query.lte('started_at', opts.to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const includeCosts = columns.some((column) => column.key === 'rate');

    return ((data ?? []) as unknown as TimeLogRow[]).map((log) => {
      const hours = (log.duration_seconds ?? 0) / 3600;
      const row: ExportRow = {
        date: log.started_at ? log.started_at.slice(0, 10) : null,
        member: log.member_display_name_snapshot ?? log.member_user_id,
        project: log.project?.title ?? log.project_id,
        task: log.task?.title ?? null,
        started_at: log.started_at,
        ended_at: log.ended_at,
        duration_hours: Number(hours.toFixed(2)),
        break_minutes: log.break_minutes ?? 0,
        status: log.status,
        source: log.source,
        flagged_reason: log.flagged_reason,
      };
      // rate_snapshot is internal cost — only materialized when the resolved
      // columns carry the cost set (i.e. the caller holds view_costs).
      if (includeCosts) {
        const rate = log.rate_snapshot;
        row.rate = rate;
        row.currency = log.currency_snapshot;
        row.amount =
          rate === null || rate === undefined
            ? null
            : Number((rate * hours).toFixed(2));
      }
      return row;
    });
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
