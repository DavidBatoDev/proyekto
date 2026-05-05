-- Migration: 20260505000010_add_position_to_project_shares.sql
-- Date: May 5, 2026
-- Description:
--   Adds a free-form `position` text column to `project_shares` so each
--   member can carry a label like "CEO", "Backend Dev", "Designer", etc.
--   The column is nullable; the application enforces a max length of
--   80 characters (matching `project_invites.invited_position`). It is
--   never used for authorization — purely a display label surfaced on
--   the team page, member rows, and chat profile panels.
--
--   Edit gating is enforced application-side:
--     - self (caller.user_id == row.user_id)            → allowed
--     - role >= admin on the project                    → allowed
--     - members.edit_position capability granted        → allowed
--     - else                                            → forbidden

ALTER TABLE public.project_shares
  ADD COLUMN IF NOT EXISTS position text;

COMMENT ON COLUMN public.project_shares.position IS
  'Free-form member position/title (e.g., "CEO", "Backend Dev"). Display-only; never used for authorization.';
