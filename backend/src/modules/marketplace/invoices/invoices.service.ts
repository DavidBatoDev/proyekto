import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { MailerService } from '../../../common/mail/mailer.service';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TeamFinanceAccessService } from '../finance/team-finance-access.service';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import { QaFixturePolicyService } from '../../shared/qa-fixtures/qa-fixture-policy.service';
import { UploadsService } from '../../shared/uploads/uploads.controller';
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
  RecordInvoicePaymentDto,
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
  project_id: string | null;
  project_title_snapshot: string | null;
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
  void_reason: string | null;
  voided_by: string | null;
  replaces_invoice_id: string | null;
  replaced_by_invoice_id: string | null;
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
  payments: InvoicePaymentRow[];
  events: InvoiceEventRow[];
  amount_paid: number;
  balance_due: number;
  payment_count: number;
  is_overdue: boolean;
  /** Present on the issue/resend responses only. */
  email_delivery?: InvoiceEmailDelivery;
}

export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
  amount: string | number;
  payment_date: string;
  payment_method: string | null;
  reference: string | null;
  note: string | null;
  recorded_by: string | null;
  reverses_payment_id: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface InvoiceEventRow {
  id: string;
  invoice_id: string;
  event_type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
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
  return `invoice_documents/${invoice.project_id ?? 'severed'}/${invoice.id}/invoice.pdf`;
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
    // The either/or facade (consultant+owner OR project finance capability),
    // so a project admin can run the invoice lifecycle. See the class note on
    // TeamFinanceAccessService.
    private readonly financeAccess: TeamFinanceAccessService,
    private readonly notifications: NotificationsService,
    private readonly contracts: ContractsService,
    private readonly composition: InvoiceCompositionService,
    private readonly uploads: UploadsService,
    private readonly mailer: MailerService,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly qaFixtures: QaFixturePolicyService,
  ) {}

  async listProjectInvoices(
    callerId: string,
    projectId: string,
    query: InvoiceListQueryDto,
  ): Promise<{ items: InvoiceWithLines[]; total: number }> {
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      projectId,
      'read',
    );
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
    const project = await this.financeAccess.assertProjectFinanceActor(
      callerId,
      dto.project_id,
      'manage',
    );

    // An explicitly selected contract is exact invoice provenance. Without
    // one, manual creation correctly uses the project's signed contract.
    const contract = dto.contract_id
      ? await this.contracts.getContractById(dto.contract_id)
      : await this.contracts.getSignedContract(dto.project_id);
    if (dto.contract_id && !contract) {
      throw new BadRequestException('The selected contract does not exist.');
    }
    if (contract && contract.relationship_kind !== 'client_services') {
      throw new BadRequestException(
        'Talent contracts are cost agreements and cannot be used for client invoices.',
      );
    }
    if (contract && contract.project_id !== dto.project_id) {
      throw new BadRequestException(
        'The selected contract does not belong to this project.',
      );
    }
    const currency = (
      dto.currency ??
      contract?.currency ??
      'USD'
    ).toUpperCase();
    const number =
      dto.number?.trim() ||
      (await this.nextInvoiceNumber(dto.project_id, contract));
    // P4b fixed-price agreements are manually invoiced. Their invoice can
    // carry explicit manual line items, but must never attach delivery hours.
    const fixedPrice = contract?.billing_mode === 'fixed';
    const detail = fixedPrice ? 'none' : (dto.hours_detail_level ?? 'summary');
    const attachHours = fixedPrice ? false : (dto.attach_hours ?? false);

    // The shared Supabase client is intentionally untyped at this boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.supabase
      .from('invoices')
      .insert({
        project_id: dto.project_id,
        project_title_snapshot: project.title,
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
        attach_hours: attachHours,
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
      attach_hours: attachHours,
      hours_from: dto.hours_from ?? dto.period_start,
      hours_to: dto.hours_to ?? dto.period_end,
      hours_detail_level: detail,
    });
    await this.replaceInvoiceLineItems(invoice.id, lines);
    await this.refreshTotals(invoice.id);
    await this.recordEvent(invoice.id, 'created', callerId, {
      origin: 'manual',
    });
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
    // Keep the service fail-closed if an ineligible contract is passed
    // directly. P4b schedules only live hourly/retainer Client agreements;
    // fixed-price contracts are manual until milestone billing exists.
    if (
      !contract.project_id ||
      contract.relationship_kind !== 'client_services' ||
      contract.billing_mode === 'fixed'
    ) {
      return null;
    }
    if (await this.qaFixtures.isFixtureProject(contract.project_id))
      return null;
    const number = await this.nextInvoiceNumber(contract.project_id, contract);
    const detail: HoursDetailLevel =
      contract.billing_mode === 'retainer' ? 'none' : 'summary';

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.supabase
      .from('invoices')
      .insert({
        project_id: contract.project_id,
        project_title_snapshot: contract.project_title_snapshot,
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
    await this.recordEvent(invoice.id, 'created', contract.created_by, {
      origin: 'scheduled',
      period_start: periodStart,
      period_end: periodEnd,
    });
    return this.getInvoiceInternal(invoice.id);
  }

  async getInvoice(
    callerId: string,
    invoiceId: string,
  ): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.assertInvoiceRead(callerId, invoice);
    return invoice;
  }

  private async assertInvoiceRead(
    callerId: string,
    invoice: InvoiceRow,
  ): Promise<void> {
    if (invoice.project_id) {
      await this.financeAccess.assertProjectFinanceActor(
        callerId,
        invoice.project_id,
        'read',
      );
      return;
    }
    if (invoice.issuer_user_id === callerId) return;
    if (invoice.contract_id) {
      const contract = await this.contracts.getContractById(
        invoice.contract_id,
      );
      if (
        callerId ===
        (contract?.consultant_user_id ?? contract?.created_by ?? null)
      ) {
        return;
      }
    }
    throw new NotFoundException('Invoice not found');
  }

  private requireInvoiceProjectId(invoice: InvoiceRow): string {
    if (!invoice.project_id) throw new NotFoundException('Project not found');
    return invoice.project_id;
  }

  async updateInvoice(
    callerId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceWithLines> {
    const existing = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(existing),
      'manage',
    );
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        'Only draft invoices can be edited. Issue a replacement if a sent invoice needs correction.',
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
        ? await this.contracts.getContractById(existing.contract_id)
        : null;
      const attachHours = dto.attach_hours ?? existing.attach_hours;
      const existingManualLines = existing.line_items
        .filter((line) => line.source_type === 'manual')
        .map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_rate: Number(line.unit_rate),
        }));
      let rebuilt: ComposedLine[];
      if (existing.contract_id && !contract) {
        const requiresContractRecompose =
          attachHours &&
          (dto.attach_hours === true ||
            dto.hours_from !== undefined ||
            dto.hours_to !== undefined ||
            dto.hours_detail_level !== undefined ||
            dto.hours_member_user_id !== undefined);
        if (requiresContractRecompose) {
          throw new ConflictException(
            'The contract used to price this invoice is no longer available. Existing priced lines were preserved.',
          );
        }
        rebuilt = await this.composeInvoiceLines(existing, null, {
          line_items: dto.line_items ?? existingManualLines,
          attach_hours: false,
          hours_detail_level:
            dto.hours_detail_level ?? existing.hours_detail_level ?? 'summary',
        });
        if (attachHours) {
          rebuilt.push(
            ...existing.line_items
              .filter((line) => line.source_type !== 'manual')
              .map((line) => ({
                source_type: line.source_type,
                source_log_id: line.source_log_id,
                description: line.description,
                quantity: Number(line.quantity),
                unit_rate: Number(line.unit_rate),
                amount: Number(line.amount),
                metadata: line.metadata,
                position: 0,
              })),
          );
          rebuilt = rebuilt.map((line, position) => ({ ...line, position }));
        }
      } else {
        rebuilt = await this.composeInvoiceLines(existing, contract, {
          line_items: dto.line_items ?? existingManualLines,
          attach_hours: attachHours,
          hours_from: dto.hours_from ?? existing.period_start ?? undefined,
          hours_to: dto.hours_to ?? existing.period_end ?? undefined,
          hours_detail_level:
            dto.hours_detail_level ?? existing.hours_detail_level ?? 'summary',
        });
      }
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
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'manage',
    );

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
    const projectId = this.requireInvoiceProjectId(invoice);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      projectId,
      'manage',
    );
    await this.qaFixtures.assertProjectSideEffectAllowed(
      projectId,
      'Invoice issuing',
    );

    if (invoice.status !== 'draft') {
      throw new BadRequestException(
        `Invoice in status ${invoice.status} cannot be issued.`,
      );
    }

    // An invoice can only be issued/sent once there is a client to reach:
    // a linked client account, a client email on the contract, or a real
    // client on the project. Otherwise "issue" would be a no-op.
    this.assertInvoiceHasClient(invoice);

    const now = new Date().toISOString();
    const issueDate = invoice.issue_date ?? now.slice(0, 10);

    // The issued document is the final legal snapshot. Render before locking so
    // the stored PDF is exactly what every subsequent resend uses.
    const { error: dateErr } = await this.supabase
      .from('invoices')
      .update({ issue_date: issueDate, updated_at: now })
      .eq('id', invoiceId);
    if (dateErr) throw new BadRequestException(dateErr.message);
    await this.renderAndStorePdf(
      await this.getInvoiceInternal(invoiceId),
      callerId,
    );

    const { error } = await this.supabase
      .from('invoices')
      .update({
        status: 'issued',
        issued_at: now,
        updated_at: now,
      })
      .eq('id', invoiceId);
    if (error) throw new BadRequestException(error.message);
    await this.recordEvent(invoiceId, 'issued', callerId, {
      issue_date: issueDate,
    });

    try {
      if (invoice.recipient_user_id && invoice.recipient_user_id !== callerId) {
        await this.notifications.createNotification({
          user_id: invoice.recipient_user_id,
          project_id: projectId,
          actor_id: callerId,
          type_name: 'invoice_issued',
          content: {
            invoice_id: invoice.id,
            invoice_number: invoice.number,
            amount: invoice.total,
            currency: invoice.currency,
            message: `Invoice ${invoice.number} has been issued.`,
          },
          link_url: `/project/${projectId}/overview`,
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
      pdf = invoice.pdf_path
        ? await this.uploads.getPrivateObject(invoice.pdf_path)
        : (await this.renderAndStorePdf(invoice, callerId)).buffer;
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
      await this.recordEvent(invoice.id, 'email_sent', callerId, { to });
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
      .select('owner_id')
      .eq('id', invoice.project_id)
      .maybeSingle();
    const ownerId = (project as { owner_id: string | null } | null)?.owner_id;
    if (!ownerId) return { email: null, source: 'none' };

    const { data: client } = await this.supabase
      .from('profiles')
      .select('email')
      .eq('id', ownerId)
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
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'read',
    );
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
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'manage',
    );
    await this.qaFixtures.assertProjectSideEffectAllowed(
      this.requireInvoiceProjectId(invoice),
      'Invoice email delivery',
    );
    if (invoice.status === 'draft' || invoice.status === 'void') {
      throw new BadRequestException(
        'Only issued invoices can be sent to the client.',
      );
    }
    return this.emailInvoiceToClient(invoice, callerId);
  }

  async recordPayment(
    callerId: string,
    invoiceId: string,
    dto: RecordInvoicePaymentDto,
  ): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'manage',
    );
    await this.qaFixtures.assertProjectSideEffectAllowed(
      this.requireInvoiceProjectId(invoice),
      'Invoice payment recording',
    );
    if (invoice.status === 'draft' || invoice.status === 'void') {
      throw new BadRequestException(
        'Payments can only be recorded against an issued invoice.',
      );
    }
    const amount = roundMoney(dto.amount);
    if (amount > invoice.balance_due + 0.0001) {
      throw new BadRequestException(
        'Payment cannot exceed the remaining invoice balance.',
      );
    }
    const { error } = await this.supabase.from('invoice_payments').insert({
      invoice_id: invoiceId,
      amount,
      payment_date: this.normalizeDate(dto.payment_date),
      payment_method: dto.payment_method?.trim() || null,
      reference: dto.reference?.trim() || null,
      note: dto.note?.trim() || null,
      recorded_by: callerId,
    });
    if (error) throw new BadRequestException(error.message);
    await this.refreshPaymentState(invoiceId);
    await this.recordEvent(invoiceId, 'payment_recorded', callerId, {
      amount,
      payment_date: dto.payment_date,
      reference: dto.reference?.trim() || null,
    });
    return this.getInvoiceInternal(invoiceId);
  }

  async reversePayment(
    callerId: string,
    invoiceId: string,
    paymentId: string,
    reason: string,
  ): Promise<InvoiceWithLines> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'manage',
    );
    await this.qaFixtures.assertProjectSideEffectAllowed(
      this.requireInvoiceProjectId(invoice),
      'Invoice payment reversal',
    );
    if (invoice.status === 'void')
      throw new BadRequestException(
        'A void invoice has no reversible payments.',
      );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: payment, error: paymentErr } = await this.supabase
      .from('invoice_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('invoice_id', invoiceId)
      .maybeSingle();
    if (paymentErr) throw new Error(paymentErr.message);
    if (!payment) throw new NotFoundException('Payment not found');
    if ((payment as InvoicePaymentRow).reverses_payment_id) {
      throw new BadRequestException('A reversal cannot be reversed.');
    }
    const { data: existingReversal } = await this.supabase
      .from('invoice_payments')
      .select('id')
      .eq('reverses_payment_id', paymentId)
      .maybeSingle();
    if (existingReversal)
      throw new BadRequestException('This payment has already been reversed.');
    const trimmedReason = reason.trim();
    if (!trimmedReason)
      throw new BadRequestException('A reversal reason is required.');
    const { error } = await this.supabase.from('invoice_payments').insert({
      invoice_id: invoiceId,
      amount: Number((payment as InvoicePaymentRow).amount),
      payment_date: new Date().toISOString().slice(0, 10),
      recorded_by: callerId,
      reverses_payment_id: paymentId,
      reversal_reason: trimmedReason,
    });
    if (error) throw new BadRequestException(error.message);
    await this.refreshPaymentState(invoiceId);
    await this.recordEvent(invoiceId, 'payment_reversed', callerId, {
      payment_id: paymentId,
      reason: trimmedReason,
    });
    return this.getInvoiceInternal(invoiceId);
  }

  async voidAndReplaceInvoice(
    callerId: string,
    invoiceId: string,
    reason: string,
  ): Promise<{ voided: InvoiceWithLines; replacement: InvoiceWithLines }> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    const projectId = this.requireInvoiceProjectId(invoice);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      projectId,
      'manage',
    );
    await this.qaFixtures.assertProjectSideEffectAllowed(
      projectId,
      'Invoice void and replacement',
    );
    if (invoice.status !== 'issued') {
      throw new BadRequestException(
        'Only unpaid issued invoices can be voided and replaced. Reverse payments first.',
      );
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason)
      throw new BadRequestException('A void reason is required.');
    const number = await this.nextInvoiceNumber(projectId, null);
    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: replacement, error: replacementErr } = await this.supabase
      .from('invoices')
      .insert({
        project_id: projectId,
        contract_id: invoice.contract_id,
        project_title_snapshot: invoice.project_title_snapshot,
        issuer_user_id: callerId,
        recipient_user_id: invoice.recipient_user_id,
        number,
        status: 'draft',
        currency: invoice.currency,
        issue_date: null,
        due_date: invoice.due_date,
        period_start: invoice.period_start,
        period_end: invoice.period_end,
        origin: 'manual',
        hours_detail_level: invoice.hours_detail_level,
        bill_to: invoice.bill_to,
        issued_by: invoice.issued_by,
        payment_method: invoice.payment_method,
        notes: invoice.notes,
        attach_hours: false,
        replaces_invoice_id: invoice.id,
      })
      .select('*')
      .single();
    if (replacementErr || !replacement)
      throw new BadRequestException(
        replacementErr?.message ?? 'Could not create replacement invoice.',
      );
    await this.replaceInvoiceLineItems(
      String((replacement as InvoiceRow).id),
      invoice.line_items.map((line) => ({
        source_type: line.source_type,
        source_log_id: line.source_log_id,
        description: line.description,
        quantity: Number(line.quantity),
        unit_rate: Number(line.unit_rate),
        amount: Number(line.amount),
        metadata: line.metadata,
        position: line.position,
      })),
    );
    await this.refreshTotals(String((replacement as InvoiceRow).id));
    const { error: voidErr } = await this.supabase
      .from('invoices')
      .update({
        status: 'void',
        void_reason: trimmedReason,
        voided_by: callerId,
        voided_at: now,
        replaced_by_invoice_id: (replacement as InvoiceRow).id,
        updated_at: now,
      })
      .eq('id', invoiceId);
    if (voidErr) throw new BadRequestException(voidErr.message);
    await this.recordEvent(invoiceId, 'voided', callerId, {
      reason: trimmedReason,
      replacement_invoice_id: (replacement as InvoiceRow).id,
    });
    await this.recordEvent(
      String((replacement as InvoiceRow).id),
      'replacement_created',
      callerId,
      { replaces_invoice_id: invoiceId },
    );
    return {
      voided: await this.getInvoiceInternal(invoiceId),
      replacement: await this.getInvoiceInternal(
        String((replacement as InvoiceRow).id),
      ),
    };
  }

  /**
   * True-or-throw: the invoice names somebody to send it to.
   *
   * A recipient account or a bill-to email on the invoice. It used to also accept
   * "the project has an owner who is not the consultant" as a third proof, read
   * out of `project_access.origin` — an inference about who the parties are rather
   * than a fact about this invoice, and one the execution layer should not be
   * asked to make. Requiring the invoice to name its recipient is both stricter
   * and unambiguous.
   */
  private assertInvoiceHasClient(invoice: InvoiceRow): void {
    const billToEmail = (invoice.bill_to as InvoiceParty | null)?.email?.trim();
    if (invoice.recipient_user_id || billToEmail) return;

    throw new BadRequestException(
      'This invoice has no recipient to send to. Link a recipient account, or fill in the bill-to details on the invoice or contract, before issuing.',
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
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'manage',
    );
    if (invoice.status !== 'draft' && invoice.pdf_path) {
      throw new BadRequestException(
        'Issued invoices use their finalized PDF and cannot be regenerated.',
      );
    }
    const stored = await this.renderAndStorePdf(invoice, callerId);
    if (invoice.status !== 'draft') {
      await this.recordEvent(invoiceId, 'pdf_finalized', callerId);
    }
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
      // The document states what it is and what has been settled against it,
      // so a re-sent PDF cannot look identical to the one issued before a
      // payment landed.
      status: invoice.status,
      amountPaid: invoice.amount_paid,
      isOverdue: invoice.is_overdue,
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
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      this.requireInvoiceProjectId(invoice),
      'read',
    );
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
      { data: payments, error: paymentsErr },
      { data: events, error: eventsErr },
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
      this.supabase
        .from('invoice_payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: true }),
      this.supabase
        .from('invoice_events')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: true }),
    ]);
    if (lineErr) throw new Error(lineErr.message);
    if (docsErr) throw new Error(docsErr.message);
    // Reads remain compatible while the API rolls out ahead of the receivables
    // migration. Payment actions still fail normally until the schema exists.
    if (paymentsErr && !isMissingReceivablesSchema(paymentsErr)) {
      throw new Error(paymentsErr.message);
    }
    if (eventsErr && !isMissingReceivablesSchema(eventsErr)) {
      throw new Error(eventsErr.message);
    }

    const paymentRows = (payments ?? []) as InvoicePaymentRow[];
    const amountPaid = paymentRows.reduce(
      (sum, payment) =>
        sum +
        (payment.reverses_payment_id
          ? -Number(payment.amount)
          : Number(payment.amount)),
      0,
    );
    const total = Number((invoice as InvoiceRow).total ?? 0);

    const parsed: InvoiceWithLines = {
      ...(invoice as InvoiceRow),
      subtotal: Number((invoice as InvoiceRow).subtotal ?? 0),
      total,
      line_items: ((lineItems ?? []) as InvoiceLineItemRow[]).map((item) => ({
        ...item,
        quantity: Number(item.quantity ?? 0),
        unit_rate: Number(item.unit_rate ?? 0),
        amount: Number(item.amount ?? 0),
      })),
      documents: (docs ?? []) as InvoiceDocumentRow[],
      payments: paymentRows.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
      events: (events ?? []) as InvoiceEventRow[],
      amount_paid: roundMoney(amountPaid),
      balance_due: roundMoney(Math.max(0, total - amountPaid)),
      payment_count: paymentRows.filter(
        (payment) => !payment.reverses_payment_id,
      ).length,
      is_overdue:
        !['draft', 'void', 'paid'].includes((invoice as InvoiceRow).status) &&
        total - amountPaid > 0 &&
        Boolean((invoice as InvoiceRow).due_date) &&
        String((invoice as InvoiceRow).due_date) <
          new Date().toISOString().slice(0, 10),
    };
    return parsed;
  }

  private async refreshPaymentState(invoiceId: string): Promise<void> {
    const invoice = await this.getInvoiceInternal(invoiceId);
    const status: InvoiceStatus =
      invoice.balance_due <= 0
        ? 'paid'
        : invoice.amount_paid > 0
          ? 'partially_paid'
          : 'issued';
    const { error } = await this.supabase
      .from('invoices')
      .update({
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);
    if (error) throw new BadRequestException(error.message);
  }

  private async recordEvent(
    invoiceId: string,
    eventType: string,
    actorId: string | null,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await this.supabase.from('invoice_events').insert({
      invoice_id: invoiceId,
      event_type: eventType,
      actor_id: actorId,
      data,
    });
    if (error) throw new Error(error.message);
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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isMissingReceivablesSchema(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === 'PGRST205' ||
    error.message?.includes("Could not find the table 'public.invoice_") ===
      true
  );
}
