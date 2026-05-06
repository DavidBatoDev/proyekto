-- Migration: 20260507000030_team_members_rate_gate_and_drop_legacy.sql
-- Date: May 7, 2026
-- Description:
--   Two cleanups in one migration:
--
--   1. Rate-gate via RLS on `team_members`. The SELECT policy previously
--      let project members of an attached team SELECT entire team_members
--      rows (so they could read hourly_rate, currency, custom_id, etc. via
--      direct Supabase queries). Now the project-member branch is dropped:
--      project members access team membership only via project_team_members
--      (which has no rate columns). Team owners + team members + the user
--      themself still see the full row.
--
--   2. Drop legacy `project_member_time_rates`. The table was truncated in
--      migration A and has no live writers since the project-time backend
--      module was removed. Frontend reference files import its types but
--      they're @ts-nocheck'd and never executed. Safe to drop.

BEGIN;

-- ─── (1) Tighten team_members SELECT RLS ──────────────────────────────────

DROP POLICY IF EXISTS team_members_select ON public.team_members;

CREATE POLICY team_members_select ON public.team_members
  FOR SELECT USING (
    -- Team owner sees their team's roster (incl. rate fields).
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id AND t.owner_id = auth.uid()
    )
    -- The user themself.
    OR user_id = auth.uid()
    -- Other members of the same team.
    OR EXISTS (
      SELECT 1 FROM public.team_members me
      WHERE me.team_id = team_members.team_id AND me.user_id = auth.uid()
    )
    -- NOTE: project members of attached teams used to see rows here; they
    -- now go through project_team_members for roster info (no rate cols).
  );

-- ─── (2) Drop legacy project_member_time_rates ────────────────────────────

DROP TABLE IF EXISTS public.project_member_time_rates;

COMMIT;
