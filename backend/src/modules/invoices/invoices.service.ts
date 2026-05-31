import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateInvoiceDto,
  InvoiceLineItemInputDto,
  InvoiceListQueryDto,
  InvoiceStatus,
  UpdateInvoiceDto,
} from './dto/invoices.dto';

export interface InvoiceRow {
  id: string;
  project_id: string;
  issuer_user_id: string;
  recipient_user_id: string | null;
  number: string;
  status: InvoiceStatus;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  attach_hours: boolean;
  subtotal: string | number;
  total: string | number;
  issued_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  source_type: 'manual' | 'time_log';
  source_log_id: string | null;
  description: string;
  quantity: string | number;
  unit_rate: string | number;
  amount: string | number;
  metadata: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceDocumentRow {
  id: string;
  invoice_id: string;
  kind: 'pdf';
  storage_path: string;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceWithLines extends InvoiceRow {
  line_items: InvoiceLineItemRow[];
  documents: InvoiceDocumentRow[];
}

interface ComposeLinesInput {
  line_items?: InvoiceLineItemInputDto[];
  attach_hours: boolean;
  hours_from?: string;
  hours_to?: string;
  hours_member_user_id?: string;
}

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  async listProjectInvoices(
    callerId: string,
    projectId: string,
    query: InvoiceListQueryDto,
  ): Promise<{ items: InvoiceWithLines[]; total: number }> {
    await this.projectAuth.assertRole(callerId, projectId, 'viewer');
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const offset = (page - 1) * limit;

    let dbQuery = this.supabase
      .from('invoices')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.status) dbQuery = dbQuery.eq('status', query.status);
    if (query.from) dbQuery = dbQuery.gte('created_at', query.from);
    if (query.to) dbQuery = dbQuery.lte('created_at', query.to);

    const { data, error, count } = await dbQuery;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as InvoiceRow[];

    const items = await Promise.all(
      rows.map((row) => this.getInvoiceInternal(row.id)),
    );
    return {
      items,
      total: count ?? 0,
    };
  }

  async createInvoice(
    callerId: string,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceWithLines> {
    await this.projectAuth.assertRole(callerId, dto.project_id, 'editor');
    const number = dto.number?.trim() || (await this.nextInvoiceNumber(dto.project_id));
    const currency = (dto.currency ?? 'USD').toUpperCase();

    const { data, error } = await this.supabase
      .from('invoices')
      .insert({
        project_id: dto.project_id,
        issuer_user_id: callerId,
        recipient_user_id: dto.recipient_user_id ?? null,
        number,
        status: 'draft',
        currency,
        issue_date: this.normalizeDate(dto.issue_date),
        due_date: this.normalizeDate(dto.due_date),
        notes: dto.notes?.trim() || null,
        attach_hours: dto.attach_hours ?? false,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'Failed to create invoice');
    }

    const invoice = data as InvoiceRow;
    const lines = await this.composeInvoiceLines(invoice, {
      line_items: dto.line_items,
      attach_hours: dto.attach_hours ?? false,
      hours_from: dto.hours_from,
      hours_to: dto.hours_to,
      hours_member_user_id: dto.hours_member_user_id,
    });
    await this.replaceInvoiceLineItems(invoice.id, lines);
    await this.refreshTotals(invoice.id);
    return this.getInvoiceInternal(invoice.id);
  }

  async getInvoice(callerId: string, invoiceId: string): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.projectAuth.assertRole(callerId, invoice.project_id, 'viewer');
    return invoice;
  }

  async updateInvoice(
    callerId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceWithLines> {
    const existing = await this.getInvoiceInternal(invoiceId);
    await this.projectAuth.assertRole(callerId, existing.project_id, 'editor');
    if (existing.status === 'paid' || existing.status === 'void') {
      throw new BadRequestException(
        `Cannot edit an invoice that is ${existing.status}.`,
      );
    }

    const patch: Record<string, unknown> = {};
    if (dto.recipient_user_id !== undefined) {
      patch.recipient_user_id = dto.recipient_user_id ?? null;
    }
    if (dto.number !== undefined) patch.number = dto.number.trim();
    if (dto.currency !== undefined) patch.currency = dto.currency.toUpperCase();
    if (dto.issue_date !== undefined) patch.issue_date = this.normalizeDate(dto.issue_date);
    if (dto.due_date !== undefined) patch.due_date = this.normalizeDate(dto.due_date);
    if (dto.notes !== undefined) patch.notes = dto.notes?.trim() || null;
    if (dto.attach_hours !== undefined) patch.attach_hours = dto.attach_hours;

    if (Object.keys(patch).length > 0) {
      const { error } = await this.supabase
        .from('invoices')
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoiceId);
      if (error) throw new BadRequestException(error.message);
    }

    const shouldRebuildLines =
      dto.line_items !== undefined ||
      dto.attach_hours !== undefined ||
      dto.hours_from !== undefined ||
      dto.hours_to !== undefined ||
      dto.hours_member_user_id !== undefined;

    if (shouldRebuildLines) {
      const rebuilt = await this.composeInvoiceLines(existing, {
        line_items: dto.line_items,
        attach_hours: dto.attach_hours ?? existing.attach_hours,
        hours_from: dto.hours_from,
        hours_to: dto.hours_to,
        hours_member_user_id: dto.hours_member_user_id,
      });
      await this.replaceInvoiceLineItems(invoiceId, rebuilt);
      await this.refreshTotals(invoiceId);
    }

    return this.getInvoiceInternal(invoiceId);
  }

  async issueInvoice(callerId: string, invoiceId: string): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.projectAuth.assertRole(callerId, invoice.project_id, 'admin');

    if (invoice.status !== 'draft' && invoice.status !== 'issued') {
      throw new BadRequestException(
        `Invoice in status ${invoice.status} cannot be issued.`,
      );
    }

    const now = new Date().toISOString();
    const issueDate = invoice.issue_date ?? now.slice(0, 10);

    const { error } = await this.supabase
      .from('invoices')
      .update({
        status: 'issued',
        issue_date: issueDate,
        issued_at: now,
        updated_at: now,
      })
      .eq('id', invoiceId);
    if (error) throw new BadRequestException(error.message);

    try {
      if (invoice.recipient_user_id && invoice.recipient_user_id !== callerId) {
        await this.notifications.createNotification({
          user_id: invoice.recipient_user_id,
          project_id: invoice.project_id,
          actor_id: callerId,
          type_name: 'invoice_issued',
          content: {
            invoice_id: invoice.id,
            invoice_number: invoice.number,
            amount: invoice.total,
            currency: invoice.currency,
            message: `Invoice ${invoice.number} has been issued.`,
          },
          link_url: `/project/${invoice.project_id}/payments`,
        });
      }
    } catch {
      // notification failures should not fail invoice issuing
    }

    return this.getInvoiceInternal(invoiceId);
  }

  async generatePdf(
    callerId: string,
    invoiceId: string,
  ): Promise<{
    invoice_id: string;
    document_id: string;
    pdf_path: string;
    generated_at: string;
  }> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.projectAuth.assertRole(callerId, invoice.project_id, 'viewer');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pdfPath = `invoices/${invoice.project_id}/${invoice.id}/invoice-${invoice.number}-${timestamp}.pdf`;

    const { data: document, error: docErr } = await this.supabase
      .from('invoice_documents')
      .insert({
        invoice_id: invoice.id,
        kind: 'pdf',
        storage_path: pdfPath,
        created_by: callerId,
      })
      .select('*')
      .single();
    if (docErr || !document) {
      throw new BadRequestException(
        docErr?.message ?? 'Failed to generate invoice PDF document.',
      );
    }

    const generatedAt = new Date().toISOString();
    const { error: invoiceErr } = await this.supabase
      .from('invoices')
      .update({
        pdf_path: pdfPath,
        updated_at: generatedAt,
      })
      .eq('id', invoice.id);
    if (invoiceErr) throw new BadRequestException(invoiceErr.message);

    return {
      invoice_id: invoice.id,
      document_id: (document as InvoiceDocumentRow).id,
      pdf_path: pdfPath,
      generated_at: generatedAt,
    };
  }

  private normalizeDate(value?: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date value.');
    }
    return parsed.toISOString().slice(0, 10);
  }

  private async getInvoiceInternal(invoiceId: string): Promise<InvoiceWithLines> {
    const { data: invoice, error: invoiceErr } = await this.supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceErr) throw new Error(invoiceErr.message);
    if (!invoice) throw new NotFoundException('Invoice not found');

    const [{ data: lineItems, error: lineErr }, { data: docs, error: docsErr }] =
      await Promise.all([
        this.supabase
          .from('invoice_line_items')
          .select('*')
          .eq('invoice_id', invoiceId)
          .order('position', { ascending: true }),
        this.supabase
          .from('invoice_documents')
          .select('*')
          .eq('invoice_id', invoiceId)
          .order('created_at', { ascending: false }),
      ]);
    if (lineErr) throw new Error(lineErr.message);
    if (docsErr) throw new Error(docsErr.message);

    const parsed: InvoiceWithLines = {
      ...(invoice as InvoiceRow),
      subtotal: Number((invoice as InvoiceRow).subtotal ?? 0),
      total: Number((invoice as InvoiceRow).total ?? 0),
      line_items: ((lineItems ?? []) as InvoiceLineItemRow[]).map((item) => ({
        ...item,
        quantity: Number(item.quantity ?? 0),
        unit_rate: Number(item.unit_rate ?? 0),
        amount: Number(item.amount ?? 0),
      })),
      documents: (docs ?? []) as InvoiceDocumentRow[],
    };
    return parsed;
  }

  private async nextInvoiceNumber(projectId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('number')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const numbers = ((data ?? []) as Array<{ number: string }>).map((row) => {
      const m = row.number.match(/(\d+)$/);
      return m ? Number(m[1]) : 0;
    });
    const max = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `INV-${String(max + 1).padStart(4, '0')}`;
  }

  private async composeInvoiceLines(
    invoice: Pick<InvoiceRow, 'id' | 'project_id' | 'currency' | 'attach_hours'>,
    input: ComposeLinesInput,
  ): Promise<
    Array<{
      source_type: 'manual' | 'time_log';
      source_log_id: string | null;
      description: string;
      quantity: number;
      unit_rate: number;
      amount: number;
      metadata: Record<string, unknown>;
      position: number;
    }>
  > {
    const lines: Array<{
      source_type: 'manual' | 'time_log';
      source_log_id: string | null;
      description: string;
      quantity: number;
      unit_rate: number;
      amount: number;
      metadata: Record<string, unknown>;
      position: number;
    }> = [];

    const manualItems = input.line_items ?? [];
    for (const item of manualItems) {
      const quantity = Number(item.quantity ?? 0);
      const unitRate = Number(item.unit_rate ?? 0);
      lines.push({
        source_type: 'manual',
        source_log_id: null,
        description: item.description.trim(),
        quantity,
        unit_rate: unitRate,
        amount: quantity * unitRate,
        metadata: {},
        position: lines.length,
      });
    }

    if (input.attach_hours) {
      const timeLogLines = await this.buildAttachedTimeLogLines(
        invoice.project_id,
        input.hours_from,
        input.hours_to,
        input.hours_member_user_id,
      );
      for (const line of timeLogLines) {
        lines.push({
          ...line,
          position: lines.length,
        });
      }
    }

    return lines;
  }

  private async buildAttachedTimeLogLines(
    projectId: string,
    hoursFrom?: string,
    hoursTo?: string,
    memberUserId?: string,
  ): Promise<
    Array<{
      source_type: 'time_log';
      source_log_id: string | null;
      description: string;
      quantity: number;
      unit_rate: number;
      amount: number;
      metadata: Record<string, unknown>;
      position: number;
    }>
  > {
    let query = this.supabase
      .from('task_time_logs')
      .select(
        'id, started_at, duration_seconds, rate_snapshot, currency_snapshot, status, task:roadmap_tasks!task_time_logs_task_id_fkey(title)',
      )
      .eq('project_id', projectId)
      .in('status', ['approved', 'paid'])
      .order('started_at', { ascending: true });

    if (hoursFrom) {
      query = query.gte('started_at', `${this.normalizeDate(hoursFrom)}T00:00:00.000Z`);
    }
    if (hoursTo) {
      query = query.lte('started_at', `${this.normalizeDate(hoursTo)}T23:59:59.999Z`);
    }
    if (memberUserId) {
      query = query.eq('member_user_id', memberUserId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      started_at: string;
      duration_seconds: number | null;
      rate_snapshot: number | null;
      currency_snapshot: string | null;
      status: string;
      task: Array<{ title: string | null }> | { title: string | null } | null;
    }>;

    return rows.map((row, index) => {
      const hours = Math.max(0, Number(row.duration_seconds ?? 0)) / 3600;
      const unitRate = Number(row.rate_snapshot ?? 0);
      const dateLabel = row.started_at.slice(0, 10);
      const taskNode = Array.isArray(row.task) ? row.task[0] : row.task;
      const taskTitle = taskNode?.title?.trim() || 'Logged work';
      return {
        source_type: 'time_log' as const,
        source_log_id: row.id,
        description: `${taskTitle} (${dateLabel})`,
        quantity: hours,
        unit_rate: unitRate,
        amount: hours * unitRate,
        metadata: {
          started_at: row.started_at,
          status: row.status,
          currency_snapshot: row.currency_snapshot,
        },
        position: index,
      };
    });
  }

  private async replaceInvoiceLineItems(
    invoiceId: string,
    lines: Array<{
      source_type: 'manual' | 'time_log';
      source_log_id: string | null;
      description: string;
      quantity: number;
      unit_rate: number;
      amount: number;
      metadata: Record<string, unknown>;
      position: number;
    }>,
  ): Promise<void> {
    const { error: deleteErr } = await this.supabase
      .from('invoice_line_items')
      .delete()
      .eq('invoice_id', invoiceId);
    if (deleteErr) throw new Error(deleteErr.message);

    if (lines.length === 0) return;

    const { error: insertErr } = await this.supabase
      .from('invoice_line_items')
      .insert(
        lines.map((line) => ({
          invoice_id: invoiceId,
          source_type: line.source_type,
          source_log_id: line.source_log_id,
          description: line.description,
          quantity: line.quantity,
          unit_rate: line.unit_rate,
          amount: line.amount,
          metadata: line.metadata,
          position: line.position,
        })),
      );
    if (insertErr) throw new Error(insertErr.message);
  }

  private async refreshTotals(invoiceId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('invoice_line_items')
      .select('amount')
      .eq('invoice_id', invoiceId);
    if (error) throw new Error(error.message);
    const total = ((data ?? []) as Array<{ amount: string | number }>).reduce(
      (acc, item) => acc + Number(item.amount ?? 0),
      0,
    );
    const { error: updateErr } = await this.supabase
      .from('invoices')
      .update({
        subtotal: total,
        total,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);
    if (updateErr) throw new Error(updateErr.message);
  }
}
