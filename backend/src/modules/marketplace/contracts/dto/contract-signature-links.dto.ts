import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A base64 PNG data URL is a big string. 700 KB of base64 decodes to ~525 KB —
 * comfortably above any real drawn signature, comfortably below the bucket's
 * 5 MB ceiling, and small enough that a hostile payload cannot use the public
 * endpoint as a memory amplifier before validation runs.
 */
const MAX_SIGNATURE_BASE64_LENGTH = 700_000;

export class CreateSignatureLinkDto {
  /** Where to email the link. Defaults to the contract's client email. */
  @IsOptional() @IsEmail() @MaxLength(320) recipient_email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expires_in_days?: number;

  /** When true the link is emailed as well as returned. */
  @IsOptional() @IsBoolean() send_email?: boolean;
}

/**
 * Signing from a public link. There is no session, so the signer identifies
 * themselves by typing their name — the same act that is legally operative in
 * the in-app flow.
 */
export class PublicSignContractDto {
  @IsString() @MaxLength(200) signer_name!: string;

  /** Optional drawn signature, as a `data:image/png;base64,...` URL. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SIGNATURE_BASE64_LENGTH)
  signature_png?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(3)
  signature_scale?: number;

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
