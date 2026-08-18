import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MARKETPLACE_SLUG_PATTERN } from '../../taxonomy/dto/taxonomy.dto';
import {
  MAX_SURVEY_CATEGORIES,
  SURVEY_COMPANY_SIZES,
  SURVEY_INTENTS,
  SURVEY_SAVEABLE_STATUSES,
  SURVEY_TALENT_GOALS,
} from '../survey.types';

/**
 * Mirrors the CHECK constraints in 20260819100000 exactly. The database is the
 * authority; failing here gives a 400 naming the field instead of a 500
 * carrying a constraint name.
 *
 * `status` deliberately omits `skipped` — that transition is terminal and is
 * reached only through `POST /marketplace/survey/skip`.
 *
 * `@ArrayMaxSize(MAX_SURVEY_CATEGORIES)` is the friendly gate; the real backstop
 * is the `marketplace_survey_categories_cap` trigger, which also covers anything
 * reaching PostgREST directly.
 */
export class SaveMarketplaceSurveyDto {
  @IsArray()
  @ArrayMaxSize(SURVEY_INTENTS.length)
  @IsIn(SURVEY_INTENTS, { each: true })
  intents: string[];

  @IsArray()
  @ArrayMaxSize(MAX_SURVEY_CATEGORIES)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @Matches(MARKETPLACE_SLUG_PATTERN, { each: true })
  @IsOptional()
  category_slugs?: string[];

  @IsIn(SURVEY_TALENT_GOALS)
  @IsOptional()
  talent_goal?: string;

  @IsIn(SURVEY_COMPANY_SIZES)
  @IsOptional()
  company_size?: string;

  @IsIn(SURVEY_SAVEABLE_STATUSES)
  @IsOptional()
  status?: string;
}
