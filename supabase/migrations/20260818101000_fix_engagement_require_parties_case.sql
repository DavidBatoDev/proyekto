-- Fix engagement activation, which could never complete.
--
-- tg_engagement_require_parties backs two deferred constraint triggers: one on
-- engagement_parties (which has an engagement_id column) and one on engagements
-- (whose key is id). It picked between them with a CASE *expression*:
--
--   v_engagement_id := CASE WHEN TG_TABLE_NAME = 'engagements'
--                        THEN NEW.id ELSE NEW.engagement_id END;
--
-- PL/pgSQL resolves every field reference in an expression when it plans that
-- expression, not only the branch that is taken, so on the engagements row type
-- the untaken NEW.engagement_id reference raised
--
--   42703  record "new" has no field "engagement_id"
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED, so it fired at COMMIT and took
-- down the whole final-signature transaction in
-- sign_contract_position_and_activate. Every contract carrying two generic
-- positions therefore failed on its second signature, and no engagement could
-- ever be created. The sibling tg_engagement_project_scope_check already
-- branches with IF/ELSIF statements and was never affected.
--
-- Latest body: 20260814020000_engagement_core.sql. Only the branch is changed;
-- the party-pair rule is preserved exactly. Both triggers keep pointing here.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_engagement_require_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_engagement_id uuid;
BEGIN
  -- Statement-level branching: each arm is planned only when it runs, so the
  -- engagements row type is never asked for an engagement_id field.
  IF TG_TABLE_NAME = 'engagements' THEN
    v_engagement_id := NEW.id;
  ELSE
    v_engagement_id := NEW.engagement_id;
  END IF;

  IF (SELECT count(*) FROM public.engagement_parties WHERE engagement_id = v_engagement_id) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = v_engagement_id AND position = 'hirer'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = v_engagement_id AND position = 'provider'
    ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_REQUIRES_TWO_PARTIES';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_engagement_require_parties()
  FROM PUBLIC, anon, authenticated;

COMMIT;
