import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Lower-case, hyphen-separated, no leading/trailing/doubled hyphens - the same
 * shape the database CHECK constraints enforce on
 * `marketplace_categories.slug` and `marketplace_subcategories.slug`.
 *
 * This regex is load-bearing rather than cosmetic: these values reach a Redis
 * cache key and a PostgREST filter, so rejecting `..`, `%2e%2e`, and uppercase
 * here keeps both of those from ever seeing an unexpected token.
 */
export const MARKETPLACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CategorySlugParamDto {
  @IsString()
  @MaxLength(80)
  @Matches(MARKETPLACE_SLUG_PATTERN)
  categorySlug: string;
}

export class SubcategorySlugParamDto extends CategorySlugParamDto {
  @IsString()
  @MaxLength(80)
  @Matches(MARKETPLACE_SLUG_PATTERN)
  subcategorySlug: string;
}

/**
 * Full replace of a consultant's taxonomy placements.
 *
 * `@ArrayMaxSize(5)` is the friendly gate; the real backstop is the
 * `consultant_subcategories_cap` trigger (20260818120100), which also covers
 * anything reaching PostgREST directly.
 */
export class TopicSlugParamDto extends SubcategorySlugParamDto {
  @IsString()
  @MaxLength(80)
  @Matches(MARKETPLACE_SLUG_PATTERN)
  topicSlug: string;
}

/**
 * Fifteen, matching the `consultant_topics` cap trigger. Declared here as well
 * as in the database because the pipe gives a field-level 400 naming the limit,
 * where the trigger raises CONSULTANT_TOPIC_LIMIT after a round trip.
 */
export class ReplaceConsultantTopicsDto {
  @IsArray()
  @ArrayMaxSize(15)
  @IsUUID('4', { each: true })
  topic_ids: string[];
}

export class ReplaceConsultantSubcategoriesDto {
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  subcategory_ids: string[];
}
