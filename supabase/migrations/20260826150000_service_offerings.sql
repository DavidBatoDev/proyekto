-- Service offerings: the seller-neutral generalisation of consultant_services.
--
-- Both verified consultants AND active talent sell productised services now,
-- so the consultant-branded name is wrong — and since no web client ever
-- shipped against the old module, this is the cheapest moment the rename
-- will ever have. Same table, new name, plus what the Fiverr-style surface
-- needs: a gallery and flexible tiered packages (seller-titled, ordered —
-- deliberately NOT a basic/standard/premium enum).
--
-- Rename precedent: 20260821090000 (freelancer_profiles -> talent_profiles),
-- which renamed the constraint and index explicitly alongside the table.

-- ── 1. Rename the table and its attached objects ────────────────────────────

ALTER TABLE public.consultant_services RENAME TO service_offerings;

ALTER TABLE public.service_offerings
  RENAME CONSTRAINT consultant_services_published_needs_price
  TO service_offerings_published_needs_price;
ALTER TABLE public.service_offerings
  RENAME CONSTRAINT consultant_services_description_check
  TO service_offerings_description_check;

ALTER INDEX public.idx_consultant_services_owner_position
  RENAME TO idx_service_offerings_owner_position;
ALTER INDEX public.idx_consultant_services_published_subcategory
  RENAME TO idx_service_offerings_published_subcategory;
ALTER INDEX public.idx_consultant_services_published_owner
  RENAME TO idx_service_offerings_published_owner;

ALTER TRIGGER consultant_services_updated_at
  ON public.service_offerings RENAME TO service_offerings_updated_at;

-- ── 2. Gallery ──────────────────────────────────────────────────────────────

ALTER TABLE public.service_offerings
  ADD COLUMN IF NOT EXISTS gallery_urls text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.service_offerings.gallery_urls
  IS 'Additional public image URLs shown on the service detail page, after cover_url.';

-- ── 3. Widen RLS from consultant-only to seller (consultant OR talent) ──────

DROP POLICY IF EXISTS consultant_services_public_read ON public.service_offerings;
DROP POLICY IF EXISTS consultant_services_owner_all ON public.service_offerings;

CREATE POLICY service_offerings_public_read
  ON public.service_offerings FOR SELECT
  TO anon, authenticated
  USING (
    status = 'published'
    AND (
      public.is_active_consultant(user_id)
      OR public.is_active_talent(user_id)
    )
  );

CREATE POLICY service_offerings_owner_all
  ON public.service_offerings FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      public.is_active_consultant(auth.uid())
      OR public.is_active_talent(auth.uid())
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.is_active_consultant(auth.uid())
      OR public.is_active_talent(auth.uid())
    )
  );

-- ── 4. Packages: flexible seller-titled tiers ───────────────────────────────

CREATE TABLE public.service_offering_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.service_offerings(id) ON DELETE CASCADE,
  title text NOT NULL
    CONSTRAINT service_offering_packages_title_check
    CHECK (length(trim(title)) BETWEEN 2 AND 80),
  description text
    CONSTRAINT service_offering_packages_description_check
    CHECK (description IS NULL OR length(trim(description)) <= 600),
  price numeric(12,2) NOT NULL
    CONSTRAINT service_offering_packages_price_check CHECK (price >= 0),
  delivery_days integer
    CONSTRAINT service_offering_packages_delivery_check
    CHECK (delivery_days IS NULL OR delivery_days BETWEEN 1 AND 365),
  -- NULL means unlimited revisions; 0 means none.
  revisions integer
    CONSTRAINT service_offering_packages_revisions_check
    CHECK (revisions IS NULL OR revisions >= 0),
  features text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_offering_packages_offering
  ON public.service_offering_packages(offering_id, position);

CREATE TRIGGER service_offering_packages_updated_at
  BEFORE UPDATE ON public.service_offering_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.service_offering_packages ENABLE ROW LEVEL SECURITY;

-- Ownership and visibility derive from the parent offering via a plain
-- child->parent subquery — no recursion risk.
CREATE POLICY service_offering_packages_public_read
  ON public.service_offering_packages FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_offerings s
      WHERE s.id = offering_id
        AND s.status = 'published'
        AND (
          public.is_active_consultant(s.user_id)
          OR public.is_active_talent(s.user_id)
        )
    )
  );

CREATE POLICY service_offering_packages_owner_all
  ON public.service_offering_packages FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_offerings s
      WHERE s.id = offering_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_offerings s
      WHERE s.id = offering_id AND s.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.service_offering_packages
  IS 'Seller-titled pricing tiers for a service offering, ordered by position. The parent starting_price is kept in sync with MIN(price) by the backend.';
