-- Migration: 20260503000040_extend_share_role_enum_for_project_shares.sql
-- Date: May 3, 2026
-- Description:
--   Extend the existing `share_role` enum (currently 'viewer | commenter |
--   editor' from 20260213000000_add_roadmap_sharing.sql) with two new
--   higher-rank values: 'admin' and 'owner'. Required for the project_shares
--   table that lands in the next migration.
--
--   Postgres enum values can be added but not reordered. We add 'admin' and
--   'owner' AFTER 'editor' so the storage order is:
--     viewer < commenter < editor < admin < owner
--
--   The role hierarchy used by service code does NOT depend on the storage
--   order — it's expressed via the get_user_project_role function and the
--   ProjectAuthorizationService.assertRole helper.

ALTER TYPE share_role ADD VALUE IF NOT EXISTS 'admin' AFTER 'editor';
ALTER TYPE share_role ADD VALUE IF NOT EXISTS 'owner' AFTER 'admin';
