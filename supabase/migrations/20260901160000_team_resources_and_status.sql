-- Team Overview: a team status, and team resources (hyperlink-only).
--
-- The resource tables are structural mirrors of project_resource_folders /
-- project_resource_links (20260320120000, plus the icon/colour columns from
-- 20260826130000 and the white default from 20260826140000, folded in here
-- rather than replayed as three migrations), keyed on team_id instead of
-- project_id. Links only: there is no file upload on either surface.

-- ── Team status ─────────────────────────────────────────────────────────────
-- Describes the team's working life, not a project's. Defaults to 'active' so
-- every existing team keeps a meaningful value with no backfill.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_status_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_status_check
  CHECK (status IN ('active', 'paused', 'archived'));

COMMENT ON COLUMN public.teams.status IS
  'Team lifecycle state shown as a chip on the team Overview: active | paused | archived.';

-- ── Membership predicates ───────────────────────────────────────────────────
-- SECURITY DEFINER, which is the whole point: the body runs with the owner's
-- rights and so is not itself subject to RLS on teams/team_members. That is
-- what keeps the policies below from recursing, and it is the same shape as
-- get_user_project_role (20260507000010) — the pattern this schema adopted
-- after its RLS-recursion incidents, and the one project_team_invites
-- (20260825120000) uses in preference to an inline EXISTS.

CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team_id AND t.owner_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.team_id = p_team_id AND m.user_id = p_user_id
  );
$$;

COMMENT ON FUNCTION public.is_team_member(uuid, uuid) IS
  'True when the user owns the team or holds any team_members row on it. SECURITY DEFINER so RLS policies can call it without recursing.';

CREATE OR REPLACE FUNCTION public.can_manage_team(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team_id AND t.owner_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.team_id = p_team_id
      AND m.user_id = p_user_id
      AND m.role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.can_manage_team(uuid, uuid) IS
  'True for the team owner or a team admin. Mirrors TeamsService.assertCanManageMembers.';

-- ── team_resource_folders ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_resource_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'folder',
  color text NOT NULL DEFAULT 'white',
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT team_resource_folders_name_not_blank
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT team_resource_folders_name_length
    CHECK (char_length(name) <= 120),
  CONSTRAINT team_resource_folders_icon_token
    CHECK (icon ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT team_resource_folders_color_token
    CHECK (color ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT team_resource_folders_position_non_negative
    CHECK (position >= 0),
  CONSTRAINT team_resource_folders_team_position_unique
    UNIQUE (team_id, position)
);

-- ── team_resource_links ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_resource_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.team_resource_folders(id) ON DELETE SET NULL,
  title text NOT NULL,
  url text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT team_resource_links_title_not_blank
    CHECK (char_length(btrim(title)) > 0),
  CONSTRAINT team_resource_links_title_length
    CHECK (char_length(title) <= 255),
  CONSTRAINT team_resource_links_url_length
    CHECK (char_length(url) <= 2048),
  CONSTRAINT team_resource_links_url_http_https
    CHECK (url ~* '^https?://'),
  CONSTRAINT team_resource_links_description_length
    CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT team_resource_links_position_non_negative
    CHECK (position >= 0)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- The two partial uniques are load-bearing: they are why reordering has to run
-- as two passes (park every row above the current maximum, then write the final
-- positions) rather than swapping in place.

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_resource_folders_team_name_ci
  ON public.team_resource_folders (team_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_team_resource_folders_team_position
  ON public.team_resource_folders (team_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_resource_links_team_folder_position_unique
  ON public.team_resource_links (team_id, folder_id, position)
  WHERE folder_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_resource_links_team_uncategorized_position_unique
  ON public.team_resource_links (team_id, position)
  WHERE folder_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_resource_links_team_folder_position
  ON public.team_resource_links (team_id, folder_id, position);

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_team_resource_link_folder_team()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_team_id uuid;
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT f.team_id
  INTO v_folder_team_id
  FROM public.team_resource_folders f
  WHERE f.id = NEW.folder_id;

  IF v_folder_team_id IS NULL THEN
    RAISE EXCEPTION 'Resource folder % does not exist', NEW.folder_id
      USING ERRCODE = '23503';
  END IF;

  IF v_folder_team_id <> NEW.team_id THEN
    RAISE EXCEPTION 'Resource link folder must belong to the same team'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ON DELETE SET NULL alone would drop the links into uncategorized carrying
-- their old positions, colliding with whatever is already there. This appends
-- them after the current maximum instead.
CREATE OR REPLACE FUNCTION public.move_team_resource_links_on_folder_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_position integer;
BEGIN
  SELECT COALESCE(MAX(l.position) + 1, 0)
  INTO v_next_position
  FROM public.team_resource_links l
  WHERE l.team_id = OLD.team_id
    AND l.folder_id IS NULL;

  WITH links_to_move AS (
    SELECT
      l.id,
      ROW_NUMBER() OVER (ORDER BY l.position, l.created_at, l.id) - 1 AS order_idx
    FROM public.team_resource_links l
    WHERE l.team_id = OLD.team_id
      AND l.folder_id = OLD.id
  )
  UPDATE public.team_resource_links l
  SET
    folder_id = NULL,
    position = v_next_position + m.order_idx,
    updated_at = now()
  FROM links_to_move m
  WHERE l.id = m.id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_resource_links_validate_folder_team
ON public.team_resource_links;
CREATE TRIGGER trg_team_resource_links_validate_folder_team
BEFORE INSERT OR UPDATE OF team_id, folder_id
ON public.team_resource_links
FOR EACH ROW
EXECUTE FUNCTION public.validate_team_resource_link_folder_team();

DROP TRIGGER IF EXISTS trg_team_resource_folders_move_links_before_delete
ON public.team_resource_folders;
CREATE TRIGGER trg_team_resource_folders_move_links_before_delete
BEFORE DELETE
ON public.team_resource_folders
FOR EACH ROW
EXECUTE FUNCTION public.move_team_resource_links_on_folder_delete();

DROP TRIGGER IF EXISTS trg_team_resource_folders_updated_at
ON public.team_resource_folders;
CREATE TRIGGER trg_team_resource_folders_updated_at
BEFORE UPDATE
ON public.team_resource_folders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_team_resource_links_updated_at
ON public.team_resource_links;
CREATE TRIGGER trg_team_resource_links_updated_at
BEFORE UPDATE
ON public.team_resource_links
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- The project resource tables ended up RLS-enabled with zero policies, because
-- a DROP ... CASCADE of is_project_member took their policies with it. That is
-- an accident, not a design, and it is why those tables are reachable only
-- through the service-role client. These get real policies: any team member
-- reads, only the owner and team admins write — the same split TeamsService
-- enforces in application code.

ALTER TABLE public.team_resource_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_resource_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_resource_folders_select ON public.team_resource_folders;
CREATE POLICY team_resource_folders_select
ON public.team_resource_folders
FOR SELECT
USING (public.is_team_member(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_folders_insert ON public.team_resource_folders;
CREATE POLICY team_resource_folders_insert
ON public.team_resource_folders
FOR INSERT
WITH CHECK (public.can_manage_team(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_folders_update ON public.team_resource_folders;
CREATE POLICY team_resource_folders_update
ON public.team_resource_folders
FOR UPDATE
USING (public.can_manage_team(team_id, auth.uid()))
WITH CHECK (public.can_manage_team(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_folders_delete ON public.team_resource_folders;
CREATE POLICY team_resource_folders_delete
ON public.team_resource_folders
FOR DELETE
USING (public.can_manage_team(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_links_select ON public.team_resource_links;
CREATE POLICY team_resource_links_select
ON public.team_resource_links
FOR SELECT
USING (public.is_team_member(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_links_insert ON public.team_resource_links;
CREATE POLICY team_resource_links_insert
ON public.team_resource_links
FOR INSERT
WITH CHECK (public.can_manage_team(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_links_update ON public.team_resource_links;
CREATE POLICY team_resource_links_update
ON public.team_resource_links
FOR UPDATE
USING (public.can_manage_team(team_id, auth.uid()))
WITH CHECK (public.can_manage_team(team_id, auth.uid()));

DROP POLICY IF EXISTS team_resource_links_delete ON public.team_resource_links;
CREATE POLICY team_resource_links_delete
ON public.team_resource_links
FOR DELETE
USING (public.can_manage_team(team_id, auth.uid()));

COMMENT ON TABLE public.team_resource_folders
IS 'Organizational folders for team resources (hyperlinks only).';

COMMENT ON TABLE public.team_resource_links
IS 'Hyperlink resources for teams, optionally grouped in folders.';
