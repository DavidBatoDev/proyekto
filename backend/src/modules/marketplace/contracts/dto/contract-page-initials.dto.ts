import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const INITIALS_METHODS = ['typed', 'drawn'] as const;
export type InitialsMethod = (typeof INITIALS_METHODS)[number];

export const INITIALS_POSITIONS = ['hirer', 'provider'] as const;
export type InitialsPosition = (typeof INITIALS_POSITIONS)[number];

/**
 * One initialling act, applied across the pages the signer marked.
 *
 * The pages arrive as a list because "apply to all pages" is the normal case:
 * initialling a twelve-page agreement is one decision, and splitting it into
 * twelve requests would stamp twelve different timestamps on it.
 */
export class SaveContractInitialsDto {
  @IsIn(INITIALS_POSITIONS)
  position!: InitialsPosition;

  @IsIn(INITIALS_METHODS)
  method!: InitialsMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(199, { each: true })
  pages!: number[];

  /** The characters typed. Required for a typed mark, ignored for a drawn one. */
  @ValidateIf((dto: SaveContractInitialsDto) => dto.method === 'typed')
  @IsString()
  @MinLength(1)
  @MaxLength(8)
  initials_text?: string;

  /** Set by a signed-in signer, who uploaded the PNG themselves. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  image_url?: string;

  /**
   * Set by the account-free signing page, which has no session to upload with.
   * Capped on the ENCODED length; the service re-checks the decoded bytes.
   */
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  image_png?: string;
}
