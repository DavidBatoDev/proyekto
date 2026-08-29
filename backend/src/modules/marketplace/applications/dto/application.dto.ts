import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApplicationPlacementDto {
  @IsUUID('4')
  subcategory_id: string;

  /** Bucket floor in years (0, 1, 3, 5, 10). Required by eligibility, not schema. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  years_experience?: number;
}

/**
 * Draft payload for the consultant application wizard.
 *
 * The legacy free-prose fields (cover_letter, why_join, primary_niche,
 * years_of_experience, website_url) are gone from the contract: the rebuilt
 * application collects structured evidence instead — taxonomy placements
 * with per-speciality years, verifiable links, a rate card, an identity
 * document. Their columns remain in the DB, unused; the global whitelist
 * ValidationPipe 400s any legacy payload still sending them, which is
 * correct because this API's only client is the wizard shipped alongside
 * this DTO.
 */
export class CreateApplicationDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  linkedin_url?: string;

  /** Marketplace speciality picks with years; replace-set semantics on every save. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ApplicationPlacementDto)
  placements?: ApplicationPlacementDto[];

  /** Must be one of placements' subcategory ids; enforced in the service. */
  @IsOptional()
  @IsUUID('4')
  primary_subcategory_id?: string;
}
