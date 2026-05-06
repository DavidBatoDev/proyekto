-- ---------------------------------------------------------------------
-- Add `position` text column to team_members and team_invites.
--
-- Free-form job-title-style label (e.g. "Engineering Lead",
-- "Product Designer") that the team owner / admins set on a per-member
-- basis. Carries over from team_invites → team_members on accept so the
-- inviter's intent doesn't get lost.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS position text;

ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS position text;

COMMENT ON COLUMN public.team_members.position IS
  'Optional free-form title for this member within the team. Editable by team owner / admins.';
COMMENT ON COLUMN public.team_invites.position IS
  'Optional free-form title proposed in the invite. Copied to team_members.position on accept.';

COMMIT;
