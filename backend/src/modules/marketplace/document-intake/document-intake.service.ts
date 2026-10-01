/* eslint-disable @typescript-eslint/no-unsafe-assignment --
 * The shared Supabase client is untyped at this boundary; every row is cast
 * to its interface where it is read, as in the rest of the marketplace code.
 */
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentInternalClient } from '../../../common/agent/agent-internal.client';
import { isActiveConsultantEnrollment } from '../../../common/auth/consultant-capability';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { UploadsService } from '../../shared/uploads/uploads.controller';
import { PdfTextExtractorService } from '../profile-import/services/pdf-text-extractor.service';
import type {
  CreateIntakeBatchDto,
  RereadIntakeFieldDto,
  UpdateIntakeClausesDto,
  UpdateIntakeDocumentDto,
  UpdateIntakeFieldDto,
  UpdateIntakeRelationshipDto,
} from './dto/document-intake.dto';
import {
  acceptField,
  blockingFields,
  chargeablePages,
  correctField,
  type CurrencyDecision,
  currencyQuestion,
  documentCurrencies,
  type ExtractedFieldInput,
  groupByCounterparty,
  importerSideCheck,
  type IntakeDocType,
  invoiceTotalFlags,
  markNotInDocument,
  matchPaymentToInvoice,
  normalizePartyName,
  pagesOf,
  type ReviewFields,
  reviewFieldsFromExtraction,
} from './intake-review';

export interface UploadedIntakeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface IntakeBatchRow {
  id: string;
  workspace_id: string | null;
  created_by: string;
  importer_capacity: 'consultant' | 'client';
  status: 'open' | 'replicated' | 'abandoned';
  created_at: string;
  updated_at: string;
}

export interface IntakeDocumentRow {
  id: string;
  batch_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  file_sha256: string;
  page_count: number;
  page_start: number;
  page_end: number;
  doc_type: IntakeDocType | null;
  language: string | null;
  extraction: {
    clauses?: Array<{ number?: string; title?: string; body?: string }>;
    line_items?: Array<{
      description?: string;
      quantity?: number | null;
      unit_rate?: number | null;
      amount?: number | null;
    }>;
    model?: string;
    classification_confidence?: number;
    match?: { invoice_id: string; basis: string } | null;
    [key: string]: unknown;
  };
  confidence: Record<string, number>;
  fields: ReviewFields;
  flags: string[];
  relationship_id: string | null;
  duplicate_of: string | null;
  status:
    | 'uploaded'
    | 'classified'
    | 'extracted'
    | 'confirmed'
    | 'replicated'
    | 'failed'
    | 'skipped';
  replicated_record: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface IntakeRelationshipRow {
  id: string;
  batch_id: string;
  counterparty_name: string | null;
  counterparty_email: string | null;
  counterparty_user_id: string | null;
  relationship_kind: 'client_services' | 'talent_services';
  project_id: string | null;
  project_title: string | null;
  status: 'proposed' | 'confirmed' | 'replicated';
  replicated: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;
const ENGLISH = /^en\b/;

/**
 * Document intake: upload -> detect -> classify -> extract -> group -> review.
 * (Replicate lives in IntakeReplicateService.)
 *
 * The AI output is always a draft: nothing below creates a Proyekto record.
 * Every model call goes to the agent service with the internal token; the
 * agent never touches the database.
 */
@Injectable()
export class DocumentIntakeService {
  private readonly logger = new Logger(DocumentIntakeService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly uploads: UploadsService,
    private readonly agent: AgentInternalClient,
    private readonly pdf: PdfTextExtractorService,
    @Optional() private readonly entitlements?: EntitlementsService,
  ) {}

  // ─── batches ───────────────────────────────────────────────────────────────

  /** Consultants and clients may run intake; the importer's side is recorded. */
  async createBatch(
    callerId: string,
    dto: CreateIntakeBatchDto,
  ): Promise<IntakeBatchRow> {
    const workspaceId =
      dto.workspace_id ?? (await this.defaultWorkspaceId(callerId));
    if (dto.workspace_id) {
      const { data } = await this.supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', dto.workspace_id)
        .eq('user_id', callerId)
        .maybeSingle();
      if (!data) throw new NotFoundException('Workspace not found');
    }
    const capacity = (await isActiveConsultantEnrollment(
      this.supabase,
      callerId,
    ))
      ? 'consultant'
      : 'client';
    const { data, error } = await this.supabase
      .from('intake_batches')
      .insert({
        workspace_id: workspaceId,
        created_by: callerId,
        importer_capacity: capacity,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Could not start intake.',
      );
    }
    return data as IntakeBatchRow;
  }

  async listBatches(callerId: string): Promise<IntakeBatchRow[]> {
    const { data, error } = await this.supabase
      .from('intake_batches')
      .select('*')
      .eq('created_by', callerId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as IntakeBatchRow[];
  }

  async getBatch(callerId: string, batchId: string) {
    const batch = await this.requireBatch(callerId, batchId);
    const [documents, relationships] = await Promise.all([
      this.batchDocuments(batch.id),
      this.batchRelationships(batch.id),
    ]);
    const [importer, projectCurrencies] = await Promise.all([
      this.importerIdentity(batch.created_by),
      this.projectCurrencies(
        relationships
          .map((row) => row.project_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ]);
    return {
      ...batch,
      documents,
      relationships: relationships.map((relationship) => ({
        ...relationship,
        party_check: this.partyCheck(
          relationship,
          documents,
          importer,
          batch.importer_capacity,
        ),
        // Asked on the page before Import; replicate refuses without it.
        currency_question:
          relationship.status === 'replicated'
            ? null
            : currencyQuestion({
                documentCurrencies: documentCurrencies(
                  documents.filter(
                    (doc) =>
                      doc.relationship_id === relationship.id &&
                      doc.status === 'confirmed',
                  ),
                ),
                projectCurrency: relationship.project_id
                  ? (projectCurrencies.get(relationship.project_id) ?? 'USD')
                  : null,
                previous:
                  (relationship.replicated.currency_decision as
                    | CurrencyDecision
                    | undefined) ?? null,
              }),
      })),
      pages: pagesOf(documents),
    };
  }

  /**
   * How the importer is named on a group's documents. When the paper names
   * them differently from their team (a trading name), the review suggests
   * the team name the records are created under.
   */
  private partyCheck(
    relationship: IntakeRelationshipRow,
    documents: IntakeDocumentRow[],
    importer: { names: string[]; teamName: string | null },
    capacity: 'consultant' | 'client',
  ): { read_name: string | null; team_name: string | null; matches: boolean } {
    const mine = documents.filter(
      (doc) => doc.relationship_id === relationship.id,
    );
    const check = importerSideCheck(
      mine.map((doc) => ({
        id: doc.id,
        doc_type: doc.doc_type,
        fields: doc.fields,
      })),
      importer.names,
      capacity,
    );
    return { ...check, team_name: importer.teamName };
  }

  // ─── upload ────────────────────────────────────────────────────────────────

  /**
   * Store each file privately, hash it, count its pages. A file already
   * imported (same sha256, by this person or in this workspace) is flagged and
   * skipped, never re-read. Pages count against the intake quota here.
   */
  async uploadFiles(
    callerId: string,
    batchId: string,
    files: UploadedIntakeFile[],
  ): Promise<IntakeDocumentRow[]> {
    const batch = await this.requireBatch(callerId, batchId);
    if (batch.status !== 'open') {
      throw new BadRequestException('This intake is closed.');
    }
    if (!files?.length) throw new BadRequestException('No files provided.');
    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw new BadRequestException(
        `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`,
      );
    }

    const prepared: Array<{
      file: UploadedIntakeFile;
      sha256: string;
      pages: number;
      duplicateOf: string | null;
    }> = [];
    for (const file of files) {
      if (!ACCEPTED_TYPES.has(file.mimetype)) {
        throw new BadRequestException(
          `${file.originalname}: upload a PDF or a JPEG, PNG or WebP photo.`,
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new BadRequestException(
          `${file.originalname} is larger than 25 MB.`,
        );
      }
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const pages =
        file.mimetype === 'application/pdf'
          ? Math.max(1, (await this.pdf.extract(file.buffer)).pageCount)
          : 1;
      prepared.push({
        file,
        sha256,
        pages,
        duplicateOf: await this.findDuplicateFile(batch, sha256),
      });
    }

    await this.assertPageQuota(
      batch,
      prepared
        .filter((entry) => !entry.duplicateOf)
        .reduce((sum, entry) => sum + entry.pages, 0),
    );

    const rows: IntakeDocumentRow[] = [];
    for (const entry of prepared) {
      const extension =
        entry.file.originalname.split('.').pop()?.toLowerCase() ?? 'bin';
      const key = `intake/${batch.id}/${entry.sha256}.${extension}`;
      if (!entry.duplicateOf) {
        await this.uploads.putPrivateObject(
          key,
          entry.file.buffer,
          entry.file.mimetype,
        );
      }
      const { data, error } = await this.supabase
        .from('intake_documents')
        .insert({
          batch_id: batch.id,
          file_path: key,
          file_name: entry.file.originalname,
          mime_type: entry.file.mimetype,
          size_bytes: entry.file.size,
          file_sha256: entry.sha256,
          page_count: entry.pages,
          page_start: 1,
          page_end: entry.pages,
          duplicate_of: entry.duplicateOf,
          status: entry.duplicateOf ? 'skipped' : 'uploaded',
          flags: entry.duplicateOf
            ? ['This file was already imported. It was not read again.']
            : [],
        })
        .select('*')
        .single();
      if (error || !data) {
        throw new BadRequestException(error?.message ?? 'Upload failed.');
      }
      rows.push(data as IntakeDocumentRow);
    }
    return rows;
  }

  // ─── detect + classify ─────────────────────────────────────────────────────

  /**
   * Split an uploaded file into the documents it holds and give each a type.
   * The first detected document keeps this row; the rest are new rows on the
   * same file. The person can re-split, merge and retype afterwards.
   */
  async classify(
    callerId: string,
    documentId: string,
  ): Promise<IntakeDocumentRow[]> {
    const { document, batch } = await this.requireDocument(
      callerId,
      documentId,
    );
    if (document.status !== 'uploaded') {
      throw new BadRequestException('This file has already been classified.');
    }
    const result = await this.agent.post<{
      documents: Array<{
        doc_type: IntakeDocType;
        page_start: number;
        page_end: number;
        language: string;
        confidence: number;
      }>;
      model: string;
    }>(
      '/intake/classify',
      {
        file_name: document.file_name,
        mime_type: document.mime_type,
        file_data_url: await this.fileDataUrl(document),
        page_count: document.page_count,
      },
      {
        timeoutMs: 110_000,
        unavailableMessage:
          'Automatic reading is not available right now. Set each document type by hand.',
      },
    );
    const detected = normalizeRanges(result.documents, document.page_count);
    const [first, ...rest] = detected;
    const out: IntakeDocumentRow[] = [
      await this.patchDocument(document.id, {
        doc_type: first.doc_type,
        page_start: first.page_start,
        page_end: first.page_end,
        language: first.language,
        status: 'classified',
        extraction: {
          classification_confidence: first.confidence,
          model: result.model,
        },
        flags: languageFlags(first.language),
      }),
    ];
    for (const entry of rest) {
      const { data, error } = await this.supabase
        .from('intake_documents')
        .insert({
          batch_id: batch.id,
          file_path: document.file_path,
          file_name: document.file_name,
          mime_type: document.mime_type,
          size_bytes: document.size_bytes,
          file_sha256: document.file_sha256,
          page_count: document.page_count,
          page_start: entry.page_start,
          page_end: entry.page_end,
          doc_type: entry.doc_type,
          language: entry.language,
          status: 'classified',
          extraction: {
            classification_confidence: entry.confidence,
            model: result.model,
          },
          flags: languageFlags(entry.language),
        })
        .select('*')
        .single();
      if (error || !data) throw new BadRequestException(error?.message);
      out.push(data as IntakeDocumentRow);
    }
    return out;
  }

  // ─── extract ───────────────────────────────────────────────────────────────

  /**
   * Read a document's fields. Every value carries its page, box and
   * confidence, and lands in one of the review states. A document the model
   * identified as another language is flagged, not extracted.
   */
  async extract(
    callerId: string,
    documentId: string,
  ): Promise<IntakeDocumentRow> {
    const { document } = await this.requireDocument(callerId, documentId);
    if (!document.doc_type) {
      throw new BadRequestException('Classify the document first.');
    }
    if (document.status === 'confirmed' || document.status === 'replicated') {
      throw new BadRequestException('A confirmed document is not re-read.');
    }
    if (document.language && !ENGLISH.test(document.language)) {
      return this.patchDocument(document.id, {
        status: 'extracted',
        flags: languageFlags(document.language),
        fields: {},
      });
    }
    if (document.doc_type === 'other') {
      return this.patchDocument(document.id, {
        status: 'extracted',
        fields: {},
      });
    }

    const result = await this.agent.post<{
      language: string;
      fields: Record<string, ExtractedFieldInput>;
      clauses: Array<{ number?: string; title?: string; body?: string }>;
      line_items: NonNullable<IntakeDocumentRow['extraction']['line_items']>;
      model: string;
    }>(
      '/intake/extract',
      {
        doc_type: document.doc_type,
        file_name: document.file_name,
        mime_type: document.mime_type,
        file_data_url: await this.fileDataUrl(document),
        page_start: document.page_start,
        page_end: document.page_end,
      },
      {
        timeoutMs: 110_000,
        unavailableMessage:
          'Automatic reading is not available right now. Type the fields from the document.',
      },
    );
    if (result.language && !ENGLISH.test(result.language)) {
      return this.patchDocument(document.id, {
        status: 'extracted',
        language: result.language,
        flags: languageFlags(result.language),
        fields: {},
      });
    }
    const fields = reviewFieldsFromExtraction(result.fields ?? {});
    const flags =
      document.doc_type === 'invoice'
        ? invoiceTotalFlags(fields, result.line_items ?? [])
        : [];
    return this.patchDocument(document.id, {
      status: 'extracted',
      language: result.language || document.language,
      fields,
      confidence: Object.fromEntries(
        Object.entries(fields).map(([name, f]) => [name, f.confidence]),
      ),
      flags,
      extraction: {
        ...document.extraction,
        fields: result.fields,
        clauses: result.clauses ?? [],
        line_items: result.line_items ?? [],
        model: result.model,
        read_at: new Date().toISOString(),
      },
    });
  }

  /**
   * "Assign a field by drawing a box": the crop is re-read for that one field
   * (a small call on that region only) and fills it, origin `snip`.
   */
  async reread(
    callerId: string,
    documentId: string,
    dto: RereadIntakeFieldDto,
  ): Promise<IntakeDocumentRow> {
    const { document } = await this.requireDocument(callerId, documentId);
    this.assertEditable(document);
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dto.image_data_url)) {
      throw new BadRequestException('Send the drawn region as an image.');
    }
    const result = await this.agent.post<{
      fields: Record<string, ExtractedFieldInput>;
    }>(
      '/intake/extract',
      {
        doc_type: document.doc_type ?? 'other',
        file_name: `${document.file_name} (region)`,
        mime_type: dto.image_data_url.slice(5, dto.image_data_url.indexOf(';')),
        file_data_url: dto.image_data_url,
        page_start: 1,
        page_end: 1,
        field: dto.field,
      },
      { timeoutMs: 60_000 },
    );
    const read = result.fields?.[dto.field];
    const fields = {
      ...document.fields,
      [dto.field]: correctField(
        document.fields[dto.field],
        typeof read?.value === 'string' || typeof read?.value === 'number'
          ? String(read.value)
          : null,
        'snip',
        { page: dto.page ?? null, box: dto.box ?? null },
      ),
    };
    return this.patchDocument(document.id, {
      fields,
      flags: this.refreshFlags(document, fields),
    });
  }

  // ─── review ────────────────────────────────────────────────────────────────

  async updateField(
    callerId: string,
    documentId: string,
    dto: UpdateIntakeFieldDto,
  ): Promise<IntakeDocumentRow> {
    const { document } = await this.requireDocument(callerId, documentId);
    this.assertEditable(document);
    const current = document.fields[dto.field];
    let next;
    if (dto.not_in_document) {
      next = markNotInDocument(current);
    } else if (dto.accept) {
      if (!current)
        throw new BadRequestException('There is nothing to accept.');
      next = acceptField(current);
    } else {
      next = dto.snip_box
        ? correctField(current, dto.value ?? null, 'snip', {
            page: dto.snip_page ?? null,
            box: dto.snip_box,
          })
        : correctField(current, dto.value ?? null, 'typed');
    }
    const fields = { ...document.fields, [dto.field]: next };
    return this.patchDocument(document.id, {
      fields,
      flags: this.refreshFlags(document, fields),
    });
  }

  async updateClauses(
    callerId: string,
    documentId: string,
    dto: UpdateIntakeClausesDto,
  ): Promise<IntakeDocumentRow> {
    const { document } = await this.requireDocument(callerId, documentId);
    this.assertEditable(document);
    return this.patchDocument(document.id, {
      extraction: { ...document.extraction, clauses: dto.clauses },
    });
  }

  /** Retype, re-range, regroup or re-match a document. */
  async updateDocument(
    callerId: string,
    documentId: string,
    dto: UpdateIntakeDocumentDto,
  ): Promise<IntakeDocumentRow> {
    const { document, batch } = await this.requireDocument(
      callerId,
      documentId,
    );
    this.assertEditable(document);
    const patch: Record<string, unknown> = {};
    if (dto.doc_type && dto.doc_type !== document.doc_type) {
      // A new type means a new set of fields: read it again.
      patch.doc_type = dto.doc_type;
      patch.fields = {};
      patch.status = 'classified';
    }
    const start = dto.page_start ?? document.page_start;
    const end = dto.page_end ?? document.page_end;
    if (start > end || end > document.page_count) {
      throw new BadRequestException(
        `Pages must be within 1-${document.page_count}.`,
      );
    }
    if (start !== document.page_start || end !== document.page_end) {
      patch.page_start = start;
      patch.page_end = end;
      patch.status = 'classified';
    }
    if (dto.relationship_id !== undefined) {
      if (dto.relationship_id) {
        const relationship = await this.requireRelationship(
          callerId,
          dto.relationship_id,
        );
        if (relationship.batch_id !== batch.id) {
          throw new BadRequestException('That group is in another intake.');
        }
      }
      patch.relationship_id = dto.relationship_id;
    }
    if (dto.matched_invoice_id !== undefined) {
      patch.extraction = {
        ...document.extraction,
        match: dto.matched_invoice_id
          ? { invoice_id: dto.matched_invoice_id, basis: 'person' }
          : null,
      };
    }
    return this.patchDocument(document.id, patch);
  }

  /** Split a detected document in two at a page (the person's re-split). */
  async split(
    callerId: string,
    documentId: string,
    atPage: number,
  ): Promise<IntakeDocumentRow[]> {
    const { document } = await this.requireDocument(callerId, documentId);
    this.assertEditable(document);
    if (atPage <= document.page_start || atPage > document.page_end) {
      throw new BadRequestException(
        `Split between pages ${document.page_start + 1} and ${document.page_end}.`,
      );
    }
    const first = await this.patchDocument(document.id, {
      page_end: atPage - 1,
      status: 'classified',
      fields: {},
    });
    const { data, error } = await this.supabase
      .from('intake_documents')
      .insert({
        batch_id: document.batch_id,
        file_path: document.file_path,
        file_name: document.file_name,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        file_sha256: document.file_sha256,
        page_count: document.page_count,
        page_start: atPage,
        page_end: document.page_end,
        doc_type: document.doc_type,
        language: document.language,
        status: 'classified',
      })
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message);
    return [first, data as IntakeDocumentRow];
  }

  /** Merge a document with the one that follows it in the same file. */
  async merge(
    callerId: string,
    documentId: string,
    withId: string,
  ): Promise<IntakeDocumentRow> {
    const { document } = await this.requireDocument(callerId, documentId);
    const { document: other } = await this.requireDocument(callerId, withId);
    this.assertEditable(document);
    this.assertEditable(other);
    if (
      other.file_path !== document.file_path ||
      other.page_start !== document.page_end + 1
    ) {
      throw new BadRequestException(
        'Only the next document in the same file can be merged.',
      );
    }
    await this.supabase.from('intake_documents').delete().eq('id', other.id);
    return this.patchDocument(document.id, {
      page_end: other.page_end,
      status: 'classified',
      fields: {},
    });
  }

  /**
   * Confirm is disabled until no field is Unsure or Needs input. A field the
   * document genuinely does not contain is marked "Not in document" instead.
   */
  async confirm(
    callerId: string,
    documentId: string,
  ): Promise<IntakeDocumentRow> {
    const { document } = await this.requireDocument(callerId, documentId);
    if (document.status !== 'extracted') {
      throw new BadRequestException(
        document.status === 'confirmed'
          ? 'Already confirmed.'
          : 'Read the document before confirming it.',
      );
    }
    if (document.language && !ENGLISH.test(document.language)) {
      throw new BadRequestException(
        'Only English documents can be imported for now.',
      );
    }
    const blocking = blockingFields(document.fields);
    if (blocking.length > 0) {
      throw new ConflictException(
        `Confirm or correct these fields first: ${blocking.join(', ')}.`,
      );
    }
    return this.patchDocument(document.id, { status: 'confirmed' });
  }

  // ─── group ─────────────────────────────────────────────────────────────────

  /**
   * Propose relationships: documents between the same two parties. Invoices
   * are matched to their relationship by the parties they name; payments to
   * invoices by reference, else by amount. The person confirms or regroups.
   */
  async group(callerId: string, batchId: string) {
    const batch = await this.requireBatch(callerId, batchId);
    const documents = (await this.batchDocuments(batch.id)).filter(
      (doc) => doc.status === 'extracted' || doc.status === 'confirmed',
    );
    const importerNames = await this.importerNames(callerId);
    const groups = groupByCounterparty(
      documents.map((doc) => ({
        id: doc.id,
        doc_type: doc.doc_type,
        fields: doc.fields,
      })),
      importerNames,
      batch.importer_capacity,
    );
    const existing = await this.batchRelationships(batch.id);
    for (const group of groups.values()) {
      // A group the person renamed keeps its documents: it is found by the
      // documents already in it, then by its (edited) name.
      const assigned = documents.find(
        (doc) => group.ids.includes(doc.id) && doc.relationship_id,
      )?.relationship_id;
      const key = normalizePartyName(group.name);
      let relationship =
        existing.find((row) => row.id === assigned) ??
        existing.find(
          (row) =>
            row.counterparty_name &&
            normalizePartyName(row.counterparty_name) === key,
        );
      if (!relationship) {
        const { data, error } = await this.supabase
          .from('intake_relationships')
          .insert({
            batch_id: batch.id,
            counterparty_name: group.name,
            counterparty_email: group.email,
            relationship_kind: 'client_services',
          })
          .select('*')
          .single();
        if (error || !data) throw new BadRequestException(error?.message);
        relationship = data as IntakeRelationshipRow;
        existing.push(relationship);
      }
      await this.supabase
        .from('intake_documents')
        .update({ relationship_id: relationship.id })
        .in('id', group.ids)
        .is('relationship_id', null);
    }

    // Payments to invoices, within each relationship.
    const regrouped = await this.batchDocuments(batch.id);
    for (const payment of regrouped.filter(
      (doc) =>
        (doc.doc_type === 'receipt' || doc.doc_type === 'proof_of_payment') &&
        !doc.extraction.match,
    )) {
      const invoices = regrouped.filter(
        (doc) =>
          doc.doc_type === 'invoice' &&
          doc.relationship_id === payment.relationship_id,
      );
      const match = matchPaymentToInvoice(
        { id: payment.id, doc_type: payment.doc_type, fields: payment.fields },
        invoices.map((doc) => ({
          id: doc.id,
          doc_type: doc.doc_type,
          fields: doc.fields,
        })),
      );
      if (match) {
        await this.patchDocument(payment.id, {
          extraction: { ...payment.extraction, match },
        });
      }
    }
    return this.getBatch(callerId, batch.id);
  }

  async createRelationship(
    callerId: string,
    batchId: string,
    name: string | undefined,
  ): Promise<IntakeRelationshipRow> {
    const batch = await this.requireBatch(callerId, batchId);
    const { data, error } = await this.supabase
      .from('intake_relationships')
      .insert({ batch_id: batch.id, counterparty_name: name ?? null })
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message);
    return data as IntakeRelationshipRow;
  }

  /** Name the counterparty's account and the project; confirm the group. */
  async updateRelationship(
    callerId: string,
    relationshipId: string,
    dto: UpdateIntakeRelationshipDto,
  ): Promise<IntakeRelationshipRow> {
    const relationship = await this.requireRelationship(
      callerId,
      relationshipId,
    );
    if (relationship.status === 'replicated') {
      throw new BadRequestException('This group was already imported.');
    }
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.counterparty_name !== undefined) {
      // The name read from the paper is only a default; the person's edit is
      // what grouping, the new project and the recorded agreement use.
      const name = dto.counterparty_name.replace(/\s+/g, ' ').trim();
      if (!name) {
        throw new BadRequestException('Name the other party.');
      }
      patch.counterparty_name = name;
    }
    if (dto.relationship_kind) patch.relationship_kind = dto.relationship_kind;
    if (dto.project_title !== undefined)
      patch.project_title = dto.project_title;
    if (dto.project_id !== undefined) patch.project_id = dto.project_id;
    if (dto.counterparty_email !== undefined) {
      const email = dto.counterparty_email.trim().toLowerCase();
      patch.counterparty_email = email;
      const { data } = await this.supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      const userId = (data as { id: string } | null)?.id ?? null;
      if (userId === callerId) {
        throw new BadRequestException(
          'That is your own account. Name the other party.',
        );
      }
      patch.counterparty_user_id = userId;
    }
    if (dto.confirm) patch.status = 'confirmed';
    const { data, error } = await this.supabase
      .from('intake_relationships')
      .update(patch)
      .eq('id', relationship.id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message);
    return data as IntakeRelationshipRow;
  }

  /** The original file's bytes, for the review screen's left pane. */
  async documentFile(
    callerId: string,
    documentId: string,
  ): Promise<{ body: Buffer; mimeType: string; fileName: string }> {
    const { document } = await this.requireDocument(callerId, documentId);
    return {
      body: await this.uploads.getPrivateObject(document.file_path),
      mimeType: document.mime_type,
      fileName: document.file_name,
    };
  }

  /** Acquisition metrics across all intake (platform admins). */
  async metrics() {
    const head = { count: 'exact' as const, head: true };
    const [batches, replicated, invites, attested] = await Promise.all([
      this.supabase.from('intake_batches').select('id', head),
      this.supabase
        .from('intake_relationships')
        .select('id', head)
        .eq('status', 'replicated'),
      this.supabase
        .from('contracts')
        .select('id', head)
        .eq('execution_origin', 'external')
        .neq('status', 'draft'),
      this.supabase
        .from('contract_positions')
        .select('contract_id', head)
        .not('attestation_statement', 'is', null),
    ]).then((replies) => replies.map((reply) => reply.count ?? 0));
    return {
      imports_started: batches,
      relationships_replicated: replicated,
      invites_sent: invites,
      attestations: attested,
      // Not tracked: signup attribution from an attestation link needs a
      // referral marker on the token path.
      accounts_from_attestation: null,
    };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  async requireBatch(
    callerId: string,
    batchId: string,
  ): Promise<IntakeBatchRow> {
    const { data, error } = await this.supabase
      .from('intake_batches')
      .select('*')
      .eq('id', batchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const batch = data as IntakeBatchRow | null;
    // An intake is private to whoever started it.
    if (!batch || batch.created_by !== callerId) {
      throw new NotFoundException('Intake not found');
    }
    return batch;
  }

  async requireDocument(
    callerId: string,
    documentId: string,
  ): Promise<{ document: IntakeDocumentRow; batch: IntakeBatchRow }> {
    const { data, error } = await this.supabase
      .from('intake_documents')
      .select('*')
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const document = data as IntakeDocumentRow | null;
    if (!document) throw new NotFoundException('Document not found');
    const batch = await this.requireBatch(callerId, document.batch_id);
    return { document, batch };
  }

  async requireRelationship(
    callerId: string,
    relationshipId: string,
  ): Promise<IntakeRelationshipRow> {
    const { data, error } = await this.supabase
      .from('intake_relationships')
      .select('*')
      .eq('id', relationshipId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const relationship = data as IntakeRelationshipRow | null;
    if (!relationship) throw new NotFoundException('Group not found');
    await this.requireBatch(callerId, relationship.batch_id);
    return relationship;
  }

  async batchDocuments(batchId: string): Promise<IntakeDocumentRow[]> {
    const { data, error } = await this.supabase
      .from('intake_documents')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true })
      .order('page_start', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as IntakeDocumentRow[];
  }

  async batchRelationships(batchId: string): Promise<IntakeRelationshipRow[]> {
    const { data, error } = await this.supabase
      .from('intake_relationships')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as IntakeRelationshipRow[];
  }

  async patchDocument(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<IntakeDocumentRow> {
    const { data, error } = await this.supabase
      .from('intake_documents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'Update failed.');
    }
    return data as IntakeDocumentRow;
  }

  private assertEditable(document: IntakeDocumentRow): void {
    if (document.status === 'replicated') {
      throw new BadRequestException('This document was already imported.');
    }
    if (document.status === 'skipped') {
      throw new BadRequestException('This file was skipped as a duplicate.');
    }
  }

  private refreshFlags(
    document: IntakeDocumentRow,
    fields: ReviewFields,
  ): string[] {
    const language = languageFlags(document.language);
    return document.doc_type === 'invoice'
      ? [
          ...language,
          ...invoiceTotalFlags(fields, document.extraction.line_items ?? []),
        ]
      : language;
  }

  private async fileDataUrl(document: IntakeDocumentRow): Promise<string> {
    const body = await this.uploads.getPrivateObject(document.file_path);
    return `data:${document.mime_type};base64,${body.toString('base64')}`;
  }

  /** Same bytes already imported by this person or in this workspace. */
  private async findDuplicateFile(
    batch: IntakeBatchRow,
    sha256: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('intake_documents')
      .select('id, batch:intake_batches!inner(created_by, workspace_id)')
      .eq('file_sha256', sha256)
      .neq('status', 'skipped')
      .limit(20);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      batch: { created_by: string; workspace_id: string | null } | null;
    }>;
    const hit = rows.find(
      (row) =>
        row.batch?.created_by === batch.created_by ||
        (batch.workspace_id !== null &&
          row.batch?.workspace_id === batch.workspace_id),
    );
    return hit?.id ?? null;
  }

  /**
   * Pages, not files: the cost is per page. Every workspace gets the
   * onboarding pages once, then the monthly quota applies.
   */
  private async assertPageQuota(
    batch: IntakeBatchRow,
    adding: number,
  ): Promise<void> {
    if (!this.entitlements || adding <= 0) return;
    const ref = { workspaceId: batch.workspace_id, exempt: false };
    const onboarding = await this.entitlements.getLimit(
      ref,
      'document_intake_onboarding_pages',
    );
    const monthly = await this.entitlements.getLimit(
      ref,
      'document_intake_pages_monthly',
    );
    if (monthly === null) return;
    const { data, error } = await this.supabase
      .from('intake_documents')
      .select(
        'page_start, page_end, status, created_at, batch:intake_batches!inner(workspace_id)',
      )
      .eq('batch.workspace_id', batch.workspace_id ?? '')
      .neq('status', 'skipped');
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as Array<{
      page_start: number;
      page_end: number;
      created_at: string;
    }>;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const usedEver = pagesOf(rows);
    const usedThisMonth = pagesOf(
      rows.filter((row) => new Date(row.created_at) >= monthStart),
    );
    const charge = chargeablePages({
      usedEver,
      usedThisMonth,
      adding,
      onboarding: onboarding ?? 0,
    });
    if (charge.unlimited) return;
    await this.entitlements.assertCountedLimit(
      ref,
      'document_intake_pages_monthly',
      { used: charge.used, adding: charge.adding, context: 'write' },
    );
  }

  private async projectCurrencies(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data } = await this.supabase
      .from('projects')
      .select('id, currency')
      .in('id', ids);
    return new Map(
      ((data ?? []) as Array<{ id: string; currency: string | null }>).map(
        (row) => [row.id, (row.currency ?? 'USD').toUpperCase()],
      ),
    );
  }

  /** The importer's names, and the team name their records are created under. */
  private async importerIdentity(
    callerId: string,
  ): Promise<{ names: string[]; teamName: string | null }> {
    const [names, { data: teams }] = await Promise.all([
      this.importerNames(callerId),
      this.supabase
        .from('teams')
        .select('name, legal_name')
        .eq('owner_id', callerId)
        .order('created_at', { ascending: true })
        .limit(1),
    ]);
    const team = (
      (teams ?? []) as Array<{
        name: string;
        legal_name: string | null;
      }>
    )[0];
    return { names, teamName: team ? team.legal_name || team.name : null };
  }

  private async importerNames(callerId: string): Promise<string[]> {
    const [{ data: profile }, { data: teams }] = await Promise.all([
      this.supabase
        .from('profiles')
        .select('display_name, first_name, last_name, email')
        .eq('id', callerId)
        .maybeSingle(),
      this.supabase
        .from('teams')
        .select('name, legal_name')
        .eq('owner_id', callerId),
    ]);
    const p = profile as {
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
    } | null;
    const names = [
      p?.display_name,
      [p?.first_name, p?.last_name].filter(Boolean).join(' '),
      ...(
        (teams ?? []) as Array<{ name: string; legal_name: string | null }>
      ).flatMap((team) => [team.name, team.legal_name]),
    ];
    return names.filter((name): name is string => Boolean(name?.trim()));
  }

  private async defaultWorkspaceId(userId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .order('joined_at', { ascending: true })
      .limit(1);
    const rows = (data ?? []) as Array<{ workspace_id: string }>;
    return rows[0]?.workspace_id ?? null;
  }
}

function languageFlags(language: string | null | undefined): string[] {
  return language && !ENGLISH.test(language)
    ? [
        `This document looks like it is not in English (${language}). Only English is imported for now; type it in by hand or leave it out.`,
      ]
    : [];
}

/** Ranges that cover the file once each, in page order. */
export function normalizeRanges<
  T extends { page_start: number; page_end: number },
>(documents: T[], pageCount: number): T[] {
  const sorted = [...documents]
    .map((doc) => ({
      ...doc,
      page_start: Math.min(Math.max(1, doc.page_start), pageCount),
      page_end: Math.min(Math.max(doc.page_start, doc.page_end), pageCount),
    }))
    .sort((a, b) => a.page_start - b.page_start);
  const out: T[] = [];
  let next = 1;
  for (const doc of sorted) {
    if (doc.page_end < next) continue;
    const start = Math.max(doc.page_start, next);
    if (out.length > 0 && start > next) {
      // A gap: the previous document runs up to this one.
      out[out.length - 1].page_end = start - 1;
    }
    out.push({ ...doc, page_start: out.length === 0 ? 1 : start });
    next = doc.page_end + 1;
  }
  if (out.length === 0) {
    return [
      { ...(documents[0] ?? {}), page_start: 1, page_end: pageCount } as T,
    ];
  }
  out[out.length - 1].page_end = pageCount;
  return out;
}
