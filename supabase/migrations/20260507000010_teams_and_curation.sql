-- Migration: 20260507000010_teams_and_curation.sql
-- Date: May 7, 2026
-- Description:
--   Linear-style Teams refactor (Migration A — additive).
--   Introduces global, reusable teams owned by any user. Teams are
--   attached to projects as primary or contributor. A new curation
--   table (project_team_members) is the source of truth for which team
--   members actually participate in each project — a project admin
--   curates the roster from the available team roster. A trigger fans
--   curation rows out to project_shares as team-derived rows.
--
--   Time rates move from project_member_time_rates (legacy) onto
--   team_members; task_time_logs gains rate_snapshot/currency_snapshot
--   so historical financial records are immutable.
--
--   project_shares uniqueness changes from (project_id, user_id) to
--   (project_id, user_id, origin) so a user can hold one direct row
--   plus one per attached team containing them.
--
--   Migration B (separate file, after verification) drops
--   project_member_time_rates and projects.consultant_id.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Teams + members
-- ---------------------------------------------------------------------

CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_owner ON public.teams (owner_id);

COMMENT ON TABLE public.teams IS 'Global, reusable team. Owned by any user; rate features gated to consultant-verified owners.';

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner','admin','member')),
  hourly_rate numeric(12,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  currency text,
  custom_id text,
  start_date date,
  end_date date,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX idx_team_members_team ON public.team_members (team_id);
CREATE INDEX idx_team_members_user ON public.team_members (user_id);

COMMENT ON TABLE public.team_members IS 'Roster of a team. Rate fields only writable when the team owner is consultant-verified.';

-- ---------------------------------------------------------------------
-- 2. Project ↔ team attachment
-- ---------------------------------------------------------------------

CREATE TABLE public.project_teams (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  default_role share_role NOT NULL DEFAULT 'editor',
  attached_by uuid REFERENCES public.profiles(id),
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);

CREATE UNIQUE INDEX project_teams_one_primary
  ON public.project_teams (project_id) WHERE is_primary;

CREATE INDEX idx_project_teams_team ON public.project_teams (team_id);

COMMENT ON TABLE public.project_teams IS 'Attached teams per project. ON DELETE RESTRICT on team_id so team deletion fails loudly while attached.';
COMMENT ON COLUMN public.project_teams.default_role IS 'Default role used when curating new members from this team onto the project.';

-- ---------------------------------------------------------------------
-- 3. Per-project curation: which team members participate
-- ---------------------------------------------------------------------

CREATE TABLE public.project_team_members (
  project_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role share_role NOT NULL,
  -- Per-(project, team, user) capability override layered on top of the
  -- role preset. Sync trigger composes project_shares.capabilities
  -- deterministically as (defaults for role) merged with this object.
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_by uuid REFERENCES public.profiles(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id, user_id),
  -- Attached team must exist; detaching cascades curation away.
  FOREIGN KEY (project_id, team_id)
    REFERENCES public.project_teams(project_id, team_id) ON DELETE CASCADE,
  -- Curated user must be a member of that team; leaving the team
  -- cascades them off every project they were curated onto.
  FOREIGN KEY (team_id, user_id)
    REFERENCES public.team_members(team_id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_project_team_members_user ON public.project_team_members (user_id);
CREATE INDEX idx_project_team_members_project ON public.project_team_members (project_id);

COMMENT ON TABLE public.project_team_members IS 'Source of truth for team-derived project shares. Insert/delete here drives the project_shares team:<id> rows.';

-- ---------------------------------------------------------------------
-- 4. projects.primary_team_id (denormalized pointer)
-- ---------------------------------------------------------------------

ALTER TABLE public.projects
  ADD COLUMN primary_team_id uuid REFERENCES public.teams(id);

COMMENT ON COLUMN public.projects.primary_team_id IS 'Denormalized pointer to project_teams.team_id WHERE is_primary. Null for personal-workspace projects. Sync trigger keeps it consistent.';

-- ---------------------------------------------------------------------
-- 5. project_shares uniqueness: (project_id, user_id) → (project_id, user_id, origin)
-- ---------------------------------------------------------------------

ALTER TABLE public.project_shares
  DROP CONSTRAINT IF EXISTS project_shares_project_id_user_id_key;

-- origin must be non-null for the new uniqueness contract; backfill any
-- existing nulls to a stable label first.
UPDATE public.project_shares SET origin = 'legacy' WHERE origin IS NULL;
ALTER TABLE public.project_shares
  ALTER COLUMN origin SET NOT NULL;

ALTER TABLE public.project_shares
  ADD CONSTRAINT project_shares_project_user_origin_unique
  UNIQUE (project_id, user_id, origin);

COMMENT ON COLUMN public.project_shares.origin IS 'Where the grant came from: client | consultant | invited | personal_workspace | legacy | team:<team_id>. Now part of the uniqueness contract.';

-- get_user_project_role: a user can have multiple rows now; return the
-- highest role across them.
CREATE OR REPLACE FUNCTION public.get_user_project_role(
  uid uuid,
  project uuid
)
RETURNS share_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.project_shares
  WHERE user_id = uid AND project_id = project
  ORDER BY CASE role
    WHEN 'owner'     THEN 5
    WHEN 'admin'     THEN 4
    WHEN 'editor'    THEN 3
    WHEN 'commenter' THEN 2
    WHEN 'viewer'    THEN 1
    ELSE 0
  END DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_user_project_role(uuid, uuid) IS 'Returns the maximum share_role for (uid, project) across all rows in project_shares (direct + team-derived). NULL if no grant.';

-- ---------------------------------------------------------------------
-- 6. task_time_logs rate snapshot
-- ---------------------------------------------------------------------

ALTER TABLE public.task_time_logs
  ADD COLUMN rate_snapshot numeric(12,2) NOT NULL DEFAULT 0
    CHECK (rate_snapshot >= 0),
  ADD COLUMN currency_snapshot text NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN public.task_time_logs.rate_snapshot IS 'Hourly rate frozen at log creation. Past logs are immutable financial records; later rate changes do not retroactively rewrite them.';
COMMENT ON COLUMN public.task_time_logs.currency_snapshot IS 'Currency frozen at log creation, paired with rate_snapshot.';

-- ---------------------------------------------------------------------
-- 7. Triggers
-- ---------------------------------------------------------------------

-- 7a. Block deletion of a team owner's own team_members row.
CREATE OR REPLACE FUNCTION public.tg_team_members_block_owner_delete()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = OLD.team_id AND t.owner_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot remove team owner from team_members; transfer ownership or delete the team first';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER team_members_block_owner_delete
  BEFORE DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_team_members_block_owner_delete();

-- 7b. Consultant-persona gate on rate writes.
CREATE OR REPLACE FUNCTION public.tg_team_members_check_consultant_for_rate()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_owner_verified boolean;
BEGIN
  IF NEW.hourly_rate IS NULL AND NEW.currency IS NULL
     AND NEW.start_date IS NULL AND NEW.end_date IS NULL
     AND NEW.custom_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- only check when at least one billing field is being set/changed
  IF TG_OP = 'UPDATE' THEN
    IF NEW.hourly_rate IS NOT DISTINCT FROM OLD.hourly_rate
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.custom_id IS NOT DISTINCT FROM OLD.custom_id
       AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
       AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT p.is_consultant_verified INTO v_owner_verified
  FROM public.teams t
  JOIN public.profiles p ON p.id = t.owner_id
  WHERE t.id = NEW.team_id;

  IF v_owner_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'Team owner must be consultant-verified to set rate fields on team_members';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER team_members_check_consultant_for_rate
  BEFORE INSERT OR UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_team_members_check_consultant_for_rate();

-- 7c. Sync project_team_members → project_shares (origin = 'team:<id>').
CREATE OR REPLACE FUNCTION public.tg_project_team_members_sync_shares()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_origin text;
  v_granted_by uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_origin := 'team:' || OLD.team_id::text;
    DELETE FROM public.project_shares
    WHERE project_id = OLD.project_id
      AND user_id    = OLD.user_id
      AND origin     = v_origin;
    RETURN OLD;
  END IF;

  v_origin := 'team:' || NEW.team_id::text;
  v_granted_by := NEW.added_by;

  INSERT INTO public.project_shares (
    project_id, user_id, role, origin, capabilities, granted_by
  ) VALUES (
    NEW.project_id, NEW.user_id, NEW.role, v_origin, NEW.capabilities, v_granted_by
  )
  ON CONFLICT (project_id, user_id, origin) DO UPDATE
    SET role = EXCLUDED.role,
        capabilities = EXCLUDED.capabilities,
        granted_by = EXCLUDED.granted_by;

  RETURN NEW;
END $$;

CREATE TRIGGER project_team_members_sync_shares
  AFTER INSERT OR UPDATE OR DELETE ON public.project_team_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_project_team_members_sync_shares();

-- 7d. Keep projects.primary_team_id in sync with project_teams.is_primary.
CREATE OR REPLACE FUNCTION public.tg_project_teams_sync_primary()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.is_primary THEN
      UPDATE public.projects
      SET primary_team_id = NEW.team_id
      WHERE id = NEW.project_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.is_primary AND NOT NEW.is_primary THEN
      -- Was primary, no longer is: clear the pointer if still pointing at this team.
      UPDATE public.projects
      SET primary_team_id = NULL
      WHERE id = NEW.project_id AND primary_team_id = NEW.team_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.is_primary THEN
    UPDATE public.projects
    SET primary_team_id = NULL
    WHERE id = OLD.project_id AND primary_team_id = OLD.team_id;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER project_teams_sync_primary
  AFTER INSERT OR UPDATE OR DELETE ON public.project_teams
  FOR EACH ROW EXECUTE FUNCTION public.tg_project_teams_sync_primary();

-- ---------------------------------------------------------------------
-- 8. RLS on the new tables
-- ---------------------------------------------------------------------

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_team_members ENABLE ROW LEVEL SECURITY;

-- teams: visible to owner and members; mutable by owner only.
CREATE POLICY teams_select ON public.teams
  FOR SELECT USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = teams.id AND tm.user_id = auth.uid()
    )
    OR EXISTS (
      -- Project members can see teams attached to their project (read-only).
      SELECT 1 FROM public.project_teams pt
      JOIN public.project_shares ps ON ps.project_id = pt.project_id
      WHERE pt.team_id = teams.id AND ps.user_id = auth.uid()
    )
  );

CREATE POLICY teams_insert ON public.teams
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY teams_update ON public.teams
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY teams_delete ON public.teams
  FOR DELETE USING (owner_id = auth.uid());

-- team_members: visible to team owner + team members; visible to project
-- members (names + roles only — rate fields gated in app layer / via
-- column-level filter in the read API). Mutations restricted to team
-- owner / team admins.
CREATE POLICY team_members_select ON public.team_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.owner_id = auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members me
      WHERE me.team_id = team_members.team_id AND me.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.project_teams pt
      JOIN public.project_shares ps ON ps.project_id = pt.project_id
      WHERE pt.team_id = team_members.team_id AND ps.user_id = auth.uid()
    )
  );

CREATE POLICY team_members_insert ON public.team_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.team_members me
      WHERE me.team_id = team_members.team_id
        AND me.user_id = auth.uid()
        AND me.role IN ('owner','admin')
    )
  );

CREATE POLICY team_members_update ON public.team_members
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.team_members me
      WHERE me.team_id = team_members.team_id
        AND me.user_id = auth.uid()
        AND me.role IN ('owner','admin')
    )
  );

CREATE POLICY team_members_delete ON public.team_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.team_members me
      WHERE me.team_id = team_members.team_id
        AND me.user_id = auth.uid()
        AND me.role IN ('owner','admin')
    )
  );

-- project_teams: visible to anyone with project access; mutable by
-- project admin/owner.
CREATE POLICY project_teams_select ON public.project_teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_teams.project_id AND ps.user_id = auth.uid()
    )
  );

CREATE POLICY project_teams_insert ON public.project_teams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_teams.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner','admin')
    )
  );

CREATE POLICY project_teams_update ON public.project_teams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_teams.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner','admin')
    )
  );

CREATE POLICY project_teams_delete ON public.project_teams
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_teams.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner','admin')
    )
  );

-- project_team_members: same gate as project_teams (project admin curates).
CREATE POLICY project_team_members_select ON public.project_team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_team_members.project_id AND ps.user_id = auth.uid()
    )
  );

CREATE POLICY project_team_members_insert ON public.project_team_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_team_members.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner','admin')
    )
  );

CREATE POLICY project_team_members_update ON public.project_team_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_team_members.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner','admin')
    )
  );

CREATE POLICY project_team_members_delete ON public.project_team_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_team_members.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner','admin')
    )
  );

-- ---------------------------------------------------------------------
-- 9. Wipe legacy rate / time-log rows (no backfill)
-- ---------------------------------------------------------------------
-- The new model represents rates per team_member, not per project_member.
-- Historical rows in project_member_time_rates can't be cleanly mapped
-- without a per-consultant team backfill (deemed not worth the
-- complexity for current data). Likewise existing task_time_logs would
-- have rate_snapshot = 0 with no way to recover the historical rate.
-- Per user direction: clear both tables and start fresh.
TRUNCATE TABLE public.task_time_logs RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.project_member_time_rates RESTART IDENTITY CASCADE;

COMMIT;
