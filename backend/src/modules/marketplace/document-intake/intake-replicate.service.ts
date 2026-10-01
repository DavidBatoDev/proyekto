import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
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
import type { ReplicateIntakeRelationshipDto } from './dto/document-intake.dto';
import {
  amendmentChainFromIntake,
  contractTermsFromIntake,
  type CurrencyDecision,
  currencyQuestion,
  currencyQuestionMessage,
  documentCurrencies,
  normalizePartyName,
} from './intake-review';

type Outcome = {
  document_id: string;
  created?: string;
  error?: string;
  /** Held, not failed: waiting for the counterparty to join. */
  pending?: string;
};

/**
 * An agreement whose counterparty has no account yet (decision 2026-09-30:
 * invite first, record on join). Kept on the relationship until they accept
 * the project invite, which doubles as the attestation request.
 */
export interface PendingAgreement {
  email: string;
  name: string | null;
  invite_id: string | null;
  importer_id: string;
  contract_document_id: string;
  amendment_document_ids: string[];
  since: string;
  last_error?: string | null;
}

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
export class IntakeReplicateService implements OnModuleInit {
  private readonly logger = new Logger(IntakeReplicateService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly intake: DocumentIntakeService,
    private readonly contracts: ContractsService,
    private readonly financeImports: FinanceImportsService,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    // Accepting the project invite is the counterparty "joining": the held
    // agreement is recorded then, and goes to them to attest.
    this.projects.onInviteAccepted?.((event) =>
      this.completePendingAgreements(event.userId, event.projectId),
    );
  }

  async replicate(
    callerId: string,
    relationshipId: string,
    dto: ReplicateIntakeRelationshipDto = {},
  ) {
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

    // Decision 2026-10-01: the project's currency changes only by the
    // person's choice, asked here before anything is written.
    const currencies = documentCurrencies(confirmed);
    const currentCurrency = relationship.project_id
      ? await this.projectCurrency(relationship.project_id)
      : null;
    const question = currencyQuestion({
      documentCurrencies: currencies,
      projectCurrency: currentCurrency,
      previous:
        (relationship.replicated.currency_decision as
          | CurrencyDecision
          | undefined) ?? null,
    });
    let chosenCurrency: string | null = null;
    if (question) {
      const picked = dto.project_currency?.trim().toUpperCase();
      if (!picked) {
        throw new ConflictException(currencyQuestionMessage(question));
      }
      if (
        picked !== question.project_currency &&
        !question.document_currencies.includes(picked)
      ) {
        throw new BadRequestException(
          `Choose ${[...question.document_currencies, question.project_currency].filter((c, i, all) => all.indexOf(c) === i).join(' or ')} for the project currency.`,
        );
      }
      chosenCurrency = picked;
    }

    const projectId = await this.ensureProject(
      callerId,
      relationship,
      batch,
      chosenCurrency,
    );
    if (
      chosenCurrency &&
      currentCurrency !== null &&
      chosenCurrency !== currentCurrency
    ) {
      await this.projects.updateProject(projectId, callerId, {
        currency: chosenCurrency,
      });
    }
    const currencyDecision: CurrencyDecision | null = chosenCurrency
      ? { project_currency: chosenCurrency, document_currencies: currencies }
      : null;
    const outcomes: Outcome[] = [];
    const financeDocs = new Map<string, string>();
    for (const doc of confirmed) {
      const financeId = await this.copyToFinance(callerId, projectId, doc);
      financeDocs.set(doc.id, financeId);
      if (doc.replicated_record?.finance_document_id !== financeId) {
        await this.intake.patchDocument(doc.id, {
          replicated_record: {
            ...(doc.replicated_record ?? {}),
            finance_document_id: financeId,
            project_id: projectId,
          },
        });
        doc.replicated_record = {
          ...(doc.replicated_record ?? {}),
          finance_document_id: financeId,
        };
      }
    }
    let pendingAgreement =
      (relationship.replicated.pending_agreement as
        | PendingAgreement
        | undefined) ?? null;

    // Contract (+ amendments folded in).
    const contractDoc = confirmed.find((doc) => doc.doc_type === 'contract');
    const amendments = confirmed.filter((doc) => doc.doc_type === 'amendment');
    let contractId: string | null =
      (relationship.replicated.contract_id as string | undefined) ?? null;
    if (contractDoc && !relationship.counterparty_user_id) {
      // Decision 3: the counterparty has no account. Invoices and payments
      // import now; the agreement waits for them, and the project invite is
      // also the request to attest it.
      try {
        pendingAgreement = await this.holdAgreement(
          callerId,
          batch.importer_capacity,
          relationship,
          projectId,
          contractDoc,
          amendments,
          pendingAgreement,
        );
        const waiting = `Waiting for ${pendingAgreement.name ?? pendingAgreement.email} to join`;
        outcomes.push({ document_id: contractDoc.id, pending: waiting });
        for (const amendment of amendments) {
          outcomes.push({ document_id: amendment.id, pending: waiting });
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
    } else if (contractDoc) {
      try {
        contractId = await this.recordAgreement(
          callerId,
          batch.importer_capacity,
          relationship,
          projectId,
          contractDoc,
          amendments,
          financeDocs.get(contractDoc.id) as string,
          financeDocs,
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
      ...(currencyDecision ? { currency_decision: currencyDecision } : {}),
      pending_agreement: contractId ? null : pendingAgreement,
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
    return {
      project_id: projectId,
      contract_id: contractId,
      pending_agreement: contractId ? null : pendingAgreement,
      outcomes,
    };
  }

  /**
   * Hold the agreement for a counterparty without an account and invite them
   * to the project. The invite's note says what they are asked to confirm, so
   * the one email is both the invitation and the attestation request.
   * Idempotent: an agreement already held keeps its invite.
   */
  private async holdAgreement(
    callerId: string,
    importerCapacity: 'consultant' | 'client',
    relationship: IntakeRelationshipRow,
    projectId: string,
    contractDoc: IntakeDocumentRow,
    amendments: IntakeDocumentRow[],
    existing: PendingAgreement | null,
  ): Promise<PendingAgreement> {
    const email = relationship.counterparty_email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException(
        `${relationship.counterparty_name ?? 'The other party'} has no Proyekto account. Add their email so they can be invited to confirm the agreement.`,
      );
    }
    // Decision 2: when the importer holds the consultant seat, they must be a
    // verified team owner. Checked now so nothing is held that cannot record.
    if (importerCapacity === 'consultant') {
      await this.contracts.assertAdoptionHolder(callerId);
    }
    if (existing && existing.email === email) return existing;

    const name = relationship.counterparty_name;
    const invite = (await this.projects.inviteByEmail(projectId, callerId, {
      email,
      message: `This invitation is also a request to confirm our agreement. Once you join, you will see the recorded agreement${amendments.length ? ` and its ${amendments.length} amendment${amendments.length === 1 ? '' : 's'}` : ''} and be asked to attest that it matches what we signed.`,
    } as never)) as { id?: string } | null;
    return {
      email,
      name,
      invite_id: invite?.id ?? null,
      importer_id: callerId,
      contract_document_id: contractDoc.id,
      amendment_document_ids: amendments.map((doc) => doc.id),
      since: new Date().toISOString(),
      last_error: null,
    };
  }

  /**
   * The counterparty joined (accepted the project invite): record every
   * agreement held for this project against them and send it to attest.
   * Never throws into the invite flow; a failure stays on the relationship.
   */
  async completePendingAgreements(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('intake_relationships')
      .select('*')
      .eq('project_id', projectId)
      .not('replicated->pending_agreement', 'is', null);
    if (error) {
      this.logger.warn(`Pending agreements lookup failed: ${error.message}`);
      return;
    }
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    const joinedEmail = (profile as { email: string | null } | null)?.email
      ?.trim()
      .toLowerCase();
    for (const relationship of (data ?? []) as IntakeRelationshipRow[]) {
      const pending = relationship.replicated
        .pending_agreement as PendingAgreement | null;
      if (!pending || (joinedEmail && pending.email !== joinedEmail)) continue;
      try {
        await this.recordHeldAgreement(userId, relationship, pending);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Recording the held agreement for ${relationship.id} failed: ${message}`,
        );
        await this.supabase
          .from('intake_relationships')
          .update({
            counterparty_user_id: userId,
            replicated: {
              ...relationship.replicated,
              pending_agreement: { ...pending, last_error: message },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', relationship.id);
      }
    }
  }

  private async recordHeldAgreement(
    userId: string,
    relationship: IntakeRelationshipRow,
    pending: PendingAgreement,
  ): Promise<void> {
    const joined = { ...relationship, counterparty_user_id: userId };
    const { data: batchRow } = await this.supabase
      .from('intake_batches')
      .select('importer_capacity')
      .eq('id', relationship.batch_id)
      .maybeSingle();
    const importerCapacity =
      (batchRow as { importer_capacity: 'consultant' | 'client' } | null)
        ?.importer_capacity ?? 'consultant';
    const documents = await this.intake.batchDocuments(relationship.batch_id);
    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    const contractDoc = byId.get(pending.contract_document_id);
    if (!contractDoc) throw new Error('The held contract document is gone.');
    const amendments = pending.amendment_document_ids
      .map((id) => byId.get(id))
      .filter((doc): doc is IntakeDocumentRow => Boolean(doc));
    const financeDocs = new Map<string, string>();
    for (const doc of [contractDoc, ...amendments]) {
      const financeId = doc.replicated_record?.finance_document_id as
        | string
        | undefined;
      if (financeId) financeDocs.set(doc.id, financeId);
    }
    const projectId = relationship.project_id as string;
    const contractId = await this.recordAgreement(
      pending.importer_id,
      importerCapacity,
      joined,
      projectId,
      contractDoc,
      amendments,
      financeDocs.get(contractDoc.id) as string,
      financeDocs,
    );
    for (const doc of [contractDoc, ...amendments]) {
      await this.intake.patchDocument(doc.id, {
        status: 'replicated',
        replicated_record: {
          record_id: contractId,
          finance_document_id: financeDocs.get(doc.id),
          project_id: projectId,
        },
      });
    }
    const stillOpen = documents.some(
      (doc) =>
        doc.relationship_id === relationship.id &&
        doc.id !== contractDoc.id &&
        !pending.amendment_document_ids.includes(doc.id) &&
        doc.status !== 'replicated' &&
        doc.status !== 'skipped',
    );
    await this.supabase
      .from('intake_relationships')
      .update({
        counterparty_user_id: userId,
        replicated: {
          ...relationship.replicated,
          contract_id: contractId,
          pending_agreement: null,
          joined_at: new Date().toISOString(),
        },
        status: stillOpen ? 'confirmed' : 'replicated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', relationship.id);
  }

  private async projectCurrency(projectId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('currency')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (
      (data as { currency: string | null } | null)?.currency ?? 'USD'
    ).toUpperCase();
  }

  private async ensureProject(
    callerId: string,
    relationship: IntakeRelationshipRow,
    batch: {
      importer_capacity: 'consultant' | 'client';
      workspace_id: string | null;
    },
    /** Only the currency the person picked; otherwise the project default. */
    currency: string | null = null,
  ): Promise<string> {
    if (relationship.project_id) return relationship.project_id;
    const created = await this.projects.createProject(callerId, {
      ...(currency ? { currency } : {}),
      title:
        relationship.project_title?.trim() ||
        `Work with ${relationship.counterparty_name ?? 'imported client'}`,
      creation_mode:
        batch.importer_capacity === 'consultant' ? 'consultant' : 'client',
      workspace_id: batch.workspace_id ?? undefined,
      // Consultant-mode creation only accepts drafts; the imported work is
      // already running, so the project is activated right after.
      status: batch.importer_capacity === 'consultant' ? 'draft' : 'active',
    });
    const projectId = created.project.id;
    if (batch.importer_capacity === 'consultant') {
      const { error } = await this.supabase
        .from('projects')
        .update({ status: 'active' })
        .eq('id', projectId);
      if (error) throw new BadRequestException(error.message);
    }
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
    financeDocs: Map<string, string> = new Map(),
  ): Promise<string> {
    if (!relationship.counterparty_user_id) {
      throw new BadRequestException(
        `${relationship.counterparty_name ?? 'The other party'} has no Proyekto account yet, so the agreement cannot be recorded against them. Ask them to sign up with ${relationship.counterparty_email ?? 'their email'}, then import again.`,
      );
    }
    // Decision 2: the consultant seat on a recorded agreement is held by a
    // verified team owner: the importer when they are the consultant, else
    // the consultant they are importing against.
    await this.contracts.assertAdoptionHolder(
      importerCapacity === 'consultant'
        ? callerId
        : relationship.counterparty_user_id,
    );
    // Decision 4: the original is recorded as it was signed. Each amendment
    // becomes its own version, back-dated to its effective date, once the
    // version before it is attested.
    const terms = contractTermsFromIntake(
      contractDoc.fields,
      contractDoc.extraction.clauses ?? [],
      [],
    );
    const chain = amendmentChainFromIntake(
      contractDoc.fields,
      amendments.map((doc) => ({ id: doc.id, fields: doc.fields })),
    );
    const undated = amendments.length - chain.length;
    if (undated > 0) {
      throw new BadRequestException(
        `${undated} amendment${undated === 1 ? ' has' : 's have'} no effective date. Add it in review so each amendment can take effect on its own date.`,
      );
    }
    if (!terms.external_agreed_at) {
      throw new BadRequestException(
        'The contract needs the date it was signed before it can be recorded.',
      );
    }
    const { clauses, external_agreed_at, ...rest } = terms;
    const queue = chain.map((entry) => ({
      effective_from: entry.effective_from,
      agreed_at: entry.agreed_at,
      document_id: financeDocs.get(entry.id) ?? financeDocumentId,
      terms: entry.terms,
    }));
    const recorded = await this.contracts.recordExternalAgreement(
      callerId,
      {
        ...rest,
        project_id: projectId,
        scope_mode: 'project_specific',
        relationship_kind: relationship.relationship_kind,
        counterparty_user_id: relationship.counterparty_user_id,
        author_capacity: importerCapacity,
        external_agreed_at,
        external_document_id: financeDocumentId,
        ...(clauses.length ? { clauses } : {}),
        ...(await this.paperPartyBlock(
          importerCapacity,
          relationship,
          contractDoc,
        )),
      },
      queue,
    );
    await this.contracts.sendContract(callerId, recorded.id);
    return recorded.id;
  }

  /**
   * Decision 2026-10-01: the recorded terms name the counterparty as the
   * paper does ("Join Test Co"), with their email beneath, not by whatever
   * their account is called. Their account still holds the seat, and its
   * person is named as the contact when they sign for a company.
   */
  private async paperPartyBlock(
    importerCapacity: 'consultant' | 'client',
    relationship: IntakeRelationshipRow,
    contractDoc: IntakeDocumentRow,
  ): Promise<Record<string, string>> {
    const counterpartySeat =
      (relationship.relationship_kind === 'client_services') ===
      (importerCapacity === 'consultant')
        ? 'hirer'
        : 'provider';
    const paperField =
      counterpartySeat === 'hirer' ? 'client_name' : 'provider_name';
    const paperName =
      relationship.counterparty_name?.trim() ||
      contractDoc.fields[paperField]?.value?.trim() ||
      null;
    if (!paperName) return {};
    const { data } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', relationship.counterparty_user_id as string)
      .maybeSingle();
    const profile = data as {
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    } | null;
    const personName =
      profile?.display_name?.trim() ||
      [profile?.first_name, profile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      null;
    const email =
      relationship.counterparty_email?.trim() || profile?.email?.trim() || null;
    const isCompany =
      !personName ||
      normalizePartyName(personName) !== normalizePartyName(paperName);
    if (counterpartySeat === 'hirer') {
      return {
        client_name: paperName,
        client_kind: isCompany ? 'company' : 'individual',
        ...(isCompany && personName ? { client_contact_name: personName } : {}),
        ...(email ? { client_email: email } : {}),
      };
    }
    return {
      provider_name: paperName,
      provider_kind: isCompany ? 'agency' : 'individual',
      ...(email ? { provider_email: email } : {}),
    };
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
    // "#BS2026-DM-054" on the paper is invoice BS2026-DM-054 in the ledger.
    const number = v(invoice, 'number')
      ?.replace(/^\s*#\s*/, '')
      .trim();
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
