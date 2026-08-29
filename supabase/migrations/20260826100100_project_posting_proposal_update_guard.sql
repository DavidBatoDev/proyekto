-- Migration: 20260826100100_project_posting_proposal_update_guard.sql
-- Date: August 26, 2026
-- Description:
--   Freezes the content of a proposal against everybody except the applicant
--   who wrote it.
--
--   `project_posting_proposals_author_update` (20260826100000) lets the brief's
--   author move a proposal to 'shortlisted' or 'declined'. A WITH CHECK can only
--   see the row being written, never the row being replaced, so it cannot tell
--   "set status = shortlisted" from "set status = shortlisted AND rewrite the
--   applicant's pitch". Probed against dev before writing this: the author could
--   do exactly that, and the proposal is the applicant's own words about their
--   own work -- a client editing it is a forgery, not an edit.
--
--   Only a trigger can compare OLD to NEW, so the rule lives here.
--
--   auth.uid() IS NULL means no end-user JWT: a service-role or backend
--   context, which already bypasses RLS entirely. The guard deliberately does
--   not fire there -- it is scoped to the same surface RLS governs, and pretending
--   to police trusted server code would only produce a false sense of coverage.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_project_posting_proposals_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- The applicant owns their own pitch, rate and withdrawal.
  IF auth.uid() IS NULL OR auth.uid() = OLD.consultant_id THEN
    RETURN NEW;
  END IF;

  IF NEW.posting_id IS DISTINCT FROM OLD.posting_id
     OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id
     OR NEW.pitch IS DISTINCT FROM OLD.pitch
     OR NEW.indicative_rate IS DISTINCT FROM OLD.indicative_rate
     OR NEW.rate_currency IS DISTINCT FROM OLD.rate_currency
     OR NEW.rate_unit IS DISTINCT FROM OLD.rate_unit
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'only the applicant may change the content of their own proposal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_posting_proposals_guard_update
  BEFORE UPDATE ON public.project_posting_proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_project_posting_proposals_guard_update();

COMMENT ON FUNCTION public.tg_project_posting_proposals_guard_update() IS
  'Restricts a non-applicant (in practice the brief author) to changing only `status` on a proposal. The companion RLS policy bounds WHICH statuses they may set; this bounds WHAT ELSE they may touch, which a WITH CHECK cannot express because it never sees the old row.';

COMMIT;
