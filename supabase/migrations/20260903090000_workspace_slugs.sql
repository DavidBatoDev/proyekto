-- Workspace URL slugs: /w/<slug>/...
--
-- All slug logic lives here in Postgres, enforced by a trigger, so every insert
-- path — WorkspacesService.createWorkspace, the provision_default_workspace RPC,
-- migrations and seeds — gets a slug without knowing the rule, and allocation is
-- race-safe (advisory lock and insert in one transaction, which a client-side
-- select-then-insert loop cannot be). provision_default_workspace needs no
-- redefinition: its INSERT ... RETURNING * picks up the trigger-filled slug.
--
-- Uniqueness spans three tables: live slugs, retired slugs (which keep
-- redirecting), and reserved words that collide with routes. The reserved list
-- is a table, not a TypeScript constant, because the backfill, the trigger and
-- the RPC never pass through TypeScript; the API validates shape only.
--
-- Order matters: the guard trigger is created AFTER the backfill so the
-- backfill's NULL -> slug updates do not take the rename branch.

BEGIN;

-- ── 0. Accent folding ───────────────────────────────────────────────────────
-- Available but not installed on either project until now. One prod workspace
-- name carries a non-ASCII character today.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ── 1. Column, nullable first ───────────────────────────────────────────────

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS slug text;

-- ── 2. Reserved words ───────────────────────────────────────────────────────
-- Anything that is a route segment inside /w/<slug>/ or at the root. Add a row
-- whenever a new top-level web route is created.

CREATE TABLE IF NOT EXISTS public.workspace_reserved_slugs (
  slug text PRIMARY KEY
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  note text
);

INSERT INTO public.workspace_reserved_slugs (slug, note) VALUES
  ('me', 'route'), ('new', 'route'), ('edit', 'route'), ('create', 'route'),
  ('index', 'route'), ('settings', 'route'), ('invites', 'route'),
  ('teams', 'route'), ('time', 'route'), ('members', 'route'),
  ('billing', 'route'), ('general', 'route'), ('logs', 'route'),
  ('projects', 'route'), ('my-logs', 'route'), ('team-logs', 'route'),
  ('payouts', 'route'), ('manage-rates', 'route'), ('log', 'route'),
  ('api', 'infra'), ('w', 'infra'), ('admin', 'infra'), ('auth', 'infra'),
  ('static', 'infra'), ('assets', 'infra'), ('app', 'infra'), ('www', 'infra'),
  ('dashboard', 'top-level'), ('command-center', 'top-level'),
  ('meetings', 'top-level'), ('inbox', 'top-level'),
  ('engagements', 'top-level'), ('notifications', 'top-level'),
  ('onboarding', 'top-level'), ('welcome', 'top-level'),
  ('profile', 'top-level'), ('project', 'top-level'), ('roadmap', 'top-level'),
  ('roadmap-templates', 'top-level'), ('marketplace', 'top-level'),
  ('contract', 'top-level'), ('oauth', 'top-level'),
  ('unsubscribe', 'top-level'), ('start-selling', 'top-level'),
  ('work-items', 'top-level'), ('workspace', 'top-level'),
  ('freelancer', 'top-level'), ('brief', 'top-level'),
  ('login', 'auth'), ('signup', 'auth'), ('sign-in', 'auth'),
  ('sign-up', 'auth'), ('register', 'auth'), ('logout', 'auth'),
  ('docs', 'site'), ('help', 'site'), ('support', 'site'), ('terms', 'site'),
  ('privacy', 'site'), ('status', 'site')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.workspace_reserved_slugs ENABLE ROW LEVEL SECURITY;

-- Route names are public knowledge; the list is safe to read.
DROP POLICY IF EXISTS workspace_reserved_slugs_select ON public.workspace_reserved_slugs;
CREATE POLICY workspace_reserved_slugs_select
ON public.workspace_reserved_slugs
FOR SELECT
USING (true);

REVOKE ALL ON TABLE public.workspace_reserved_slugs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.workspace_reserved_slugs TO authenticated;
GRANT ALL ON TABLE public.workspace_reserved_slugs TO service_role;

-- ── 3. Retired slugs ────────────────────────────────────────────────────────
-- slug is the primary key: a retired slug redirects to exactly one workspace,
-- and can never be allocated to a new one while it does.

CREATE TABLE IF NOT EXISTS public.workspace_slug_history (
  slug text PRIMARY KEY
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  replaced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_slug_history_workspace_id
  ON public.workspace_slug_history(workspace_id);

ALTER TABLE public.workspace_slug_history ENABLE ROW LEVEL SECURITY;

-- Members can see their own workspace's retired slugs, which is what lets the
-- web redirect an old link without any endpoint that could enumerate others.
DROP POLICY IF EXISTS workspace_slug_history_select ON public.workspace_slug_history;
CREATE POLICY workspace_slug_history_select
ON public.workspace_slug_history
FOR SELECT
USING (public.is_workspace_member(workspace_id, auth.uid()));

REVOKE ALL ON TABLE public.workspace_slug_history FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.workspace_slug_history TO authenticated;
GRANT ALL ON TABLE public.workspace_slug_history TO service_role;

-- ── 4. Slugify ──────────────────────────────────────────────────────────────
-- Apostrophes are dropped BEFORE the non-alphanumeric pass so "Teleg's" becomes
-- "telegs" rather than "teleg-s". STABLE because unaccent is. Executable by
-- authenticated so the web can show a live "your URL will be ..." preview
-- without re-implementing the algorithm.

CREATE OR REPLACE FUNCTION public.slugify_workspace_name(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  v := regexp_replace(coalesce(p_name, ''), '[''’]', '', 'g');
  v := extensions.unaccent('extensions.unaccent'::regdictionary, v);
  v := lower(v);
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := btrim(v, '-');
  v := btrim(left(v, 60), '-');
  IF v = '' THEN
    RETURN 'workspace';
  END IF;
  IF char_length(v) < 3 THEN
    RETURN v || '-workspace';
  END IF;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.slugify_workspace_name(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workspace_slug_is_free(p_slug text, p_exclude_workspace_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
           SELECT 1 FROM public.workspace_reserved_slugs r WHERE r.slug = p_slug
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.workspaces w
           WHERE w.slug = p_slug
             AND (p_exclude_workspace_id IS NULL OR w.id <> p_exclude_workspace_id)
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.workspace_slug_history h
           WHERE h.slug = p_slug
             AND (p_exclude_workspace_id IS NULL OR h.workspace_id <> p_exclude_workspace_id)
         );
$$;

-- ── 5. Allocator ────────────────────────────────────────────────────────────
-- The advisory lock serialises callers with the SAME base, so two concurrent
-- "Acme" inserts cannot both see "acme" as free. The unique index below is the
-- backstop for everything else.

CREATE OR REPLACE FUNCTION public.next_workspace_slug(p_name text, p_exclude_workspace_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text := public.slugify_workspace_name(p_name);
  v_candidate text := v_base;
  v_n integer := 1;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-slug:' || v_base, 0));
  LOOP
    IF public.workspace_slug_is_free(v_candidate, p_exclude_workspace_id) THEN
      RETURN v_candidate;
    END IF;
    v_n := v_n + 1;
    IF v_n > 1000 THEN
      RAISE EXCEPTION 'Unable to allocate a workspace slug for "%"', v_base
        USING ERRCODE = 'unique_violation';
    END IF;
    v_candidate := rtrim(left(v_base, 60 - char_length('-' || v_n), '-') || '-' || v_n;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.next_workspace_slug(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_workspace_slug(text, uuid) TO service_role;

-- ── 6. Backfill ─────────────────────────────────────────────────────────────
-- One UPDATE per row so the allocation order is the one chosen here, not the
-- table's physical order. Oldest wins the bare slug; the personal workspaces
-- all share the original backfill instant, so among those the one that holds
-- teams wins, then id for determinism.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT w.id, w.name
    FROM public.workspaces w
    WHERE w.slug IS NULL
    ORDER BY w.created_at,
             (SELECT count(*) FROM public.teams t WHERE t.workspace_id = w.id) DESC,
             w.id
  LOOP
    UPDATE public.workspaces
    SET slug = public.next_workspace_slug(r.name, r.id)
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- ── 7. Constraints, now that every row has a value ──────────────────────────

ALTER TABLE public.workspaces ALTER COLUMN slug SET NOT NULL;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_slug_format;
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_slug_format CHECK (
  slug = lower(slug)
  AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  AND char_length(slug) BETWEEN 3 AND 60
  -- A uuid-shaped slug could never be told apart from an id in a URL.
  AND slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_key ON public.workspaces(slug);

-- ── 8. Guard trigger ────────────────────────────────────────────────────────
-- Auto-fills on insert; on an explicit slug (rename, or an insert naming its
-- own) validates, refuses, reclaims and archives. Every refusal raises with
-- ERRCODE unique_violation (23505) and a user-facing message so the API maps
-- them to one 409; format failures hit the CHECK above (23514) instead.

CREATE OR REPLACE FUNCTION public.workspaces_slug_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_history_owner uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.slug IS NULL THEN
    NEW.slug := public.next_workspace_slug(NEW.name, NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.slug IS NOT DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.workspace_reserved_slugs r WHERE r.slug = NEW.slug) THEN
    RAISE EXCEPTION 'The URL "%" is reserved', NEW.slug
      USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.workspaces w WHERE w.slug = NEW.slug AND w.id <> NEW.id) THEN
    RAISE EXCEPTION 'The URL "%" is already taken', NEW.slug
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT h.workspace_id INTO v_history_owner
  FROM public.workspace_slug_history h
  WHERE h.slug = NEW.slug;

  IF v_history_owner IS NOT NULL AND v_history_owner <> NEW.id THEN
    RAISE EXCEPTION 'The URL "%" still redirects to another workspace', NEW.slug
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Renaming back to one of your own old slugs reclaims it.
  IF v_history_owner = NEW.id THEN
    DELETE FROM public.workspace_slug_history WHERE slug = NEW.slug;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.slug IS NOT NULL THEN
    INSERT INTO public.workspace_slug_history (slug, workspace_id)
    VALUES (OLD.slug, NEW.id)
    ON CONFLICT (slug) DO UPDATE
      SET workspace_id = EXCLUDED.workspace_id,
          replaced_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_slug_guard ON public.workspaces;
CREATE TRIGGER trg_workspaces_slug_guard
BEFORE INSERT OR UPDATE OF slug ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.workspaces_slug_guard();

COMMENT ON COLUMN public.workspaces.slug IS
  'URL segment under /w/<slug>/. Auto-derived from name on insert by trg_workspaces_slug_guard; owner-editable; old values live in workspace_slug_history and keep redirecting.';
COMMENT ON TABLE public.workspace_slug_history IS
  'Retired workspace slugs. A slug here is never live on another workspace and cannot be allocated to a new one; renaming back to your own old slug removes the row.';
COMMENT ON TABLE public.workspace_reserved_slugs IS
  'Slugs that collide with routes. Single source of truth: next_workspace_slug and trg_workspaces_slug_guard read it; the API only validates shape. Add a row whenever a new top-level web route is created.';

COMMIT;
