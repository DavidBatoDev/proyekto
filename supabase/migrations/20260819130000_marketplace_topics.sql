-- Migration: 20260819130000_marketplace_topics.sql
-- Date: August 19, 2026
-- Description:
--   Adds the third taxonomy level: category -> sub-category -> TOPIC.
--
--   Why a third level exists at all. A category page can only show something
--   category-specific if there is a level between the category and the
--   consultant list. With two levels the only thing a category page could tile
--   was the whole taxonomy, which is why every category rendered an identical
--   grid. Topics give each sub-category tile a list of its own.
--
--   Naming: "topic", not "service". `consultant_services` is already a
--   per-consultant priced catalogue and shares no shape with a taxonomy node.
--   The UI calls level 2 a "speciality"; level 3 is a "topic" under it.
--
--   Shapes, CHECK constraints, index style and RLS are copied from
--   20260818110000_marketplace_taxonomy.sql rather than reinvented, so the
--   three levels stay one family.

-- ---------------------------------------------------------------------------
-- 1. The taxonomy level
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketplace_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcategory_id uuid NOT NULL
    REFERENCES public.marketplace_subcategories(id) ON DELETE RESTRICT,
  slug text NOT NULL
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR length(trim(description)) BETWEEN 2 AND 400),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Per parent, not global: the URL carries all three segments, so two
  -- specialities may each own an `evaluation`.
  UNIQUE (subcategory_id, slug),
  UNIQUE (subcategory_id, name)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_topics_subcategory_position
  ON public.marketplace_topics(subcategory_id, position, name) WHERE is_active;

DROP TRIGGER IF EXISTS marketplace_topics_updated_at ON public.marketplace_topics;
CREATE TRIGGER marketplace_topics_updated_at
  BEFORE UPDATE ON public.marketplace_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. Consultant placement at topic level
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consultant_topics (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL
    REFERENCES public.marketplace_topics(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

-- Mirrors idx_consultant_subcategories_subcategory: the leaf page asks "who is
-- in this topic", which is the opposite direction to the primary key.
CREATE INDEX IF NOT EXISTS idx_consultant_topics_topic
  ON public.consultant_topics(topic_id, user_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.marketplace_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_topics ENABLE ROW LEVEL SECURITY;

-- The whole chain must be active, extending the EXISTS test
-- marketplace_subcategories_public_read already performs on its parent. A topic
-- under a retired speciality disappears without its own row being touched,
-- which is what made the category retirements cascade correctly.
DROP POLICY IF EXISTS marketplace_topics_public_read ON public.marketplace_topics;
CREATE POLICY marketplace_topics_public_read
  ON public.marketplace_topics FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.marketplace_subcategories s
      JOIN public.marketplace_categories c ON c.id = s.category_id
      WHERE s.id = subcategory_id
        AND s.is_active = true
        AND c.is_active = true
    )
  );

-- No write policy: the taxonomy is editorial, service_role only, exactly like
-- the two levels above it.

DROP POLICY IF EXISTS consultant_topics_public_read ON public.consultant_topics;
CREATE POLICY consultant_topics_public_read
  ON public.consultant_topics FOR SELECT
  TO anon, authenticated
  USING (public.is_active_consultant(user_id));

DROP POLICY IF EXISTS consultant_topics_owner_write ON public.consultant_topics;
CREATE POLICY consultant_topics_owner_write
  ON public.consultant_topics FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND public.is_active_consultant(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_active_consultant(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Cap
-- ---------------------------------------------------------------------------
--
-- Copied from tg_consultant_subcategories_cap AS AMENDED by 20260818120200 --
-- the original body had no advisory lock, and two concurrent inserts at the cap
-- would both read under the limit and both succeed. Taking the newest body is
-- the rule; copying the first one would reintroduce the race.
--
-- 15 = three topics per speciality at the existing five-speciality cap.
-- BEFORE INSERT only: an UPDATE cannot increase the row count, and firing on
-- UPDATE would make re-ordering fail for a consultant already at the cap.

CREATE OR REPLACE FUNCTION public.tg_consultant_topics_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 1));

  SELECT count(*) INTO v_count
  FROM public.consultant_topics
  WHERE user_id = NEW.user_id;

  IF v_count >= 15 THEN
    RAISE EXCEPTION 'CONSULTANT_TOPIC_LIMIT'
      USING HINT = 'A consultant may appear in at most 15 topics.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_consultant_topics_cap()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS consultant_topics_cap ON public.consultant_topics;
CREATE TRIGGER consultant_topics_cap
  BEFORE INSERT ON public.consultant_topics
  FOR EACH ROW EXECUTE FUNCTION public.tg_consultant_topics_cap();
