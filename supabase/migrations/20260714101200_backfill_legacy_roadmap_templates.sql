-- Backfill legacy projectless roadmaps that opted into both old flags. The
-- source remains untouched and may later be deleted; the version is a complete
-- sanitized snapshot with permanent attribution.

CREATE OR REPLACE FUNCTION public.snapshot_roadmap_for_public_template(p_roadmap_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roadmap public.roadmaps%ROWTYPE;
  v_base_date date;
  v_epics jsonb;
  v_milestones jsonb;
BEGIN
  SELECT * INTO v_roadmap FROM public.roadmaps WHERE id = p_roadmap_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Roadmap not found'; END IF;

  SELECT COALESCE(
    v_roadmap.start_date::date,
    (SELECT min(e.start_date::date) FROM public.roadmap_epics e WHERE e.roadmap_id = p_roadmap_id),
    current_date
  ) INTO v_base_date;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', 'epic-' || e.id::text,
    'title', regexp_replace(e.title, '^\s*\((?:Month|Week) [^)]+\)\s*', '', 'i'),
    'time_label', format('(Month %s)', e.position + 1),
    'description', e.description,
    'start_day_offset', COALESCE(e.start_date::date - v_base_date, e.position * 30),
    'end_day_offset', COALESCE(e.end_date::date - v_base_date, e.position * 30 + 29),
    'priority', e.priority,
    'tags', to_jsonb(COALESCE(e.tags, ARRAY[]::text[])),
    'features', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', 'feature-' || f.id::text,
        'title', regexp_replace(f.title, '^\s*\((?:Day|Week) [^)]+\)\s*', '', 'i'),
        'time_label', format('(Week %s)', greatest(1, floor(COALESCE(f.start_date::date - v_base_date, e.position * 30)::numeric / 7)::integer + 1)),
        'description', f.description,
        'start_day_offset', COALESCE(f.start_date::date - v_base_date, e.position * 30 + f.position * 7),
        'end_day_offset', COALESCE(f.end_date::date - v_base_date, e.position * 30 + least(29, f.position * 7 + 6)),
        'is_deliverable', f.is_deliverable,
        'tasks', COALESCE((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'key', 'task-' || t.id::text,
            'title', t.title,
            'description', t.description,
            'priority', t.priority,
            'position', t.position,
            'work_type', COALESCE(t.work_type, 'real_work'),
            'due_day_offset', CASE WHEN t.due_date IS NULL THEN NULL ELSE t.due_date::date - v_base_date END,
            'checklist', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', COALESCE(NULLIF(item.value ->> 'id', ''), format('checklist-%s', item.ordinality)),
                'title', COALESCE(NULLIF(item.value ->> 'title', ''), NULLIF(item.value ->> 'text', ''), 'Checklist item'),
                'completed', false
              ) ORDER BY item.ordinality)
              FROM jsonb_array_elements(COALESCE(t.checklist, '[]'::jsonb))
                WITH ORDINALITY AS item(value, ordinality)
            ), '[]'::jsonb)
          )) ORDER BY t.position)
          FROM public.roadmap_tasks t WHERE t.feature_id = f.id
        ), '[]'::jsonb)
      ) ORDER BY f.position)
      FROM public.roadmap_features f WHERE f.epic_id = e.id
    ), '[]'::jsonb)
  ) ORDER BY e.position), '[]'::jsonb)
  INTO v_epics
  FROM public.roadmap_epics e
  WHERE e.roadmap_id = p_roadmap_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', 'milestone-' || m.id::text,
    'title', regexp_replace(m.title, '^\s*\(End of (?:Month|Week) [^)]+\)\s*', '', 'i'),
    'time_label', format('(End of Month %s)', m.position + 1),
    'description', m.description,
    'target_day_offset', m.target_date::date - v_base_date,
    'feature_keys', COALESCE((
      SELECT jsonb_agg('feature-' || mf.feature_id::text ORDER BY mf.position)
      FROM public.milestone_features mf WHERE mf.milestone_id = m.id
    ), '[]'::jsonb)
  ) ORDER BY m.position), '[]'::jsonb)
  INTO v_milestones
  FROM public.roadmap_milestones m
  WHERE m.roadmap_id = p_roadmap_id;

  RETURN jsonb_build_object(
    'contract_version', 1,
    'schedule_kind', 'long_term',
    'roadmap', jsonb_build_object(
      'name', v_roadmap.name,
      'description', v_roadmap.description,
      'schedule_kind', 'long_term',
      'start_day_offset', 0,
      'end_day_offset', COALESCE(v_roadmap.end_date::date - v_base_date, 119)
    ),
    'milestones', v_milestones,
    'epics', v_epics
  );
END;
$$;

DO $$
DECLARE
  v_source record;
  v_template_id uuid;
  v_version_id uuid;
  v_category_id uuid;
  v_content jsonb;
BEGIN
  FOR v_source IN
    SELECT r.*, COALESCE(
      NULLIF(trim(p.display_name), ''),
      NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Proyekto consultant'
    ) AS attribution_name
    FROM public.roadmaps r
    LEFT JOIN public.profiles p ON p.id = r.owner_id
    WHERE r.project_id IS NULL
      AND r.is_public = true
      AND r.is_templatable = true
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.roadmap_public_templates
      WHERE source_roadmap_id = v_source.id
    ) THEN CONTINUE; END IF;

    SELECT c.id INTO v_category_id
    FROM public.roadmap_template_categories c
    WHERE lower(c.name) = lower(COALESCE(v_source.category, ''))
       OR c.slug = lower(regexp_replace(COALESCE(v_source.category, ''), '[^a-zA-Z0-9]+', '-', 'g'))
    LIMIT 1;
    v_category_id := COALESCE(v_category_id, '20000000-0000-4000-8000-000000000001'::uuid);
    v_template_id := gen_random_uuid();
    v_version_id := gen_random_uuid();
    v_content := public.snapshot_roadmap_for_public_template(v_source.id);

    INSERT INTO public.roadmap_public_templates (
      id, slug, title, summary, preview_url, owner_id, source_roadmap_id,
      origin, status, category_id, difficulty, schedule_kind,
      estimated_duration_days, attribution_name, rights_attested_at, published_at
    ) VALUES (
      v_template_id, 'legacy-' || replace(v_source.id::text, '-', ''),
      CASE
        WHEN length(trim(COALESCE(v_source.name, ''))) >= 3 THEN trim(v_source.name)
        ELSE 'Roadmap ' || left(v_source.id::text, 8)
      END,
      CASE WHEN length(trim(COALESCE(v_source.description, ''))) >= 20
        THEN v_source.description
        ELSE 'A consultant-authored roadmap template for ' ||
          CASE
            WHEN length(trim(COALESCE(v_source.name, ''))) >= 3 THEN trim(v_source.name)
            ELSE 'Roadmap ' || left(v_source.id::text, 8)
          END || '.' END,
      v_source.preview_url, v_source.owner_id, v_source.id,
      'consultant', 'published', v_category_id, 'intermediate', 'long_term',
      least(3650, greatest(1, COALESCE(v_source.end_date::date - v_source.start_date::date + 1, 120))),
      v_source.attribution_name, now(), now()
    );

    INSERT INTO public.roadmap_template_versions (
      id, template_id, version_number, contract_version, content, checksum,
      created_by, published_at
    ) VALUES (
      v_version_id, v_template_id, 1, 1, v_content,
      encode(extensions.digest(v_content::text, 'sha256'), 'hex'),
      v_source.owner_id, now()
    );
    UPDATE public.roadmap_public_templates
    SET current_version_id = v_version_id
    WHERE id = v_template_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_roadmap_for_public_template(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_roadmap_for_public_template(uuid) TO service_role;
