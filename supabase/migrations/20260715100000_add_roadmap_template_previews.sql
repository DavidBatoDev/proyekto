-- Store the small catalog projection beside each immutable template snapshot.
-- Catalog and landing-page reads no longer need to transfer full task,
-- checklist, description, or scheduling payloads from the version content.

CREATE OR REPLACE FUNCTION public.build_roadmap_template_preview(p_content jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'epics', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', epic.value ->> 'key',
          'title', concat_ws(
            ' ',
            nullif(epic.value ->> 'time_label', ''),
            nullif(epic.value ->> 'title', '')
          ),
          'position', epic.ordinality - 1,
          'features', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', feature.value ->> 'key',
                'title', concat_ws(
                  ' ',
                  nullif(feature.value ->> 'time_label', ''),
                  nullif(feature.value ->> 'title', '')
                )
              )
              ORDER BY feature.ordinality
            )
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(epic.value -> 'features') = 'array'
                  THEN epic.value -> 'features'
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS feature(value, ordinality)
          ), '[]'::jsonb)
        )
        ORDER BY epic.ordinality
      )
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p_content -> 'epics') = 'array'
            THEN p_content -> 'epics'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS epic(value, ordinality)
      WHERE epic.ordinality <= 6
    ), '[]'::jsonb),
    'milestone_count', CASE
      WHEN jsonb_typeof(p_content -> 'milestones') = 'array'
        THEN jsonb_array_length(p_content -> 'milestones')
      ELSE 0
    END
  );
$$;

REVOKE ALL ON FUNCTION public.build_roadmap_template_preview(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_roadmap_template_preview(jsonb)
  TO service_role;

ALTER TABLE public.roadmap_template_versions
  ADD COLUMN preview jsonb
  GENERATED ALWAYS AS (public.build_roadmap_template_preview(content)) STORED;

COMMENT ON COLUMN public.roadmap_template_versions.preview IS
  'Compact generated projection for marketplace cards; excludes descriptions, schedules, tasks, and checklists.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.roadmap_template_versions
    WHERE jsonb_typeof(preview -> 'epics') <> 'array'
      OR jsonb_typeof(preview -> 'milestone_count') <> 'number'
      OR preview::text ~ '"(tasks|checklist|description|start_day_offset|end_day_offset)"'
  ) THEN
    RAISE EXCEPTION 'Roadmap template preview backfill validation failed';
  END IF;
END;
$$;
