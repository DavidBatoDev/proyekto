import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const PAYOUT_METHOD_TYPES = [
  'bank',
  'gcash',
  'maya',
  'paypal',
  'other',
] as const;
export type PayoutMethodType = (typeof PAYOUT_METHOD_TYPES)[number];

export const PAYOUT_SOURCES = ['batch', 'quick'] as const;
export type PayoutSource = (typeof PAYOUT_SOURCES)[number];

export class CreatePayoutMethodDto {
  @IsIn(PAYOUT_METHOD_TYPES)
  method_type!: PayoutMethodType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsString()
  @MaxLength(200)
  account_name!: string;

  @IsString()
  @MaxLength(200)
  account_identifier!: string;

  // Required only for bank accounts.
  @ValidateIf((o: CreatePayoutMethodDto) => o.method_type === 'bank')
  @IsString()
  @MaxLength(200)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  // Private R2 object key for the scan-to-pay QR image (from the uploads endpoint).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  qr_path?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class UpdatePayoutMethodDto {
  @IsOptional()
  @IsIn(PAYOUT_METHOD_TYPES)
  method_type?: PayoutMethodType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  account_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  account_identifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  // Empty string clears the existing QR; a non-empty key replaces it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  qr_path?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreatePayoutDto {
  @IsUUID()
  team_id!: string;

  @IsUUID()
  member_user_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  log_ids!: string[];

  @IsOptional()
  @IsUUID()
  payout_method_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference_number?: string;

  // Private R2 object key returned by the uploads endpoint (payout_proofs bucket).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proof_path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsDateString()
  paid_at?: string;

  @IsOptional()
  @IsIn(PAYOUT_SOURCES)
  source?: PayoutSource;
}
