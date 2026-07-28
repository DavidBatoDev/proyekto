import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  BillingPeriod,
  billingPeriodsForRange,
  configForCadence,
  PayPeriodConfig,
} from './billing-period';
import {
  ContractClause,
  ContractService,
  defaultContractClauses,
} from './contract-clause-template';
import { computeContractTerm } from './contract-term';
import {
  BillingMode,
  ContractStatus,
  CreateContractDto,
  InvoiceCadence,
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
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  async listByProject(
    callerId: string,
    projectId: string,
  ): Promise<ContractWithSchedule[]> {
    await this.projectAuth.assertRole(callerId, projectId, 'viewer');
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
    await this.projectAuth.assertRole(callerId, row.project_id, 'viewer');
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
    await this.projectAuth.assertRole(callerId, dto.project_id, 'admin');
    return this.createContractInternal(callerId, dto);
  }

  /**
   * Insert path shared by the API and by project creation (where the wizard
   * submits commercial terms alongside the project). Skips the authorization
   * check because the caller has already established it.
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
    await this.projectAuth.assertRole(callerId, existing.project_id, 'admin');

    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `A ${existing.status} contract cannot be edited. Create a new version instead.`,
      );
    }

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
    const isClientParty = dto.party === 'client';
    await this.assertCanManageSignature(callerId, existing, dto.party);

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

    if (bothSigned) {
      await this.notifyCounterparty(callerId, updated);
    }
    return this.withSchedule(updated);
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
   * A party may sign/unsign their own line: the client is authorized by
   * identity (they may hold only a viewer role, or none yet if invited by
   * email), the service-provider side by project `admin`.
   */
  private async assertCanManageSignature(
    callerId: string,
    existing: ContractRow,
    party: 'consultant' | 'client',
  ): Promise<void> {
    if (party === 'client') {
      const isRecordedClient =
        existing.client_user_id === callerId ||
        (await this.isProjectClient(callerId, existing.project_id));
      if (!isRecordedClient) {
        await this.projectAuth.assertRole(
          callerId,
          existing.project_id,
          'admin',
        );
      }
    } else {
      await this.projectAuth.assertRole(callerId, existing.project_id, 'admin');
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
      },
    );
  }

  /** The primary team's cut-off config, so client billing lines up with payouts. */
  async getTeamPayPeriodConfig(
    projectId: string,
  ): Promise<PayPeriodConfig | null> {
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
      .select('pay_period_config')
      .eq('id', teamId)
      .maybeSingle();
    return (
      ((team as { pay_period_config: PayPeriodConfig | null } | null)
        ?.pay_period_config as PayPeriodConfig | null) ?? null
    );
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async withSchedule(row: ContractRow): Promise<ContractWithSchedule> {
    return { ...row, periods: await this.resolvePeriods(row) };
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

  private async isProjectClient(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const { data } = await this.supabase
      .from('projects')
      .select('client_id')
      .eq('id', projectId)
      .maybeSingle();
    return (data as { client_id: string | null } | null)?.client_id === userId;
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

    const { data: creator } = await this.supabase
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', callerId)
      .maybeSingle();
    if (creator && seeded.provider_name === undefined) {
      seeded.provider_name = this.profileLabel(creator);
    }
    if (creator && seeded.provider_email === undefined) {
      seeded.provider_email =
        (creator as { email: string | null }).email ?? null;
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
          link_url: `/project/${contract.project_id}/contract`,
        });
      } catch {
        // A notification failure must not undo a signature.
      }
    }
  }
}
