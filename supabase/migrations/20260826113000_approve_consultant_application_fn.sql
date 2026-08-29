-- Consultant application rebuild, phase 2: atomic approval.
--
-- Approval used to be two un-transacted writes from the backend (upsert the
-- verified enrollment, then mark the application approved) — a failure
-- between them left a verified consultant whose application still said
-- 'submitted'. It also never placed the consultant in the marketplace
-- taxonomy, so approval produced an empty storefront. This function does the
-- three writes in one transaction, with a status precondition that also
-- closes the reject-after-approve hole's mirror image (approving twice).
--
-- New function (no prior defining migration — checked per the
-- latest-function-body rule). Service-role only: the backend authorizes the
-- reviewing admin before calling.

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

  -- The staged taxonomy picks become the live directory placement.
  INSERT INTO public.consultant_subcategories (
    user_id, subcategory_id, is_primary, position
  )
  SELECT v_app.user_id, p.subcategory_id, p.is_primary, p.position
    FROM public.consultant_application_placements p
   WHERE p.application_id = v_app.id
  ON CONFLICT (user_id, subcategory_id) DO UPDATE
    SET is_primary = EXCLUDED.is_primary,
        position   = EXCLUDED.position;

  RETURN v_app;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_consultant_application(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.approve_consultant_application(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.approve_consultant_application(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_consultant_application(uuid, uuid) TO service_role;
