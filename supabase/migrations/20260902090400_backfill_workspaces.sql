-- Backfill: every existing non-guest user gets a workspace, and their owned
-- teams and projects move into it.
--
-- Every statement is guarded (NOT EXISTS / IS NULL), so re-running this is a
-- no-op. That matters because dev and prod hold different rows and the file is
-- applied to both.
--
-- Guests are skipped deliberately: a guest's roadmap has no workspace until
-- conversion, at which point ProjectsService.createProjectFromRoadmap places
-- the new project in the converting user's workspace.

BEGIN;

-- 1. A workspace + owner membership for every non-guest profile that owns none.
WITH candidates AS (
  SELECT
    p.id AS user_id,
    COALESCE(
      NULLIF(btrim(p.first_name), ''),
      NULLIF(btrim(p.display_name), '')
    ) AS stub
  FROM public.profiles p
  WHERE COALESCE(p.is_guest, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.user_id = p.id AND wm.role = 'owner'
    )
),
created AS (
  -- Same naming rule as provision_default_workspace: a nameless profile gets
  -- "My Workspace", never "My's Workspace".
  INSERT INTO public.workspaces (name, created_by)
  SELECT
    CASE WHEN stub IS NULL THEN 'My Workspace' ELSE stub || '''s Workspace' END,
    user_id
  FROM candidates
  RETURNING id, created_by
)
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT id, created_by, 'owner' FROM created;

-- 2. A free subscription row for any workspace missing one.
INSERT INTO public.workspace_subscriptions (workspace_id)
SELECT w.id FROM public.workspaces w
ON CONFLICT (workspace_id) DO NOTHING;

-- 3. Owned teams adopt their owner's default workspace.
UPDATE public.teams t
SET workspace_id = dw.workspace_id
FROM (
  SELECT DISTINCT ON (wm.user_id) wm.user_id, wm.workspace_id
  FROM public.workspace_members wm
  WHERE wm.role = 'owner'
  ORDER BY wm.user_id, wm.joined_at, wm.workspace_id
) dw
WHERE t.workspace_id IS NULL
  AND t.owner_id = dw.user_id;

-- 4. Owned projects likewise. Guest-owned projects match no row and stay NULL.
UPDATE public.projects pr
SET workspace_id = dw.workspace_id
FROM (
  SELECT DISTINCT ON (wm.user_id) wm.user_id, wm.workspace_id
  FROM public.workspace_members wm
  WHERE wm.role = 'owner'
  ORDER BY wm.user_id, wm.joined_at, wm.workspace_id
) dw
WHERE pr.workspace_id IS NULL
  AND pr.owner_id = dw.user_id;

COMMIT;
