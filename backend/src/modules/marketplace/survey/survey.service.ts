import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyRepository,
} from '../taxonomy/repositories/taxonomy.repository.interface';
import type { SaveMarketplaceSurveyDto } from './dto/survey.dto';
import {
  SURVEY_REPOSITORY,
  type SurveyRepository,
} from './repositories/survey.repository.interface';
import type {
  MarketplaceSurvey,
  SurveyCompanySize,
  SurveyIntent,
  SurveySaveableStatus,
  SurveyTalentGoal,
} from './survey.types';

/**
 * The marketplace intake survey.
 *
 * Personalization only. Nothing here is consulted to decide what a user may do
 * — see `survey.types.ts` and the table COMMENT in 20260819100000.
 */
@Injectable()
export class SurveyService {
  constructor(
    @Inject(SURVEY_REPOSITORY) private readonly repo: SurveyRepository,
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepository,
  ) {}

  /** Null means "never asked", which is what makes the modal open. */
  async findMine(userId: string): Promise<MarketplaceSurvey | null> {
    const survey = await this.repo.findByUser(userId);
    if (!survey) return null;
    return { ...survey, categories: await this.repo.findCategories(userId) };
  }

  async save(
    userId: string,
    dto: SaveMarketplaceSurveyDto,
  ): Promise<MarketplaceSurvey> {
    // De-duped here rather than by a constraint: true de-duplication needs a
    // subquery, which a CHECK cannot have, so the cardinality CHECK in the
    // migration is only a bound. Same approach as replaceMyPlacements.
    const intents = Array.from(new Set(dto.intents)) as SurveyIntent[];
    const slugs = Array.from(new Set(dto.category_slugs ?? []));
    const status = (dto.status ?? 'in_progress') as SurveySaveableStatus;

    if (status === 'completed' && intents.length === 0) {
      throw new BadRequestException(
        'Choose at least one option before finishing the survey.',
      );
    }

    // Resolve before writing anything, so a typo'd slug cannot leave the
    // response row saved and the categories half-applied.
    const categoryIds = await this.resolveCategoryIds(slugs);

    const survey = await this.repo.upsert(userId, {
      status,
      intents,
      talent_goal: (dto.talent_goal ?? null) as SurveyTalentGoal | null,
      company_size: (dto.company_size ?? null) as SurveyCompanySize | null,
      // Moves in lockstep with `status`, which the
      // marketplace_survey_completed_at_matches_status CHECK requires.
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    });

    const categories = await this.repo.replaceCategories(userId, categoryIds);
    return { ...survey, categories };
  }

  /**
   * Terminal: the modal is never offered again. Idempotent, because the client
   * fires this on dismissal and a retry must not become an error.
   */
  async skip(userId: string): Promise<MarketplaceSurvey> {
    const survey = await this.repo.markSkipped(userId);
    return { ...survey, categories: await this.repo.findCategories(userId) };
  }

  /**
   * Slugs in, ids out, order preserved — the stored `position` is the order the
   * user picked them in, and the first one is what the storefront leads with.
   */
  private async resolveCategoryIds(slugs: string[]): Promise<string[]> {
    if (slugs.length === 0) return [];

    const bySlug = await this.taxonomy.findCategoryIdsBySlugs(slugs);
    const unknown = slugs.filter((slug) => !bySlug.has(slug));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown category: ${unknown.join(', ')}`);
    }
    return slugs.map((slug) => bySlug.get(slug) as string);
  }
}
