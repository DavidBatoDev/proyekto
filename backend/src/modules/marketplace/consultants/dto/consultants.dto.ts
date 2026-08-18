import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MARKETPLACE_SLUG_PATTERN } from '../../taxonomy/dto/taxonomy.dto';

/**
 * Query strings carry booleans as text, and an absent flag must stay absent
 * rather than becoming `false` - the directory treats "unset" as "do not
 * filter", and a coerced `false` would silently mean "only consultants without
 * an hourly rate".
 */
const toOptionalBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

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

  /**
   * Only meaningful alongside `category` AND `subcategory`: topic slugs are
   * unique per speciality, not globally, so one on its own cannot be resolved.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;

  /** Free text, matched against display name and headline. */
  @IsString()
  @IsOptional()
  @MaxLength(80)
  q?: string;

  /**
   * Matched against `profiles.country` as it is stored. The facets endpoint
   * publishes the values that actually exist, so the filter rail can only ever
   * offer a country somebody is in.
   */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  country?: string;

  /** An ISO language code from `languages.code`. */
  @IsString()
  @IsOptional()
  @MaxLength(12)
  @Matches(/^[A-Za-z-]+$/)
  language?: string;

  /** Cheapest published service, in the service's own currency. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  @IsOptional()
  budgetMin?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  @IsOptional()
  budgetMax?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  @IsOptional()
  hourlyMin?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  @IsOptional()
  hourlyMax?: number;

  /** Has an hourly rate on their rate card at all. */
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  offersHourly?: boolean;

  /** Rate card says `available` rather than busy or unavailable. */
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  availableNow?: boolean;

  /** Has at least one published catalog entry. */
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  hasServices?: boolean;

  /** Delivers a published service within this many days. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  deliveryDays?: number;

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
