-- Migration: 20260818120100_consultant_subcategories_self_serve.sql
-- Date: August 18, 2026
-- Description:
--   Lets a verified consultant place themselves in the curated marketplace
--   taxonomy, capped at 5 sub-categories.
--
--   20260818110000 shipped `consultant_subcategories` with public-read and NO
--   write policy at all, on the reasoning that membership is assigned
--   editorially during vetting. The measured consequence: 11 categories and 84
--   sub-categories are seeded, and `consultant_subcategories` holds ZERO rows,
--   so every /marketplace/category/* landing page renders empty. There is no
--   admin surface to assign placements either. This opens the path the earlier
--   migration deferred, in the exact shape it specified.
--
--   The cap is a trigger, not a CHECK, because a CHECK cannot count sibling
--   rows. (The comparable cap in 20260818100000 could be a CHECK only because
--   team tags are an ARRAY on one row, where cardinality() is immutable.)
--
--   Why cap at all: the taxonomy is a discovery surface. A consultant listed in
--   twenty sub-categories is listed in none of them meaningfully, and the
--   category pages stop being a signal. Five is enough to describe a real
--   practice and few enough that the ranking on each page still means something.
--
--   Capability, not role: every path here is gated on
--   public.is_active_consultant(), so a suspended consultant can neither add nor
--   change placements, and their existing rows stop being publicly readable via
--   the policy already in 20260818110000.

-- ---------------------------------------------------------------------------
-- Cap trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_consultant_subcategories_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.consultant_subcategories
  WHERE user_id = NEW.user_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'CONSULTANT_SUBCATEGORY_LIMIT'
      USING HINT = 'A consultant may appear in at most 5 sub-categories.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_consultant_subcategories_cap()
  FROM PUBLIC, anon, authenticated;

-- INSERT only. An UPDATE cannot increase the row count, and firing on UPDATE
-- would make re-ordering (`position`) fail for a consultant already at the cap.
CREATE TRIGGER consultant_subcategories_cap
  BEFORE INSERT ON public.consultant_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultant_subcategories_cap();

-- ---------------------------------------------------------------------------
-- Owner write policy
-- ---------------------------------------------------------------------------

-- Verbatim the policy drafted in 20260818110000's trailing comment.
CREATE POLICY consultant_subcategories_owner_write
  ON public.consultant_subcategories FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND public.is_active_consultant(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_active_consultant(auth.uid()));

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.tg_consultant_subcategories_cap() IS
  'Caps a consultant at 5 taxonomy placements. A trigger rather than a CHECK because a CHECK cannot count sibling rows. INSERT-only: UPDATE cannot raise the count, and firing on UPDATE would break re-ordering at the cap.';
