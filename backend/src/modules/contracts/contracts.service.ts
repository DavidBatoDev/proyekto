import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ConsultantFinanceAccessService } from '../finance/consultant-finance-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  addDays,
  BillingPeriod,
  billingPeriodsForRange,
  configForCadence,
  parseIsoDate,
  PayPeriodConfig,
  toIsoDate,
} from './billing-period';
import {
  ContractClause,
  ContractService,
  defaultContractClauses,
} from './contract-clause-template';
import { computeContractTerm } from './contract-term';
import {
  AmendContractDto,
  BillingMode,
  BillingTiming,
  ContractStatus,
  CreateContractDto,
  InvoiceCadence,
  ProviderKind,
  SignContractDto,
  UnsignContractDto,
  UpdateContractDto,
  UpdateSignaturePlacementDto,
} from './dto/contracts.dto';

export interface ContractRow {
  id: string;
  project_id: string;
  version: number;
  contract_number: string | null;
  status: ContractStatus;

  /**
   * Which identity signs THIS contract. 'agency' pulls the provider block from
   * the project's primary team; 'individual' pulls it from the consultant's own
   * profile. Per-contract rather than per-team, because a consultant can run
   * most work through the agency and still take one engagement personally.
   */
  provider_kind: ProviderKind;
  provider_name: string | null;
  provider_address: string | null;
  provider_tin: string | null;
  provider_email: string | null;
  client_name: string | null;
  client_contact_name: string | null;
  client_address: string | null;
  client_tin: string | null;
  client_email: string | null;
  client_user_id: string | null;

  currency: string;
  billing_mode: BillingMode;
  /** 'arrears' bills a closed period; 'advance' bills the period ahead. */
  billing_timing: BillingTiming;
  recurring_fee: number | null;
  client_hourly_rate: number | null;
  included_hours: number | null;
  invoice_cadence: InvoiceCadence;
  period_source: 'team_config' | 'contract';
  invoice_offset_days: number;
  due_days: number;
  invoice_number_prefix: string | null;
  service_description: string | null;
  payment_method: string | null;

  service_start_date: string | null;
  term_count: number | null;
  term_unit: 'month' | 'year' | null;
  service_end_date: string | null;
  contract_end_date: string | null;
  auto_renew: boolean;
  notice_days: number | null;
  /** The version this one amends. Null on an original. */
  supersedes_contract_id: string | null;
  /** First day the amended terms apply. */
  amendment_effective_date: string | null;

  clauses: ContractClause[];
  services: ContractService[];
  notes: string | null;
  signed_by_consultant_at: string | null;
  signed_by_consultant_name: string | null;
  signed_by_consultant_signature_url: string | null;
  /** Display multiplier (0.5–3) for the provider signature image. */
  signed_by_consultant_signature_scale: number;
  /** Offsets in multiples of the base signature height; +x right, +y up. */
  signed_by_consultant_signature_offset_x: number;
  signed_by_consultant_signature_offset_y: number;
  signed_by_client_at: string | null;
  signed_by_client_name: string | null;
  signed_by_client_signature_url: string | null;
  /** Display multiplier (0.5–3) for the client signature image. */
  signed_by_client_signature_scale: number;
  signed_by_client_signature_offset_x: number;
  signed_by_client_signature_offset_y: number;

  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A contract plus the billing schedule derived from its terms. */
export interface ContractWithSchedule extends ContractRow {
  periods: BillingPeriod[];
}

/** The project's primary team, as far as contracts care about it. */
interface PrimaryTeamRow {
  name: string | null;
  legal_name: string | null;
  billing_address: string | null;
  tax_id: string | null;
  billing_email: string | null;
  pay_period_config: PayPeriodConfig | null;
}

const EDITABLE_STATUSES: ContractStatus[] = ['draft', 'sent'];

const MIN_SIGNATURE_SCALE = 0.5;
const MAX_SIGNATURE_SCALE = 3;
const MAX_SIGNATURE_OFFSET = 3;

/** Keep the stored multiplier inside the column's check constraint. */
function clampSignatureScale(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(
    MAX_SIGNATURE_SCALE,
    Math.max(MIN_SIGNATURE_SCALE, Math.round(value * 100) / 100),
  );
}

/** Same, for a placement offset (base-height multiples, ±3). */
function clampSignatureOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(
    MAX_SIGNATURE_OFFSET,
    Math.max(-MAX_SIGNATURE_OFFSET, Math.round(value * 1000) / 1000),
  );
}

@Injectable()
export class ContractsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly financeAccess: ConsultantFinanceAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async listByProject(
    callerId: string,
    projectId: string,
  ): Promise<ContractWithSchedule[]> {
    await this.financeAccess.assertProject(callerId, projectId);
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ContractRow[];
    return Promise.all(rows.map((row) => this.withSchedule(row)));
  }

  async getContract(
    callerId: string,
    contractId: string,
  ): Promise<ContractWithSchedule> {
    const row = await this.getContractRow(contractId);
    await this.financeAccess.assertProject(callerId, row.project_id);
    return this.withSchedule(row);
  }

  /**
   * The single contract that governs billing right now, or null. Used by the
   * activation checklist and the invoice scheduler.
   */
  async getLiveContract(projectId: string): Promise<ContractRow | null> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .eq('project_id', projectId)
      .in('status', ['signed', 'active'])
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ContractRow | null) ?? null;
  }

  async createContract(
    callerId: string,
    dto: CreateContractDto,
  ): Promise<ContractWithSchedule> {
    await this.financeAccess.assertProject(callerId, dto.project_id);
    return this.createContractInternal(callerId, dto);
  }

  /**
   * Insert path used after the finance authorization check has succeeded.
   */
  async createContractInternal(
    callerId: string,
    dto: CreateContractDto,
  ): Promise<ContractWithSchedule> {
    const { project_id: projectId, ...terms } = dto;
    const seeded = await this.seedParties(callerId, projectId, terms);
    const version = await this.nextVersion(projectId);

    const insert: Record<string, unknown> = {
      project_id: projectId,
      version,
      status: 'draft',
      created_by: callerId,
      clauses:
        (terms.clauses as unknown as ContractClause[]) ??
        defaultContractClauses(),
      // Services start empty — the consultant defines them on the Contract tab.
      services: (terms.services as unknown as ContractService[]) ?? [],
      ...seeded,
      ...this.termPatch(terms),
    };

    const { data, error } = await this.supabase
      .from('contracts')
      .insert(insert)
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to create contract.',
      );
    }
    return this.withSchedule(data as ContractRow);
  }

  async updateContract(
    callerId: string,
    contractId: string,
    dto: UpdateContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.financeAccess.assertProject(callerId, existing.project_id);

    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be edited. Create a new version instead.`,
      );
    }

    this.assertBillingTimingAllowed(
      dto.billing_timing ?? existing.billing_timing,
      dto.billing_mode ?? existing.billing_mode,
    );

    const patch: Record<string, unknown> = {
      ...this.scalarPatch(dto),
      ...this.termPatch(dto, existing),
    };
    if (dto.clauses !== undefined) {
      patch.clauses = dto.clauses;
    }
    if (dto.services !== undefined) {
      patch.services = dto.services;
    }

    if (Object.keys(patch).length === 0) {
      return this.withSchedule(existing);
    }

    const { data, error } = await this.supabase
      .from('contracts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', contractId)
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to update contract.',
      );
    }
    return this.withSchedule(data as ContractRow);
  }

  /** Drafts have no legal force yet and may be discarded by the consultant. */
  async deleteContract(callerId: string, contractId: string): Promise<void> {
    const existing = await this.getContractRow(contractId);
    await this.financeAccess.assertProject(callerId, existing.project_id);
    if (existing.status !== 'draft') {
      throw new BadRequestException('Only draft contracts can be deleted.');
    }

    const { error } = await this.supabase
      .from('contracts')
      .delete()
      .eq('id', contractId);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Change the terms of a contract that is already signed.
   *
   * A signed contract is immutable, and future invoices don't exist as rows —
   * the scheduler re-derives them from the contract every run. So changing
   * "this and every future invoice" is not an invoice edit at all: it creates
   * version + 1 of the agreement, effective from a chosen date, which both
   * parties must re-sign. Until they do, the current version keeps governing.
   */
  async amendContract(
    callerId: string,
    contractId: string,
    dto: AmendContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.financeAccess.assertProject(callerId, existing.project_id);

    if (dto.scope === 'this') {
      throw new BadRequestException(
        'Changing a single invoice is an invoice edit, not a contract change — open that invoice in the editor instead.',
      );
    }
    if (existing.status !== 'signed' && existing.status !== 'active') {
      throw new BadRequestException(
        'Only a signed contract needs amending. Edit this one directly.',
      );
    }
    if (!existing.service_start_date || !existing.service_end_date) {
      throw new BadRequestException(
        'This contract has no service window to amend.',
      );
    }

    this.assertBillingTimingAllowed(
      dto.billing_timing ?? existing.billing_timing,
      dto.billing_mode ?? existing.billing_mode,
    );

    const effectiveFrom =
      dto.scope === 'all'
        ? existing.service_start_date
        : (dto.effective_from?.slice(0, 10) ??
          (await this.currentPeriodStart(existing)));

    await this.assertNoIssuedInvoicesFrom(contractId, effectiveFrom);

    // 'following' splits the engagement: the old version stops the day before
    // the new one starts. 'all' replaces it outright, so its dates stand.
    if (dto.scope === 'following') {
      const truncatedEnd = toIsoDate(addDays(parseIsoDate(effectiveFrom), -1));
      if (truncatedEnd < existing.service_start_date) {
        throw new BadRequestException(
          'The new terms would start before the contract does. Use "the whole engagement" instead.',
        );
      }
      const { error: truncateError } = await this.supabase
        .from('contracts')
        .update({
          service_end_date: truncatedEnd,
          contract_end_date: truncatedEnd,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contractId);
      if (truncateError) throw new BadRequestException(truncateError.message);
    }

    const successor = await this.insertAmendedVersion(
      existing,
      dto,
      effectiveFrom,
      callerId,
    );

    // The predecessor's future DRAFT invoices belong to terms that no longer
    // apply. They are deleted so the new version re-drafts them; without this
    // the same calendar period could be billed once by each version, because
    // uq_invoices_scheduled_period is keyed on contract_id.
    await this.dropFutureDrafts(contractId, effectiveFrom);

    return this.withSchedule(successor);
  }

  /** The start of the billing period containing today. */
  private async currentPeriodStart(contract: ContractRow): Promise<string> {
    const periods = await this.resolvePeriods(contract);
    const today = new Date().toISOString().slice(0, 10);
    const current = periods.find(
      (p) => p.periodStart <= today && today <= p.periodEnd,
    );
    return current?.periodStart ?? today;
  }

  /**
   * Refuse to amend over an invoice the client has already been sent.
   *
   * Advance billing makes this reachable in ordinary use: a prepaid contract
   * can have issued an invoice for a period that has not started yet, and
   * silently changing the terms underneath it would mean the client holds an
   * invoice that no longer matches the agreement.
   */
  private async assertNoIssuedInvoicesFrom(
    contractId: string,
    effectiveFrom: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('number, period_start, status')
      .eq('contract_id', contractId)
      .gte('period_start', effectiveFrom)
      .neq('status', 'draft');
    if (error) throw new BadRequestException(error.message);

    const issued = (data ?? []) as Array<{ number: string }>;
    if (issued.length > 0) {
      const numbers = issued.map((i) => i.number).join(', ');
      throw new BadRequestException(
        `Invoice${issued.length === 1 ? '' : 's'} ${numbers} already went to the client for a period on or after ${effectiveFrom}. Void or credit ${issued.length === 1 ? 'it' : 'them'} before amending from that date.`,
      );
    }
  }

  private async dropFutureDrafts(
    contractId: string,
    effectiveFrom: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('invoices')
      .delete()
      .eq('contract_id', contractId)
      .eq('origin', 'scheduled')
      .eq('status', 'draft')
      .gte('period_start', effectiveFrom);
    if (error) throw new BadRequestException(error.message);
  }

  /** Copy the contract forward, apply the patch, leave it unsigned. */
  private async insertAmendedVersion(
    existing: ContractRow,
    dto: AmendContractDto,
    effectiveFrom: string,
    callerId: string,
  ): Promise<ContractRow> {
    const { scope: _scope, effective_from: _effectiveFrom, ...terms } = dto;
    const patch = {
      ...this.scalarPatch(terms as UpdateContractDto),
      ...this.termPatch(
        {
          ...(terms as UpdateContractDto),
          // 'following' restarts the clock at the split; 'all' keeps the
          // original start so the amended terms cover the whole engagement.
          service_start_date:
            terms.service_start_date ??
            (dto.scope === 'following'
              ? effectiveFrom
              : (existing.service_start_date ?? undefined)),
        },
        existing,
      ),
    };

    const {
      id: _id,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...carried
    } = existing;

    const { data, error } = await this.supabase
      .from('contracts')
      .insert({
        ...carried,
        ...patch,
        version: await this.nextVersion(existing.project_id),
        status: 'draft',
        supersedes_contract_id: existing.id,
        amendment_effective_date: effectiveFrom,
        // A new agreement needs new signatures — that is the whole point.
        signed_by_consultant_at: null,
        signed_by_consultant_name: null,
        signed_by_consultant_signature_url: null,
        signed_by_client_at: null,
        signed_by_client_name: null,
        signed_by_client_signature_url: null,
        created_by: callerId,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to create the amended contract.',
      );
    }
    return data as ContractRow;
  }

  /**
   * Stamps one party's signature. The contract only becomes `signed` once BOTH
   * parties have stamped — which is what the activation checklist gates on.
   */
  async signContract(
    callerId: string,
    contractId: string,
    dto: SignContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.assertCanManageSignature(callerId, existing, dto.party);
    return this.stampSignature(existing, dto, callerId);
  }

  /**
   * Stamp a signature that has ALREADY been authorized.
   *
   * Split out of `signContract` so the public token-bearer path can reuse the
   * exact same semantics — both-signed detection, the supersede step, the
   * counterparty notification — without re-deriving them. The token IS the
   * authorization there, so it must not call `assertCanManageSignature`; that
   * is the only difference between the two entry points, and keeping one
   * implementation is what stops them drifting.
   */
  private async stampSignature(
    existing: ContractRow,
    dto: SignContractDto,
    actorId: string | null,
  ): Promise<ContractWithSchedule> {
    const contractId = existing.id;
    const isClientParty = dto.party === 'client';

    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be signed.`,
      );
    }
    if (!existing.service_start_date || !existing.service_end_date) {
      throw new BadRequestException(
        'Set the service start date and term before signing.',
      );
    }

    const now = new Date().toISOString();
    const signatureUrl = dto.signature_url?.trim() || null;
    const signatureScale = clampSignatureScale(dto.signature_scale);
    const offsetX = clampSignatureOffset(dto.signature_offset_x);
    const offsetY = clampSignatureOffset(dto.signature_offset_y);
    const patch: Record<string, unknown> = isClientParty
      ? {
          signed_by_client_at: now,
          signed_by_client_name: dto.signer_name.trim(),
          signed_by_client_signature_url: signatureUrl,
          signed_by_client_signature_scale: signatureScale,
          signed_by_client_signature_offset_x: offsetX,
          signed_by_client_signature_offset_y: offsetY,
        }
      : {
          signed_by_consultant_at: now,
          signed_by_consultant_name: dto.signer_name.trim(),
          signed_by_consultant_signature_url: signatureUrl,
          signed_by_consultant_signature_scale: signatureScale,
          signed_by_consultant_signature_offset_x: offsetX,
          signed_by_consultant_signature_offset_y: offsetY,
        };

    const consultantSigned = isClientParty
      ? Boolean(existing.signed_by_consultant_at)
      : true;
    const clientSigned = isClientParty
      ? true
      : Boolean(existing.signed_by_client_at);
    const bothSigned = consultantSigned && clientSigned;
    if (bothSigned) {
      patch.status = 'signed';
    } else if (existing.status === 'draft') {
      patch.status = 'sent';
    }

    // Superseding: a project may hold only ONE live (signed/active) contract
    // (uq_contracts_live_per_project). When this signature makes a NEW version
    // live, retire any previous live contract first — otherwise the partial
    // unique index rejects the update. This is the amendment path the schema was
    // designed for: a new version supersedes the old, which becomes `ended`.
    if (patch.status === 'signed') {
      const { error: supersedeError } = await this.supabase
        .from('contracts')
        .update({ status: 'ended', updated_at: now })
        .eq('project_id', existing.project_id)
        .neq('id', contractId)
        .in('status', ['signed', 'active']);
      if (supersedeError) {
        throw new BadRequestException(supersedeError.message);
      }
    }

    const { data, error } = await this.supabase
      .from('contracts')
      .update({ ...patch, updated_at: now })
      .eq('id', contractId)
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to sign contract.',
      );
    }
    const updated = data as ContractRow;

    // A token-bearing signer has no account, so there is nobody to exclude
    // from the notification — everyone on the project should hear about it.
    if (bothSigned) {
      await this.notifyCounterparty(actorId ?? '', updated);
    }
    return this.withSchedule(updated);
  }

  /**
   * Sign as the holder of a valid signature link. Authorization already
   * happened when the token was resolved, so this deliberately skips
   * `assertCanManageSignature` — see `stampSignature`.
   */
  async signAsTokenBearer(
    contract: ContractRow,
    dto: SignContractDto,
  ): Promise<ContractWithSchedule> {
    return this.stampSignature(contract, dto, null);
  }

  /**
   * Resize or reposition a stamped signature image. Cosmetic only — it changes
   * where and how large the overlay is drawn, never the terms — so unlike
   * unsigning it stays available on a signed or active contract.
   */
  async updateSignaturePlacement(
    callerId: string,
    contractId: string,
    dto: UpdateSignaturePlacementDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.assertCanManageSignature(callerId, existing, dto.party);

    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be changed.`,
      );
    }

    const isClient = dto.party === 'client';
    const prefix = isClient
      ? 'signed_by_client_signature'
      : 'signed_by_consultant_signature';
    // Each field is optional: the size slider and the drag handle write
    // independently, so an omitted field must keep its current value.
    const patch: Record<string, unknown> = {};
    if (dto.scale !== undefined) {
      patch[`${prefix}_scale`] = clampSignatureScale(dto.scale);
    }
    if (dto.offset_x !== undefined) {
      patch[`${prefix}_offset_x`] = clampSignatureOffset(dto.offset_x);
    }
    if (dto.offset_y !== undefined) {
      patch[`${prefix}_offset_y`] = clampSignatureOffset(dto.offset_y);
    }
    if (Object.keys(patch).length === 0) {
      return this.withSchedule(existing);
    }

    const { data, error } = await this.supabase
      .from('contracts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', contractId)
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to reposition the signature.',
      );
    }
    return this.withSchedule(data as ContractRow);
  }

  /**
   * Remove a party's signature so it can be re-done (e.g. to swap a typed name
   * for an uploaded signature image). Clears that party's name/date/image and,
   * if the contract had reached `signed`, drops it back to `sent` — it is no
   * longer fully executed, so the sign controls reappear. An `active` contract
   * governs a live project and is intentionally not editable here.
   */
  async unsignContract(
    callerId: string,
    contractId: string,
    dto: UnsignContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.assertCanManageSignature(callerId, existing, dto.party);

    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be changed.`,
      );
    }
    if (existing.status === 'active') {
      throw new BadRequestException(
        'This contract is active and governs the live project. Deactivate the project before changing signatures.',
      );
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> =
      dto.party === 'client'
        ? {
            signed_by_client_at: null,
            signed_by_client_name: null,
            signed_by_client_signature_url: null,
          }
        : {
            signed_by_consultant_at: null,
            signed_by_consultant_name: null,
            signed_by_consultant_signature_url: null,
          };
    // No longer fully executed once a signature is pulled.
    if (existing.status === 'signed') {
      patch.status = 'sent';
    }

    const { data, error } = await this.supabase
      .from('contracts')
      .update({ ...patch, updated_at: now })
      .eq('id', contractId)
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to remove the signature.',
      );
    }
    return this.withSchedule(data as ContractRow);
  }

  /**
   * Authenticated signature management belongs to the consultant of record.
   * Clients sign through ContractSignatureLinksService's public token flow.
   */
  private async assertCanManageSignature(
    callerId: string,
    existing: ContractRow,
    party: 'consultant' | 'client',
  ): Promise<void> {
    void party;
    await this.financeAccess.assertProject(callerId, existing.project_id);
  }

  /**
   * Advance billing is retainer-only: an hourly contract cannot be invoiced
   * before its hours exist, let alone before they're approved.
   *
   * `contracts_advance_retainer_only_check` enforces the same thing in the DB,
   * but a raw constraint name is not an error message — this exists so the
   * consultant is told why, in their own vocabulary.
   */
  private assertBillingTimingAllowed(
    timing: BillingTiming,
    mode: BillingMode,
  ): void {
    if (timing === 'advance' && mode !== 'retainer') {
      throw new BadRequestException(
        'Invoicing in advance is only available on a recurring-retainer contract — hourly work has to be logged and approved before it can be billed.',
      );
    }
  }

  /** Billing windows implied by a contract's terms. Empty when terms are incomplete. */
  async resolvePeriods(contract: ContractRow): Promise<BillingPeriod[]> {
    if (!contract.service_start_date || !contract.service_end_date) return [];
    const teamConfig =
      contract.period_source === 'team_config'
        ? await this.getTeamPayPeriodConfig(contract.project_id)
        : null;
    return billingPeriodsForRange(
      configForCadence(contract.invoice_cadence, teamConfig),
      contract.service_start_date,
      contract.service_end_date,
      {
        invoiceOffsetDays: contract.invoice_offset_days,
        dueDays: contract.due_days,
        billingTiming: contract.billing_timing,
      },
    );
  }

  /** The primary team's cut-off config, so client billing lines up with payouts. */
  async getTeamPayPeriodConfig(
    projectId: string,
  ): Promise<PayPeriodConfig | null> {
    const team = await this.getPrimaryTeam(projectId);
    return team?.pay_period_config ?? null;
  }

  /**
   * The team a project bills through — the source of both its pay cut-offs and
   * its business identity on contracts and invoices.
   */
  private async getPrimaryTeam(
    projectId: string,
  ): Promise<PrimaryTeamRow | null> {
    const { data: project } = await this.supabase
      .from('projects')
      .select('primary_team_id')
      .eq('id', projectId)
      .maybeSingle();
    const teamId = (project as { primary_team_id: string | null } | null)
      ?.primary_team_id;
    if (!teamId) return null;

    const { data: team } = await this.supabase
      .from('teams')
      .select(
        'name, legal_name, billing_address, tax_id, billing_email, pay_period_config',
      )
      .eq('id', teamId)
      .maybeSingle();
    return (team as PrimaryTeamRow | null) ?? null;
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async withSchedule(row: ContractRow): Promise<ContractWithSchedule> {
    return { ...row, periods: await this.resolvePeriods(row) };
  }

  /**
   * Raw row fetch for the signature-link service, which authorizes by token
   * rather than by session and so cannot go through the usual `getContract`.
   */
  async getContractRowForLink(contractId: string): Promise<ContractRow> {
    return this.getContractRow(contractId);
  }

  private async getContractRow(contractId: string): Promise<ContractRow> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Contract not found');
    return data as ContractRow;
  }

  private async nextVersion(projectId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ version: number }>;
    return rows.length > 0 ? Number(rows[0].version) + 1 : 1;
  }

  /**
   * Plain scalar fields, copied through verbatim. Term fields are deliberately
   * excluded — they go through `termPatch` so the derived end dates can never
   * drift from the inputs that produced them.
   */
  private scalarPatch(dto: UpdateContractDto): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const copy = <K extends keyof UpdateContractDto>(key: K) => {
      if (dto[key] !== undefined) patch[key as string] = dto[key];
    };

    copy('provider_kind');
    copy('provider_name');
    copy('provider_address');
    copy('provider_tin');
    copy('provider_email');
    copy('client_name');
    copy('client_contact_name');
    copy('client_address');
    copy('client_tin');
    copy('client_email');
    copy('client_user_id');
    copy('billing_mode');
    copy('billing_timing');
    copy('recurring_fee');
    copy('client_hourly_rate');
    copy('included_hours');
    copy('invoice_cadence');
    copy('period_source');
    copy('invoice_offset_days');
    copy('due_days');
    copy('service_description');
    copy('payment_method');
    copy('auto_renew');
    copy('notice_days');
    copy('notes');

    if (dto.currency !== undefined) patch.currency = dto.currency.toUpperCase();
    if (dto.invoice_number_prefix !== undefined) {
      patch.invoice_number_prefix =
        dto.invoice_number_prefix.trim().toUpperCase() || null;
    }
    return patch;
  }

  /**
   * Recomputes and stores the derived term dates whenever any term input
   * changes. Storing them (rather than deriving on read) is what lets a
   * renewal or amendment override the computed value later.
   */
  private termPatch(
    dto: UpdateContractDto,
    existing?: ContractRow,
  ): Record<string, unknown> {
    const start =
      dto.service_start_date ?? existing?.service_start_date ?? null;
    const count = dto.term_count ?? existing?.term_count ?? null;
    const unit = dto.term_unit ?? existing?.term_unit ?? null;

    const touched =
      dto.service_start_date !== undefined ||
      dto.term_count !== undefined ||
      dto.term_unit !== undefined;
    if (!touched) return {};

    const patch: Record<string, unknown> = {
      service_start_date: start ? start.slice(0, 10) : null,
      term_count: count,
      term_unit: unit,
    };

    if (start && count && unit) {
      const term = computeContractTerm({
        serviceStartDate: start.slice(0, 10),
        termCount: count,
        termUnit: unit,
      });
      patch.service_start_date = term.serviceStartDate;
      patch.service_end_date = term.serviceEndDate;
      patch.contract_end_date = term.contractEndDate;
    } else {
      patch.service_end_date = null;
      patch.contract_end_date = null;
    }
    return patch;
  }

  /** Prefills provider/client blocks from the creator and the project client. */
  private async seedParties(
    callerId: string,
    projectId: string,
    terms: Partial<CreateContractDto>,
  ): Promise<Record<string, unknown>> {
    const seeded = this.scalarPatch(terms as UpdateContractDto);

    const kind: ProviderKind = terms.provider_kind ?? 'agency';
    const provider = await this.resolveProviderBlock(callerId, projectId, kind);
    for (const [key, value] of Object.entries(provider)) {
      if (seeded[key] === undefined) seeded[key] = value;
    }

    const { data: project } = await this.supabase
      .from('projects')
      .select('client_id')
      .eq('id', projectId)
      .maybeSingle();
    const clientId = (project as { client_id: string | null } | null)
      ?.client_id;
    // A consultant-created project lists the creator as its own client until a
    // real client is transferred in; seeding that as the counterparty would be
    // misleading, so skip it.
    if (clientId && clientId !== callerId) {
      const { data: client } = await this.supabase
        .from('profiles')
        .select('display_name, first_name, last_name, email')
        .eq('id', clientId)
        .maybeSingle();
      if (client) {
        if (seeded.client_name === undefined) {
          seeded.client_name = this.profileLabel(client);
        }
        if (seeded.client_email === undefined) {
          seeded.client_email =
            (client as { email: string | null }).email ?? null;
        }
        if (seeded.client_user_id === undefined) {
          seeded.client_user_id = clientId;
        }
      }
    }
    return seeded;
  }

  /**
   * The four `provider_*` values for a given identity.
   *
   * The agency branch falls back FIELD BY FIELD to the personal profile rather
   * than all-or-nothing: a team that has filled in only its legal name should
   * still get a usable email, not a blank one. `profiles` carries no business
   * address or TIN, so those stay null for an individual — correct, and the UI
   * says so rather than leaving the reader to wonder why they're empty.
   */
  private async resolveProviderBlock(
    callerId: string,
    projectId: string,
    kind: ProviderKind,
    teamId?: string,
  ): Promise<Record<string, unknown>> {
    const { data: creator } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', callerId)
      .maybeSingle();
    const personalName = creator ? this.profileLabel(creator) : null;
    const personalEmail =
      (creator as { email: string | null } | null)?.email ?? null;

    if (kind === 'individual') {
      return {
        provider_kind: 'individual',
        provider_name: personalName,
        provider_address: null,
        provider_tin: null,
        provider_email: personalEmail,
      };
    }

    const team = teamId
      ? await this.getAttachedTeamIdentity(projectId, teamId)
      : await this.getPrimaryTeam(projectId);
    return {
      provider_kind: 'agency',
      provider_name: team?.legal_name || team?.name || personalName,
      provider_address: team?.billing_address ?? null,
      provider_tin: team?.tax_id ?? null,
      provider_email: team?.billing_email || personalEmail,
    };
  }

  /**
   * A specific team's billing identity, but only if it is attached to this
   * project.
   *
   * The membership check is the security boundary: `team_id` arrives from the
   * client, and without it a project admin could read any team's legal name,
   * billing address and tax id by guessing a UUID.
   */
  private async getAttachedTeamIdentity(
    projectId: string,
    teamId: string,
  ): Promise<PrimaryTeamRow | null> {
    const { data: attachment, error: attachmentError } = await this.supabase
      .from('project_teams')
      .select('team_id')
      .eq('project_id', projectId)
      .eq('team_id', teamId)
      .maybeSingle();
    if (attachmentError) throw new BadRequestException(attachmentError.message);
    if (!attachment) {
      throw new BadRequestException(
        'That team is not attached to this project.',
      );
    }

    const { data, error } = await this.supabase
      .from('teams')
      .select(
        'name, legal_name, billing_address, tax_id, billing_email, pay_period_config',
      )
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (data as PrimaryTeamRow | null) ?? null;
  }

  /**
   * Overwrite the provider block from the chosen identity. Destructive by
   * design — see `ReseedProviderDto` — so it is a deliberate call, not a side
   * effect of editing terms.
   */
  async reseedProvider(
    callerId: string,
    contractId: string,
    kind: ProviderKind,
    teamId?: string,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.financeAccess.assertProject(callerId, existing.project_id);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        'This contract is no longer editable. Remove the signatures to change it.',
      );
    }

    const patch = await this.resolveProviderBlock(
      existing.created_by ?? callerId,
      existing.project_id,
      kind,
      teamId,
    );
    const { data, error } = await this.supabase
      .from('contracts')
      .update(patch)
      .eq('id', contractId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.withSchedule(data as ContractRow);
  }

  private profileLabel(profile: unknown): string | null {
    const p = profile as {
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    };
    const composed = [p.first_name, p.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return p.display_name || composed || p.email || null;
  }

  private async notifyCounterparty(
    actorId: string,
    contract: ContractRow,
  ): Promise<void> {
    const { data: project } = await this.supabase
      .from('projects')
      .select('client_id, consultant_id, title')
      .eq('id', contract.project_id)
      .maybeSingle();
    const row = project as {
      client_id: string | null;
      consultant_id: string | null;
      title: string | null;
    } | null;

    const recipients = new Set<string>();
    if (row?.consultant_id) recipients.add(row.consultant_id);
    if (contract.client_user_id) recipients.add(contract.client_user_id);
    else if (row?.client_id) recipients.add(row.client_id);
    recipients.delete(actorId);

    for (const userId of recipients) {
      try {
        await this.notifications.createNotification({
          user_id: userId,
          project_id: contract.project_id,
          actor_id: actorId,
          type_name: 'contract_signed',
          content: {
            contract_id: contract.id,
            project_title: row?.title ?? null,
            message: 'The service agreement is now fully signed.',
          },
          link_url: `/finance/${contract.id}?section=signatures`,
        });
      } catch {
        // A notification failure must not undo a signature.
      }
    }
  }
}
