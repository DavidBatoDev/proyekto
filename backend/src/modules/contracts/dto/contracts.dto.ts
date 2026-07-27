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
}

export class UnsignContractDto {
  @IsIn(['consultant', 'client'])
  party!: 'consultant' | 'client';
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

  /**
   * Consultant's explicit acknowledgement that hourly members deliberately run
   * without a weekly/monthly cap. Clears the `hour_limits_set` checklist item.
   */
  @IsOptional() @IsBoolean() hour_limits_ack?: boolean;
}
