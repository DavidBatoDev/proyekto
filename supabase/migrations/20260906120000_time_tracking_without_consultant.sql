-- Time tracking is no longer a consultant-only capability.
--
-- Enabling a team's time tracking is now an owner-or-admin operational switch
-- (see TeamsService.updateTeam), and setting member rates no longer requires
-- the team owner to hold a verified consultant enrollment. This drops the last
-- database-level consultant gate on the rates path.
--
-- The trigger came from 20260509000010_team_member_rates.sql and was last
-- redefined in 20260809131000_consultant_capability_predicate.sql. There was
-- never a DB gate on teams.time_tracking_enabled itself — that one lived only
-- in the service layer.
--
-- public.is_active_consultant() is NOT dropped: marketplace RLS policies and
-- the contract seat guards still depend on it.

BEGIN;

DROP TRIGGER IF EXISTS team_member_rates_check_consultant
  ON public.team_member_rates;

DROP FUNCTION IF EXISTS public.tg_team_member_rates_check_consultant();

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual)
-- Run the block below manually if you need to restore the consultant gate.
-- ---------------------------------------------------------------------------
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.tg_team_member_rates_check_consultant()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $$
-- DECLARE
--   v_owner_is_active_consultant boolean;
-- BEGIN
--   SELECT public.is_active_consultant(t.owner_id)
--   INTO v_owner_is_active_consultant
--   FROM public.teams AS t
--   WHERE t.id = NEW.team_id;
--
--   IF v_owner_is_active_consultant IS NOT TRUE THEN
--     RAISE EXCEPTION 'Team owner must be an active consultant to set rates on team members';
--   END IF;
--
--   RETURN NEW;
-- END
-- $$;
--
-- CREATE TRIGGER team_member_rates_check_consultant
--   BEFORE INSERT OR UPDATE ON public.team_member_rates
--   FOR EACH ROW EXECUTE FUNCTION public.tg_team_member_rates_check_consultant();
-- COMMIT;
