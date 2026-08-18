-- Migration: 20260818120000_consultant_services.sql
-- Date: August 18, 2026
-- Description:
--   A consultant-owned catalog of priced service offerings. This is the thing a
--   consultant fills in to say "here is what I do and what it starts at", and it
--   is what the public profile grid and the "From $X/project" line on the
--   directory card render.
--
--   Why a table at all, when `contracts.services` already exists: that column
--   (20260724110010) is a jsonb array on ONE contract. It is owned by nobody,
--   reusable nowhere, and copied afresh into every new contract version. It is
--   the right shape for a legal record -- frozen at signature, never mutating
--   under a signed agreement -- and the wrong shape for a catalog.
--
--   The two are deliberately connected by COPY, not by reference. Picking a
--   catalog entry on the Contract tab appends a snapshot into
--   `contracts.services`; editing the catalog entry afterwards must never
--   retroactively alter what somebody signed. `contracts.services` remains the
--   legal record; this table is the consultant's own menu.
--
--   Classification hangs off `marketplace_subcategories` (20260818110000), which
--   classifies consultant DISCIPLINES. Not `roadmap_template_categories` (which
--   classifies roadmap subjects) and not `user_specializations` (freelancer
--   free-text). See docs/04-web/routing-and-access.md -- three taxonomies, three
--   axes, deliberately not unified.
--
--   Capability is `consultant_profiles.status = 'verified'` via
--   public.is_active_consultant(), never a declared role. Nothing here
--   introduces a role.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.consultant_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Nullable and ON DELETE SET NULL: retiring a sub-category from the curated
  -- taxonomy must not delete a consultant's service or block the edit.
  subcategory_id uuid REFERENCES public.marketplace_subcategories(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  description text CHECK (description IS NULL OR length(trim(description)) BETWEEN 10 AND 2000),
  cover_url text,
  starting_price numeric(12,2) CHECK (starting_price IS NULL OR starting_price >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  price_unit text NOT NULL DEFAULT 'project'
    CHECK (price_unit IN ('project', 'hour', 'month')),
  delivery_days integer CHECK (delivery_days IS NULL OR delivery_days BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A published service must be priced. The public card renders "From $X" and a
  -- published-but-unpriced row would render that label with a hole in it. Drafts
  -- may be unpriced: that is the state you are in while still writing it.
  CONSTRAINT consultant_services_published_needs_price
    CHECK (status <> 'published' OR starting_price IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The owner's console list, in their chosen order.
CREATE INDEX idx_consultant_services_owner_position
  ON public.consultant_services(user_id, position, created_at);

-- The public surfaces: a sub-category's services, and the MIN(starting_price)
-- that becomes "From $X" on a directory card. Partial, because unpublished rows
-- are never read by either.
CREATE INDEX idx_consultant_services_published_subcategory
  ON public.consultant_services(subcategory_id, starting_price)
  WHERE status = 'published';

CREATE INDEX idx_consultant_services_published_owner
  ON public.consultant_services(user_id, position)
  WHERE status = 'published';

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER consultant_services_updated_at
  BEFORE UPDATE ON public.consultant_services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.consultant_services ENABLE ROW LEVEL SECURITY;

-- Published rows are world-readable, but only while the author is genuinely a
-- verified consultant -- the same shape as consultant_subcategories_public_read.
-- The consequence that matters: suspending a consultant takes their whole
-- catalog off the public site without a single row being touched, and
-- reinstating them puts it back.
CREATE POLICY consultant_services_public_read
  ON public.consultant_services FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND public.is_active_consultant(user_id));

-- Owners manage their own catalog, and only while verified. Unlike the taxonomy
-- tables, this one DOES get a user-facing write path: a service is the
-- consultant's own words about their own work, not an editorial placement.
CREATE POLICY consultant_services_owner_all
  ON public.consultant_services FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND public.is_active_consultant(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_active_consultant(auth.uid()));

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.consultant_services IS
  'A consultant''s own catalog of priced service offerings. A catalog entry, NOT an order, a commitment, or a legal record: picking one on the Contract tab copies a snapshot into contracts.services, which stays the agreement of record. Editing an entry here never alters a signed contract.';

COMMENT ON COLUMN public.consultant_services.subcategory_id IS
  'Optional placement in the curated consultant-discipline taxonomy (marketplace_subcategories). Nullable so a service can exist before it is classified, and SET NULL on delete so retiring a sub-category cannot destroy a consultant''s catalog.';

COMMENT ON COLUMN public.consultant_services.starting_price IS
  'The "from" price, in `currency` per `price_unit`. A floor for display and contract seeding, not a quote: the actual figure is negotiated on the contract.';

COMMENT ON COLUMN public.consultant_services.status IS
  'draft (private, may be unpriced) | published (public, must be priced) | archived (retired, kept so historical contract copies remain explicable).';
