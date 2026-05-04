-- Migration: 20260503000070_add_roadmap_effective_role_helper.sql
-- Date: May 3, 2026
-- Description:
--   Adds a NEW helper `get_user_roadmap_effective_role(uid, roadmap_id)` that
--   consults `roadmap_shares` first, falling back to `project_shares` on the
--   roadmap's parent project. Returns `share_role`.
--
--   This is the slice-3 follow-up to the deferred roadmap-helper extension
--   from slice 2 (see specs decision log 2026-05-03). The pre-existing
--   `get_user_roadmap_share_role(p_roadmap_id, p_user_id) RETURNS TEXT` is
--   left untouched — it's still referenced by RLS policies created in the
--   roadmap-sharing migration. Migrating those policies to the new function
--   is a separate slice (touches every roadmap-related RLS policy in
--   lockstep). For now, callers that want the project_shares fallback
--   semantics use the new function explicitly.
--
--   Implication: the new function is OPT-IN. Existing roadmap RLS still
--   enforces the original (TEXT-returning) helper. Backend service code
--   that needs project-owner inheritance can call the new function.

CREATE OR REPLACE FUNCTION public.get_user_roadmap_effective_role(
  uid uuid,
  roadmap_id uuid
)
RETURNS share_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH explicit_grant AS (
    SELECT
      CASE
        WHEN re.role IS NOT NULL THEN re.role
        WHEN rs.default_role IS NOT NULL AND rs.is_active THEN rs.default_role
        ELSE NULL
      END::share_role AS role
    FROM public.roadmap_shares rs
    LEFT JOIN LATERAL (
      SELECT (entry->>'role')::share_role AS role
      FROM jsonb_array_elements(COALESCE(rs.invited_emails, '[]'::jsonb)) AS entry
      WHERE entry->>'email' = (
        SELECT email FROM public.profiles WHERE id = uid LIMIT 1
      )
      LIMIT 1
    ) re ON true
    WHERE rs.roadmap_id = get_user_roadmap_effective_role.roadmap_id
      AND rs.is_active = true
    ORDER BY re.role DESC NULLS LAST
    LIMIT 1
  ),
  project_grant AS (
    SELECT public.get_user_project_role(uid, r.project_id) AS role
    FROM public.roadmaps r
    WHERE r.id = get_user_roadmap_effective_role.roadmap_id
      AND r.project_id IS NOT NULL
  )
  SELECT COALESCE(
    (SELECT role FROM explicit_grant WHERE role IS NOT NULL),
    (SELECT role FROM project_grant WHERE role IS NOT NULL)
  );
$$;

COMMENT ON FUNCTION public.get_user_roadmap_effective_role(uuid, uuid) IS 'Returns user role on a roadmap, consulting roadmap_shares first then falling back to project_shares on the parent project. Distinct from get_user_roadmap_share_role (TEXT-returning legacy helper) which is still referenced by RLS policies.';
