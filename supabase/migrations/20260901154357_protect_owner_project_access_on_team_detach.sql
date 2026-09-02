-- Migration: 20260901154357_protect_owner_project_access_on_team_detach.sql
--
-- Bug: a project owner who attached their own team and then detached it
-- lost ALL access to their project. Detaching cascades project_teams →
-- project_team_members, and the DELETE trigger garbage-collects the
-- project_access row for every affected user whose row is not flagged
-- has_direct_grant = true — with no owner exemption. Several writers
-- minted direct grants with the flag left false (addMember omitted the
-- column; legacy provisioning paths predate it), so an owner's own row
-- could be one team-detach away from deletion. Since every permission
-- helper and RLS policy reads project_access only (never
-- projects.owner_id), losing the row means losing the project.
--
-- Fix (DB half; the application half sets has_direct_grant = true in
-- the flag-omitting writers):
--   1. Trigger: never delete an owner's access row. An owner's access
--      is by definition a direct grant, so self-heal the flag instead.
--   2. Backfill: repair rows minted with the flag off.

-- 1. Trigger — body carried forward from
--    20260507000130_collapse_project_access_single_row.sql (newest
--    definition), adding the owner guard in the DELETE branch.
CREATE OR REPLACE FUNCTION public.tg_project_team_members_sync_shares()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_remaining int;
  v_has_direct boolean;
  v_role text;
  v_is_project_owner boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.project_team_members
    WHERE project_id = OLD.project_id AND user_id = OLD.user_id;
    IF v_remaining > 0 THEN RETURN OLD; END IF;

    SELECT has_direct_grant, role::text INTO v_has_direct, v_role
    FROM public.project_access
    WHERE project_id = OLD.project_id AND user_id = OLD.user_id;
    IF NOT FOUND THEN RETURN OLD; END IF;

    IF v_has_direct IS DISTINCT FROM true THEN
      SELECT EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = OLD.project_id AND p.owner_id = OLD.user_id
      ) INTO v_is_project_owner;

      IF v_role = 'owner' OR v_is_project_owner THEN
        -- Owner guard: an owner's access is by definition a direct
        -- grant. A false flag here is a data bug, not a team-only
        -- grant — repair it rather than deleting the owner's access.
        UPDATE public.project_access
        SET has_direct_grant = true
        WHERE project_id = OLD.project_id AND user_id = OLD.user_id;
      ELSE
        DELETE FROM public.project_access
        WHERE project_id = OLD.project_id AND user_id = OLD.user_id;
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  -- INSERT/UPDATE no longer touch project_access.
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.tg_project_team_members_sync_shares() IS
  'On project_team_members DELETE: removes the project_access row once no team curations remain and has_direct_grant is false — except for owners (role owner or projects.owner_id), whose row is kept and self-healed to has_direct_grant = true.';

-- 2. Backfill repair (idempotent).
-- Rows minted by flag-omitting writers: a non-team origin means a
-- direct grant. (The move-direct-grant path rewrites origin to
-- 'team:<id>', so non-team origin + false flag = bug artifact.)
UPDATE public.project_access
SET has_direct_grant = true
WHERE has_direct_grant = false
  AND (origin IS NULL OR origin NOT LIKE 'team:%');

-- Owners are always direct, regardless of origin label.
UPDATE public.project_access pa
SET has_direct_grant = true
FROM public.projects p
WHERE pa.has_direct_grant = false
  AND pa.project_id = p.id
  AND (pa.role = 'owner' OR pa.user_id = p.owner_id);
