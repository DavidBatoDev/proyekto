import {
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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const PRICE_UNITS = ['project', 'hour', 'month'] as const;
const STATUSES = ['draft', 'published', 'archived'] as const;

/**
 * Mirrors the CHECK constraints in 20260818120000 exactly. The DB is the
 * authority, but failing here gives a 400 with a field name instead of a 500
 * carrying a constraint name.
 *
 * `status` is deliberately absent from create: a service is always born a
 * draft, and publishing is a separate deliberate act.
 */
export class CreateConsultantServiceDto {
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
 * Deliberately standalone rather than `extends CreateConsultantServiceDto`.
 * Every field is optional on a PATCH, and narrowing an inherited required
 * property to optional is not something TypeScript allows — the workaround
 * (`declare title: string`) leaves the type saying "required" while the
 * validator says "optional", which is exactly the kind of disagreement that
 * gets discovered at runtime.
 */
export class UpdateConsultantServiceDto {
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

  @IsIn(STATUSES)
  @IsOptional()
  status?: (typeof STATUSES)[number];
}

class ReorderItemDto {
  @IsUUID()
  id: string;

  @IsInt()
  @Min(0)
  position: number;
}

export class ReorderConsultantServicesDto {
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
