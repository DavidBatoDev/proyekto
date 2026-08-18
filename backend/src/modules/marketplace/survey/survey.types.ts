/**
 * The marketplace intake survey: what someone said they came here to do.
 *
 * `intents` is a stated preference and nothing else. It is not a capability and
 * not a role — see the COMMENT on `marketplace_survey_responses.intents`
 * (20260819100000) and `scripts/check_survey_is_not_authz.mjs`, which fails the
 * build if any guard, policy or route loader starts reading it. Consultant
 * capability remains `consultant_profiles.status = 'verified'` via
 * `public.is_active_consultant()`.
 */
export const SURVEY_INTENTS = ['client', 'consultant', 'talent'] as const;
export type SurveyIntent = (typeof SURVEY_INTENTS)[number];

/**
 * `skipped` is terminal and is reached only through `POST /skip`, never through
 * the save route — there is no retake surface, so a status that means "never
 * ask again" should have exactly one way in.
 */
export const SURVEY_STATUSES = ['in_progress', 'completed', 'skipped'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

/** The subset a save request may set. See above for why `skipped` is missing. */
export const SURVEY_SAVEABLE_STATUSES = ['in_progress', 'completed'] as const;
export type SurveySaveableStatus = (typeof SURVEY_SAVEABLE_STATUSES)[number];

export const SURVEY_TALENT_GOALS = [
  'find_work',
  'build_profile',
  'get_verified',
] as const;
export type SurveyTalentGoal = (typeof SURVEY_TALENT_GOALS)[number];

export const SURVEY_COMPANY_SIZES = [
  'solo',
  '2_10',
  '11_50',
  '51_plus',
] as const;
export type SurveyCompanySize = (typeof SURVEY_COMPANY_SIZES)[number];

/** Mirrors the `marketplace_survey_categories_cap` trigger (20260819100000). */
export const MAX_SURVEY_CATEGORIES = 3;

/** A chosen category, flattened to what a chip needs. */
export interface SurveyCategory {
  slug: string;
  name: string;
}

/** The stored row, as the API returns it. */
export interface MarketplaceSurvey {
  status: SurveyStatus;
  intents: SurveyIntent[];
  categories: SurveyCategory[];
  talent_goal: SurveyTalentGoal | null;
  company_size: SurveyCompanySize | null;
  completed_at: string | null;
  updated_at: string;
}
