import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { MailerService } from '../../common/mail/mailer.service';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ConsultantFinanceAccessService } from '../finance/consultant-finance-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.controller';
import {
  ContractsService,
  type ContractRow,
} from '../contracts/contracts.service';
import {
  InvoiceCompositionService,
  type ComposedLine,
  type HoursDetailLevel,
  type InvoiceLineSource,
} from './invoice-composition.service';
import { buildInvoiceEmailHtml } from './invoice-email.template';
import { renderInvoicePdf } from './pdf/invoice-pdf.renderer';
import {
  CreateInvoiceDto,
  InvoiceLineItemInputDto,
  InvoiceListQueryDto,
  InvoiceStatus,
  UpdateInvoiceDto,
} from './dto/invoices.dto';

export interface InvoiceParty {
  name?: string | null;
  address?: string | null;
  tin?: string | null;
  email?: string | null;
}

export interface InvoiceRow {
  id: string;
  project_id: string;
  contract_id: string | null;
  issuer_user_id: string;
  recipient_user_id: string | null;
  number: string;
  status: InvoiceStatus;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  origin: 'manual' | 'scheduled';
  hours_detail_level: HoursDetailLevel;
  bill_to: InvoiceParty;
  issued_by: InvoiceParty;
  payment_method: string | null;
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
  source_type: InvoiceLineSource;
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
  /** Present on the issue/resend responses only. */
  email_delivery?: InvoiceEmailDelivery;
}

/** Outcome of emailing an invoice — surfaced so the UI can explain a failure. */
export interface InvoiceEmailDelivery {
  sent: boolean;
  /** Why it didn't send. Absent on success. */
  reason?: string;
  /** The address it went to. Absent on failure. */
  to?: string;
}

/** Which of the three fallbacks supplied the address an invoice will go to. */
export type InvoiceRecipientSource =
  /** `bill_to.email`, snapshotted from the contract when the invoice was made. */
  | 'contract_snapshot'
  /** The linked recipient account's profile email. */
  | 'recipient_account'
  /** The project's client account. */
  | 'project_client'
  /** Nothing resolved — the invoice cannot be sent. */
  | 'none';

export interface InvoiceRecipient {
  email: string | null;
  source: InvoiceRecipientSource;
}

/**
 * Stable R2 key per invoice — keyed on the immutable id, not the editable
 * number, so regenerating OVERWRITES rather than leaking a new object.
 */
function invoicePdfPath(
  invoice: Pick<InvoiceRow, 'project_id' | 'id'>,
): string {
  return `invoice_documents/${invoice.project_id}/${invoice.id}/invoice.pdf`;
}

interface ComposeLinesInput {
  line_items?: InvoiceLineItemInputDto[];
  attach_hours: boolean;
  hours_from?: string;
  hours_to?: string;
  hours_detail_level: HoursDetailLevel;
}

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly financeAccess: ConsultantFinanceAccessService,
    private readonly notifications: NotificationsService,
    private readonly contracts: ContractsService,
    private readonly composition: InvoiceCompositionService,
    private readonly uploads: UploadsService,
    private readonly mailer: MailerService,
  ) {}

  async listProjectInvoices(
    callerId: string,
    projectId: string,
    query: InvoiceListQueryDto,
  ): Promise<{ items: InvoiceWithLines[]; total: number }> {
    await this.financeAccess.assertProject(callerId, projectId);
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
    await this.financeAccess.assertProject(callerId, dto.project_id);

    // A live contract governs pricing whenever one exists — the client rate,
    // the parties on the document, and the payment terms all come from it.
    const contract = await this.contracts.getLiveContract(dto.project_id);
    const currency = (
      dto.currency ??
      contract?.currency ??
      'USD'
    ).toUpperCase();
    const number =
      dto.number?.trim() ||
      (await this.nextInvoiceNumber(dto.project_id, contract));
    const detail = dto.hours_detail_level ?? 'summary';

    const { data, error } = await this.supabase
      .from('invoices')
      .insert({
        project_id: dto.project_id,
        contract_id: dto.contract_id ?? contract?.id ?? null,
        issuer_user_id: callerId,
        recipient_user_id:
          dto.recipient_user_id ?? contract?.client_user_id ?? null,
        number,
        status: 'draft',
        currency,
        issue_date: this.normalizeDate(dto.issue_date),
        due_date: this.normalizeDate(dto.due_date),
        period_start: this.normalizeDate(dto.period_start),
        period_end: this.normalizeDate(dto.period_end),
        origin: 'manual',
        hours_detail_level: detail,
        bill_to: this.billToSnapshot(contract),
        issued_by: this.issuedBySnapshot(contract),
        payment_method: contract?.payment_method ?? null,
        notes: dto.notes?.trim() || null,
        attach_hours: dto.attach_hours ?? false,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to create invoice',
      );
    }

    const invoice = data as InvoiceRow;
    const lines = await this.composeInvoiceLines(invoice, contract, {
      line_items: dto.line_items,
      attach_hours: dto.attach_hours ?? false,
      hours_from: dto.hours_from ?? dto.period_start,
      hours_to: dto.hours_to ?? dto.period_end,
      hours_detail_level: detail,
    });
    await this.replaceInvoiceLineItems(invoice.id, lines);
    await this.refreshTotals(invoice.id);
    return this.getInvoiceInternal(invoice.id);
  }

  /**
   * Scheduler entry point: one draft invoice per contract per closed period.
   *
   * Relies on the partial unique index
   * `uq_invoices_scheduled_period (contract_id, period_start, period_end)` to
   * make a retry after a partial failure a no-op instead of a double-bill —
   * hence the 23505 check rather than a read-then-write guard, which would race
   * against a concurrent run.
   */
  async createScheduledInvoice(
    contract: ContractRow,
    periodStart: string,
    periodEnd: string,
    dueDate: string,
    issueDate: string,
  ): Promise<InvoiceWithLines | null> {
    const number = await this.nextInvoiceNumber(contract.project_id, contract);
    const detail: HoursDetailLevel =
      contract.billing_mode === 'retainer' ? 'none' : 'summary';

    const { data, error } = await this.supabase
      .from('invoices')
      .insert({
        project_id: contract.project_id,
        contract_id: contract.id,
        issuer_user_id: contract.created_by,
        recipient_user_id: contract.client_user_id,
        number,
        status: 'draft',
        currency: contract.currency,
        issue_date: issueDate,
        due_date: dueDate,
        period_start: periodStart,
        period_end: periodEnd,
        origin: 'scheduled',
        hours_detail_level: detail,
        bill_to: this.billToSnapshot(contract),
        issued_by: this.issuedBySnapshot(contract),
        payment_method: contract.payment_method,
        attach_hours: contract.billing_mode !== 'retainer',
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') return null; // already billed for this period
      throw new BadRequestException(error.message);
    }
    if (!data) return null;

    const invoice = data as InvoiceRow;
    const { lines } = await this.composition.composeForContract(
      contract,
      periodStart,
      periodEnd,
      detail,
    );
    await this.replaceInvoiceLineItems(invoice.id, lines);
    await this.refreshTotals(invoice.id);
    return this.getInvoiceInternal(invoice.id);
  }

  async getInvoice(
    callerId: string,
    invoiceId: string,
  ): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, invoice.project_id);
    return invoice;
  }

  async updateInvoice(
    callerId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceWithLines> {
    const existing = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, existing.project_id);
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
    if (dto.issue_date !== undefined)
      patch.issue_date = this.normalizeDate(dto.issue_date);
    if (dto.due_date !== undefined)
      patch.due_date = this.normalizeDate(dto.due_date);
    if (dto.period_start !== undefined)
      patch.period_start = this.normalizeDate(dto.period_start);
    if (dto.period_end !== undefined)
      patch.period_end = this.normalizeDate(dto.period_end);
    if (dto.notes !== undefined) patch.notes = dto.notes?.trim() || null;
    if (dto.attach_hours !== undefined) patch.attach_hours = dto.attach_hours;
    if (dto.hours_detail_level !== undefined) {
      patch.hours_detail_level = dto.hours_detail_level;
    }

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
      dto.hours_detail_level !== undefined ||
      dto.hours_member_user_id !== undefined;

    if (shouldRebuildLines) {
      const contract = existing.contract_id
        ? await this.contracts.getLiveContract(existing.project_id)
        : null;
      const rebuilt = await this.composeInvoiceLines(existing, contract, {
        line_items: dto.line_items,
        attach_hours: dto.attach_hours ?? existing.attach_hours,
        hours_from: dto.hours_from ?? existing.period_start ?? undefined,
        hours_to: dto.hours_to ?? existing.period_end ?? undefined,
        hours_detail_level:
          dto.hours_detail_level ?? existing.hours_detail_level ?? 'summary',
      });
      await this.replaceInvoiceLineItems(invoiceId, rebuilt);
      await this.refreshTotals(invoiceId);
    }

    return this.getInvoiceInternal(invoiceId);
  }

  /**
   * Delete a draft invoice. Only drafts: once an invoice has been issued the
   * client has seen that number, so the audit trail must keep it — void it
   * instead of erasing it.
   */
  async deleteInvoice(callerId: string, invoiceId: string): Promise<void> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, invoice.project_id);

    if (invoice.status !== 'draft') {
      throw new BadRequestException(
        `Only draft invoices can be deleted. ${invoice.number} is ${invoice.status} — void it instead so the numbering stays auditable.`,
      );
    }

    // Line items and documents cascade from the invoice row.
    const { error } = await this.supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId);
    if (error) throw new BadRequestException(error.message);
  }

  async issueInvoice(
    callerId: string,
    invoiceId: string,
  ): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, invoice.project_id);

    if (invoice.status !== 'draft' && invoice.status !== 'issued') {
      throw new BadRequestException(
        `Invoice in status ${invoice.status} cannot be issued.`,
      );
    }

    // An invoice can only be issued/sent once there is a client to reach:
    // a linked client account, a client email on the contract, or a real
    // client on the project. Otherwise "issue" would be a no-op.
    await this.assertInvoiceHasClient(invoice);

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
          link_url: `/project/${invoice.project_id}/overview`,
        });
      }
    } catch {
      // notification failures should not fail invoice issuing
    }

    const fresh = await this.getInvoiceInternal(invoiceId);
    const delivery = await this.emailInvoiceToClient(fresh, callerId);
    return { ...fresh, email_delivery: delivery };
  }

  /**
   * Emails the issued invoice to the client with the PDF attached.
   *
   * Best-effort: the invoice is already issued by the time this runs, so a
   * missing email address or an unconfigured mail server is reported back to
   * the consultant rather than rolling the issue back. The result rides along
   * on the response so the UI can say "issued, but not emailed — here's why".
   */
  private async emailInvoiceToClient(
    invoice: InvoiceWithLines,
    callerId: string,
  ): Promise<InvoiceEmailDelivery> {
    const to = await this.resolveClientEmail(invoice);
    if (!to) {
      return {
        sent: false,
        reason:
          'No client email on file. Add one on the contract (Parties → Client → Email) and re-send.',
      };
    }

    // Render fresh rather than trusting a stale stored PDF, and store it via
    // the normal path so the document row and `pdf_path` are recorded too —
    // what the client received is then exactly what "Open" shows.
    let pdf: Buffer;
    try {
      pdf = (await this.renderAndStorePdf(invoice, callerId)).buffer;
    } catch {
      return {
        sent: false,
        reason: 'The invoice PDF could not be generated. Try sending it again.',
      };
    }

    const result = await this.mailer.send({
      to,
      sender: 'billing',
      // The client is doing business with the agency, not with Proyekto, so
      // the agency's name leads in the inbox and replies go to them. The
      // address stays ours — it is the only domain we can authenticate.
      onBehalfOf: invoice.issued_by?.name ?? null,
      replyTo: invoice.issued_by?.email ?? undefined,
      subject: `Invoice ${invoice.number} from ${invoice.issued_by?.name ?? 'your service provider'}`,
      html: buildInvoiceEmailHtml({
        invoice,
        hasAttachment: true,
      }),
      attachments: [
        {
          filename: `${invoice.number}.pdf`,
          contentType: 'application/pdf',
          content: pdf,
        },
      ],
    });

    if (result.sent) {
      await this.supabase
        .from('invoices')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', invoice.id);
    }
    return {
      sent: result.sent,
      reason: result.reason,
      to: result.sent ? to : undefined,
    };
  }

  /** Where an invoice should be emailed: the snapshot first, then the account. */
  private async resolveClientEmail(
    invoice: InvoiceRow,
  ): Promise<string | null> {
    return (await this.resolveRecipient(invoice)).email;
  }

  /**
   * The same resolution as `resolveClientEmail`, but reporting WHICH fallback
   * supplied the address.
   *
   * The pre-send confirmation shows the consultant where the invoice is about
   * to go, and "which one of the three sources is this" is the difference
   * between a reassuring confirmation and a misleading one — a snapshot taken
   * when the contract was drafted can easily be staler than the account on file.
   */
  async resolveRecipient(invoice: InvoiceRow): Promise<InvoiceRecipient> {
    const snapshot = invoice.bill_to?.email?.trim();
    if (snapshot) return { email: snapshot, source: 'contract_snapshot' };

    if (invoice.recipient_user_id) {
      const { data } = await this.supabase
        .from('profiles')
        .select('email')
        .eq('id', invoice.recipient_user_id)
        .maybeSingle();
      const email = (data as { email: string | null } | null)?.email?.trim();
      if (email) return { email, source: 'recipient_account' };
    }

    const { data: project } = await this.supabase
      .from('projects')
      .select('client_id')
      .eq('id', invoice.project_id)
      .maybeSingle();
    const clientId = (project as { client_id: string | null } | null)
      ?.client_id;
    if (!clientId) return { email: null, source: 'none' };

    const { data: client } = await this.supabase
      .from('profiles')
      .select('email')
      .eq('id', clientId)
      .maybeSingle();
    const email = (client as { email: string | null } | null)?.email?.trim();
    return email
      ? { email, source: 'project_client' }
      : { email: null, source: 'none' };
  }

  /** Read-only lookup behind `GET /api/invoices/:id/recipient`. */
  async getRecipient(
    callerId: string,
    invoiceId: string,
  ): Promise<InvoiceRecipient> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, invoice.project_id);
    return this.resolveRecipient(invoice);
  }

  /**
   * Re-send an already-issued invoice — for a bounced address, or a client who
   * says it never arrived.
   */
  async resendInvoiceEmail(
    callerId: string,
    invoiceId: string,
  ): Promise<InvoiceEmailDelivery> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, invoice.project_id);
    if (invoice.status === 'draft') {
      throw new BadRequestException(
        'This invoice is still a draft. Issue it to send it to the client.',
      );
    }
    return this.emailInvoiceToClient(invoice, callerId);
  }

  /**
   * True-or-throw: the invoice has a client to send to. Accepts any of a linked
   * recipient account, a client email snapshotted onto the invoice, or a real
   * client on the project (client_id distinct from the consultant).
   */
  private async assertInvoiceHasClient(invoice: InvoiceRow): Promise<void> {
    const billToEmail = (invoice.bill_to as InvoiceParty | null)?.email?.trim();
    if (invoice.recipient_user_id || billToEmail) return;

    const { data } = await this.supabase
      .from('projects')
      .select('client_id, consultant_id')
      .eq('id', invoice.project_id)
      .maybeSingle();
    const project = data as {
      client_id: string | null;
      consultant_id: string | null;
    } | null;
    if (project?.client_id && project.client_id !== project.consultant_id) {
      return;
    }

    throw new BadRequestException(
      'This invoice has no client to send to. Add a client to the project, or fill in the client details on the contract, before issuing.',
    );
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
    await this.financeAccess.assertProject(callerId, invoice.project_id);
    const stored = await this.renderAndStorePdf(invoice, callerId);
    // Drop the rendered bytes — this is an HTTP response, not a download.
    return {
      invoice_id: stored.invoice_id,
      document_id: stored.document_id,
      pdf_path: stored.pdf_path,
      generated_at: stored.generated_at,
    };
  }

  /**
   * Renders the invoice and stores it in the PRIVATE R2 bucket.
   *
   * Previously this method only recorded a storage path and never produced a
   * file, so every "PDF" link pointed at nothing. The bytes are generated
   * server-side (pdfkit) so scheduled invoices arrive ready to send rather than
   * needing a human to open a print dialog.
   */
  async renderAndStorePdf(
    invoice: InvoiceWithLines,
    callerId: string | null,
  ): Promise<{
    invoice_id: string;
    document_id: string;
    pdf_path: string;
    generated_at: string;
    /** The rendered bytes, so callers can attach them without re-rendering. */
    buffer: Buffer;
  }> {
    // Stable key per invoice (keyed on the immutable id, not the editable
    // number) so regenerating OVERWRITES the R2 object instead of leaking a new
    // one on every click. Presigned reads are minted per request, so there is
    // no stale-cache concern from reusing the key.
    const pdfPath = invoicePdfPath(invoice);
    const buffer = await this.renderInvoiceBuffer(invoice);

    // Upload BEFORE recording the row, so a failed render never leaves a
    // document row pointing at a key that does not exist.
    await this.uploads.putPrivateObject(pdfPath, buffer, 'application/pdf');

    // One document row per invoice: drop any prior rows before recording the
    // current one, so a regenerate replaces rather than accumulates. The R2
    // object was already overwritten in place by the stable key above.
    await this.supabase
      .from('invoice_documents')
      .delete()
      .eq('invoice_id', invoice.id);

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
        docErr?.message ?? 'Failed to record the invoice PDF document.',
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
      buffer,
    };
  }

  /** Renders the invoice document to PDF bytes. */
  private renderInvoiceBuffer(invoice: InvoiceWithLines): Promise<Buffer> {
    return renderInvoicePdf({
      number: invoice.number,
      currency: invoice.currency,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      periodStart: invoice.period_start,
      periodEnd: invoice.period_end,
      issuedBy: invoice.issued_by ?? {},
      billTo: invoice.bill_to ?? {},
      paymentMethod: invoice.payment_method,
      notes: invoice.notes,
      total: Number(invoice.total ?? 0),
      lines: invoice.line_items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity ?? 0),
        unit_rate: Number(item.unit_rate ?? 0),
        amount: Number(item.amount ?? 0),
        // Retainer and manual lines are counts, not hours.
        isHours:
          item.source_type === 'time_log' || item.source_type === 'overage',
      })),
    });
  }

  /**
   * Time-limited read URL for an invoice's stored PDF. Authorization happens
   * here, before the presigned URL is minted — the URL itself is a bearer
   * capability. Mirrors `GET /api/payouts/:id/proof-url`.
   */
  async getPdfUrl(
    callerId: string,
    invoiceId: string,
  ): Promise<{ url: string; expires_in: number }> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProject(callerId, invoice.project_id);
    if (!invoice.pdf_path) {
      throw new NotFoundException(
        'This invoice has no generated PDF yet. Generate it first.',
      );
    }
    const expiresIn = 300;
    const url = await this.uploads.getPrivateSignedUrl(
      invoice.pdf_path,
      expiresIn,
    );
    return { url, expires_in: expiresIn };
  }

  private normalizeDate(value?: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date value.');
    }
    return parsed.toISOString().slice(0, 10);
  }

  private async getInvoiceInternal(
    invoiceId: string,
  ): Promise<InvoiceWithLines> {
    const { data: invoice, error: invoiceErr } = await this.supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceErr) throw new Error(invoiceErr.message);
    if (!invoice) throw new NotFoundException('Invoice not found');

    const [
      { data: lineItems, error: lineErr },
      { data: docs, error: docsErr },
    ] = await Promise.all([
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

  /**
   * Next invoice number.
   *
   * Honours the contract's prefix and sequences per YEAR across the whole
   * issuing project set (e.g. `BS2026-014`), matching the globally sequential
   * numbering the team actually uses on paper. Falls back to the legacy
   * per-project `INV-0001` form when no prefix is configured.
   */
  private async nextInvoiceNumber(
    projectId: string,
    contract?: ContractRow | null,
  ): Promise<string> {
    const prefix = contract?.invoice_number_prefix?.trim().toUpperCase();

    if (prefix) {
      const year = new Date().getUTCFullYear();
      const pattern = `${prefix}${year}-`;
      const { data, error } = await this.supabase
        .from('invoices')
        .select('number')
        .like('number', `${pattern}%`);
      if (error) throw new Error(error.message);
      const max = ((data ?? []) as Array<{ number: string }>).reduce(
        (best, row) => {
          const match = row.number.slice(pattern.length).match(/^(\d+)/);
          return match ? Math.max(best, Number(match[1])) : best;
        },
        0,
      );
      return `${pattern}${String(max + 1).padStart(3, '0')}`;
    }

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

  /**
   * Builds the line items for an invoice.
   *
   * Manual lines are taken verbatim. Hour-based lines ALWAYS come from
   * InvoiceCompositionService, which prices them at the contract's client rate
   * — never at `task_time_logs.rate_snapshot`, the member's internal cost rate.
   * Without a contract there is no client rate to bill at, so attaching hours
   * is refused rather than silently billed at team cost (the previous
   * behaviour, and the bug this replaces).
   */
  private async composeInvoiceLines(
    invoice: Pick<
      InvoiceRow,
      'id' | 'project_id' | 'currency' | 'attach_hours'
    >,
    contract: ContractRow | null,
    input: ComposeLinesInput,
  ): Promise<ComposedLine[]> {
    const lines: ComposedLine[] = [];

    for (const item of input.line_items ?? []) {
      const quantity = Number(item.quantity ?? 0);
      const unitRate = Number(item.unit_rate ?? 0);
      lines.push({
        source_type: 'manual',
        source_log_id: null,
        description: item.description.trim(),
        quantity,
        unit_rate: unitRate,
        amount: Math.round(quantity * unitRate * 100) / 100,
        metadata: {},
        position: lines.length,
      });
    }

    if (input.attach_hours) {
      if (!contract) {
        throw new BadRequestException(
          'Attaching hours needs a signed contract, which supplies the rate the client is billed at. Set up the contract first.',
        );
      }
      if (
        contract.billing_mode !== 'retainer' &&
        !(Number(contract.client_hourly_rate) > 0)
      ) {
        throw new BadRequestException(
          'The contract has no client hourly rate, so logged hours cannot be priced. Set it on the contract first.',
        );
      }
      if (!input.hours_from || !input.hours_to) {
        throw new BadRequestException(
          'Attaching hours needs a billing period (from and to dates).',
        );
      }

      const { lines: composed } = await this.composition.composeForContract(
        contract,
        this.normalizeDate(input.hours_from) as string,
        this.normalizeDate(input.hours_to) as string,
        input.hours_detail_level,
      );
      for (const line of composed) {
        lines.push({ ...line, position: lines.length });
      }
    }

    return lines;
  }

  /** Party block shown as "bill to" on the rendered document. */
  private billToSnapshot(contract: ContractRow | null): InvoiceParty {
    if (!contract) return {};
    return {
      name: contract.client_name,
      address: contract.client_address,
      tin: contract.client_tin,
      email: contract.client_email,
    };
  }

  /** Party block shown as the issuer on the rendered document. */
  private issuedBySnapshot(contract: ContractRow | null): InvoiceParty {
    if (!contract) return {};
    return {
      name: contract.provider_name,
      address: contract.provider_address,
      tin: contract.provider_tin,
      email: contract.provider_email,
    };
  }

  private async replaceInvoiceLineItems(
    invoiceId: string,
    lines: ComposedLine[],
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
