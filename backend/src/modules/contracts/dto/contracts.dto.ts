import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const CONTRACT_STATUSES = [
  'draft',
  'sent',
  'signed',
  'active',
  'ended',
  'cancelled',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const BILLING_MODES = ['retainer', 'time_based', 'hybrid'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const INVOICE_CADENCES = ['monthly', 'semi_monthly', 'custom'] as const;
export type InvoiceCadence = (typeof INVOICE_CADENCES)[number];

export const TERM_UNITS = ['month', 'year'] as const;
export const PERIOD_SOURCES = ['team_config', 'contract'] as const;

/** Whose identity signs a contract: the consultant personally, or their team. */
export const PROVIDER_KINDS = ['individual', 'agency'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/**
 * When the invoice for a period is raised. 'advance' is the prepaid retainer:
 * bill November 30 for December. Retainer-only — an hourly contract cannot be
 * billed before its hours are logged and approved.
 */
export const BILLING_TIMINGS = ['arrears', 'advance'] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];

export class ContractClauseDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(8000)
  body!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  position!: number;
}

export class ContractServiceDto {
  @IsString()
  @MaxLength(80)
  id!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unit_rate!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  position!: number;
}

/**
 * Commercial + party fields shared by create and update. Every field is
 * optional here because a contract is built up progressively — the wizard
 * writes terms, the Contract tab fills in parties and clauses later. The
 * *completeness* rules that actually matter live in the activation checklist,
 * not in DTO validation, so a consultant is never blocked from saving a
 * half-finished draft.
 */
export class ContractTermsDto {
  @IsOptional() @IsIn(PROVIDER_KINDS) provider_kind?: ProviderKind;
  @IsOptional() @IsString() @MaxLength(200) provider_name?: string;
  @IsOptional() @IsString() @MaxLength(500) provider_address?: string;
  @IsOptional() @IsString() @MaxLength(80) provider_tin?: string;
  @IsOptional() @IsString() @MaxLength(320) provider_email?: string;

  @IsOptional() @IsString() @MaxLength(200) client_name?: string;
  @IsOptional() @IsString() @MaxLength(200) client_contact_name?: string;
  @IsOptional() @IsString() @MaxLength(500) client_address?: string;
  @IsOptional() @IsString() @MaxLength(80) client_tin?: string;
  @IsOptional() @IsString() @MaxLength(320) client_email?: string;
  @IsOptional() @IsUUID() client_user_id?: string | null;

  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsIn(BILLING_MODES) billing_mode?: BillingMode;
  @IsOptional() @IsIn(BILLING_TIMINGS) billing_timing?: BillingTiming;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  recurring_fee?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  client_hourly_rate?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  included_hours?: number | null;

  @IsOptional() @IsIn(INVOICE_CADENCES) invoice_cadence?: InvoiceCadence;
  @IsOptional() @IsIn(PERIOD_SOURCES) period_source?:
    | 'team_config'
    | 'contract';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  invoice_offset_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  due_days?: number;

  @IsOptional() @IsString() @MaxLength(12) invoice_number_prefix?: string;
  @IsOptional() @IsString() @MaxLength(300) service_description?: string;
  @IsOptional() @IsString() @MaxLength(200) payment_method?: string;

  @IsOptional() @IsDateString() service_start_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  term_count?: number;

  @IsOptional() @IsIn(TERM_UNITS) term_unit?: 'month' | 'year';

  @IsOptional() @IsBoolean() auto_renew?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  notice_days?: number | null;

  @IsOptional() @IsString() @MaxLength(5000) notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractClauseDto)
  clauses?: ContractClauseDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractServiceDto)
  services?: ContractServiceDto[];
}

export class CreateContractDto extends ContractTermsDto {
  @IsUUID()
  project_id!: string;
}

export class UpdateContractDto extends ContractTermsDto {}

/**
 * Which invoices a terms change applies to. Mirrors MEETING_EDIT_SCOPES.
 *
 * Because future invoices are not materialized, only 'following' and 'all'
 * reach the contract at all — 'this' is a single-invoice edit and belongs to
 * the invoice editor. The enum still carries it so the UI and the API agree on
 * one vocabulary and the server can say so explicitly.
 */
export const CONTRACT_EDIT_SCOPES = ['this', 'following', 'all'] as const;
export type ContractEditScope = (typeof CONTRACT_EDIT_SCOPES)[number];

export class AmendContractDto extends ContractTermsDto {
  @IsIn(CONTRACT_EDIT_SCOPES) scope!: ContractEditScope;

  /**
   * First day the new terms apply. Defaults to the start of the billing period
   * containing today for 'following', and to the service start for 'all'.
   */
  @IsOptional() @IsDateString() effective_from?: string;
}

/**
 * Refill the provider block from a chosen identity. Deliberately its own
 * endpoint rather than a side effect of `PATCH /contracts/:id`: a consultant
 * who hand-edited the provider details should not lose them the moment they
 * flip the Individual/Agency toggle, so overwriting is an explicit act.
 */
export class ReseedProviderDto {
  @IsIn(PROVIDER_KINDS) provider_kind!: ProviderKind;

  /**
   * Which team's billing identity to copy, for `agency`. Defaults to the
   * project's primary team. Only teams attached to the project are accepted —
   * without that check any project admin could read out an arbitrary team's
   * legal name, address and tax id by guessing a UUID.
   *
   * Ignored for `individual`, which always reads the caller's own profile.
   */
  @IsOptional() @IsUUID() team_id?: string;
}

export class SignContractDto {
  @IsIn(['consultant', 'client'])
  party!: 'consultant' | 'client';

  @IsString()
  @MaxLength(200)
  signer_name!: string;

  /** Public URL of an uploaded signature image, optional. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  signature_url?: string;

  /** Display multiplier for the signature image. 1 = base size. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(3)
  signature_scale?: number;

  /** Placement offsets in base-height multiples; +x right, +y up. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-3)
  @Max(3)
  signature_offset_x?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-3)
  @Max(3)
  signature_offset_y?: number;
}

export class UnsignContractDto {
  @IsIn(['consultant', 'client'])
  party!: 'consultant' | 'client';
}

/**
 * Resize or reposition an already-stamped signature. Purely cosmetic — it
 * changes where and how large the overlay is drawn, never the terms — so
 * unlike unsigning it stays available once the contract is signed or active.
 *
 * Every field is optional so the size slider and the drag handle can write
 * independently without clobbering each other.
 */
export class UpdateSignaturePlacementDto {
  @IsIn(['consultant', 'client'])
  party!: 'consultant' | 'client';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(3)
  scale?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-3)
  @Max(3)
  offset_x?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-3)
  @Max(3)
  offset_y?: number;
}

/**
 * How the team pool divides between members. 'equal' derives each slice from
 * the member count on read; 'custom' uses the stored per-member amounts —
 * hours are never truly equal, so the consultant needs both.
 */
export const ALLOCATION_MODES = ['equal', 'custom'] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

/** One member's slice of the team pool. */
export class ProjectMemberAllocationDto {
  @IsUUID() team_id!: string;
  @IsUUID() user_id!: string;

  /** null = in the split, but with no explicit amount yet. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthly_allocation?: number | null;
}

export class UpdateProjectEconomicsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  company_percent!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  team_percent!: number;

  @IsOptional() @IsString() @MaxLength(8) currency?: string;

  @IsOptional() @IsIn(ALLOCATION_MODES) allocation_mode?: AllocationMode;

  /**
   * The complete set of per-member slices. Omit to leave them untouched; send
   * an array to REPLACE them — anyone absent is dropped from the split, which
   * is how "remove this member from the budget" persists.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectMemberAllocationDto)
  allocations?: ProjectMemberAllocationDto[];

  /**
   * Consultant's explicit acknowledgement that hourly members deliberately run
   * without a weekly/monthly cap. Clears the `hour_limits_set` checklist item.
   */
  @IsOptional() @IsBoolean() hour_limits_ack?: boolean;
}
