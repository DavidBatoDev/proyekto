-- The tg_team_members_block_owner_delete trigger fires during CASCADE deletions
-- from profiles → team_members (via user_id ON DELETE CASCADE). At that point the
-- team still exists, so the owner-check raises a false positive and blocks user deletion.
-- Fix: skip the guard when the profile itself is being deleted (profile row already gone)
-- or when the team itself is being deleted.

CREATE OR REPLACE FUNCTION public.tg_team_members_block_owner_delete()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Profile is being deleted — cascade is legitimate, skip the guard.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  -- Team is being deleted — cascade is legitimate, skip the guard.
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id) THEN
    RETURN OLD;
  END IF;

  -- Normal case: someone is trying to remove the owner from a live team — block it.
  IF EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = OLD.team_id AND t.owner_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot remove team owner from team_members; transfer ownership or delete the team first';
  END IF;

  RETURN OLD;
END $$;
