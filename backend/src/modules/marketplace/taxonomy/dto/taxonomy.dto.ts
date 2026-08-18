import { IsString, Matches, MaxLength } from 'class-validator';

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
