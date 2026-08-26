import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { PdfTextExtractorService } from '../profile-import/services/pdf-text-extractor.service';
import { UploadsService } from '../../shared/uploads/uploads.controller';
import { TeamFinanceAccessService } from '../finance/team-finance-access.service';
import { InvoicesService } from '../invoices/invoices.service';
import {
  DocumentSnipDto,
  FinanceDocumentKind,
  ImportInvoiceDto,
  ImportedPaymentDto,
} from './dto/finance-imports.dto';
import { InvoiceReaderService } from './invoice-reader.service';

const FINANCE_DOCUMENTS_BUCKET = 'finance_documents';
/** Long enough to read a document in the workspace, short enough to not leak. */
const PREVIEW_URL_TTL_SECONDS = 900;

export interface FinanceDocumentRow {
  id: string;
  project_id: string;
  kind: FinanceDocumentKind;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  extraction: Record<string, unknown>;
  extraction_status: 'pending' | 'ready' | 'failed' | 'skipped';
  extraction_error: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/**
 * The untyped service-role client hands back `any`; naming the shape here keeps
 * every read in this file type-safe without a generated database type.
 */
interface SingleRowReply<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface FinanceDocumentSnipRow {
  id: string;
  document_id: string;
  invoice_id: string | null;
  payment_id: string | null;
  field_key: string;
  page: number;
  rect: { x: number; y: number; w: number; h: number };
  value_text: string | null;
  origin: 'snip' | 'extraction' | 'manual';
  created_at: string;
}

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Six places: enough for a PHP/AUD rate, few enough to stay exact on read. */
function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Recording invoices and payments that happened outside Proyekto.
 *
 * The unit of work is a DOCUMENT, not a form: a PDF that was already sent to a
 * client, or the bank record that proves it was paid. The document is uploaded
 * first, read once for a draft set of fields, and then committed into the same
 * `invoices` / `invoice_payments` tables the live lifecycle writes to — so a
 * backfilled invoice ages, totals, and reconciles exactly like a native one.
 *
 * Two rules hold the design together:
 *
 *   - Nothing is booked from the reader's output alone. Every committed field
 *     may carry a SNIP: the page and rectangle it was read from, stored beside
 *     the record. That is what makes a historical figure defensible six months
 *     later, and it is why `finance_document_snips` exists at all.
 *   - An imported invoice is never re-rendered or emailed. The document of
 *     record already exists and was already sent; `origin = 'imported'` is what
 *     the invoice lifecycle reads to refuse those transitions.
 */
@Injectable()
export class FinanceImportsService {
  private readonly logger = new Logger(FinanceImportsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly uploads: UploadsService,
    private readonly financeAccess: TeamFinanceAccessService,
    private readonly invoices: InvoicesService,
    private readonly pdfText: PdfTextExtractorService,
    private readonly reader: InvoiceReaderService,
  ) {}

  async uploadDocument(
    callerId: string,
    projectId: string,
    kind: FinanceDocumentKind,
    file: UploadedFileLike,
  ): Promise<FinanceDocumentRow & { preview_url: string }> {
    if (!file) throw new BadRequestException('No file provided');
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      projectId,
      'manage',
    );

    // Validation (size, mimetype) and the private-bucket routing live in the
    // shared uploader; this service only owns what the row means.
    const stored = await this.uploads.uploadFile(
      callerId,
      FINANCE_DOCUMENTS_BUCKET,
      file,
    );

    const { data, error } = (await this.supabase
      .from('finance_documents')
      .insert({
        project_id: projectId,
        kind,
        file_path: stored.path,
        file_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: callerId,
      })
      .select('*')
      .single()) as SingleRowReply<FinanceDocumentRow>;
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('The document was not stored.');

    const row = data;
    return { ...row, preview_url: await this.previewUrl(row.file_path) };
  }

  async listDocuments(
    callerId: string,
    projectId: string,
    kind?: FinanceDocumentKind,
  ): Promise<FinanceDocumentRow[]> {
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      projectId,
      'read',
    );
    let query = this.supabase
      .from('finance_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (kind) query = query.eq('kind', kind);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as FinanceDocumentRow[];
  }

  async getDocument(
    callerId: string,
    documentId: string,
  ): Promise<FinanceDocumentRow & { preview_url: string }> {
    const row = await this.requireDocument(documentId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      row.project_id,
      'read',
    );
    return { ...row, preview_url: await this.previewUrl(row.file_path) };
  }

  /**
   * The document's bytes, for rendering it in the workspace.
   *
   * Proxied through the API rather than handing the browser the presigned R2
   * URL: the renderer reads the file with `fetch`, and a cross-origin read of
   * the private bucket would need CORS opened on it. The bytes already pass
   * through this backend for invoice PDFs; one authorized hop is cheaper than
   * a permanently widened bucket.
   */
  async getDocumentFile(
    callerId: string,
    documentId: string,
  ): Promise<{ body: Buffer; mimeType: string; fileName: string }> {
    const row = await this.requireDocument(documentId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      row.project_id,
      'read',
    );
    return {
      body: await this.uploads.getPrivateObject(row.file_path),
      mimeType: row.mime_type,
      fileName: row.file_name,
    };
  }

  /**
   * Read the document once and store the draft fields on it.
   *
   * Idempotent by design: re-reading a document overwrites its draft and
   * touches nothing that was already committed. Only PDFs carry a text layer —
   * a photograph of a bank app is marked `skipped` rather than failed, because
   * there is nothing wrong with it; it simply has to be snipped by hand.
   */
  async readDocument(
    callerId: string,
    documentId: string,
  ): Promise<FinanceDocumentRow> {
    const row = await this.requireDocument(documentId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      row.project_id,
      'manage',
    );

    if (row.mime_type !== 'application/pdf') {
      return this.saveExtraction(documentId, {
        extraction_status: 'skipped',
        extraction: {
          note: 'Images carry no text layer. Snip the fields from the document.',
        },
      });
    }

    try {
      const buffer = await this.uploads.getPrivateObject(row.file_path);
      const text = await this.pdfText.extract(buffer);
      const fields = await this.reader.read(text.plainText);
      return this.saveExtraction(documentId, {
        extraction_status: 'ready',
        extraction: { fields, read_at: new Date().toISOString() },
        extracted_text: text.plainText,
        page_count: text.pageCount,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The document could not be read.';
      this.logger.warn(
        `Finance document read failed (${documentId}): ${message}`,
      );
      return this.saveExtraction(documentId, {
        extraction_status: 'failed',
        extraction_error: message,
      });
    }
  }

  async deleteDocument(callerId: string, documentId: string): Promise<void> {
    const row = await this.requireDocument(documentId);
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      row.project_id,
      'manage',
    );

    // A document that a record was booked from is that record's evidence; it
    // outlives the workspace it was uploaded in.
    const [{ count: invoiceCount }, { count: paymentCount }] =
      await Promise.all([
        this.supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('source_document_id', documentId),
        this.supabase
          .from('invoice_payments')
          .select('id', { count: 'exact', head: true })
          .eq('proof_document_id', documentId),
      ]);
    if ((invoiceCount ?? 0) > 0 || (paymentCount ?? 0) > 0) {
      throw new BadRequestException(
        'This document is the evidence for a recorded invoice or payment and cannot be removed.',
      );
    }

    const { error } = await this.supabase
      .from('finance_documents')
      .delete()
      .eq('id', documentId);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Commit a document into the ledger as an invoice, with the payments that
   * already settled it and the snips that evidence every figure.
   *
   * The invoice is created `issued` — it was issued, on paper, on its issue
   * date — and each payment is applied through the same balance rules the live
   * lifecycle uses, so the final status is computed rather than asserted.
   */
  async importInvoice(
    callerId: string,
    dto: ImportInvoiceDto,
  ): Promise<{ invoice_id: string }> {
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      dto.project_id,
      'manage',
    );
    const document = await this.requireDocument(dto.source_document_id);
    if (document.project_id !== dto.project_id) {
      throw new BadRequestException(
        'That document belongs to a different project.',
      );
    }

    const currency = dto.currency.trim().toUpperCase();
    const total = roundMoney(dto.total);
    const lines = dto.lines?.length
      ? dto.lines
      : [{ description: 'Imported invoice', amount: total }];
    const lineTotal = roundMoney(
      lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0),
    );
    if (dto.lines?.length && Math.abs(lineTotal - total) > 0.01) {
      throw new BadRequestException(
        `The lines add up to ${lineTotal}, not the invoice total ${total}.`,
      );
    }

    const { data: created, error } = await this.supabase
      .from('invoices')
      .insert({
        project_id: dto.project_id,
        issuer_user_id: callerId,
        number: dto.number.trim(),
        status: 'issued',
        currency,
        issue_date: dto.issue_date,
        due_date: dto.due_date ?? null,
        notes: dto.notes?.trim() || null,
        subtotal: total,
        total,
        issued_at: new Date(`${dto.issue_date}T00:00:00Z`).toISOString(),
        origin: 'imported',
        source_document_id: document.id,
      })
      .select('id')
      .single();
    if (error) {
      // The table's own uniqueness rule, phrased for the person importing.
      if (error.code === '23505') {
        throw new BadRequestException(
          `Invoice ${dto.number.trim()} is already recorded on this project.`,
        );
      }
      throw new BadRequestException(error.message);
    }
    const invoiceId = (created as { id: string }).id;

    const { error: linesError } = await this.supabase
      .from('invoice_line_items')
      .insert(
        lines.map((line, index) => ({
          invoice_id: invoiceId,
          source_type: 'manual',
          description: line.description,
          quantity: line.quantity ?? 1,
          unit_rate: line.unit_rate ?? roundMoney(Number(line.amount)),
          amount: roundMoney(Number(line.amount)),
          position: index,
        })),
      );
    if (linesError) throw new BadRequestException(linesError.message);

    await this.recordEvent(invoiceId, 'created', callerId, {
      origin: 'imported',
      document_id: document.id,
      file_name: document.file_name,
    });

    for (const payment of dto.payments ?? []) {
      await this.applyPayment(callerId, invoiceId, currency, payment);
    }
    if (dto.payments?.length) {
      await this.invoices.refreshPaymentState(invoiceId);
    }

    await this.saveSnips(callerId, invoiceId, null, dto.snips ?? []);
    return { invoice_id: invoiceId };
  }

  /** The evidence behind one recorded invoice, for the ledger's detail view. */
  async listInvoiceSnips(callerId: string, invoiceId: string) {
    const { data: invoice, error } = await this.supabase
      .from('invoices')
      .select('id, project_id')
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.financeAccess.assertProjectFinanceActor(
      callerId,
      (invoice as { project_id: string }).project_id,
      'read',
    );

    const { data, error: snipsError } = (await this.supabase
      .from('finance_document_snips')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })) as SingleRowReply<
      FinanceDocumentSnipRow[]
    >;
    if (snipsError) throw new Error(snipsError.message);
    return data ?? [];
  }

  private async applyPayment(
    callerId: string,
    invoiceId: string,
    invoiceCurrency: string,
    payment: ImportedPaymentDto,
  ): Promise<void> {
    const amount = roundMoney(payment.amount);
    const settlement = this.resolveSettlement(invoiceCurrency, amount, payment);

    const { data: inserted, error } = await this.supabase
      .from('invoice_payments')
      .insert({
        invoice_id: invoiceId,
        amount,
        payment_date: payment.payment_date,
        payment_method: payment.payment_method?.trim() || null,
        reference: payment.reference?.trim() || null,
        note: payment.note?.trim() || null,
        recorded_by: callerId,
        settled_currency: settlement?.currency ?? null,
        settled_amount: settlement?.amount ?? null,
        fx_rate: settlement?.rate ?? null,
        proof_document_id: payment.proof_document_id ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    const paymentId = (inserted as { id: string }).id;

    await this.recordEvent(invoiceId, 'payment_recorded', callerId, {
      amount,
      payment_date: payment.payment_date,
      reference: payment.reference?.trim() || null,
      settled_currency: settlement?.currency ?? null,
      settled_amount: settlement?.amount ?? null,
      fx_rate: settlement?.rate ?? null,
      origin: 'imported',
    });

    await this.saveSnips(callerId, null, paymentId, payment.snips ?? []);
  }

  /**
   * What actually landed, and at what rate.
   *
   * A settlement in the invoice's own currency is not a foreign settlement and
   * is stored as none at all — otherwise every ordinary payment would carry a
   * meaningless rate of 1. When the rate is not given it is derived from the
   * two amounts, which is the only rate that reconciles them.
   */
  private resolveSettlement(
    invoiceCurrency: string,
    amount: number,
    payment: ImportedPaymentDto,
  ): { currency: string; amount: number; rate: number } | null {
    const currency = payment.settled_currency?.trim().toUpperCase();
    if (!currency && payment.settled_amount === undefined) return null;
    if (!currency || payment.settled_amount === undefined) {
      throw new BadRequestException(
        'A settlement needs both the currency it arrived in and the amount that arrived.',
      );
    }
    if (currency === invoiceCurrency) return null;

    const settledAmount = roundMoney(payment.settled_amount);
    const rate = payment.fx_rate ?? settledAmount / amount;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException('The settlement rate must be positive.');
    }
    return { currency, amount: settledAmount, rate: roundRate(rate) };
  }

  private async saveSnips(
    callerId: string,
    invoiceId: string | null,
    paymentId: string | null,
    snips: DocumentSnipDto[],
  ): Promise<void> {
    if (snips.length === 0) return;
    const rows = snips.map((snip) => ({
      document_id: snip.document_id,
      invoice_id: invoiceId,
      payment_id: paymentId,
      field_key: snip.field_key,
      page: snip.page,
      rect: this.normalizeRect(snip.rect),
      value_text: snip.value_text ?? null,
      origin: snip.origin ?? 'snip',
      created_by: callerId,
    }));
    const { error } = await this.supabase
      .from('finance_document_snips')
      .upsert(rows, {
        onConflict: invoiceId ? 'invoice_id,field_key' : 'payment_id,field_key',
      });
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Clamped to the page. A rectangle that runs off the edge would highlight
   * nothing on re-render, and the viewer can produce one from a drag that ends
   * outside the canvas.
   */
  private normalizeRect(rect: { x: number; y: number; w: number; h: number }): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    // Rounded as well as clamped: `1 - 0.8` is 0.19999999999999996 in binary
    // floating point, and a stored rectangle should read like a rectangle.
    const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
    const clamp = (value: number) =>
      Number.isFinite(value) ? round(Math.min(1, Math.max(0, value))) : 0;
    const x = clamp(rect.x);
    const y = clamp(rect.y);
    return {
      x,
      y,
      w: round(Math.min(clamp(rect.w), 1 - x)),
      h: round(Math.min(clamp(rect.h), 1 - y)),
    };
  }

  private async previewUrl(path: string): Promise<string> {
    return this.uploads.getPrivateSignedUrl(path, PREVIEW_URL_TTL_SECONDS);
  }

  private async requireDocument(id: string): Promise<FinanceDocumentRow> {
    const { data, error } = (await this.supabase
      .from('finance_documents')
      .select('*')
      .eq('id', id)
      .maybeSingle()) as SingleRowReply<FinanceDocumentRow>;
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Document not found');
    return data;
  }

  private async saveExtraction(
    documentId: string,
    patch: Record<string, unknown>,
  ): Promise<FinanceDocumentRow> {
    const { data, error } = (await this.supabase
      .from('finance_documents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .select('*')
      .single()) as SingleRowReply<FinanceDocumentRow>;
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Document not found');
    return data;
  }

  private async recordEvent(
    invoiceId: string,
    eventType: string,
    actorId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase.from('invoice_events').insert({
      invoice_id: invoiceId,
      event_type: eventType,
      actor_id: actorId,
      data,
    });
    if (error) throw new Error(error.message);
  }
}
