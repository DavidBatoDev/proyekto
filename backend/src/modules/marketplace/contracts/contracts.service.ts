import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { isActiveConsultantEnrollment } from '../../../common/auth/consultant-capability';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ConsultantFinanceAccessService } from '../finance/consultant-finance-access.service';
import {
  type ContractPageInitial,
  ContractPageInitialsService,
} from './contract-page-initials.service';
import type { SaveContractInitialsDto } from './dto/contract-page-initials.dto';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
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
  CompensationMode,
  ContractRelationshipKind,
  ContractScopeMode,
  ContractStatus,
  CreateContractDto,
  InvoiceCadence,
  ProviderKind,
  SignContractDto,
  UnsignContractDto,
  UpdateContractDto,
  UpdateSignaturePlacementDto,
} from './dto/contracts.dto';

export interface ContractPosition {
  contract_id: string;
  position: 'hirer' | 'provider';
  user_id: string;
  capacity: 'client' | 'consultant' | 'talent';
  display_name_snapshot: string;
  email_snapshot: string | null;
  signer_name: string | null;
  signature_url: string | null;
  signature_scale: number;
  signature_offset_x: number;
  signature_offset_y: number;
  signed_at: string | null;
}

export interface ContractRow {
  id: string;
  project_id: string | null;
  project_title_snapshot: string | null;
  consultant_user_id: string | null;
  relationship_kind: ContractRelationshipKind;
  scope_mode: ContractScopeMode;
  contract_family_id: string | null;
  engagement_id: string | null;
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
  fixed_fee: number | null;
  time_tracking_mode: 'disabled' | 'optional' | 'required';
  time_approval_mode: 'none' | 'provider_submit_hirer_approve';
  allow_manual_time: boolean;
  time_rounding_minutes: number;
  weekly_time_limit_minutes: number | null;
  client_hours_detail_level: 'none' | 'summary' | 'detailed';
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
  positions?: ContractPosition[];
}

/** A contract plus the billing schedule derived from its terms. */
export interface ContractWithSchedule extends ContractRow {
  periods: BillingPeriod[];
  /** Per-page initials, so the document can stamp each page it renders. */
  page_initials: ContractPageInitial[];
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

export interface ProfileIdentity {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

const EDITABLE_STATUSES: ContractStatus[] = ['draft', 'sent'];

/**
 * Signing failures raised by the database.
 *
 * `sign_contract_position_and_activate`, its legacy wrapper, and the
 * `tg_contracts_lock_parties` trigger all signal with bare tokens. Without this
 * table they reached the signer verbatim — a mid-signature dialog reading
 * "CONTRACT_REQUIRES_TWO_POSITIONS". Anything unmapped still surfaces its raw
 * message rather than being swallowed, so a new token is visible in support
 * rather than silent.
 */
const SIGNING_ERRORS: Record<
  string,
  { conflict?: boolean; missing?: boolean; message: string }
> = {
  CONTRACT_NOT_FOUND: {
    // Only reachable as a race: the RPC re-reads the row under its own lock.
    missing: true,
    message: 'This contract no longer exists.',
  },
  CONTRACT_ALREADY_SIGNED: {
    conflict: true,
    message:
      'This contract is already fully signed. Amend it to change its terms.',
  },
  CONTRACT_NOT_SIGNABLE: {
    conflict: true,
    message: 'An ended or cancelled contract cannot be signed.',
  },
  CONSULTANT_ENROLLMENT_INACTIVE: {
    conflict: true,
    message:
      'The consultant on this contract is no longer verified. Reinstate or re-approve them before signing.',
  },
  CONTRACT_POSITION_INVALID: {
    message: 'That signing position is not part of this contract.',
  },
  CONTRACT_SIGNATURE_PARTY_INVALID: {
    message: 'That signing party is not part of this contract.',
  },
  CONTRACT_REQUIRES_TWO_POSITIONS: {
    message:
      'Both the hirer and the provider must be set on the contract before it can be signed.',
  },
  CONTRACT_SELF_DEALING: {
    message: 'The same account cannot be both sides of a contract.',
  },
  CONTRACT_PROJECT_SEVERED: {
    message:
      'The project this contract covers was deleted, so it can no longer be signed.',
  },
  CONTRACT_TERM_INCOMPLETE: {
    message: 'Set the service start date and term before signing.',
  },
  CONTRACT_FIXED_FEE_REQUIRED: {
    message: 'Set the fixed fee before signing a fixed-price contract.',
  },
  CONTRACT_MONTHLY_RATE_REQUIRED: {
    message: 'Set the monthly rate before signing this contract.',
  },
  CONTRACT_HOURLY_RATE_REQUIRED: {
    message: 'Set the hourly rate before signing this contract.',
  },
  ENGAGEMENT_PARTIES_MISMATCH: {
    conflict: true,
    message:
      'This amendment does not match the parties on the existing engagement. A change of party needs a new contract.',
  },
  ENGAGEMENT_REQUIRES_TWO_PARTIES: {
    conflict: true,
    message: 'An engagement needs exactly one hirer and one provider.',
  },
  AMENDMENT_EFFECTIVE_DATE_PAST: {
    message: 'An amendment must take effect today or later.',
  },
  AMENDMENT_EFFECTIVE_DATE_NOT_PROSPECTIVE: {
    message:
      'This amendment must take effect after the terms it replaces. Choose a later date.',
  },
  CONTRACT_CONSULTANT_PARTY_LOCKED: {
    conflict: true,
    message: 'The consultant cannot be changed once a contract has been sent.',
  },
  CONTRACT_CLIENT_PARTY_LOCKED: {
    conflict: true,
    message: 'The client cannot be changed once a contract has been sent.',
  },
  CONTRACT_COMMERCIAL_IDENTITY_LOCKED: {
    conflict: true,
    message:
      'The relationship and scope of a sent contract are fixed. Create a new contract instead.',
  },
  CONTRACT_PROJECT_SCOPE_LOCKED: {
    conflict: true,
    message: 'The project a sent contract covers cannot be changed.',
  },
};

/** Translate a database signing token into the matching HTTP error. */
function signingError(raw: string | undefined) {
  for (const [token, mapped] of Object.entries(SIGNING_ERRORS)) {
    if (raw?.includes(token)) {
      if (mapped.missing) return new NotFoundException(mapped.message);
      return mapped.conflict
        ? new ConflictException(mapped.message)
        : new BadRequestException(mapped.message);
    }
  }
  return new BadRequestException(raw ?? 'Failed to sign contract.');
}

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
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly pageInitials: ContractPageInitialsService,
  ) {}

  /**
   * Records per-page initials for a seat the caller actually holds.
   *
   * Authorization is the same question as "may this person act on the
   * agreement", so it reuses the signing check rather than inventing a second
   * rule: a caller may only mark the seat they are seated in.
   */
  async savePageInitials(
    callerId: string,
    contractId: string,
    dto: SaveContractInitialsDto,
  ): Promise<ContractPageInitial[]> {
    const contract = await this.getContractRow(contractId);
    const positions = await this.getPositions(contractId);
    const seat = positions.find((p) => p.user_id === callerId);
    if (!seat) {
      // A position-less legacy contract still has a consultant who may act.
      await this.assertConsultantContractControl(callerId, contract);
      if (dto.position !== 'provider' && dto.position !== 'hirer') {
        throw new BadRequestException('Choose which seat is initialling.');
      }
    } else if (seat.position !== dto.position) {
      throw new BadRequestException(
        'You can only initial on behalf of your own seat.',
      );
    }
    return this.pageInitials.save(contractId, callerId, dto);
  }

  async listByProject(
    callerId: string,
    projectId: string,
  ): Promise<ContractWithSchedule[]> {
    // Either the consultant's own book (verified consultant + project owner)
    // or the project finance capability — a project admin may READ the
    // project's contracts; contract control below stays consultant-bound.
    try {
      await this.financeAccess.assertProject(callerId, projectId);
    } catch {
      await this.projectAuth.assertPermission(
        callerId,
        projectId,
        'finance.view_contracts',
      );
    }
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
    await this.assertContractRead(callerId, row);
    return this.withSchedule(row);
  }

  /** Internal exact-row lookup for invoice provenance. No caller authorization. */
  async getContractById(contractId: string): Promise<ContractRow | null> {
    const response = await this.supabase
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .maybeSingle();
    const data: unknown = response.data;
    const error = response.error;
    if (error) throw new Error(error.message);
    return (data as ContractRow | null) ?? null;
  }

  /**
   * The single signed contract that currently governs project billing.
   */
  async getSignedContract(projectId: string): Promise<ContractRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .eq('project_id', projectId)
      .eq('relationship_kind', 'client_services')
      .eq('status', 'signed')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ContractRow | null) ?? null;
  }

  async createContract(
    callerId: string,
    dto: CreateContractDto,
  ): Promise<ContractWithSchedule> {
    const relationshipKind = dto.relationship_kind ?? 'client_services';
    const scopeMode = dto.scope_mode ?? 'project_specific';
    if (scopeMode === 'project_specific') {
      if (!dto.project_id) {
        throw new BadRequestException(
          'A project-specific contract requires a project.',
        );
      }
      await this.financeAccess.assertProject(callerId, dto.project_id);
    } else {
      if (dto.project_id) {
        throw new BadRequestException(
          'A flexible contract starts without a project scope.',
        );
      }
      await this.assertActiveConsultant(callerId);
    }
    if (relationshipKind === 'talent_services' && !dto.counterparty_user_id) {
      throw new BadRequestException(
        'Choose the Talent account before creating a private Talent contract.',
      );
    }
    return this.createContractInternal(callerId, dto);
  }

  /**
   * Insert path used after the finance authorization check has succeeded.
   */
  async createContractInternal(
    callerId: string,
    dto: CreateContractDto,
  ): Promise<ContractWithSchedule> {
    const {
      project_id: projectId = null,
      counterparty_user_id,
      ...rawTerms
    } = dto;
    const terms = this.normalizeTerms(rawTerms);
    const relationshipKind = terms.relationship_kind ?? 'client_services';
    const scopeMode = terms.scope_mode ?? 'project_specific';
    const consultant = await this.resolveProfile(callerId);
    const counterparty = await this.resolveCounterpartyForCreate(
      callerId,
      projectId,
      relationshipKind,
      counterparty_user_id,
    );
    const seeded = await this.seedContractParties(
      callerId,
      projectId,
      relationshipKind,
      terms,
      consultant,
      counterparty,
    );

    const insert: Record<string, unknown> = {
      project_id: projectId,
      consultant_user_id: callerId,
      relationship_kind: relationshipKind,
      scope_mode: scopeMode,
      contract_family_id: randomUUID(),
      version: 1,
      status: 'draft',
      created_by: callerId,
      clauses:
        (terms.clauses as unknown as ContractClause[]) ??
        defaultContractClauses(),
      // Services start empty — the consultant defines them on the Contract tab.
      services: (terms.services as unknown as ContractService[]) ?? [],
      ...seeded,
      ...this.timePolicyPatch(relationshipKind, terms),
      ...this.termPatch(terms),
    };

    // The shared Supabase client is intentionally untyped at this boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    const row = data as ContractRow;
    await this.insertContractPositions(
      row.id,
      relationshipKind,
      consultant,
      counterparty,
    );
    return this.withSchedule(row);
  }

  async updateContract(
    callerId: string,
    contractId: string,
    dto: UpdateContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.assertConsultantContractControl(callerId, existing);

    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be edited. Create a new version instead.`,
      );
    }

    const terms = this.normalizeTerms(dto);
    this.assertBillingTimingAllowed(
      terms.billing_timing ?? existing.billing_timing,
      terms.billing_mode ?? existing.billing_mode,
    );
    this.timePolicyPatch(existing.relationship_kind, { ...existing, ...terms });

    const patch: Record<string, unknown> = {
      ...this.scalarPatch(terms),
      ...this.termPatch(terms, existing),
    };
    if (terms.clauses !== undefined) {
      patch.clauses = terms.clauses;
    }
    if (terms.services !== undefined) {
      patch.services = terms.services;
    }

    if (Object.keys(patch).length === 0) {
      return this.withSchedule(existing);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    await this.assertConsultantContractControl(callerId, existing);
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
    await this.assertConsultantContractControl(callerId, existing);

    if (
      dto.scope === 'this' ||
      (existing.engagement_id && dto.scope === 'all')
    ) {
      throw new BadRequestException(
        existing.engagement_id
          ? 'Engagement-backed contracts can only be amended prospectively.'
          : 'Changing a single invoice is an invoice edit, not a contract change — open that invoice in the editor instead.',
      );
    }
    const terms = this.normalizeTerms(dto);
    this.assertBillingTimingAllowed(
      terms.billing_timing ?? existing.billing_timing,
      terms.billing_mode ?? existing.billing_mode,
    );
    this.timePolicyPatch(existing.relationship_kind, { ...existing, ...terms });

    const effectiveFrom =
      dto.scope === 'all'
        ? existing.service_start_date
        : (dto.effective_from?.slice(0, 10) ??
          (await this.currentPeriodStart(existing)));

    if (!effectiveFrom || !existing.service_start_date) {
      throw new BadRequestException(
        'Set the service start date before amending this contract.',
      );
    }

    if (
      existing.engagement_id &&
      effectiveFrom < new Date().toISOString().slice(0, 10)
    ) {
      throw new BadRequestException(
        'Engagement-backed amendments must take effect today or later.',
      );
    }

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
      terms,
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
    void _scope;
    void _effectiveFrom;
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
    void _id;
    void _createdAt;
    void _updatedAt;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await this.supabase
      .from('contracts')
      .insert({
        ...carried,
        ...patch,
        contract_family_id: existing.contract_family_id ?? randomUUID(),
        version: await this.nextVersion(existing),
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
    const successor = data as ContractRow;
    await this.cloneOrCreateAmendmentPositions(existing, successor);
    return successor;
  }

  /**
   * Stamps one party's signature. The contract becomes `signed` once both
   * parties have stamped.
   */
  async signContract(
    callerId: string,
    contractId: string,
    dto: SignContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    const position = await this.resolveSignaturePosition(existing, dto);
    await this.assertCanSign(callerId, existing, position);
    return this.stampSignature(existing, { ...dto, position }, callerId);
  }

  /**
   * Stamp a signature that has ALREADY been authorized.
   *
   * Split out of `signContract` so the public token-bearer path can reuse the
   * exact same semantics — both-signed detection, the supersede step, the
   * counterparty notification — without re-deriving them. The token IS the
   * authorization there, so it must not call `assertCanSign`; that
   * is the only difference between the two entry points, and keeping one
   * implementation is what stops them drifting.
   */
  private async stampSignature(
    existing: ContractRow,
    dto: SignContractDto,
    actorId: string | null,
  ): Promise<ContractWithSchedule> {
    const contractId = existing.id;
    const position = await this.resolveSignaturePosition(existing, dto);
    const positions = await this.getPositions(existing.id);

    if (
      existing.scope_mode === 'project_specific' &&
      existing.project_id === null
    ) {
      throw new BadRequestException(
        'A contract for a removed project cannot be signed.',
      );
    }
    const consultantId = existing.consultant_user_id ?? existing.created_by;
    const consultantIsActive = consultantId
      ? await isActiveConsultantEnrollment(this.supabase, consultantId)
      : false;
    if (!consultantIsActive) {
      throw new ConflictException(
        'The consultant on this contract is no longer verified. Reinstate or re-approve them before signing.',
      );
    }
    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be signed.`,
      );
    }
    if (existing.status === 'signed') {
      throw new BadRequestException(
        'This contract is already fully signed. Amend it to change its terms.',
      );
    }
    if (!existing.service_start_date || !existing.service_end_date) {
      throw new BadRequestException(
        'Set the service start date and term before signing.',
      );
    }
    this.assertCommercialTerms(existing);
    this.timePolicyPatch(existing.relationship_kind, existing);

    const now = new Date().toISOString();
    const signatureUrl = dto.signature_url?.trim() || null;
    const signatureScale = clampSignatureScale(dto.signature_scale);
    const offsetX = clampSignatureOffset(dto.signature_offset_x);
    const offsetY = clampSignatureOffset(dto.signature_offset_y);
    const response =
      positions.length === 2
        ? await this.supabase.rpc('sign_contract_position_and_activate', {
            p_contract_id: contractId,
            p_position: position,
            p_signer_name: dto.signer_name.trim(),
            p_signature_url: signatureUrl,
            p_scale: signatureScale,
            p_offset_x: offsetX,
            p_offset_y: offsetY,
            p_signed_at: now,
          })
        : await this.supabase.rpc('sign_contract_and_flip', {
            p_contract_id: contractId,
            p_party: dto.party === 'consultant' ? 'consultant' : 'client',
            p_signer_name: dto.signer_name.trim(),
            p_signature_url: signatureUrl,
            p_scale: signatureScale,
            p_offset_x: offsetX,
            p_offset_y: offsetY,
            p_signed_at: now,
          });
    const data: unknown = response.data;
    const error = response.error;
    if (error) throw signingError(error.message);

    // The RPC owns superseding and the final status transition while the row is
    // locked, so concurrent consultant/client stamps cannot strand two
    // signatures on a contract that is still marked sent.
    if (!data) {
      throw new BadRequestException('Failed to sign contract.');
    }
    const updated = (Array.isArray(data) ? data[0] : data) as
      | ContractRow
      | undefined;
    if (!updated) {
      throw new BadRequestException('Failed to sign contract.');
    }

    // A token-bearing signer has no account, so there is nobody to exclude
    // from the notification — everyone on the project should hear about it.
    if (updated.status === 'signed') {
      await this.notifyCounterparty(actorId ?? '', updated);
    }
    return this.withSchedule(updated);
  }

  /**
   * Sign as the holder of a valid signature link. Authorization already
   * happened when the token was resolved, so this deliberately skips
   * `assertCanSign` — see `stampSignature`.
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
   * unsigning it stays available once the contract is signed.
   */
  async updateSignaturePlacement(
    callerId: string,
    contractId: string,
    dto: UpdateSignaturePlacementDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.assertConsultantSignature(callerId, existing);

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

    const position = await this.positionForLegacyParty(existing, dto.party);
    if (position) {
      const { error: positionError } = await this.supabase
        .from('contract_positions')
        .update({
          ...(dto.scale !== undefined
            ? { signature_scale: clampSignatureScale(dto.scale) }
            : {}),
          ...(dto.offset_x !== undefined
            ? { signature_offset_x: clampSignatureOffset(dto.offset_x) }
            : {}),
          ...(dto.offset_y !== undefined
            ? { signature_offset_y: clampSignatureOffset(dto.offset_y) }
            : {}),
        })
        .eq('contract_id', contractId)
        .eq('position', position);
      if (positionError) {
        throw new BadRequestException(positionError.message);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
   * longer fully executed, so the sign controls reappear.
   */
  async unsignContract(
    callerId: string,
    contractId: string,
    dto: UnsignContractDto,
  ): Promise<ContractWithSchedule> {
    const existing = await this.getContractRow(contractId);
    await this.assertConsultantSignature(callerId, existing);

    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be changed.`,
      );
    }
    if (existing.engagement_id) {
      throw new BadRequestException(
        'An activated engagement cannot be unsigned. Amend or end the engagement instead.',
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

    const position = await this.positionForLegacyParty(existing, dto.party);
    if (position) {
      const { error: positionError } = await this.supabase
        .from('contract_positions')
        .update({
          signer_name: null,
          signature_url: null,
          signed_at: null,
        })
        .eq('contract_id', contractId)
        .eq('position', position);
      if (positionError) {
        throw new BadRequestException(positionError.message);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

  private async assertCanSign(
    callerId: string,
    existing: ContractRow,
    position: 'hirer' | 'provider',
  ): Promise<void> {
    const positions = await this.getPositions(existing.id);
    if (positions.length === 2) {
      if (
        positions.some(
          (entry) => entry.position === position && entry.user_id === callerId,
        )
      ) {
        return;
      }
      throw new NotFoundException('Contract not found');
    }
    const consultantId = existing.consultant_user_id ?? existing.created_by;
    if (position === 'provider') {
      if (callerId === consultantId) return;
      throw new NotFoundException('Contract not found');
    }
    if (callerId === existing.client_user_id) return;
    if (existing.project_id) {
      const { data, error } = await this.supabase
        .from('projects')
        .select('owner_id')
        .eq('id', existing.project_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const ownerId = (data as { owner_id: string | null } | null)?.owner_id;
      if (callerId === ownerId && ownerId !== consultantId) return;
    }
    throw new NotFoundException('Contract not found');
  }

  private async assertConsultantSignature(
    callerId: string,
    existing: ContractRow,
  ): Promise<void> {
    await this.assertConsultantContractControl(callerId, existing);
    if (callerId !== (existing.consultant_user_id ?? existing.created_by)) {
      throw new NotFoundException('Contract not found');
    }
  }

  private async assertContractRead(
    callerId: string,
    contract: ContractRow,
  ): Promise<void> {
    const positions = await this.getPositions(contract.id);
    if (positions.some((position) => position.user_id === callerId)) return;
    const consultantId = contract.consultant_user_id ?? contract.created_by;
    if (callerId === consultantId || callerId === contract.client_user_id) {
      return;
    }
    if (contract.project_id) {
      // `finance.view_contracts` covers the project owner (allTrue baseline)
      // and the admin ("HR") tier alike — replacing the old owner_id-only
      // lookup. The consultant-equality carve-out above still short-circuits,
      // so a consultant who lost the seat cannot re-enter through here.
      const permissions = await this.projectAuth.resolvePermissions(
        callerId,
        contract.project_id,
      );
      if (permissions?.finance.view_contracts) return;
    }
    throw new NotFoundException('Contract not found');
  }

  private async assertConsultantContractControl(
    callerId: string,
    contract: ContractRow,
  ): Promise<void> {
    const consultantId = contract.consultant_user_id ?? contract.created_by;
    if (callerId !== consultantId)
      throw new NotFoundException('Contract not found');
    if (contract.project_id) {
      await this.financeAccess.assertProject(callerId, contract.project_id);
    } else {
      await this.assertActiveConsultant(callerId);
    }
  }

  private async resolveSignaturePosition(
    contract: ContractRow,
    dto: SignContractDto,
  ): Promise<'hirer' | 'provider'> {
    if (dto.position && dto.party) {
      const positions = await this.getPositions(contract.id);
      const consultantPosition = positions.find(
        (position) => position.capacity === 'consultant',
      )?.position;
      const mapped =
        dto.party === 'consultant'
          ? consultantPosition
          : consultantPosition === 'hirer'
            ? 'provider'
            : 'hirer';
      if (mapped && mapped !== dto.position) {
        throw new BadRequestException(
          'party and position refer to different contract seats.',
        );
      }
    }
    if (dto.position) return dto.position;

    if (dto.party) {
      const positions = await this.getPositions(contract.id);
      if (positions.length === 2) {
        const consultantPosition = positions.find(
          (position) => position.capacity === 'consultant',
        )?.position;
        if (!consultantPosition) {
          throw new BadRequestException(
            'This contract has no Consultant signing seat.',
          );
        }
        return dto.party === 'consultant'
          ? consultantPosition
          : consultantPosition === 'hirer'
            ? 'provider'
            : 'hirer';
      }
      return dto.party === 'consultant' ? 'provider' : 'hirer';
    }
    throw new BadRequestException(
      'Choose the contract position that is signing.',
    );
  }

  /** Maps the legacy UI party names onto an authoritative P4b seat. */
  private async positionForLegacyParty(
    contract: ContractRow,
    party: 'consultant' | 'client',
  ): Promise<'hirer' | 'provider' | null> {
    const positions = await this.getPositions(contract.id);
    if (positions.length !== 2) return null;
    const consultantPosition = positions.find(
      (position) => position.capacity === 'consultant',
    )?.position;
    if (!consultantPosition) {
      throw new BadRequestException(
        'This contract has no Consultant signing seat.',
      );
    }
    return party === 'consultant'
      ? consultantPosition
      : consultantPosition === 'hirer'
        ? 'provider'
        : 'hirer';
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
    projectId: string | null,
  ): Promise<PayPeriodConfig | null> {
    if (!projectId) return null;
    const team = await this.getPrimaryTeam(projectId);
    return team?.pay_period_config ?? null;
  }

  /**
   * The team a project bills through — the source of both its pay cut-offs and
   * its business identity on contracts and invoices.
   */
  private async getPrimaryTeam(
    projectId: string | null,
  ): Promise<PrimaryTeamRow | null> {
    if (!projectId) return null;
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
    return {
      ...row,
      positions: await this.getPositions(row.id),
      periods: await this.resolvePeriods(row),
      page_initials: await this.pageInitials.listForContract(row.id),
    };
  }

  private async getPositions(contractId: string): Promise<ContractPosition[]> {
    const { data, error } = await this.supabase
      .from('contract_positions')
      .select('*')
      .eq('contract_id', contractId)
      .order('position');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ContractPosition[];
  }

  /**
   * Raw row fetch for the signature-link service, which authorizes by token
   * rather than by session and so cannot go through the usual `getContract`.
   */
  async getContractRowForLink(contractId: string): Promise<ContractRow> {
    return this.getContractRow(contractId);
  }

  /** Signature-link and PDF projections need the generic seats. */
  async getContractPositions(contractId: string): Promise<ContractPosition[]> {
    return this.getPositions(contractId);
  }

  private async getContractRow(contractId: string): Promise<ContractRow> {
    const data = await this.getContractById(contractId);
    if (!data) throw new NotFoundException('Contract not found');
    return data;
  }

  private async nextVersion(contract: ContractRow): Promise<number> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('version')
      .eq('contract_family_id', contract.contract_family_id ?? '')
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
    copy('fixed_fee');
    copy('time_tracking_mode');
    copy('time_approval_mode');
    copy('allow_manual_time');
    copy('time_rounding_minutes');
    copy('weekly_time_limit_minutes');
    copy('client_hours_detail_level');
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
   * Normalizes the generic P4b commercial names onto the legacy physical
   * columns. Both names are accepted only when they describe the same term.
   */
  private normalizeTerms<T extends Partial<UpdateContractDto>>(dto: T): T {
    const normalized = { ...dto } as T & Record<string, unknown>;
    const modeByCompensation: Record<CompensationMode, BillingMode> = {
      fixed: 'fixed',
      monthly: 'retainer',
      hourly: 'time_based',
      hybrid: 'hybrid',
    };
    const compensation = dto.compensation_mode;
    if (compensation) {
      const mapped = modeByCompensation[compensation];
      if (dto.billing_mode && dto.billing_mode !== mapped) {
        throw new BadRequestException(
          'billing_mode and compensation_mode describe different terms.',
        );
      }
      normalized.billing_mode = mapped;
    }
    if (
      dto.monthly_rate !== undefined &&
      dto.recurring_fee !== undefined &&
      dto.monthly_rate !== dto.recurring_fee
    ) {
      throw new BadRequestException(
        'monthly_rate and recurring_fee must match when both are supplied.',
      );
    }
    if (
      dto.hourly_rate !== undefined &&
      dto.client_hourly_rate !== undefined &&
      dto.hourly_rate !== dto.client_hourly_rate
    ) {
      throw new BadRequestException(
        'hourly_rate and client_hourly_rate must match when both are supplied.',
      );
    }
    if (dto.monthly_rate !== undefined)
      normalized.recurring_fee = dto.monthly_rate;
    if (dto.hourly_rate !== undefined) {
      normalized.client_hourly_rate = dto.hourly_rate;
    }
    delete normalized.monthly_rate;
    delete normalized.hourly_rate;
    delete normalized.compensation_mode;
    return normalized as T;
  }

  private timePolicyPatch(
    relationshipKind: ContractRelationshipKind,
    dto: Pick<
      Partial<UpdateContractDto>,
      | 'time_tracking_mode'
      | 'time_approval_mode'
      | 'allow_manual_time'
      | 'time_rounding_minutes'
      | 'weekly_time_limit_minutes'
      | 'client_hours_detail_level'
    >,
  ): Record<string, unknown> {
    const talent = relationshipKind === 'talent_services';
    const patch: Record<string, unknown> = {
      time_tracking_mode:
        dto.time_tracking_mode ?? (talent ? 'required' : 'optional'),
      time_approval_mode:
        dto.time_approval_mode ??
        (talent ? 'provider_submit_hirer_approve' : 'none'),
      allow_manual_time: dto.allow_manual_time ?? true,
      time_rounding_minutes: dto.time_rounding_minutes ?? 0,
      weekly_time_limit_minutes: dto.weekly_time_limit_minutes ?? null,
      client_hours_detail_level: dto.client_hours_detail_level ?? 'none',
    };
    if (talent) {
      if (
        patch.time_approval_mode !== 'provider_submit_hirer_approve' ||
        patch.client_hours_detail_level !== 'none'
      ) {
        throw new BadRequestException(
          'Talent contracts require Consultant approval and cannot expose client time detail.',
        );
      }
    } else if (patch.time_approval_mode !== 'none') {
      throw new BadRequestException(
        'Client contracts do not support Talent time approval.',
      );
    }
    return patch;
  }

  private assertCommercialTerms(contract: ContractRow): void {
    if (contract.billing_mode === 'fixed' && contract.fixed_fee == null) {
      throw new BadRequestException(
        'Set the fixed contract amount before signing.',
      );
    }
    if (
      ['retainer', 'hybrid'].includes(contract.billing_mode) &&
      contract.recurring_fee == null
    ) {
      throw new BadRequestException(
        'Set the monthly contract rate before signing.',
      );
    }
    if (
      ['time_based', 'hybrid'].includes(contract.billing_mode) &&
      contract.client_hourly_rate == null
    ) {
      throw new BadRequestException(
        'Set the hourly contract rate before signing.',
      );
    }
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

  /** Exact-email profile lookup for private contract counterparties. */
  async resolveCounterparty(
    callerId: string,
    email: string,
  ): Promise<
    Pick<ProfileIdentity, 'id' | 'display_name' | 'email' | 'avatar_url'>
  > {
    await this.assertActiveConsultant(callerId);
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new BadRequestException('Enter an email address.');
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, display_name, first_name, last_name, email, avatar_url')
      .eq('email', normalized)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const profile = data as ProfileIdentity | null;
    if (!profile || profile.id === callerId) {
      throw new NotFoundException('No eligible Proyekto account was found.');
    }
    return {
      id: profile.id,
      display_name: this.profileLabel(profile),
      email: profile.email,
      avatar_url: profile.avatar_url ?? null,
    };
  }

  private async assertActiveConsultant(callerId: string): Promise<void> {
    if (!(await isActiveConsultantEnrollment(this.supabase, callerId))) {
      throw new NotFoundException('Consultant access is required.');
    }
  }

  private async resolveProfile(userId: string): Promise<ProfileIdentity> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, display_name, first_name, last_name, email, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Proyekto account not found.');
    return data as ProfileIdentity;
  }

  private async resolveCounterpartyForCreate(
    callerId: string,
    projectId: string | null,
    relationshipKind: ContractRelationshipKind,
    requestedUserId?: string,
  ): Promise<ProfileIdentity> {
    let projectOwnerId: string | null = null;
    if (projectId) {
      const { data, error } = await this.supabase
        .from('projects')
        .select('owner_id')
        .eq('id', projectId)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      projectOwnerId =
        (data as { owner_id: string | null } | null)?.owner_id ?? null;
    }

    // The named account wins. Falling back to the project owner is only a
    // convenience for the arrangement where the client happens to own the
    // project, and it is skipped when that owner is the caller — a contract
    // cannot seat one person on both sides.
    const ownerFallback =
      relationshipKind === 'client_services' && projectOwnerId !== callerId
        ? projectOwnerId
        : null;
    const counterpartyId = requestedUserId ?? ownerFallback;
    if (!counterpartyId || counterpartyId === callerId) {
      throw new BadRequestException(
        relationshipKind === 'client_services'
          ? 'Choose a Client account before creating this contract.'
          : 'Choose a Talent account before creating this contract.',
      );
    }
    /*
     * There is deliberately NO requirement that the Client be the project owner.
     *
     * That rule made project-scoped client contracts unreachable: creating one
     * runs through financeAccess.assertProject, which requires the CALLER to own
     * the project, so "client must be the owner" and "caller must be the owner"
     * could only both hold by seating one person on both sides — which
     * contract_positions forbids. Every client agreement was therefore forced to
     * be `flexible`, and because createInvoice rejects a contract whose
     * project_id does not match the invoice's, no project invoice could ever
     * carry contract provenance.
     *
     * It also contradicted the domain rule in docs/11-domains/finance/README.md:
     * "Never infer a billing counterparty from projects.owner_id or from a
     * project_access row." A project is the execution layer; who is paying is a
     * fact of the contract, named by the consultant.
     */
    return this.resolveProfile(counterpartyId);
  }

  private async seedContractParties(
    callerId: string,
    projectId: string | null,
    relationshipKind: ContractRelationshipKind,
    terms: Partial<CreateContractDto>,
    consultant: ProfileIdentity,
    counterparty: ProfileIdentity,
  ): Promise<Record<string, unknown>> {
    const seeded = this.scalarPatch(terms as UpdateContractDto);
    const consultantBlock = await this.resolveProviderBlock(
      callerId,
      projectId,
      terms.provider_kind ?? 'agency',
    );
    if (projectId) {
      const { data: project } = await this.supabase
        .from('projects')
        .select('title')
        .eq('id', projectId)
        .maybeSingle();
      seeded.project_title_snapshot =
        (project as { title: string | null } | null)?.title ?? null;
    }

    if (relationshipKind === 'client_services') {
      for (const [key, value] of Object.entries(consultantBlock)) {
        if (seeded[key] === undefined) seeded[key] = value;
      }
      if (seeded.client_name === undefined) {
        seeded.client_name = this.profileLabel(counterparty);
      }
      if (seeded.client_email === undefined)
        seeded.client_email = counterparty.email;
      if (seeded.client_user_id === undefined)
        seeded.client_user_id = counterparty.id;
      return seeded;
    }

    // For talent services the Consultant is the hirer. The existing physical
    // blocks remain compatibility storage, while positions remain authoritative.
    if (seeded.client_name === undefined) {
      seeded.client_name =
        consultantBlock.provider_name ?? this.profileLabel(consultant);
    }
    if (seeded.client_email === undefined) {
      seeded.client_email = consultantBlock.provider_email ?? consultant.email;
    }
    if (seeded.provider_name === undefined) {
      seeded.provider_name = this.profileLabel(counterparty);
    }
    if (seeded.provider_email === undefined)
      seeded.provider_email = counterparty.email;
    if (seeded.provider_kind === undefined) {
      seeded.provider_kind = terms.provider_kind ?? 'individual';
    }
    seeded.client_user_id = null;
    return seeded;
  }

  private async insertContractPositions(
    contractId: string,
    relationshipKind: ContractRelationshipKind,
    consultant: ProfileIdentity,
    counterparty: ProfileIdentity,
  ): Promise<void> {
    const label = (profile: ProfileIdentity) =>
      this.profileLabel(profile) ?? profile.email ?? profile.id;
    const rows =
      relationshipKind === 'client_services'
        ? [
            {
              contract_id: contractId,
              position: 'hirer',
              user_id: counterparty.id,
              capacity: 'client',
              display_name_snapshot: label(counterparty),
              email_snapshot: counterparty.email,
            },
            {
              contract_id: contractId,
              position: 'provider',
              user_id: consultant.id,
              capacity: 'consultant',
              display_name_snapshot: label(consultant),
              email_snapshot: consultant.email,
            },
          ]
        : [
            {
              contract_id: contractId,
              position: 'hirer',
              user_id: consultant.id,
              capacity: 'consultant',
              display_name_snapshot: label(consultant),
              email_snapshot: consultant.email,
            },
            {
              contract_id: contractId,
              position: 'provider',
              user_id: counterparty.id,
              capacity: 'talent',
              display_name_snapshot: label(counterparty),
              email_snapshot: counterparty.email,
            },
          ];
    const { error } = await this.supabase
      .from('contract_positions')
      .insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  private async cloneOrCreateAmendmentPositions(
    existing: ContractRow,
    successor: ContractRow,
  ): Promise<void> {
    const positions = await this.getPositions(existing.id);
    if (positions.length === 2) {
      const { error } = await this.supabase.from('contract_positions').insert(
        positions.map((position) => ({
          contract_id: successor.id,
          position: position.position,
          user_id: position.user_id,
          capacity: position.capacity,
          display_name_snapshot: position.display_name_snapshot,
          email_snapshot: position.email_snapshot,
        })),
      );
      if (error) throw new BadRequestException(error.message);
      return;
    }

    const consultantId = existing.consultant_user_id ?? existing.created_by;
    if (!consultantId || !existing.client_user_id) {
      throw new BadRequestException(
        'A legacy contract needs two Proyekto account-backed parties before it can be amended into an engagement.',
      );
    }
    await this.insertContractPositions(
      successor.id,
      existing.relationship_kind,
      await this.resolveProfile(consultantId),
      await this.resolveProfile(existing.client_user_id),
    );
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
    projectId: string | null,
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
      ? projectId
        ? await this.getAttachedTeamIdentity(projectId, teamId)
        : null
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
    await this.assertConsultantContractControl(callerId, existing);
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    const { data: project } = contract.project_id
      ? await this.supabase
          .from('projects')
          .select('owner_id, title')
          .eq('id', contract.project_id)
          .maybeSingle()
      : { data: null };
    const row = project as {
      owner_id: string | null;
      title: string | null;
    } | null;
    const positions = await this.getPositions(contract.id);

    // Everyone the contract itself names. The provider used to be found by asking
    // the execution layer who "the consultant" was on the project
    // (project_access.origin) — unnecessary here, since the contract records its
    // own provider and every position holder is added below anyway.
    const recipients = new Set<string>();
    if (contract.consultant_user_id) {
      recipients.add(contract.consultant_user_id);
    }
    if (contract.client_user_id) recipients.add(contract.client_user_id);
    else if (row?.owner_id) recipients.add(row.owner_id);
    for (const position of positions) recipients.add(position.user_id);
    recipients.delete(actorId);

    for (const userId of recipients) {
      try {
        await this.notifications.createNotification({
          user_id: userId,
          project_id: contract.project_id ?? undefined,
          actor_id: actorId,
          type_name: 'contract_signed',
          content: {
            contract_id: contract.id,
            project_title:
              row?.title ?? contract.project_title_snapshot ?? null,
            message: 'The service agreement is now fully signed.',
          },
          link_url: `/engagements/finance/${contract.id}?section=signatures`,
        });
      } catch {
        // A notification failure must not undo a signature.
      }
    }
  }
}
