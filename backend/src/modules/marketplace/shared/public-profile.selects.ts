/**
 * Column allowlists shared by the PUBLIC seller profiles — the consultant
 * detail (`/api/consultants/:id`) and the talent detail
 * (`/api/marketplace/talent/:id`). Both endpoints are `@Public()` and read
 * through SUPABASE_ADMIN, which bypasses RLS, so these named selects and the
 * `.eq()` filters beside them ARE the security boundary. A `select('*')`
 * anywhere downstream would publish whatever column somebody adds next.
 *
 * One definition for both pages so a column can never leak through one seller
 * surface but not the other.
 */

export const PUBLIC_SKILL_SELECT =
  'proficiency_level, years_experience, skill:skills!inner(name, slug, category)';

/**
 * `min_project_budget` and `weekly_hours` are deliberately absent. They are
 * negotiating positions, they appear on no public surface today, and
 * publishing them is a product decision rather than a plumbing one.
 */
export const PUBLIC_RATE_COLUMNS = 'hourly_rate, currency, availability';

export const PUBLIC_LANGUAGE_SELECT =
  'fluency_level, language:languages!inner(code, name)';

/**
 * Work history. `is_current` and the two dates are what let the profile print
 * "Feb 2019 - Present" and a duration without the browser guessing.
 */
export const PUBLIC_EXPERIENCE_COLUMNS =
  'id, company, title, location, is_remote, description, start_date, end_date, is_current';

export const PUBLIC_PORTFOLIO_COLUMNS =
  'id, title, description, url, image_url, tags, position';

/**
 * The talent counterpart of CONSULTANT_PUBLIC_COLUMNS: the inner join on an
 * ACTIVE talent enrollment is what makes the endpoint 404 for everyone who is
 * not currently listed — paused talent disappear from the public web rather
 * than lingering with a "paused" banner. Email, phone, DOB, gender and zip
 * are account data and never leave the authed profile endpoint.
 */
export const TALENT_PUBLIC_COLUMNS =
  'id, display_name, avatar_url, banner_url, headline, bio, country, city, created_at, talent_profile:talent_profiles!inner(status)';

/**
 * Self-declared focus areas (`user_specializations`), the talent analogue of
 * the consultant expertise taxonomy. `description` is user-authored public
 * copy — it renders on the profile, so it belongs here.
 */
export const PUBLIC_SPECIALIZATION_COLUMNS =
  'id, category, sub_category, years_of_experience, description';
