-- Roadmap template marketplace: schema, security, versioning and instantiation.
-- This is the expand phase; the legacy roadmaps flags are removed separately.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE TYPE public.roadmap_template_origin AS ENUM ('builtin', 'consultant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.roadmap_template_status AS ENUM ('draft', 'published', 'unlisted', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.roadmap_template_difficulty AS ENUM ('beginner', 'intermediate', 'advanced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.roadmap_template_schedule_kind AS ENUM ('long_term', 'short_learning');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.roadmap_template_report_status AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.roadmap_template_categories (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE,
  description text,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roadmap_public_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 20 AND 1200),
  preview_url text NOT NULL,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL,
  origin public.roadmap_template_origin NOT NULL,
  status public.roadmap_template_status NOT NULL DEFAULT 'draft',
  category_id uuid NOT NULL REFERENCES public.roadmap_template_categories(id) ON DELETE RESTRICT,
  difficulty public.roadmap_template_difficulty NOT NULL DEFAULT 'intermediate',
  schedule_kind public.roadmap_template_schedule_kind NOT NULL DEFAULT 'long_term',
  estimated_duration_days integer NOT NULL CHECK (estimated_duration_days BETWEEN 1 AND 3650),
  attribution_name text NOT NULL CHECK (length(trim(attribution_name)) BETWEEN 2 AND 160),
  attribution_url text,
  current_version_id uuid,
  is_featured boolean NOT NULL DEFAULT false,
  rights_attested_at timestamptz,
  published_at timestamptz,
  unlisted_at timestamptz,
  archived_at timestamptz,
  moderation_reason text,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  use_count bigint NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  duplicate_count bigint NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rating_count bigint NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  rating_average numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_average BETWEEN 0 AND 5),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_template_origin_owner_check CHECK (
    (origin = 'builtin' AND owner_id IS NULL) OR
    (origin = 'consultant' AND owner_id IS NOT NULL) OR
    (origin = 'consultant' AND owner_id IS NULL AND attribution_name <> '')
  ),
  CONSTRAINT roadmap_template_publish_metadata_check CHECK (
    status <> 'published' OR (published_at IS NOT NULL AND rights_attested_at IS NOT NULL)
  )
);

CREATE TABLE public.roadmap_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.roadmap_public_templates(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version > 0),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number),
  UNIQUE (template_id, checksum)
);

ALTER TABLE public.roadmap_public_templates
  ADD CONSTRAINT roadmap_public_templates_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES public.roadmap_template_versions(id) ON DELETE RESTRICT;

CREATE TABLE public.roadmap_template_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roadmap_public_template_tags (
  template_id uuid NOT NULL REFERENCES public.roadmap_public_templates(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.roadmap_template_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, tag_id)
);

CREATE TABLE public.roadmap_template_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.roadmap_public_templates(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.roadmap_template_versions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  roadmap_id uuid NOT NULL UNIQUE REFERENCES public.roadmaps(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  source_surface text NOT NULL DEFAULT 'marketplace' CHECK (source_surface IN ('landing', 'marketplace', 'roadmap_create', 'consultant', 'legacy_adapter')),
  idempotency_key uuid NOT NULL,
  start_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE public.roadmap_template_views (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES public.roadmap_public_templates(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  viewer_key text NOT NULL CHECK (viewer_key ~ '^[0-9a-f]{64}$'),
  viewed_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, viewer_key, viewed_on)
);

CREATE TABLE public.roadmap_template_ratings (
  template_id uuid NOT NULL REFERENCES public.roadmap_public_templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review text CHECK (review IS NULL OR length(review) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, user_id)
);

CREATE TABLE public.roadmap_template_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.roadmap_public_templates(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('copyright', 'unsafe', 'misleading', 'spam', 'other')),
  details text NOT NULL CHECK (length(trim(details)) BETWEEN 10 AND 2000),
  status public.roadmap_template_report_status NOT NULL DEFAULT 'open',
  moderation_note text,
  moderated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roadmap_templates_public_catalog
  ON public.roadmap_public_templates(status, is_featured DESC, published_at DESC, id DESC);
CREATE INDEX idx_roadmap_templates_category
  ON public.roadmap_public_templates(category_id, status, published_at DESC);
CREATE INDEX idx_roadmap_templates_owner
  ON public.roadmap_public_templates(owner_id, updated_at DESC);
CREATE INDEX idx_roadmap_templates_search
  ON public.roadmap_public_templates USING gin(search_vector);
CREATE INDEX idx_roadmap_template_tags_lookup
  ON public.roadmap_public_template_tags(tag_id, template_id);
CREATE INDEX idx_roadmap_template_usage_analytics
  ON public.roadmap_template_usages(template_id, created_at DESC);
CREATE INDEX idx_roadmap_template_view_analytics
  ON public.roadmap_template_views(template_id, created_at DESC);
CREATE INDEX idx_roadmap_template_reports_queue
  ON public.roadmap_template_reports(status, created_at ASC);

CREATE TRIGGER roadmap_template_categories_updated_at
  BEFORE UPDATE ON public.roadmap_template_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER roadmap_public_templates_updated_at
  BEFORE UPDATE ON public.roadmap_public_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER roadmap_template_ratings_updated_at
  BEFORE UPDATE ON public.roadmap_template_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER roadmap_template_reports_updated_at
  BEFORE UPDATE ON public.roadmap_template_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.prevent_roadmap_template_version_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Published roadmap template versions are immutable';
END;
$$;

CREATE TRIGGER roadmap_template_versions_immutable_update
  BEFORE UPDATE ON public.roadmap_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_roadmap_template_version_mutation();
CREATE TRIGGER roadmap_template_versions_immutable_delete
  BEFORE DELETE ON public.roadmap_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_roadmap_template_version_mutation();

CREATE OR REPLACE FUNCTION public.ensure_roadmap_template_rating_eligibility()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.roadmap_template_usages u
    WHERE u.template_id = NEW.template_id AND u.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'A template may only be rated after it has been used';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roadmap_template_rating_eligibility
  BEFORE INSERT OR UPDATE ON public.roadmap_template_ratings
  FOR EACH ROW EXECUTE FUNCTION public.ensure_roadmap_template_rating_eligibility();

CREATE OR REPLACE FUNCTION public.refresh_roadmap_template_aggregates()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_template_id uuid := COALESCE(NEW.template_id, OLD.template_id);
BEGIN
  UPDATE public.roadmap_public_templates t
  SET
    view_count = (SELECT count(*) FROM public.roadmap_template_views v WHERE v.template_id = v_template_id),
    use_count = (SELECT count(DISTINCT u.user_id) FROM public.roadmap_template_usages u WHERE u.template_id = v_template_id),
    duplicate_count = (SELECT count(*) FROM public.roadmap_template_usages u WHERE u.template_id = v_template_id),
    rating_count = (SELECT count(*) FROM public.roadmap_template_ratings r WHERE r.template_id = v_template_id),
    rating_average = COALESCE((SELECT round(avg(r.rating)::numeric, 2) FROM public.roadmap_template_ratings r WHERE r.template_id = v_template_id), 0)
  WHERE t.id = v_template_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER roadmap_template_usage_aggregate
  AFTER INSERT OR DELETE ON public.roadmap_template_usages
  FOR EACH ROW EXECUTE FUNCTION public.refresh_roadmap_template_aggregates();
CREATE TRIGGER roadmap_template_view_aggregate
  AFTER INSERT OR DELETE ON public.roadmap_template_views
  FOR EACH ROW EXECUTE FUNCTION public.refresh_roadmap_template_aggregates();
CREATE TRIGGER roadmap_template_rating_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON public.roadmap_template_ratings
  FOR EACH ROW EXECUTE FUNCTION public.refresh_roadmap_template_aggregates();

COMMENT ON TABLE public.roadmap_template_versions IS 'Immutable, sanitized roadmap template snapshots. Copies remain pinned to the version recorded in roadmap_template_usages.';
COMMENT ON COLUMN public.roadmap_template_views.viewer_key IS 'SHA-256 viewer fingerprint; never a raw IP address.';

-- Public catalog reads are allowed through RLS. All publication and
-- instantiation writes are performed by the service-role backend.
ALTER TABLE public.roadmap_template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_public_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_template_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_public_template_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_template_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_template_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_template_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_template_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY roadmap_template_categories_public_read
  ON public.roadmap_template_categories FOR SELECT
  USING (is_active = true);

CREATE POLICY roadmap_public_templates_catalog_read
  ON public.roadmap_public_templates FOR SELECT
  USING (status = 'published' OR owner_id = auth.uid());
CREATE POLICY roadmap_template_versions_public_read
  ON public.roadmap_template_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.roadmap_public_templates t
    WHERE t.id = template_id AND (t.status = 'published' OR t.owner_id = auth.uid())
  ));
CREATE POLICY roadmap_template_tags_public_read
  ON public.roadmap_template_tags FOR SELECT USING (true);
CREATE POLICY roadmap_public_template_tags_public_read
  ON public.roadmap_public_template_tags FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.roadmap_public_templates t
    WHERE t.id = template_id AND (t.status = 'published' OR t.owner_id = auth.uid())
  ));

CREATE POLICY roadmap_template_usages_owner_read
  ON public.roadmap_template_usages FOR SELECT USING (user_id = auth.uid());

CREATE POLICY roadmap_template_ratings_public_read
  ON public.roadmap_template_ratings FOR SELECT USING (true);
CREATE POLICY roadmap_template_ratings_owner_insert
  ON public.roadmap_template_ratings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY roadmap_template_ratings_owner_update
  ON public.roadmap_template_ratings FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY roadmap_template_ratings_owner_delete
  ON public.roadmap_template_ratings FOR DELETE USING (user_id = auth.uid());

CREATE POLICY roadmap_template_reports_owner_insert
  ON public.roadmap_template_reports FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY roadmap_template_reports_owner_read
  ON public.roadmap_template_reports FOR SELECT
  USING (
    reporter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.admin_profiles a
      WHERE a.user_id = auth.uid() AND a.is_active = true
        AND a.access_level IN ('moderator', 'super_admin')
    )
  );
CREATE POLICY roadmap_template_reports_moderator_update
  ON public.roadmap_template_reports FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.admin_profiles a
    WHERE a.user_id = auth.uid() AND a.is_active = true
      AND a.access_level IN ('moderator', 'super_admin')
  ));

CREATE OR REPLACE FUNCTION public.instantiate_roadmap_public_template(
  p_template_id uuid,
  p_template_version_id uuid,
  p_user_id uuid,
  p_project_id uuid,
  p_start_date date,
  p_idempotency_key uuid,
  p_source_surface text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_template public.roadmap_public_templates%ROWTYPE;
  v_version public.roadmap_template_versions%ROWTYPE;
  v_existing_usage public.roadmap_template_usages%ROWTYPE;
  v_existing_roadmap_id uuid;
  v_roadmap_id uuid := gen_random_uuid();
  v_epic jsonb;
  v_feature jsonb;
  v_task jsonb;
  v_milestone jsonb;
  v_feature_key text;
  v_epic_id uuid;
  v_feature_id uuid;
  v_task_id uuid;
  v_milestone_id uuid;
  v_epic_index integer;
  v_feature_index integer;
  v_task_index integer;
  v_milestone_index integer;
  v_feature_keys text[] := ARRAY[]::text[];
  v_feature_ids uuid[] := ARRAY[]::uuid[];
  v_start_offset integer;
  v_end_offset integer := 0;
  v_link_position integer;
  v_content jsonb;
  v_roadmap_name text;
  v_project_role text;
  v_child_count bigint;
BEGIN
  IF p_user_id IS NULL OR p_start_date IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'user, start_date and idempotency_key are required';
  END IF;
  IF p_source_surface NOT IN ('landing', 'marketplace', 'roadmap_create', 'consultant', 'legacy_adapter') THEN
    RAISE EXCEPTION 'Invalid source surface';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key::text, 0));

  SELECT * INTO v_existing_usage
  FROM public.roadmap_template_usages
  WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'roadmap_id', v_existing_usage.roadmap_id,
      'project_id', v_existing_usage.project_id,
      'template_id', v_existing_usage.template_id,
      'template_version_id', v_existing_usage.template_version_id,
      'idempotent_replay', true
    );
  END IF;

  SELECT * INTO v_template
  FROM public.roadmap_public_templates
  WHERE id = p_template_id AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'Published template not found'; END IF;

  SELECT * INTO v_version
  FROM public.roadmap_template_versions
  WHERE id = COALESCE(p_template_version_id, v_template.current_version_id)
    AND template_id = v_template.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template version not found'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF p_project_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('roadmap-template-project:' || p_project_id::text, 0));
    SELECT public.get_user_project_role(p_user_id, p_project_id)::text INTO v_project_role;
    IF v_project_role IS NULL OR v_project_role NOT IN ('owner', 'admin', 'editor') THEN
      RAISE EXCEPTION 'Project edit access required';
    END IF;

    SELECT r.id INTO v_existing_roadmap_id
    FROM public.roadmaps r
    WHERE r.project_id = p_project_id
    ORDER BY r.created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF v_existing_roadmap_id IS NOT NULL THEN
      SELECT
        (SELECT count(*) FROM public.roadmap_milestones m WHERE m.roadmap_id = v_existing_roadmap_id) +
        (SELECT count(*) FROM public.roadmap_epics e WHERE e.roadmap_id = v_existing_roadmap_id)
      INTO v_child_count;
      IF v_child_count > 0 THEN
        RAISE EXCEPTION 'Project already has a non-empty roadmap';
      END IF;
      DELETE FROM public.roadmaps WHERE id = v_existing_roadmap_id;
    END IF;
  END IF;

  v_content := v_version.content;
  v_roadmap_name := COALESCE(v_content #>> '{roadmap,name}', v_template.title);

  SELECT COALESCE(max((node ->> 'end_day_offset')::integer), 0)
  INTO v_end_offset
  FROM jsonb_array_elements(COALESCE(v_content -> 'epics', '[]'::jsonb)) node;

  INSERT INTO public.roadmaps (
    id, project_id, name, description, owner_id, status,
    start_date, end_date, settings, preview_url, category
  ) VALUES (
    v_roadmap_id, p_project_id, v_roadmap_name,
    COALESCE(v_content #>> '{roadmap,description}', v_template.summary),
    p_user_id, 'draft',
    (p_start_date::timestamp AT TIME ZONE 'UTC'),
    ((p_start_date + v_end_offset)::timestamp AT TIME ZONE 'UTC'),
    jsonb_build_object(
      'template_id', v_template.id,
      'template_version_id', v_version.id,
      'template_attribution', v_template.attribution_name
    ),
    v_template.preview_url,
    (SELECT c.name FROM public.roadmap_template_categories c WHERE c.id = v_template.category_id)
  );

  FOR v_epic, v_epic_index IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(COALESCE(v_content -> 'epics', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    v_epic_id := gen_random_uuid();
    INSERT INTO public.roadmap_epics (
      id, roadmap_id, title, description, priority, status, position,
      start_date, end_date, tags
    ) VALUES (
      v_epic_id, v_roadmap_id,
      trim(concat_ws(' ', v_epic ->> 'time_label', v_epic ->> 'title')),
      v_epic ->> 'description',
      COALESCE(NULLIF(v_epic ->> 'priority', ''), 'medium')::public.epic_priority,
      'backlog', v_epic_index - 1,
      ((p_start_date + COALESCE((v_epic ->> 'start_day_offset')::integer, 0))::timestamp AT TIME ZONE 'UTC'),
      ((p_start_date + COALESCE((v_epic ->> 'end_day_offset')::integer, 0))::timestamp AT TIME ZONE 'UTC'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_epic -> 'tags', '[]'::jsonb))), ARRAY[]::text[])
    );

    FOR v_feature, v_feature_index IN
      SELECT value, ordinality::integer
      FROM jsonb_array_elements(COALESCE(v_epic -> 'features', '[]'::jsonb)) WITH ORDINALITY
    LOOP
      v_feature_id := gen_random_uuid();
      v_feature_keys := array_append(v_feature_keys, v_feature ->> 'key');
      v_feature_ids := array_append(v_feature_ids, v_feature_id);
      INSERT INTO public.roadmap_features (
        id, epic_id, roadmap_id, title, description, position,
        is_deliverable, start_date, end_date
      ) VALUES (
        v_feature_id, v_epic_id, v_roadmap_id,
        trim(concat_ws(' ', v_feature ->> 'time_label', v_feature ->> 'title')),
        v_feature ->> 'description', v_feature_index - 1,
        COALESCE((v_feature ->> 'is_deliverable')::boolean, true),
        ((p_start_date + COALESCE((v_feature ->> 'start_day_offset')::integer, 0))::timestamp AT TIME ZONE 'UTC'),
        ((p_start_date + COALESCE((v_feature ->> 'end_day_offset')::integer, 0))::timestamp AT TIME ZONE 'UTC')
      );

      FOR v_task, v_task_index IN
        SELECT value, ordinality::integer
        FROM jsonb_array_elements(COALESCE(v_feature -> 'tasks', '[]'::jsonb)) WITH ORDINALITY
      LOOP
        v_task_id := gen_random_uuid();
        INSERT INTO public.roadmap_tasks (
          id, feature_id, title, description, status, priority, position,
          due_date, checklist, work_type, assignee_id
        ) VALUES (
          v_task_id, v_feature_id, v_task ->> 'title', v_task ->> 'description',
          'todo', COALESCE(NULLIF(v_task ->> 'priority', ''), 'medium')::public.task_priority,
          COALESCE((v_task ->> 'position')::integer, v_task_index - 1),
          CASE WHEN v_task ? 'due_day_offset'
            THEN ((p_start_date + (v_task ->> 'due_day_offset')::integer)::timestamp AT TIME ZONE 'UTC')
            ELSE NULL END,
          COALESCE(v_task -> 'checklist', '[]'::jsonb),
          COALESCE(NULLIF(v_task ->> 'work_type', ''), 'real_work'),
          NULL
        );
      END LOOP;
    END LOOP;
  END LOOP;

  FOR v_milestone, v_milestone_index IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(COALESCE(v_content -> 'milestones', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    v_milestone_id := gen_random_uuid();
    INSERT INTO public.roadmap_milestones (
      id, roadmap_id, title, description, target_date, completed_date,
      status, position
    ) VALUES (
      v_milestone_id, v_roadmap_id,
      trim(concat_ws(' ', v_milestone ->> 'time_label', v_milestone ->> 'title')),
      v_milestone ->> 'description',
      ((p_start_date + COALESCE((v_milestone ->> 'target_day_offset')::integer, 0))::timestamp AT TIME ZONE 'UTC'),
      NULL, 'not_started', v_milestone_index - 1
    );

    v_link_position := 0;
    FOR v_feature_key IN
      SELECT value FROM jsonb_array_elements_text(COALESCE(v_milestone -> 'feature_keys', '[]'::jsonb))
    LOOP
      IF array_position(v_feature_keys, v_feature_key) IS NULL THEN
        RAISE EXCEPTION 'Milestone references missing feature key %', v_feature_key;
      END IF;
      INSERT INTO public.milestone_features (milestone_id, feature_id, position)
      VALUES (v_milestone_id, v_feature_ids[array_position(v_feature_keys, v_feature_key)], v_link_position);
      v_link_position := v_link_position + 1;
    END LOOP;
  END LOOP;

  INSERT INTO public.roadmap_template_usages (
    template_id, template_version_id, user_id, roadmap_id, project_id,
    source_surface, idempotency_key, start_date
  ) VALUES (
    v_template.id, v_version.id, p_user_id, v_roadmap_id, p_project_id,
    p_source_surface, p_idempotency_key, p_start_date
  );

  RETURN jsonb_build_object(
    'roadmap_id', v_roadmap_id,
    'project_id', p_project_id,
    'template_id', v_template.id,
    'template_version_id', v_version.id,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instantiate_roadmap_public_template(uuid, uuid, uuid, uuid, date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instantiate_roadmap_public_template(uuid, uuid, uuid, uuid, date, uuid, text) TO service_role;
