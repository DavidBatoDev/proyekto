-- ---------------------------------------------------------------------
-- Yoke project_access rows: every (project_id, user_id) group must
-- carry the same role + capabilities. Per-origin overrides are gone;
-- origin is purely a "received via" annotation now.
--
-- This is a one-shot reconciliation. Going forward, the yoke is
-- maintained at the service layer (`ProjectAccessSyncService.syncUser`)
-- which fires on every grant/curate/role-change/cap-edit code path.
--
-- We compute the synced role per user as max across:
--   * each direct project_access row's `role`
--   * each team-derived row's `project_team_members.role` (the natural
--     source for the team origin)
--
-- Capabilities use the largest non-empty map within the group; ties
-- prefer direct origins over team-derived (matches the service's
-- `pickCapabilities` rule), then break by row id for determinism.
-- ---------------------------------------------------------------------

BEGIN;

-- 1. Helper: rank for the role hierarchy used by the resolver.
-- Returns higher integer for stronger roles.
CREATE OR REPLACE FUNCTION public._yoke_role_rank(role text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE role
    WHEN 'viewer' THEN 1
    WHEN 'commenter' THEN 2
    WHEN 'member' THEN 2
    WHEN 'client' THEN 3
    WHEN 'editor' THEN 3
    WHEN 'admin' THEN 4
    WHEN 'consultant' THEN 5
    WHEN 'owner' THEN 5
    ELSE 0
  END
$$;

-- 2. Build the per-(project, user) target role from natural sources.
-- For team-derived rows, use project_team_members.role as the
-- natural source rather than project_access.role (which is just a
-- mirror of it via the existing trigger).
WITH natural_sources AS (
  -- Direct rows: their own role.
  SELECT
    pa.project_id,
    pa.user_id,
    pa.role
  FROM public.project_access pa
  WHERE pa.user_id IS NOT NULL
    AND (pa.origin IS NULL OR pa.origin NOT LIKE 'team:%')
  UNION ALL
  -- Team-derived rows: the curation row's role.
  SELECT
    ptm.project_id,
    ptm.user_id,
    ptm.role
  FROM public.project_team_members ptm
),
target_role AS (
  SELECT
    project_id,
    user_id,
    role,
    public._yoke_role_rank(role::text) AS rank
  FROM (
    SELECT
      project_id,
      user_id,
      role,
      ROW_NUMBER() OVER (
        PARTITION BY project_id, user_id
        ORDER BY public._yoke_role_rank(role::text) DESC, role ASC
      ) AS rn
    FROM natural_sources
  ) ranked
  WHERE rn = 1
),
-- Pick capabilities per user: largest non-empty JSONB map; ties by
-- direct-origin > team-origin, then row id.
target_caps AS (
  SELECT
    project_id,
    user_id,
    capabilities
  FROM (
    SELECT
      pa.project_id,
      pa.user_id,
      pa.capabilities,
      ROW_NUMBER() OVER (
        PARTITION BY pa.project_id, pa.user_id
        ORDER BY
          jsonb_array_length(
            COALESCE(jsonb_path_query_array(pa.capabilities, '$.*'), '[]'::jsonb)
          ) DESC,
          (CASE WHEN pa.origin LIKE 'team:%' THEN 1 ELSE 0 END) ASC,
          pa.id ASC
      ) AS rn
    FROM public.project_access pa
    WHERE pa.user_id IS NOT NULL
  ) ranked
  WHERE rn = 1
)
UPDATE public.project_access pa
SET
  role = tr.role,
  capabilities = COALESCE(tc.capabilities, '{}'::jsonb)
FROM target_role tr
LEFT JOIN target_caps tc
  ON tc.project_id = tr.project_id
 AND tc.user_id = tr.user_id
WHERE pa.project_id = tr.project_id
  AND pa.user_id = tr.user_id
  AND (
    pa.role IS DISTINCT FROM tr.role
    OR pa.capabilities IS DISTINCT FROM COALESCE(tc.capabilities, '{}'::jsonb)
  );

-- 3. Drop the helper — it's a one-shot migration concern.
DROP FUNCTION public._yoke_role_rank(text);

COMMENT ON TABLE public.project_access IS
  'Membership grants. Multi-origin: same (project_id, user_id) can hold direct + team-derived rows. Yoke invariant (enforced by ProjectAccessSyncService): role and capabilities are uniform across every row in a (project_id, user_id) group; origin is informational.';

COMMIT;
