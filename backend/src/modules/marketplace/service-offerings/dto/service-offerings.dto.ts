import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const PRICE_UNITS = ['project', 'hour', 'month'] as const;
const SECTION_LAYOUTS = ['prose', 'columns'] as const;
const STATUSES = ['draft', 'published', 'archived'] as const;

/**
 * One titled block of the About area. Bodies are markdown, rendered on the
 * public page; 4000 is generous per section while the array cap keeps the
 * whole payload bounded (the column CHECK caps the array at 12 too).
 */
export class ServiceSectionColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label: string;

  @IsString()
  @MaxLength(1000)
  body: string;
}

export class ServiceDescriptionSectionDto {
  /**
   * Absent means 'prose' — sections written before layouts existed are
   * prose, and nothing has to rewrite them.
   */
  @IsIn(SECTION_LAYOUTS)
  @IsOptional()
  layout?: (typeof SECTION_LAYOUTS)[number];

  /** Optional: a columns section is often just the columns, unheaded. */
  @IsString()
  @IsOptional()
  @MaxLength(80)
  heading?: string;

  /**
   * Prose bodies only. 8000, not 4000: bodies now arrive as editor HTML, and
   * the tags roughly double the length of the same words — the old cap would
   * have rejected sections that were already saved as markdown.
   */
  @IsString()
  @IsOptional()
  @MaxLength(8000)
  body?: string;

  /** Columns layout only — at most three, matching the render. */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ServiceSectionColumnDto)
  columns?: ServiceSectionColumnDto[];
}

/**
 * Mirrors the CHECK constraints in 20260818120000 exactly. The DB is the
 * authority, but failing here gives a 400 with a field name instead of a 500
 * carrying a constraint name.
 *
 * `status` is deliberately absent from create: a service is always born a
 * draft, and publishing is a separate deliberate act.
 */
export class CreateServiceOfferingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  // 1000, not more: picking a service copies it verbatim into
  // `contracts.services`, whose ContractServiceDto caps description at 1000.
  // A wider source here would 400 exactly the longest entries.
  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(1000)
  description?: string;

  /** The About area. Full replace on write, like gallery_urls. */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ServiceDescriptionSectionDto)
  description_sections?: ServiceDescriptionSectionDto[];

  @IsUUID()
  @IsOptional()
  subcategory_id?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  cover_url?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  starting_price?: number;

  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsIn(PRICE_UNITS)
  @IsOptional()
  price_unit?: (typeof PRICE_UNITS)[number];

  @IsInt()
  @IsOptional()
  @Min(1)
  delivery_days?: number;
}

/**
 * Deliberately standalone rather than `extends CreateServiceOfferingDto`.
 * Every field is optional on a PATCH, and narrowing an inherited required
 * property to optional is not something TypeScript allows — the workaround
 * (`declare title: string`) leaves the type saying "required" while the
 * validator says "optional", which is exactly the kind of disagreement that
 * gets discovered at runtime.
 */
export class UpdateServiceOfferingDto {
  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(1000)
  description?: string;

  /** The About area. Full replace on write, like gallery_urls. */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ServiceDescriptionSectionDto)
  description_sections?: ServiceDescriptionSectionDto[];

  @IsUUID()
  @IsOptional()
  subcategory_id?: string;

  /**
   * `null` clears the cover. The whitelist pipe drops absent keys, so an
   * `undefined` here could never remove an image the seller deleted.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  cover_url?: string | null;

  @IsNumber()
  @IsOptional()
  @Min(0)
  starting_price?: number;

  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsIn(PRICE_UNITS)
  @IsOptional()
  price_unit?: (typeof PRICE_UNITS)[number];

  @IsInt()
  @IsOptional()
  @Min(1)
  delivery_days?: number;

  @IsIn(STATUSES)
  @IsOptional()
  status?: (typeof STATUSES)[number];

  /** Additional detail-page images, after cover_url. Full replace on update. */
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  gallery_urls?: string[];
}

/**
 * One seller-titled pricing tier. Deliberately no basic/standard/premium
 * enum — sellers name their own tiers and add as many as they need (server
 * cap below is an abuse guard, not a product rule). Position comes from
 * array order.
 */
export class OfferingPackageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(600)
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  delivery_days?: number;

  /** Omitted = unlimited revisions; 0 = none. */
  @IsInt()
  @IsOptional()
  @Min(0)
  revisions?: number;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  features?: string[];
}

/** Full replace, like reorder: the editor knows the whole intended set. */
export class ReplaceOfferingPackagesDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OfferingPackageDto)
  packages: OfferingPackageDto[];
}

class ReorderItemDto {
  @IsUUID()
  id: string;

  @IsInt()
  @Min(0)
  position: number;
}

export class ReorderServiceOfferingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

/**
 * Full replace, like `PUT /api/profile/skills`. Replace rather than
 * add/remove because the editor is a multi-select: the client already knows the
 * whole intended set, and a diffing API would invent an ordering problem.
 */
export class ReplaceConsultantSubcategoriesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  subcategory_ids: string[];
}
