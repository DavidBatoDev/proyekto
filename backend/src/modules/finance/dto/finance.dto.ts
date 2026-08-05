import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CONTRACT_STATUSES } from '../../contracts/dto/contracts.dto';
import { INVOICE_STATUSES } from '../../invoices/dto/invoices.dto';

const PROJECT_STATUSES = [
  'draft',
  'bidding',
  'active',
  'paused',
  'completed',
  'archived',
] as const;

export class FinanceFiltersDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  project_status?: (typeof PROJECT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class FinanceContractsQueryDto extends FinanceFiltersDto {
  @IsOptional()
  @IsIn(CONTRACT_STATUSES)
  contract_status?: (typeof CONTRACT_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class FinanceInvoicesQueryDto extends FinanceFiltersDto {
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  invoice_status?: (typeof INVOICE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}
