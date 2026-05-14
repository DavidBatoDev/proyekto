-- Drop the persisted feature status column. Feature status is now derived
-- in application code (web + backend) from child task statuses via a
-- strict cascade rule, so storing it created a second source of truth that
-- drifted whenever someone forgot to update the dropdown.
--
-- 1. Drop the index that depended on the column.
-- 2. Recreate upsert_full_roadmap without the feature.status branch.
-- 3. Drop the column itself.
-- 4. Drop the now-unused feature_status enum type.

DROP INDEX IF EXISTS public.idx_roadmap_features_status;

DROP FUNCTION IF EXISTS public.upsert_full_roadmap(uuid, uuid, jsonb, boolean);

CREATE FUNCTION public.upsert_full_roadmap(
  p_roadmap_id uuid,
  p_owner_id uuid,
  p_full_state jsonb,
  p_create_if_missing boolean DEFAULT false
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
    WHERE id = v_roadmap_id;
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

ALTER TABLE public.roadmap_features DROP COLUMN IF EXISTS status;

DROP TYPE IF EXISTS feature_status;
