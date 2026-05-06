-- Migration: 20260507000020_rename_project_shares_to_project_access.sql
-- Date: May 7, 2026
-- Description:
--   Rename `project_shares` → `project_access` for clarity.
--
--   The table sat next to `project_team_members` and the two read like
--   sibling tables when in fact one is the EFFECTIVE access list (read
--   by RLS, the resolver, every authorization check) and the other is
--   the team-curation source whose rows fan out via trigger. Renaming
--   the read view to `project_access` makes the relationship obvious:
--   `project_team_members` is the input; `project_access` is the output.
--
--   No data changes. No semantic changes. Pure rename plus refresh of
--   the few plpgsql function bodies that hard-code the table name (SQL
--   functions and RLS policy expressions track dependencies by OID and
--   keep working through `ALTER TABLE ... RENAME`).

BEGIN;

-- ─── Table + indexes + constraints ────────────────────────────────────────

ALTER TABLE public.project_shares RENAME TO project_access;

ALTER INDEX public.idx_project_shares_user RENAME TO idx_project_access_user;
ALTER INDEX public.idx_project_shares_project RENAME TO idx_project_access_project;

ALTER TABLE public.project_access
  RENAME CONSTRAINT project_shares_pkey TO project_access_pkey;

ALTER TABLE public.project_access
  RENAME CONSTRAINT project_shares_project_user_origin_unique
  TO project_access_project_user_origin_unique;

ALTER TABLE public.project_access
  RENAME CONSTRAINT project_shares_project_id_fkey TO project_access_project_id_fkey;
ALTER TABLE public.project_access
  RENAME CONSTRAINT project_shares_user_id_fkey TO project_access_user_id_fkey;
ALTER TABLE public.project_access
  RENAME CONSTRAINT project_shares_granted_by_fkey TO project_access_granted_by_fkey;

-- ─── RLS policy renames (cosmetic — references are OID-tracked) ───────────

ALTER POLICY project_shares_select ON public.project_access
  RENAME TO project_access_select;
ALTER POLICY project_shares_insert ON public.project_access
  RENAME TO project_access_insert;
ALTER POLICY project_shares_update ON public.project_access
  RENAME TO project_access_update;
ALTER POLICY project_shares_delete ON public.project_access
  RENAME TO project_access_delete;

-- ─── Refresh plpgsql functions whose bodies hard-code the table name ──────
--
-- plpgsql parses SQL inside its body lazily at execution; after the rename
-- the cached plan would resolve a no-longer-existing relation. SQL-language
-- functions and RLS expressions track dependencies by OID and don't need
-- the same treatment, but we refresh `get_user_project_role` and the chat
-- helper anyway so future readers see the new name in pg_get_functiondef.

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
  FROM public.project_access
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

COMMENT ON FUNCTION public.get_user_project_role(uuid, uuid) IS 'Returns the maximum share_role for (uid, project) across all rows in project_access (direct + team-derived). NULL if no grant.';

-- Chat helper (SQL-lang, OID-tracked, but refresh for clean pg_get text).
CREATE OR REPLACE FUNCTION public.project_chat_is_member(
  target_project_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = target_project_id
      AND (p.client_id = target_user_id OR p.consultant_id = target_user_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = target_project_id
      AND pa.user_id = target_user_id
  );
$$;

-- Chat helper (plpgsql) — must refresh because body hard-codes the name.
CREATE OR REPLACE FUNCTION public.project_chat_role(
  target_project_id uuid,
  target_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  project_row record;
  share_origin text;
BEGIN
  SELECT p.client_id, p.consultant_id
  INTO project_row
  FROM public.projects p
  WHERE p.id = target_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF target_user_id = project_row.consultant_id THEN
    RETURN 'consultant';
  END IF;

  IF target_user_id = project_row.client_id THEN
    RETURN 'client';
  END IF;

  SELECT pa.origin
  INTO share_origin
  FROM public.project_access pa
  WHERE pa.project_id = target_project_id
    AND pa.user_id = target_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF share_origin = 'consultant' THEN
    RETURN 'consultant';
  END IF;

  IF share_origin IN ('client', 'personal_workspace') THEN
    RETURN 'client';
  END IF;

  RETURN 'freelancer';
END;
$$;

-- Trigger function (plpgsql) — must refresh because body hard-codes the name.
CREATE OR REPLACE FUNCTION public.tg_project_team_members_sync_shares()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_origin text;
  v_granted_by uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_origin := 'team:' || OLD.team_id::text;
    DELETE FROM public.project_access
    WHERE project_id = OLD.project_id
      AND user_id    = OLD.user_id
      AND origin     = v_origin;
    RETURN OLD;
  END IF;

  v_origin := 'team:' || NEW.team_id::text;
  v_granted_by := NEW.added_by;

  INSERT INTO public.project_access (
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

-- ─── Documentation refresh ────────────────────────────────────────────────

COMMENT ON TABLE public.project_access IS
'Effective per-user access list for a project. Read by RLS policies, the resolver, and every authorization check. Rows come from two sources: (1) direct grants (origin in ''client'' | ''consultant'' | ''invited'' | ''personal_workspace'' | ''legacy''), inserted by the application when a user is added to the project directly; (2) team-derived grants (origin = ''team:<team_id>''), upserted by the project_team_members trigger when an admin curates a team member onto the project. Same user can hold one direct row plus one row per attached team. Effective role / capabilities are the OR-union across all rows.';

COMMENT ON COLUMN public.project_access.origin IS
'Source of the grant. Direct: ''client'' | ''consultant'' | ''invited'' | ''personal_workspace'' | ''legacy''. Team-derived: ''team:<team_id>''. Part of the uniqueness key — a user can hold multiple rows distinguished by origin.';

COMMENT ON TABLE public.project_team_members IS
'Curation source for team-derived rows in project_access. Says: "for this team attached to this project, these specific members participate, with these per-row capability overrides." A trigger (tg_project_team_members_sync_shares) fans inserts/updates/deletes here out to project_access(origin = team:<team_id>). Direct grants do NOT live here — they are inserted directly into project_access by the application.';

COMMIT;
