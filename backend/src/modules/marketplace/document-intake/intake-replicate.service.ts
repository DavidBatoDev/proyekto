import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectsService } from '../../execution/projects/projects.service';
import { ContractsService } from '../contracts/contracts.service';
import { FinanceImportsService } from '../finance-imports/finance-imports.service';
import {
  DocumentIntakeService,
  type IntakeDocumentRow,
  type IntakeRelationshipRow,
} from './document-intake.service';
import { contractTermsFromIntake } from './intake-review';

type Outcome = { document_id: string; created?: string; error?: string };

const FINANCE_KIND: Record<string, string> = {
  contract: 'contract',
  amendment: 'contract',
  invoice: 'invoice',
  receipt: 'payment_proof',
  proof_of_payment: 'payment_proof',
  other: 'other',
};

function amount(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isoDate(value: string | null | undefined): string | undefined {
  const match = value ? /^\d{4}-\d{2}-\d{2}/.exec(value.trim()) : null;
  return match ? match[0] : undefined;
}

/**
 * Replicate: turn one confirmed relationship into Proyekto records.
 *
 * - a project (linked or created in the importer's workspace)
 * - a RECORDED agreement (execution_origin = 'external') from the contract,
 *   with confirmed amendments folded in, sent to the counterparty to attest;
 *   it becomes an engagement only when both parties attest
 * - imported invoices on the project, each with its matched payments
 *
 * Every confirmed document is copied into finance_documents first, so each
 * record keeps its original. Nothing here runs without the person's Confirm.
 */
@Injectable()
export class IntakeReplicateService {
  private readonly logger = new Logger(IntakeReplicateService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly intake: DocumentIntakeService,
    private readonly contracts: ContractsService,
    private readonly financeImports: FinanceImportsService,
    private readonly projects: ProjectsService,
  ) {}

  async replicate(callerId: string, relationshipId: string) {
    const relationship = await this.intake.requireRelationship(
      callerId,
      relationshipId,
    );
    const batch = await this.intake.requireBatch(
      callerId,
      relationship.batch_id,
    );
    if (relationship.status === 'proposed') {
      throw new BadRequestException(
        'Confirm the counterparty and project for this group first.',
      );
    }
    const documents = (await this.intake.batchDocuments(batch.id)).filter(
      (doc) => doc.relationship_id === relationship.id,
    );
    const confirmed = documents.filter((doc) => doc.status === 'confirmed');
    const pending = documents.filter(
      (doc) => doc.status === 'extracted' || doc.status === 'classified',
    );
    if (confirmed.length === 0) {
      throw new BadRequestException(
        'Confirm at least one document in this group first.',
      );
    }

    const projectId = await this.ensureProject(callerId, relationship, batch);
    const outcomes: Outcome[] = [];
    const financeDocs = new Map<string, string>();
    for (const doc of confirmed) {
      financeDocs.set(
        doc.id,
        await this.copyToFinance(callerId, projectId, doc),
      );
    }

    // Contract (+ amendments folded in).
    const contractDoc = confirmed.find((doc) => doc.doc_type === 'contract');
    const amendments = confirmed.filter((doc) => doc.doc_type === 'amendment');
    let contractId: string | null =
      (relationship.replicated.contract_id as string | undefined) ?? null;
    if (contractDoc) {
      try {
        contractId = await this.recordAgreement(
          callerId,
          batch.importer_capacity,
          relationship,
          projectId,
          contractDoc,
          amendments,
          financeDocs.get(contractDoc.id) as string,
        );
        outcomes.push({ document_id: contractDoc.id, created: contractId });
        for (const amendment of amendments) {
          outcomes.push({ document_id: amendment.id, created: contractId });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcomes.push({ document_id: contractDoc.id, error: message });
        for (const amendment of amendments) {
          outcomes.push({
            document_id: amendment.id,
            error: 'Waits for its contract to be recorded.',
          });
        }
      }
    } else {
      for (const amendment of amendments) {
        outcomes.push({
          document_id: amendment.id,
          error:
            'An amendment is recorded with the agreement it amends. Add that contract to this group.',
        });
      }
    }

    // Invoices, each with its matched payments.
    const payments = confirmed.filter(
      (doc) =>
        doc.doc_type === 'receipt' || doc.doc_type === 'proof_of_payment',
    );
    const matchedPayments = new Set<string>();
    for (const invoice of confirmed.filter(
      (doc) => doc.doc_type === 'invoice',
    )) {
      const invoiceCurrency = invoice.fields.currency?.value?.toUpperCase();
      // A payment in another currency needs its rate, which the paper does
      // not reliably carry; it is left for the finance imports workspace.
      const mine = payments.filter(
        (payment) =>
          payment.extraction.match?.invoice_id === invoice.id &&
          (!payment.fields.currency?.value ||
            payment.fields.currency.value.toUpperCase() === invoiceCurrency),
      );
      try {
        const invoiceId = await this.importInvoice(
          callerId,
          projectId,
          invoice,
          mine,
          financeDocs,
        );
        outcomes.push({ document_id: invoice.id, created: invoiceId });
        for (const payment of mine) {
          matchedPayments.add(payment.id);
          outcomes.push({ document_id: payment.id, created: invoiceId });
        }
      } catch (error) {
        outcomes.push({
          document_id: invoice.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const payment of payments) {
      if (matchedPayments.has(payment.id)) continue;
      outcomes.push({
        document_id: payment.id,
        error: payment.extraction.match
          ? 'This payment is in a different currency from its invoice. Record it with its rate in the finance imports workspace.'
          : 'Match this payment to an invoice in the group to record it.',
      });
    }
    for (const other of confirmed.filter((doc) => doc.doc_type === 'other')) {
      outcomes.push({
        document_id: other.id,
        created: financeDocs.get(other.id),
      });
    }

    // Mark what was created; failures stay confirmed so they can be retried.
    for (const outcome of outcomes) {
      if (!outcome.created) continue;
      await this.intake.patchDocument(outcome.document_id, {
        status: 'replicated',
        replicated_record: {
          record_id: outcome.created,
          finance_document_id: financeDocs.get(outcome.document_id),
          project_id: projectId,
        },
      });
    }
    const replicated = {
      ...relationship.replicated,
      project_id: projectId,
      ...(contractId ? { contract_id: contractId } : {}),
      replicated_at: new Date().toISOString(),
    };
    const allDone =
      outcomes.every((outcome) => outcome.created) && pending.length === 0;
    await this.supabase
      .from('intake_relationships')
      .update({
        project_id: projectId,
        replicated,
        status: allDone ? 'replicated' : 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', relationship.id);
    if (allDone) {
      const remaining = (await this.intake.batchRelationships(batch.id)).filter(
        (row) => row.id !== relationship.id && row.status !== 'replicated',
      );
      if (remaining.length === 0) {
        await this.supabase
          .from('intake_batches')
          .update({
            status: 'replicated',
            updated_at: new Date().toISOString(),
          })
          .eq('id', batch.id);
      }
    }
    return { project_id: projectId, contract_id: contractId, outcomes };
  }

  private async ensureProject(
    callerId: string,
    relationship: IntakeRelationshipRow,
    batch: {
      importer_capacity: 'consultant' | 'client';
      workspace_id: string | null;
    },
  ): Promise<string> {
    if (relationship.project_id) return relationship.project_id;
    const created = await this.projects.createProject(callerId, {
      title:
        relationship.project_title?.trim() ||
        `Work with ${relationship.counterparty_name ?? 'imported client'}`,
      creation_mode:
        batch.importer_capacity === 'consultant' ? 'consultant' : 'client',
      workspace_id: batch.workspace_id ?? undefined,
      status: 'active',
    });
    const projectId = created.project.id;
    await this.supabase
      .from('intake_relationships')
      .update({ project_id: projectId })
      .eq('id', relationship.id);
    return projectId;
  }

  /** The intake file becomes a finance document on the project (same bytes). */
  private async copyToFinance(
    callerId: string,
    projectId: string,
    doc: IntakeDocumentRow,
  ): Promise<string> {
    const existing = doc.replicated_record?.finance_document_id as
      | string
      | undefined;
    if (existing) return existing;
    const { data, error } = await this.supabase
      .from('finance_documents')
      .insert({
        project_id: projectId,
        kind: FINANCE_KIND[doc.doc_type ?? 'other'] ?? 'other',
        file_path: doc.file_path,
        file_name:
          doc.page_count > 1
            ? `${doc.file_name} (pages ${doc.page_start}-${doc.page_end})`
            : doc.file_name,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        page_count: doc.page_end - doc.page_start + 1,
        extraction: {
          source: 'intake',
          intake_document_id: doc.id,
          fields: doc.fields,
        },
        extraction_status: 'ready',
        uploaded_by: callerId,
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Could not keep the original document.',
      );
    }
    const id = (data as { id: string }).id;
    await this.intake.patchDocument(doc.id, {
      replicated_record: { ...doc.replicated_record, finance_document_id: id },
    });
    return id;
  }

  /**
   * The recorded agreement, then Send: the counterparty is asked to attest
   * that it matches what they signed. The importer takes the seat the
   * document shows them in; the other party is the one invited.
   */
  private async recordAgreement(
    callerId: string,
    importerCapacity: 'consultant' | 'client',
    relationship: IntakeRelationshipRow,
    projectId: string,
    contractDoc: IntakeDocumentRow,
    amendments: IntakeDocumentRow[],
    financeDocumentId: string,
  ): Promise<string> {
    if (!relationship.counterparty_user_id) {
      throw new BadRequestException(
        `${relationship.counterparty_name ?? 'The other party'} has no Proyekto account yet, so the agreement cannot be recorded against them. Ask them to sign up with ${relationship.counterparty_email ?? 'their email'}, then import again.`,
      );
    }
    const terms = contractTermsFromIntake(
      contractDoc.fields,
      contractDoc.extraction.clauses ?? [],
      amendments.map((doc) => doc.fields),
    );
    if (!terms.external_agreed_at) {
      throw new BadRequestException(
        'The contract needs the date it was signed before it can be recorded.',
      );
    }
    const { clauses, external_agreed_at, ...rest } = terms;
    const recorded = await this.contracts.recordExternalAgreement(callerId, {
      ...rest,
      project_id: projectId,
      scope_mode: 'project_specific',
      relationship_kind: relationship.relationship_kind,
      counterparty_user_id: relationship.counterparty_user_id,
      author_capacity: importerCapacity,
      external_agreed_at,
      external_document_id: financeDocumentId,
      ...(clauses.length ? { clauses } : {}),
    });
    await this.contracts.sendContract(callerId, recorded.id);
    return recorded.id;
  }

  private async importInvoice(
    callerId: string,
    projectId: string,
    invoice: IntakeDocumentRow,
    payments: IntakeDocumentRow[],
    financeDocs: Map<string, string>,
  ): Promise<string> {
    const v = (doc: IntakeDocumentRow, key: string) =>
      doc.fields[key]?.value ?? null;
    const number = v(invoice, 'number');
    const total = amount(v(invoice, 'total'));
    const issueDate = isoDate(v(invoice, 'issue_date'));
    const currency = v(invoice, 'currency')?.toUpperCase();
    if (!number || total === null || !issueDate || !currency) {
      throw new BadRequestException(
        'An invoice needs its number, total, currency and issue date.',
      );
    }
    const lines = (invoice.extraction.line_items ?? [])
      .filter(
        (line) => line.description && Number.isFinite(Number(line.amount)),
      )
      .map((line) => ({
        description: String(line.description).slice(0, 500),
        quantity: line.quantity ?? undefined,
        unit_rate: line.unit_rate ?? undefined,
        amount: Number(line.amount),
      }));
    const lineSum = lines.reduce((sum, line) => sum + line.amount, 0);
    const { invoice_id } = await this.financeImports.importInvoice(callerId, {
      project_id: projectId,
      source_document_id: financeDocs.get(invoice.id) as string,
      number,
      currency,
      total,
      issue_date: issueDate,
      due_date: isoDate(v(invoice, 'due_date')),
      notes: 'Imported through document intake.',
      // Lines are only sent when they add up; otherwise one line carries the
      // total and the review flag explains the mismatch.
      ...(lines.length && Math.abs(lineSum - total) <= 0.01 ? { lines } : {}),
      payments: payments
        .map((payment) => {
          const paid = amount(v(payment, 'amount'));
          const date = isoDate(v(payment, 'payment_date'));
          if (paid === null || !date) return null;
          return {
            amount: paid,
            payment_date: date,
            reference: v(payment, 'reference')?.slice(0, 200),
            proof_document_id: financeDocs.get(payment.id),
          };
        })
        .filter((payment): payment is NonNullable<typeof payment> =>
          Boolean(payment),
        ),
    });
    return invoice_id;
  }
}
