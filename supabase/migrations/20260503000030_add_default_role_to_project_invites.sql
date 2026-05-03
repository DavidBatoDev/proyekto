-- Migration: 20260503000030_add_default_role_to_project_invites.sql
-- Date: May 3, 2026
-- Description:
--   Adds a `default_role` column to project_invites so the /welcome slide-4
--   invite step can persist the role chosen for each invite (Editor or
--   Viewer). The existing `share_role` enum from
--   20260213000000_add_roadmap_sharing.sql already includes 'viewer',
--   'commenter', and 'editor' — no enum extension needed.
--
--   Existing invites have NULL default_role (legacy/unspecified); new invites
--   from the /welcome flow will write 'editor' or 'viewer'.

ALTER TABLE public.project_invites
ADD COLUMN default_role share_role;

COMMENT ON COLUMN public.project_invites.default_role IS 'The role granted to the invitee when they accept. Written by the /welcome multi-invite step. NULL for legacy invites where no role was chosen at invite time.';
