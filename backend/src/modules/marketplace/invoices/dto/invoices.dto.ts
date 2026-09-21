import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export class InvoiceLineItemInputDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unit_rate!: number;
}

export const HOURS_DETAIL_LEVELS = ['none', 'summary', 'detailed'] as const;
export type HoursDetailLevel = (typeof HOURS_DETAIL_LEVELS)[number];

export class CreateInvoiceDto {
  @IsUUID()
  project_id!: string;

  /**
   * When set (or when the project has a live contract), lines are composed from
   * the contract's billing mode and CLIENT rate rather than from manual entry.
   */
  @IsOptional()
  @IsUUID()
  contract_id?: string;

  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  /** How much time detail the client is shown. Defaults to a single summary line. */
  @IsOptional()
  @IsIn(HOURS_DETAIL_LEVELS)
  hours_detail_level?: HoursDetailLevel;

  @IsOptional()
  @IsUUID()
  recipient_user_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  attach_hours?: boolean;

  @IsOptional()
  @IsDateString()
  hours_from?: string;

  @IsOptional()
  @IsDateString()
  hours_to?: string;

  @IsOptional()
  @IsUUID()
  hours_member_user_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemInputDto)
  line_items?: InvoiceLineItemInputDto[];
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsIn(HOURS_DETAIL_LEVELS)
  hours_detail_level?: HoursDetailLevel;

  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  @IsOptional()
  @IsUUID()
  recipient_user_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  attach_hours?: boolean;

  @IsOptional()
  @IsDateString()
  hours_from?: string;

  @IsOptional()
  @IsDateString()
  hours_to?: string;

  @IsOptional()
  @IsUUID()
  hours_member_user_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemInputDto)
  line_items?: InvoiceLineItemInputDto[];
}

export class InvoiceListQueryDto {
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RecordInvoicePaymentDto {
  /** In the invoice's currency: what this payment settles of the invoice. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  payment_date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payment_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /**
   * What actually landed, when the client pays in another currency. Recorded
   * on the payment rather than the invoice because the rate belongs to the
   * transfer: two PESONet credits against the same AUD book cleared three
   * weeks apart at 42.1650 and 41.3724.
   */
  @IsOptional()
  @IsString()
  @MaxLength(3)
  settled_currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  settled_amount?: number;

  /** Omit to derive `settled_amount / amount`. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  fx_rate?: number;

  /** A `finance_documents` row: the bank record proving the transfer. */
  @IsOptional()
  @IsUUID()
  proof_document_id?: string;
}

export class ReverseInvoicePaymentDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class VoidAndReplaceInvoiceDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
