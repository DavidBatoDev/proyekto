-- Migration: 20260819100000_marketplace_intake_survey.sql
-- Date: August 19, 2026
-- Description:
--   A short intake survey shown the first time a signed-in user reaches a
--   marketplace browse surface, so the storefront can lead with something other
--   than the same four consultants for everyone.
--
--   Everything this product stores about a person today is SUPPLY-side -- what
--   they sell: user_skills, user_specializations, user_rate_settings (including
--   min_project_budget), consultant_subcategories, consultant_services. There is
--   no stored DEMAND-side signal anywhere. That is the gap these two tables fill.
--
--   INTENT IS NOT A ROLE. profiles.role was dropped on 2026-08-10
--   (20260810160000). Consultant capability is consultant_profiles.status =
--   'verified' via public.is_active_consultant(); freelancer discoverability is
--   freelancer_profiles.status = 'active'; client and consultant are contract
--   positions, not user types. `intents` below is a stated preference that
--   changes ordering, copy and defaults on the storefront, and nothing else.
--
--   This is not a hypothetical concern. profiles.settings->'onboarding'->'intent'
--   once held exactly this shape -- {"freelancer": bool, "client": bool}, added
--   in 20260503000010 -- and was deliberately retired when account roles were
--   removed (20260809164000, 20260810160000). It is being re-introduced here for
--   personalization only, in its own table, where it cannot be mistaken for the
--   account's identity. scripts/check_survey_is_not_authz.mjs enforces that no
--   policy, guard or route loader ever reads it.
--
--   Why tables rather than another profiles.settings key: the categories answer
--   wants a foreign key. Storing category_id instead of a slug means a retired
--   or renamed category can never rot a stored answer, and it makes the reverse
--   question -- "how many people want AI & Data" -- an indexed query, which is
--   what lets the taxonomy be edited with evidence instead of instinct.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.marketplace_survey_responses (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'skipped')),

  -- Stated interest. See the header: never a capability, never a role.
  intents text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (intents <@ ARRAY['client', 'consultant', 'talent']::text[]),

  talent_goal text
    CHECK (talent_goal IS NULL
           OR talent_goal IN ('find_work', 'build_profile', 'get_verified')),

  company_size text
    CHECK (company_size IS NULL
           OR company_size IN ('solo', '2_10', '11_50', '51_plus')),

  -- Room for later questions without a migration per question. Answers that
  -- earn a consumer graduate to a real column.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- There are only three legal values, so this is really a "no duplicates
  -- smuggled in" bound: true de-duplication needs a subquery, which a CHECK
  -- cannot have, so the API de-dupes with Array.from(new Set(...)) the way
  -- replaceMyPlacements already does.
  CONSTRAINT marketplace_survey_intents_cardinality
    CHECK (coalesce(array_length(intents, 1), 0) <= 3),

  -- A completed survey answered the one required question.
  CONSTRAINT marketplace_survey_completed_needs_intent
    CHECK (status <> 'completed' OR coalesce(array_length(intents, 1), 0) > 0),

  -- completed_at exists if and only if the survey is completed, so "when did
  -- they finish" never has to be reconstructed from status plus a guess.
  CONSTRAINT marketplace_survey_completed_at_matches_status
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

-- The categories answer. A junction rather than a jsonb array of slugs: the
-- forward read is trivial either way, but the FK is what keeps a stored answer
-- correct across a category rename, and the reverse read is what makes the
-- taxonomy editable with evidence.
--
-- ON DELETE CASCADE, unlike marketplace_subcategories.category_id which is
-- RESTRICT. Retiring a category should quietly drop out of people's stated
-- interests, not block the edit.
CREATE TABLE public.marketplace_survey_categories (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL
    REFERENCES public.marketplace_categories(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The primary key already covers the owner-leading direction ("my categories",
-- read on every marketplace page load). This covers the reverse -- demand per
-- category -- which is the whole argument for the junction table.
CREATE INDEX idx_marketplace_survey_categories_category
  ON public.marketplace_survey_categories(category_id, user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER marketplace_survey_responses_updated_at
  BEFORE UPDATE ON public.marketplace_survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Category cap
-- ---------------------------------------------------------------------------

-- Three, not five. This is a "what are you interested in" answer that steers a
-- storefront; someone interested in everything is interested in nothing, and
-- the first pick is the one the hero and the consultant strip actually use.
--
-- A trigger rather than a CHECK because a CHECK cannot count sibling rows --
-- the same reason tg_consultant_subcategories_cap exists. The advisory lock is
-- copied deliberately from 20260818120200, which added it to fix the
-- read-then-insert race the first version of that trigger shipped with: two
-- concurrent inserts at two rows would both read two and both succeed.
CREATE OR REPLACE FUNCTION public.tg_marketplace_survey_categories_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialise per user so the count below cannot be read stale by a concurrent
  -- insert. Transaction-scoped: released at commit or rollback, no cleanup.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

  SELECT count(*) INTO v_count
  FROM public.marketplace_survey_categories
  WHERE user_id = NEW.user_id;

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'MARKETPLACE_SURVEY_CATEGORY_LIMIT'
      USING HINT = 'The intake survey accepts at most 3 categories of interest.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_marketplace_survey_categories_cap()
  FROM PUBLIC, anon, authenticated;

-- INSERT only. An UPDATE cannot raise the row count, and firing on UPDATE would
-- make re-ordering (`position`) fail for someone already at the cap.
CREATE TRIGGER marketplace_survey_categories_cap
  BEFORE INSERT ON public.marketplace_survey_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_marketplace_survey_categories_cap();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.marketplace_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_survey_categories ENABLE ROW LEVEL SECURITY;

-- Owner-only, and no `anon` policy at all. Unlike consultant_services and
-- consultant_subcategories, nothing here is a public listing -- it is what one
-- person told us about themselves. service_role bypasses RLS, which is how the
-- backend and any future analytics read it.
--
-- Deliberately NOT gated on public.is_active_consultant(): everyone takes this
-- survey, and gating a personalization row on a capability would be the first
-- step back towards a role.
CREATE POLICY marketplace_survey_responses_owner_all
  ON public.marketplace_survey_responses FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY marketplace_survey_categories_owner_all
  ON public.marketplace_survey_categories FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.marketplace_survey_responses IS
  'One row per user: what they said they came to the marketplace to do. Personalization only -- it orders and re-labels storefront sections. Read by nothing that decides access.';

COMMENT ON COLUMN public.marketplace_survey_responses.intents IS
  'Stated interest, NOT a capability and NOT a role. Must never be read by an RLS policy, a NestJS guard, or a route beforeLoad. Capability is consultant_profiles.status = ''verified'' via public.is_active_consultant(); discoverability is freelancer_profiles.status = ''active''; client and consultant are contract positions. profiles.settings->''onboarding''->''intent'' held this same shape and was deleted alongside profiles.role in August 2026 -- this column exists to steer a storefront, and reintroducing it as an identity would undo that removal.';

COMMENT ON COLUMN public.marketplace_survey_responses.company_size IS
  'Segmentation only. Nothing renders or filters on it today; it is stored so the question is worth having asked once there is something to compare against.';

COMMENT ON COLUMN public.marketplace_survey_responses.status IS
  'in_progress = opened, not finished. completed = answered. skipped = dismissed, and terminal: the modal is never offered again. There is no retake surface yet.';

COMMENT ON TABLE public.marketplace_survey_categories IS
  'Categories of interest from the intake survey, capped at 3 by trigger. Demand-side, and the mirror image of consultant_subcategories: that table says what a consultant sells, this says what someone came looking for. Keyed on category_id so a slug rename cannot rot a stored answer.';

COMMENT ON FUNCTION public.tg_marketplace_survey_categories_cap() IS
  'Caps a user at 3 survey categories. A trigger rather than a CHECK because a CHECK cannot count sibling rows. INSERT-only: UPDATE cannot raise the count, and firing on UPDATE would break re-ordering at the cap. Takes a per-user advisory lock so the count cannot be read stale -- the fix 20260818120200 had to retrofit onto tg_consultant_subcategories_cap.';
