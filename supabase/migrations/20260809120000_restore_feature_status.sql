-- Reintroduce a persisted status on roadmap_features.
--
-- Feature status was previously dropped (20260514120000_drop_feature_status.sql)
-- because it was a second source of truth that drifted from child task state.
-- It's coming back, but this time the backend owns writing it: whenever a
-- feature's tasks change, the NestJS layer recomputes the cascade status
-- (backend/src/modules/roadmaps/services/derive-feature-status.ts) and writes
-- it here. The column is only client-writable through the API when the
-- feature currently has zero tasks (enforced in FeaturesService, not here) —
-- that lets a task-less feature be marked e.g. "completed" by hand, while a
-- feature with tasks always reflects the derived value.
--
-- This migration intentionally keeps upsert_full_roadmap "dumb": it just
-- writes whatever status value the JSONB payload carries (defaulting to
-- 'not_started'), with no cascade logic in SQL — the caller
-- (roadmap-patch.service.ts) is responsible for pre-computing the correct
-- value per feature before invoking this RPC. Body rebuilt from the newest
-- defining migration (20260720120100_upsert_full_roadmap_revision_guard.sql)
-- per the latest-function-body rule — NOT from the stale
-- 20260514120000_drop_feature_status.sql body.

CREATE TYPE public.feature_status AS ENUM (
  'not_started',
  'in_progress',
  'in_review',
  'completed',
  'blocked'
);

ALTER TABLE public.roadmap_features
  ADD COLUMN status public.feature_status NOT NULL DEFAULT 'not_started';

CREATE INDEX idx_roadmap_features_status ON public.roadmap_features(status);

CREATE OR REPLACE FUNCTION public.upsert_full_roadmap(
  p_roadmap_id uuid,
  p_owner_id uuid,
  p_full_state jsonb,
  p_create_if_missing boolean DEFAULT false,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_roadmap_id uuid;
  v_existing_owner_id uuid;

  v_epic jsonb;
  v_feature jsonb;
  v_task jsonb;

  v_epic_id uuid;
  v_feature_id uuid;
  v_task_id uuid;

  v_epic_index integer;
  v_feature_index integer;
  v_task_index integer;

  v_milestone jsonb;
  v_milestone_id uuid;
  v_milestone_index integer;

  incoming_milestone_ids uuid[] := ARRAY[]::uuid[];
  incoming_epic_ids uuid[] := ARRAY[]::uuid[];
  incoming_feature_ids uuid[] := ARRAY[]::uuid[];
  incoming_task_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  v_roadmap_id := COALESCE((p_full_state ->> 'id')::uuid, p_roadmap_id);

  IF v_roadmap_id IS NULL THEN
    RAISE EXCEPTION 'Roadmap id is required';
  END IF;

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Owner id is required';
  END IF;

  SELECT owner_id
  INTO v_existing_owner_id
  FROM public.roadmaps
  WHERE id = v_roadmap_id;

  IF v_existing_owner_id IS NULL THEN
    IF NOT p_create_if_missing THEN
      RAISE EXCEPTION 'Roadmap % not found', v_roadmap_id;
    END IF;

    INSERT INTO public.roadmaps (
      id,
      owner_id,
      project_id,
      name,
      description,
      status,
      start_date,
      end_date,
      settings,
      updated_at
    )
    VALUES (
      v_roadmap_id,
      p_owner_id,
      NULLIF(p_full_state ->> 'project_id', '')::uuid,
      p_full_state ->> 'name',
      p_full_state ->> 'description',
      COALESCE(NULLIF(p_full_state ->> 'status', ''), 'draft')::roadmap_status,
      NULLIF(p_full_state ->> 'start_date', '')::timestamptz,
      NULLIF(p_full_state ->> 'end_date', '')::timestamptz,
      COALESCE(p_full_state -> 'settings', '{}'::jsonb),
      NOW()
    );
  ELSE
    IF v_existing_owner_id <> p_owner_id THEN
      RAISE EXCEPTION 'Not the owner';
    END IF;

    -- Opt-in optimistic-concurrency guard: when a baseline is supplied, the
    -- UPDATE only matches if updated_at is still that baseline. A concurrent
    -- writer that bumped updated_at leaves 0 rows matched → STALE_REVISION.
    UPDATE public.roadmaps
    SET
      owner_id = p_owner_id,
      project_id = NULLIF(p_full_state ->> 'project_id', '')::uuid,
      name = COALESCE(p_full_state ->> 'name', name),
      description = COALESCE(p_full_state ->> 'description', description),
      status = COALESCE(NULLIF(p_full_state ->> 'status', ''), status::text)::roadmap_status,
      start_date = COALESCE(NULLIF(p_full_state ->> 'start_date', '')::timestamptz, start_date),
      end_date = COALESCE(NULLIF(p_full_state ->> 'end_date', '')::timestamptz, end_date),
      settings = COALESCE(p_full_state -> 'settings', settings),
      updated_at = NOW()
    WHERE id = v_roadmap_id
      AND (p_expected_updated_at IS NULL OR updated_at = p_expected_updated_at);

    IF p_expected_updated_at IS NOT NULL AND NOT FOUND THEN
      RAISE EXCEPTION 'STALE_REVISION' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Evacuate live positions so the row-by-row upserts below can never collide
  -- with a row that is reordered or deleted later in this same call.
  UPDATE public.roadmap_epics
  SET position = position + 1000000
  WHERE roadmap_id = v_roadmap_id;

  UPDATE public.roadmap_features f
  SET position = f.position + 1000000
  FROM public.roadmap_epics e
  WHERE f.epic_id = e.id
    AND e.roadmap_id = v_roadmap_id;

  UPDATE public.roadmap_tasks t
  SET position = t.position + 1000000
  FROM public.roadmap_features f, public.roadmap_epics e
  WHERE t.feature_id = f.id
    AND f.epic_id = e.id
    AND e.roadmap_id = v_roadmap_id;


  IF p_full_state ? 'roadmap_milestones' THEN
    UPDATE public.roadmap_milestones
    SET position = position + 1000000
    WHERE roadmap_id = v_roadmap_id;
  END IF;

  FOR v_milestone, v_milestone_index IN
    SELECT value, ordinality::int
    FROM jsonb_array_elements(COALESCE(p_full_state -> 'roadmap_milestones', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    v_milestone_id := COALESCE(NULLIF(v_milestone ->> 'id', '')::uuid, gen_random_uuid());

    INSERT INTO public.roadmap_milestones (
      id,
      roadmap_id,
      title,
      description,
      status,
      target_date,
      completed_date,
      position,
      color,
      updated_at
    )
    VALUES (
      v_milestone_id,
      v_roadmap_id,
      v_milestone ->> 'title',
      v_milestone ->> 'description',
      COALESCE(NULLIF(v_milestone ->> 'status', ''), 'not_started')::roadmap_milestone_status,
      (v_milestone ->> 'target_date')::timestamptz,
      NULLIF(v_milestone ->> 'completed_date', '')::timestamptz,
      COALESCE(NULLIF(v_milestone ->> 'position', '')::int, v_milestone_index - 1),
      v_milestone ->> 'color',
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      roadmap_id = EXCLUDED.roadmap_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      target_date = EXCLUDED.target_date,
      completed_date = EXCLUDED.completed_date,
      position = EXCLUDED.position,
      color = EXCLUDED.color,
      updated_at = NOW();

    incoming_milestone_ids := array_append(incoming_milestone_ids, v_milestone_id);
  END LOOP;

  IF p_full_state ? 'roadmap_milestones' THEN
    IF cardinality(incoming_milestone_ids) = 0 THEN
      DELETE FROM public.roadmap_milestones m
      WHERE m.roadmap_id = v_roadmap_id;
    ELSE
      DELETE FROM public.roadmap_milestones m
      WHERE m.roadmap_id = v_roadmap_id
        AND NOT (m.id = ANY (incoming_milestone_ids));
    END IF;
  END IF;

  FOR v_epic, v_epic_index IN
    SELECT value, ordinality::int
    FROM jsonb_array_elements(COALESCE(p_full_state -> 'roadmap_epics', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    v_epic_id := COALESCE(NULLIF(v_epic ->> 'id', '')::uuid, gen_random_uuid());

    INSERT INTO public.roadmap_epics (
      id,
      roadmap_id,
      title,
      description,
      priority,
      status,
      position,
      color,
      start_date,
      end_date,
      tags,
      updated_at
    )
    VALUES (
      v_epic_id,
      v_roadmap_id,
      v_epic ->> 'title',
      v_epic ->> 'description',
      COALESCE(NULLIF(v_epic ->> 'priority', ''), 'medium')::epic_priority,
      COALESCE(NULLIF(v_epic ->> 'status', ''), 'backlog')::epic_status,
      COALESCE(NULLIF(v_epic ->> 'position', '')::int, v_epic_index - 1),
      v_epic ->> 'color',
      NULLIF(v_epic ->> 'start_date', '')::timestamptz,
      NULLIF(v_epic ->> 'end_date', '')::timestamptz,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_epic -> 'tags', '[]'::jsonb))),
        ARRAY[]::text[]
      ),
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      roadmap_id = EXCLUDED.roadmap_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      priority = EXCLUDED.priority,
      status = EXCLUDED.status,
      position = EXCLUDED.position,
      color = EXCLUDED.color,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      tags = EXCLUDED.tags,
      updated_at = NOW();

    incoming_epic_ids := array_append(incoming_epic_ids, v_epic_id);

    FOR v_feature, v_feature_index IN
      SELECT value, ordinality::int
      FROM jsonb_array_elements(COALESCE(v_epic -> 'roadmap_features', '[]'::jsonb)) WITH ORDINALITY
    LOOP
      v_feature_id := COALESCE(NULLIF(v_feature ->> 'id', '')::uuid, gen_random_uuid());

      INSERT INTO public.roadmap_features (
        id,
        epic_id,
        roadmap_id,
        title,
        description,
        position,
        is_deliverable,
        status,
        start_date,
        end_date,
        updated_at
      )
      VALUES (
        v_feature_id,
        v_epic_id,
        v_roadmap_id,
        v_feature ->> 'title',
        v_feature ->> 'description',
        COALESCE(NULLIF(v_feature ->> 'position', '')::int, v_feature_index - 1),
        COALESCE(NULLIF(v_feature ->> 'is_deliverable', '')::boolean, true),
        COALESCE(NULLIF(v_feature ->> 'status', ''), 'not_started')::feature_status,
        NULLIF(v_feature ->> 'start_date', '')::timestamptz,
        NULLIF(v_feature ->> 'end_date', '')::timestamptz,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        epic_id = EXCLUDED.epic_id,
        roadmap_id = EXCLUDED.roadmap_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        position = EXCLUDED.position,
        is_deliverable = EXCLUDED.is_deliverable,
        status = EXCLUDED.status,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        updated_at = NOW();

      incoming_feature_ids := array_append(incoming_feature_ids, v_feature_id);

      FOR v_task, v_task_index IN
        SELECT value, ordinality::int
        FROM jsonb_array_elements(COALESCE(v_feature -> 'roadmap_tasks', '[]'::jsonb)) WITH ORDINALITY
      LOOP
        v_task_id := COALESCE(NULLIF(v_task ->> 'id', '')::uuid, gen_random_uuid());

        INSERT INTO public.roadmap_tasks (
          id,
          feature_id,
          assignee_id,
          title,
          status,
          priority,
          position,
          due_date,
          updated_at
        )
        VALUES (
          v_task_id,
          v_feature_id,
          NULLIF(v_task ->> 'assignee_id', '')::uuid,
          v_task ->> 'title',
          COALESCE(NULLIF(v_task ->> 'status', ''), 'todo')::task_status,
          COALESCE(NULLIF(v_task ->> 'priority', ''), 'medium')::task_priority,
          COALESCE(NULLIF(v_task ->> 'position', '')::int, v_task_index - 1),
          NULLIF(v_task ->> 'due_date', '')::timestamptz,
          NOW()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          feature_id = EXCLUDED.feature_id,
          assignee_id = EXCLUDED.assignee_id,
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          position = EXCLUDED.position,
          due_date = EXCLUDED.due_date,
          updated_at = NOW();

        incoming_task_ids := array_append(incoming_task_ids, v_task_id);
      END LOOP;
    END LOOP;
  END LOOP;

  IF cardinality(incoming_task_ids) = 0 THEN
    DELETE FROM public.roadmap_tasks t
    USING public.roadmap_features f, public.roadmap_epics e
    WHERE t.feature_id = f.id
      AND f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id;
  ELSE
    DELETE FROM public.roadmap_tasks t
    USING public.roadmap_features f, public.roadmap_epics e
    WHERE t.feature_id = f.id
      AND f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id
      AND NOT (t.id = ANY (incoming_task_ids));
  END IF;

  IF cardinality(incoming_feature_ids) = 0 THEN
    DELETE FROM public.roadmap_features f
    USING public.roadmap_epics e
    WHERE f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id;
  ELSE
    DELETE FROM public.roadmap_features f
    USING public.roadmap_epics e
    WHERE f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id
      AND NOT (f.id = ANY (incoming_feature_ids));
  END IF;

  IF cardinality(incoming_epic_ids) = 0 THEN
    DELETE FROM public.roadmap_epics e
    WHERE e.roadmap_id = v_roadmap_id;
  ELSE
    DELETE FROM public.roadmap_epics e
    WHERE e.roadmap_id = v_roadmap_id
      AND NOT (e.id = ANY (incoming_epic_ids));
  END IF;

  RETURN (SELECT updated_at FROM public.roadmaps WHERE id = v_roadmap_id);
END;
$$;
