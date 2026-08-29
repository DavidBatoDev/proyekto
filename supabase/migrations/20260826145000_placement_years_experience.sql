-- Consultant application: per-speciality years of experience.
--
-- Each staged taxonomy pick now carries how long the applicant has led that
-- kind of work, stored as the bucket floor in years (0 = <1yr, 1 = 1-3,
-- 3 = 3-5, 5 = 5-10, 10 = 10+). Nullable at the schema level — requiredness
-- is an eligibility rule (ConsultantEligibilityService), not a constraint,
-- so a draft can exist mid-edit.
--
-- consultant_subcategories gets the same column so approval carries the
-- answer into the live directory placement.

ALTER TABLE public.consultant_application_placements
  ADD COLUMN IF NOT EXISTS years_experience smallint;

ALTER TABLE public.consultant_subcategories
  ADD COLUMN IF NOT EXISTS years_experience smallint;

COMMENT ON COLUMN public.consultant_application_placements.years_experience
  IS 'Bucket floor in years (0,1,3,5,10) for how long the applicant has led work in this speciality.';
COMMENT ON COLUMN public.consultant_subcategories.years_experience
  IS 'Bucket floor in years (0,1,3,5,10), copied from the application placement at approval.';

-- Latest-body rule: rebuilt from 20260826113000_approve_consultant_application_fn.sql
-- (the only prior definition), with the placement copy now carrying
-- years_experience.
CREATE OR REPLACE FUNCTION public.approve_consultant_application(
  p_application_id uuid,
  p_reviewed_by uuid
) RETURNS public.consultant_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.consultant_applications;
BEGIN
  SELECT * INTO v_app
    FROM public.consultant_applications
   WHERE id = p_application_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND';
  END IF;

  IF v_app.status <> 'submitted' THEN
    RAISE EXCEPTION 'INVALID_STATUS:%', v_app.status;
  END IF;

  UPDATE public.consultant_applications
     SET status = 'approved',
         reviewed_at = now(),
         reviewed_by = p_reviewed_by,
         rejection_reason = NULL
   WHERE id = p_application_id
   RETURNING * INTO v_app;

  INSERT INTO public.consultant_profiles (
    user_id, status, application_id, verified_at,
    suspended_at, revoked_at, status_reason, status_changed_by
  )
  VALUES (
    v_app.user_id, 'verified', v_app.id, now(),
    NULL, NULL, NULL, p_reviewed_by
  )
  ON CONFLICT (user_id) DO UPDATE SET
    status            = 'verified',
    application_id    = EXCLUDED.application_id,
    verified_at       = EXCLUDED.verified_at,
    suspended_at      = NULL,
    revoked_at        = NULL,
    status_reason     = NULL,
    status_changed_by = EXCLUDED.status_changed_by;

  -- The staged taxonomy picks become the live directory placement,
  -- years included.
  INSERT INTO public.consultant_subcategories (
    user_id, subcategory_id, is_primary, position, years_experience
  )
  SELECT v_app.user_id, p.subcategory_id, p.is_primary, p.position,
         p.years_experience
    FROM public.consultant_application_placements p
   WHERE p.application_id = v_app.id
  ON CONFLICT (user_id, subcategory_id) DO UPDATE
    SET is_primary       = EXCLUDED.is_primary,
        position         = EXCLUDED.position,
        years_experience = EXCLUDED.years_experience;

  RETURN v_app;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_consultant_application(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.approve_consultant_application(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.approve_consultant_application(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_consultant_application(uuid, uuid) TO service_role;
