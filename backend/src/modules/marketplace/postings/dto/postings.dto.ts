import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';

const ENGAGEMENT_TYPES = ['ongoing', 'one_time'] as const;
/**
 * Mirrors the CHECK on `project_postings.duration`. The last two are retired
 * from the picker and kept only so rows written before
 * 20260829120000_project_posting_duration_options still validate on update.
 */
const DURATIONS = [
  '<1_week',
  '1-2_weeks',
  '2-4_weeks',
  '1-3_months',
  '3-6_months',
  '6-12_months',
  '12+_months',
  'ongoing',
  'unsure',
  'custom',
  '<1_month',
  '6+_months',
] as const;
const RATE_UNITS = ['project', 'hour', 'month'] as const;
const TRIAGE_STATUSES = ['shortlisted', 'declined'] as const;

/**
 * Mirrors the CHECK constraints in 20260826100000 exactly. The DB stays the
 * authority; failing here just turns a 500 carrying a constraint name into a
 * 400 carrying a field name.
 *
 * `status` is absent from create and update on purpose: a brief is born a
 * draft, and publishing is its own deliberate endpoint with its own
 * completeness rules.
 */
export class PostingSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  key: string;

  @IsString()
  @MaxLength(20000)
  value: string;

  @IsInt()
  @Min(0)
  position: number;
}

/**
 * What the board may be narrowed by: everything except `custom`.
 *
 * The filter is exact equality (`eq('duration', …)`), and every custom brief
 * carries the same sentinel with a different sentence behind it — so filtering
 * on it would gather work that has nothing in common but the fact that it did
 * not fit a bucket.
 */
const FILTERABLE_DURATIONS = DURATIONS.filter(
  (value): value is Exclude<(typeof DURATIONS)[number], 'custom'> =>
    value !== 'custom',
);

export class CreatePostingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsIn(ENGAGEMENT_TYPES)
  @IsOptional()
  engagement_type?: (typeof ENGAGEMENT_TYPES)[number];

  @IsString()
  @IsOptional()
  @MaxLength(20000)
  summary?: string;

  // 30 sections is far past any real brief; it exists so a scripted client
  // cannot grow one row without bound.
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PostingSectionDto)
  sections?: PostingSectionDto[];

  @IsUUID()
  @IsOptional()
  category_id?: string;

  @IsUUID()
  @IsOptional()
  subcategory_id?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  budget_min?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  budget_max?: number;

  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsIn(DURATIONS)
  @IsOptional()
  duration?: (typeof DURATIONS)[number];

  /**
   * The timeline in the author's own words, for work that is not one of the
   * buckets. Only meaningful beside `duration: 'custom'` — the service clears it
   * otherwise, and the database refuses the mismatched pair outright.
   */
  @IsString()
  @IsOptional()
  @MaxLength(80)
  duration_custom?: string | null;

  @IsUUID()
  @IsOptional()
  roadmap_id?: string;
}

export class UpdatePostingDto extends CreatePostingDto {
  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(200)
  declare title: string;
}

export class AddPostingAttachmentDto {
  @IsString()
  @MaxLength(2000)
  url: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  content_type?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  size?: number;
}

export class BoardQueryDto {
  @IsUUID()
  @IsOptional()
  category_id?: string;

  @IsUUID()
  @IsOptional()
  subcategory_id?: string;

  @IsIn(ENGAGEMENT_TYPES)
  @IsOptional()
  engagement_type?: (typeof ENGAGEMENT_TYPES)[number];

  @IsIn(FILTERABLE_DURATIONS)
  @IsOptional()
  duration?: (typeof FILTERABLE_DURATIONS)[number];

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0)
  budget_min?: number;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(0)
  offset?: number;
}

/**
 * The lightweight apply. A pitch and a ballpark — deliberately not a quote, a
 * scope or a schedule: the figure that binds anybody lives on a contract.
 */
export class SubmitProposalDto {
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  pitch: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  indicative_rate?: number;

  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(3)
  rate_currency?: string;

  @IsIn(RATE_UNITS)
  @IsOptional()
  rate_unit?: (typeof RATE_UNITS)[number];
}

/** The author's triage. Withdrawal is the consultant's word, never theirs. */
export class TriageProposalDto {
  @IsIn(TRIAGE_STATUSES)
  status: (typeof TRIAGE_STATUSES)[number];
}

/** The one box the generator reads. `category_hint` only steers vocabulary. */
export class GenerateBriefDto {
  @IsString()
  @MinLength(30)
  @MaxLength(5000)
  description: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  category_hint?: string;
}
