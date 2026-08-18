import type {
  MarketplaceSurvey,
  SurveyCategory,
  SurveyCompanySize,
  SurveyIntent,
  SurveyStatus,
  SurveyTalentGoal,
} from '../survey.types';

export const SURVEY_REPOSITORY = Symbol('SURVEY_REPOSITORY');

/**
 * The columns a write may set. Everything is required so a caller cannot half-
 * update a row by omission: the survey is always submitted whole, and
 * `completed_at` in particular has to move in lockstep with `status` or the
 * `marketplace_survey_completed_at_matches_status` CHECK rejects the row.
 */
export interface UpsertSurveyInput {
  status: SurveyStatus;
  intents: SurveyIntent[];
  talent_goal: SurveyTalentGoal | null;
  company_size: SurveyCompanySize | null;
  completed_at: string | null;
}

export interface SurveyRepository {
  /** The caller's answers, or null when they have never been asked. */
  findByUser(userId: string): Promise<MarketplaceSurvey | null>;

  upsert(userId: string, input: UpsertSurveyInput): Promise<MarketplaceSurvey>;

  /**
   * Marks the survey dismissed without touching the answers already given.
   * Separate from `upsert` because it must survive being called on a row in any
   * state, including a completed one — where it also has to clear
   * `completed_at`, or the status/timestamp CHECK fails.
   */
  markSkipped(userId: string): Promise<MarketplaceSurvey>;

  findCategories(userId: string): Promise<SurveyCategory[]>;

  /**
   * Full replace, delete-then-insert. The set is at most 3 and the modal
   * submits the whole intended set, so a diff would buy nothing — and clearing
   * first is what lets somebody swap all three at once without transiently
   * tripping the cap trigger, which counts existing rows.
   */
  replaceCategories(
    userId: string,
    categoryIds: string[],
  ): Promise<SurveyCategory[]>;
}
