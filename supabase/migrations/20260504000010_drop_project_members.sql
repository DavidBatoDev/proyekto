-- Migration: 20260504000010_drop_project_members.sql
-- Date: May 4, 2026
-- Description:
--   Slice 3b finale: drop the legacy `project_members` table now that all
--   reads and writes have been migrated to `project_shares`. The 8 modules
--   that previously referenced it (chat, project-time, admin, roadmaps,
--   uploads, marketplace, projects, personal-workspace) all use
--   `project_shares` directly as of slice 3b.
--
--   Foreign key from `project_member_time_rates.project_member_id` was
--   already decoupled in 20260503000090_decouple_time_rates_from_project_members.
--   That column is now an opaque per-user identifier (set equal to
--   member_user_id on writes) and stays in place for frontend URL stability.
--
--   The `permissions_json` column lived on this table and goes away with it.

-- DROP CASCADE in case there are still RLS policies or stale FK constraints
-- pointing at project_members from the original schema migration.
DROP TABLE IF EXISTS public.project_members CASCADE;
