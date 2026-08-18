import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MARKETPLACE_SLUG_PATTERN } from '../../taxonomy/dto/taxonomy.dto';

export class ConsultantDirectoryQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  @Matches(MARKETPLACE_SLUG_PATTERN)
  category?: string;

  /**
   * Only meaningful alongside `category`: sub-category slugs are unique per
   * category, not globally, so one on its own cannot be resolved.
   */
  @IsString()
  @IsOptional()
  @MaxLength(80)
  @Matches(MARKETPLACE_SLUG_PATTERN)
  subcategory?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  @IsOptional()
  limit = 24;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset = 0;
}
