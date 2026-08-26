import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum FinanceDocumentKind {
  Invoice = 'invoice',
  PaymentProof = 'payment_proof',
  Other = 'other',
}

export class UploadFinanceDocumentDto {
  @IsUUID()
  project_id!: string;

  @IsEnum(FinanceDocumentKind)
  kind!: FinanceDocumentKind;
}

export class ListFinanceDocumentsQueryDto {
  @IsUUID()
  project_id!: string;

  @IsOptional()
  @IsEnum(FinanceDocumentKind)
  kind?: FinanceDocumentKind;
}

/**
 * Where a recorded figure was read from.
 *
 * `rect` is normalised to the page (0..1 on both axes) so the highlight lands
 * in the same place whatever zoom the viewer was at when it was drawn.
 */
export class DocumentSnipDto {
  @IsString()
  @MaxLength(60)
  field_key!: string;

  @IsUUID()
  document_id!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page!: number;

  @IsObject()
  rect!: { x: number; y: number; w: number; h: number };

  @IsOptional()
  @IsString()
  @MaxLength(500)
  value_text?: string;

  @IsOptional()
  @IsEnum(['snip', 'extraction', 'manual'])
  origin?: 'snip' | 'extraction' | 'manual';
}

export class ImportedInvoiceLineDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unit_rate?: number;

  @Type(() => Number)
  @IsNumber()
  amount!: number;
}

/**
 * A payment that already happened, in the money that actually arrived.
 *
 * `amount` is in the invoice's currency (what the payment settles of the
 * invoice); `settled_*` is what the bank credited. Both are recorded because
 * neither can be derived from the other without a rate, and the rate belongs
 * to the transfer — the two PESONet credits behind this feature cleared at
 * 42.1650 and 41.3724 PHP per AUD three weeks apart.
 */
export class ImportedPaymentDto {
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

  @IsOptional()
  @IsUUID()
  proof_document_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DocumentSnipDto)
  snips?: DocumentSnipDto[];
}

export class ImportInvoiceDto {
  @IsUUID()
  project_id!: string;

  /** The document this invoice was read from. */
  @IsUUID()
  source_document_id!: string;

  @IsString()
  @MaxLength(120)
  number!: string;

  @IsString()
  @MaxLength(3)
  currency!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total!: number;

  @IsDateString()
  issue_date!: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ImportedInvoiceLineDto)
  lines?: ImportedInvoiceLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImportedPaymentDto)
  payments?: ImportedPaymentDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DocumentSnipDto)
  snips?: DocumentSnipDto[];
}
