-- Consultant application rebuild, phase 1: staged expertise placements.
--
-- Applicants pick where they should be listed in the marketplace taxonomy
-- while applying, but consultant_subcategories is a verified-consultant
-- surface (self-serve writes are gated on is_active_consultant()). The picks
-- are therefore staged on the application in a child table and copied into
-- consultant_subcategories at approval.
--
-- FKs rather than JSONB on purpose: the taxonomy is live and mutable
-- (subcategories were consolidated twice in August 2026), and a foreign key
-- makes a stale pick impossible instead of silently rotting between
-- submission and review. The row shape mirrors consultant_subcategories
-- (user-side: user_id, subcategory_id, is_primary, position) so approval is
-- a plain INSERT ... SELECT.

CREATE TABLE IF NOT EXISTS public.consultant_application_placements (
  application_id uuid NOT NULL
    REFERENCES public.consultant_applications(id) ON DELETE CASCADE,
  subcategory_id uuid NOT NULL
    REFERENCES public.marketplace_subcategories(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, subcategory_id)
);

CREATE INDEX IF NOT EXISTS idx_consultant_application_placements_application
  ON public.consultant_application_placements(application_id);

ALTER TABLE public.consultant_application_placements ENABLE ROW LEVEL SECURITY;

-- Ownership is derived from the parent application via a plain subquery on
-- consultant_applications (whose own policies do not reference this table),
-- so there is no policy recursion.
DROP POLICY IF EXISTS "Applicants can view own placements"
  ON public.consultant_application_placements;
CREATE POLICY "Applicants can view own placements"
  ON public.consultant_application_placements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.consultant_applications a
      WHERE a.id = application_id AND a.user_id = auth.uid()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Applicants can insert own placements"
  ON public.consultant_application_placements;
CREATE POLICY "Applicants can insert own placements"
  ON public.consultant_application_placements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.consultant_applications a
      WHERE a.id = application_id
        AND a.user_id = auth.uid()
        AND a.status IN ('draft', 'submitted', 'rejected')
    )
  );

DROP POLICY IF EXISTS "Applicants can delete own placements"
  ON public.consultant_application_placements;
CREATE POLICY "Applicants can delete own placements"
  ON public.consultant_application_placements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.consultant_applications a
      WHERE a.id = application_id
        AND a.user_id = auth.uid()
        AND a.status IN ('draft', 'submitted', 'rejected')
    )
  );

DROP POLICY IF EXISTS "Admins can manage placements"
  ON public.consultant_application_placements;
CREATE POLICY "Admins can manage placements"
  ON public.consultant_application_placements FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Resubmission contract: a rejected applicant may revise and resubmit, so the
-- owner-update window widens from (draft, submitted) to include rejected.
-- The backend goes through the service role either way; this keeps RLS
-- honest for any direct-client caller.
DROP POLICY IF EXISTS "Users can update own draft application"
  ON public.consultant_applications;
CREATE POLICY "Users can update own draft application"
  ON public.consultant_applications FOR UPDATE
  USING (
    (auth.uid() = user_id AND status IN ('draft', 'submitted', 'rejected'))
    OR public.is_admin()
  );

COMMENT ON TABLE public.consultant_application_placements
  IS 'Marketplace taxonomy picks staged on a consultant application. Copied into consultant_subcategories when the application is approved.';
