-- Migration: 20260818110000_marketplace_taxonomy.sql
-- Date: August 18, 2026
-- Description:
--   A curated, editorial taxonomy for marketplace discovery: top-level
--   categories, their sub-categories, and the join that places a consultant in
--   a sub-category. It backs the hover mega-menu on the marketplace category
--   bar and the /marketplace/category/* landing pages.
--
--   Independent of `roadmap_template_categories` (20260714100000) on purpose.
--   Those 20 rows classify TEMPLATES; these classify CONSULTANTS. They will
--   drift, and forcing one table to serve both would make every future edit a
--   negotiation between two products. The seed list is *informed* by those 20
--   rows, not derived from them.
--
--   `user_specializations` is deliberately untouched. It holds self-declared
--   free-text specialization powering the FREELANCER directory facets (read by
--   backend/src/modules/marketplace/marketplace/marketplace.service.ts) and is
--   a different thing from a curated FK taxonomy. No backfill: both tables
--   hold 0 rows and the shapes do not correspond. Converging the freelancer
--   facet onto this taxonomy is a separate, later decision.
--
--   Consultant capability is `consultant_profiles.status = 'verified'` via
--   public.is_active_consultant(), never a declared role. Nothing here
--   introduces a role.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.marketplace_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR length(trim(description)) BETWEEN 2 AND 400),
  -- lucide-react icon component name, rendered by the mega-menu.
  icon text CHECK (icon IS NULL OR icon ~ '^[A-Z][A-Za-z0-9]{1,40}$'),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sub-category slug is unique PER CATEGORY, not globally. The URL always
-- carries both segments (/marketplace/category/$categorySlug/$subcategorySlug),
-- so every lookup is (category.slug, subcategory.slug). Global uniqueness would
-- forbid `analytics` under both "AI & Data" and "Growth & Marketing", which a
-- real taxonomy wants. The cost is that a bare sub-category shortlink cannot be
-- resolved; that is accepted.
CREATE TABLE public.marketplace_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL
    REFERENCES public.marketplace_categories(id) ON DELETE RESTRICT,
  slug text NOT NULL
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR length(trim(description)) BETWEEN 2 AND 400),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, slug),
  UNIQUE (category_id, name)
);

-- Pure association data, so it cascades from both sides. No uniqueness
-- constraint on is_primary in v1: a partial unique index WHERE is_primary is
-- the right thing once a "primary specialty" surface exists on the profile
-- card, and there is no such surface yet.
CREATE TABLE public.consultant_subcategories (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subcategory_id uuid NOT NULL
    REFERENCES public.marketplace_subcategories(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subcategory_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_marketplace_categories_active_position
  ON public.marketplace_categories(position, name) WHERE is_active;

CREATE INDEX idx_marketplace_subcategories_category_position
  ON public.marketplace_subcategories(category_id, position, name) WHERE is_active;

-- The leaf-page query: sub-category -> the consultants in it. The primary key
-- (user_id, subcategory_id) already covers the user_id-leading direction (a
-- consultant's own list); this covers the reverse, which the landing pages hit
-- on every request.
CREATE INDEX idx_consultant_subcategories_subcategory
  ON public.consultant_subcategories(subcategory_id, user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER marketplace_categories_updated_at
  BEFORE UPDATE ON public.marketplace_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER marketplace_subcategories_updated_at
  BEFORE UPDATE ON public.marketplace_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.marketplace_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketplace_categories_public_read
  ON public.marketplace_categories FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY marketplace_subcategories_public_read
  ON public.marketplace_subcategories FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.marketplace_categories c
      WHERE c.id = category_id AND c.is_active = true
    )
  );

-- A membership row is public only while the user is genuinely a verified
-- consultant. is_active_consultant is SECURITY DEFINER STABLE, so this needs no
-- SELECT policy on consultant_profiles and cannot recurse. The consequence that
-- matters: suspending a consultant removes them from every category page
-- without a single membership row being touched.
CREATE POLICY consultant_subcategories_public_read
  ON public.consultant_subcategories FOR SELECT
  TO anon, authenticated
  USING (public.is_active_consultant(user_id));

-- No INSERT/UPDATE/DELETE policy on any of the three tables. With RLS enabled
-- and no policy, anon and authenticated are denied; service_role bypasses RLS,
-- which is how the backend and future admin tooling write. Membership is
-- assigned editorially during vetting, so there is no user-facing write surface
-- to secure or rate-limit yet.
--
-- Deferred: consultant self-service. When consultants pick their own
-- sub-categories, add in a NEW migration (never edit this one):
--   CREATE POLICY consultant_subcategories_owner_write
--     ON public.consultant_subcategories FOR ALL TO authenticated
--     USING (user_id = auth.uid() AND public.is_active_consultant(auth.uid()))
--     WITH CHECK (user_id = auth.uid() AND public.is_active_consultant(auth.uid()));
-- plus a BEFORE INSERT trigger capping rows per user (a CHECK cannot count
-- sibling rows -- the same reason teams_tags_count_check landed as a constraint
-- and per-tag length landed in the API, in 20260818100000).

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.marketplace_categories IS
  'Curated top-level marketplace taxonomy. Editorial: seeded and edited by migration or service_role only, never by end users. Drives the mega-menu and /marketplace/category/$slug.';

COMMENT ON TABLE public.marketplace_subcategories IS
  'Curated second level. Slug is unique per category, not globally, because the URL always carries both segments (/marketplace/category/$categorySlug/$subcategorySlug).';

COMMENT ON TABLE public.consultant_subcategories IS
  'Places a consultant in a curated sub-category. Membership is not capability: a row here says nothing about whether the user may consult - that is consultant_profiles.status = ''verified'' via public.is_active_consultant(). Public reads filter on that predicate, so a suspended consultant''s rows stop being visible without anything being deleted.';
