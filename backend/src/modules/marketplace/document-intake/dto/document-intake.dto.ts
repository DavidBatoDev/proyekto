import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const INTAKE_DOC_TYPES = [
  'contract',
  'amendment',
  'invoice',
  'receipt',
  'proof_of_payment',
  'other',
] as const;

export class CreateIntakeBatchDto {
  @IsOptional()
  @IsUUID()
  workspace_id?: string;
}

/** Change what a document is, or where it starts and ends in its file. */
export class UpdateIntakeDocumentDto {
  @IsOptional()
  @IsIn(INTAKE_DOC_TYPES)
  doc_type?: (typeof INTAKE_DOC_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page_start?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page_end?: number;

  /** Regroup the document; null takes it out of any relationship. */
  @IsOptional()
  @IsUUID()
  relationship_id?: string | null;

  /** For a receipt or proof of payment: the invoice document it pays. */
  @IsOptional()
  @IsUUID()
  matched_invoice_id?: string | null;
}

/** Split one detected document into two at a page. */
export class SplitIntakeDocumentDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  at_page!: number;
}

/** Type or fix a field, accept an Unsure reading, or mark it absent. */
export class UpdateIntakeFieldDto {
  @IsString()
  @MaxLength(80)
  field!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  value?: string | null;

  @IsOptional()
  @IsBoolean()
  accept?: boolean;

  @IsOptional()
  @IsBoolean()
  not_in_document?: boolean;

  /**
   * The value came from a box the person drew (the page's own text under
   * it): recorded with origin `snip` and that location.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  snip_page?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsNumber({}, { each: true })
  snip_box?: number[];
}

/** Re-read one field from a box the person drew on the page. */
export class RereadIntakeFieldDto {
  @IsString()
  @MaxLength(80)
  field!: string;

  /** The cropped region, as a PNG/JPEG data URL. */
  @IsString()
  @MaxLength(8_000_000)
  image_data_url!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** [x, y, width, height] as fractions of the page. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsNumber({}, { each: true })
  box?: number[];
}

export class IntakeClauseDto {
  @IsOptional() @IsString() @MaxLength(40) number?: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsString() @MaxLength(20000) body!: string;
}

/** The clause list after the person split or merged clauses. */
export class UpdateIntakeClausesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IntakeClauseDto)
  clauses!: IntakeClauseDto[];
}

/** Confirm a relationship: who the counterparty is and which project. */
export class UpdateIntakeRelationshipDto {
  @IsOptional()
  @IsEmail()
  counterparty_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  counterparty_name?: string;

  @IsOptional()
  @IsIn(['client_services', 'talent_services'])
  relationship_kind?: 'client_services' | 'talent_services';

  /** An existing project to link, or none to create one on replicate. */
  @IsOptional()
  @IsUUID()
  project_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  project_title?: string;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class CreateIntakeRelationshipDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  counterparty_name?: string;
}

/**
 * Import one group. `project_currency` answers the currency question (the
 * documents are in a currency the project is not): the currency the person
 * picked for the project. Nothing changes the project's currency without it.
 */
export class ReplicateIntakeRelationshipDto {
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'project_currency must be a three-letter currency code',
  })
  project_currency?: string;
}
