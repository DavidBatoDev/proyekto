-- Migration: 20260507000130_collapse_project_access_single_row.sql
--
-- Purpose:
--   Collapse project_access to one row per (project_id, user_id). The
--   `origin` column survives as a primary-source label (consumed by
--   ORIGIN_DELTAS in project-permissions.ts) but is no longer part of
--   the uniqueness key. A new `has_direct_grant` boolean tracks whether
--   the access row is held by a direct grant; team curations live in
--   project_team_members.
--
-- Trigger change:
--   On project_team_members DELETE, the trigger only deletes the
--   project_access row when (a) no team curations remain AND
--   (b) has_direct_grant is false. INSERT/UPDATE remain no-ops on
--   project_access — the application owns those writes.

-- 1. Add has_direct_grant; backfill from existing origin.
ALTER TABLE public.project_access
  ADD COLUMN IF NOT EXISTS has_direct_grant boolean NOT NULL DEFAULT false;

UPDATE public.project_access
SET has_direct_grant = true
WHERE origin IS NULL OR origin NOT LIKE 'team:%';

-- 2. Reconcile multi-row pairs into one. Pick max role; OR-flag direct;
--    OR-union capabilities.
WITH ranked AS (
  SELECT id, project_id, user_id, role, has_direct_grant, granted_at,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, user_id
      ORDER BY has_direct_grant DESC,
        CASE role::text
          WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'editor' THEN 3
          WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END DESC,
        granted_at ASC
    ) AS rn
  FROM public.project_access
),
agg AS (
  SELECT project_id, user_id,
    bool_or(has_direct_grant) AS any_direct,
    MAX(CASE role::text
      WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'editor' THEN 3
      WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END) AS max_rank
  FROM public.project_access
  GROUP BY project_id, user_id
),
caps AS (
  SELECT project_id, user_id,
    jsonb_object_agg(key, to_jsonb(any_true)) AS merged_caps
  FROM (
    SELECT project_id, user_id, key, bool_or((value)::boolean) AS any_true
    FROM (
      SELECT project_id, user_id, key, value
      FROM public.project_access
      CROSS JOIN LATERAL jsonb_each(capabilities)
    ) kv
    GROUP BY project_id, user_id, key
  ) keyed
  GROUP BY project_id, user_id
)
UPDATE public.project_access dst
SET has_direct_grant = agg.any_direct,
    role = CASE agg.max_rank
      WHEN 5 THEN 'owner'::share_role  WHEN 4 THEN 'admin'::share_role
      WHEN 3 THEN 'editor'::share_role WHEN 2 THEN 'commenter'::share_role
      ELSE 'viewer'::share_role END,
    capabilities = COALESCE(caps.merged_caps, '{}'::jsonb)
FROM ranked
JOIN agg
  ON ranked.project_id = agg.project_id
  AND ranked.user_id = agg.user_id
LEFT JOIN caps
  ON caps.project_id = agg.project_id
  AND caps.user_id = agg.user_id
WHERE dst.id = ranked.id AND ranked.rn = 1
  AND ranked.project_id = agg.project_id
  AND ranked.user_id    = agg.user_id;

DELETE FROM public.project_access pa USING (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY project_id, user_id
      ORDER BY has_direct_grant DESC, granted_at ASC
    ) AS rn FROM public.project_access
  ) t WHERE t.rn > 1
) dups WHERE pa.id = dups.id;

-- 3. Replace uniqueness contract.
ALTER TABLE public.project_access
  DROP CONSTRAINT IF EXISTS project_access_project_user_origin_unique;
ALTER TABLE public.project_access
  ADD CONSTRAINT project_access_project_user_unique
  UNIQUE (project_id, user_id);

-- 4. Trigger: only delete the access row when there are no remaining
--    team curations and no direct grant.
CREATE OR REPLACE FUNCTION public.tg_project_team_members_sync_shares()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_remaining int;
  v_has_direct boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.project_team_members
    WHERE project_id = OLD.project_id AND user_id = OLD.user_id;
    IF v_remaining > 0 THEN RETURN OLD; END IF;

    SELECT has_direct_grant INTO v_has_direct
    FROM public.project_access
    WHERE project_id = OLD.project_id AND user_id = OLD.user_id;

    IF v_has_direct IS DISTINCT FROM true THEN
      DELETE FROM public.project_access
      WHERE project_id = OLD.project_id AND user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  -- INSERT/UPDATE no longer touch project_access.
  RETURN NEW;
END $$;

COMMENT ON COLUMN public.project_access.has_direct_grant IS
  'True iff the user holds a direct grant on this project (vs. team curation only). When false and no project_team_members rows exist for (project, user), the row should not exist.';

COMMENT ON COLUMN public.project_access.origin IS
  'Primary-source label for the grant. Not part of the uniqueness key — descriptive hint consumed by ORIGIN_DELTAS in project-permissions.ts.';

COMMENT ON TABLE public.project_access IS
  'One row per (project, user). The single source of truth for role + capabilities + origin label. Team curations are tracked structurally in project_team_members; an access row stays alive while either has_direct_grant is true or any project_team_members row exists for the pair.';
