-- ---------------------------------------------------------------------
-- Backfill personal teams for existing consultant-leaning profiles.
--
-- For every profile with lane='consultant' OR is_consultant_verified=true
-- that does NOT already own a team flagged is_personal=true, create one.
-- Name pattern matches TeamsService.buildDefaultPersonalTeamName:
--   "<first_name || display_name || 'My'>'s Team"
--
-- Idempotent: re-running is a no-op because of the partial unique index
-- teams_one_personal_per_owner from migration 20260507000040.
-- ---------------------------------------------------------------------

BEGIN;

WITH eligible AS (
  SELECT
    p.id AS owner_id,
    COALESCE(
      NULLIF(btrim(p.first_name), ''),
      NULLIF(btrim(p.display_name), ''),
      'My'
    ) || '''s Team' AS team_name
  FROM public.profiles p
  WHERE (p.settings->'onboarding'->>'lane' = 'consultant'
         OR p.is_consultant_verified = true)
    AND NOT EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.owner_id = p.id AND t.is_personal = true
    )
),
inserted_teams AS (
  INSERT INTO public.teams (owner_id, name, is_personal)
  SELECT owner_id, team_name, true
  FROM eligible
  RETURNING id, owner_id
)
INSERT INTO public.team_members (team_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM inserted_teams
ON CONFLICT (team_id, user_id) DO NOTHING;

COMMIT;
