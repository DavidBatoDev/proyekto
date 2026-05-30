-- Migration: 20260530000010_backfill_project_access_from_projects.sql
-- Date: May 30, 2026
-- Description:
--   Back-fill project_access rows for the client_id and consultant_id that
--   have lived on the projects table since the initial schema but were never
--   migrated into project_access when project_members was dropped
--   (20260504000010).  Without these rows, any user whose project predates the
--   project_shares slice (May 3 2026) receives a 403 on every task / roadmap
--   write — including their own projects.
--
--   Strategy:
--     - client_id  → 'owner' role. Personal-workspace projects are always
--       client-owned.  Marketplace projects receive admin in new code, but
--       'owner' is safe here because it is strictly broader and legacy users
--       had unrestricted access under the old project_members model.
--     - consultant_id (nullable) → 'owner' role for the same reason.
--     - origin = 'legacy' to distinguish these rows from post-May-3 direct
--       grants and make them easy to identify / audit later.
--     - ON CONFLICT DO NOTHING — if a row for (project_id, user_id, origin)
--       already exists (because the user did something that triggered a
--       fresh grant after May 3) we leave it untouched.
--
--   Idempotent: re-running is a no-op due to ON CONFLICT.

BEGIN;

-- ── client_id backfill ──────────────────────────────────────────────────────
INSERT INTO public.project_access (project_id, user_id, role, origin)
SELECT
  p.id AS project_id,
  p.client_id AS user_id,
  'owner'::share_role AS role,
  'legacy' AS origin
FROM public.projects p
WHERE p.client_id IS NOT NULL
ON CONFLICT (project_id, user_id, origin) DO NOTHING;

-- ── consultant_id backfill ──────────────────────────────────────────────────
INSERT INTO public.project_access (project_id, user_id, role, origin)
SELECT
  p.id AS project_id,
  p.consultant_id AS user_id,
  'owner'::share_role AS role,
  'legacy' AS origin
FROM public.projects p
WHERE p.consultant_id IS NOT NULL
ON CONFLICT (project_id, user_id, origin) DO NOTHING;

COMMIT;
