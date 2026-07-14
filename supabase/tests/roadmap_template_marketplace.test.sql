BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(29);

SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_public_templates WHERE origin = 'builtin'),
  20,
  'exactly 20 built-in templates are installed'
);
SELECT is(
  (SELECT count(DISTINCT category_id)::integer FROM public.roadmap_public_templates WHERE origin = 'builtin'),
  20,
  'every built-in occupies its own requested category'
);
SELECT ok(
  (public.validate_builtin_roadmap_templates() ->> 'valid')::boolean,
  'canonical hierarchy and schedule validation passes'
);
SELECT is(public.seed_builtin_roadmap_templates(), 20, 'the canonical seed is idempotent');
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_template_versions v JOIN public.roadmap_public_templates t ON t.id = v.template_id WHERE t.origin = 'builtin'),
  20,
  'idempotent seeding does not duplicate versions'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roadmaps'
      AND column_name IN ('is_public', 'is_templatable')
  ),
  'legacy roadmap flags were removed'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.seed_builtin_roadmap_templates()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.seed_builtin_roadmap_templates()', 'EXECUTE'),
  'seed execution is restricted from public roles'
);
SELECT ok(
  has_function_privilege('service_role', 'public.instantiate_roadmap_public_template(uuid,uuid,uuid,uuid,date,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.instantiate_roadmap_public_template(uuid,uuid,uuid,uuid,date,uuid,text)', 'EXECUTE'),
  'instantiation RPC is service-only'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roadmap_public_templates' AND cmd IN ('INSERT', 'UPDATE')),
  0,
  'consultants cannot bypass backend publication validation with direct writes'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roadmap_template_versions' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'template versions can only be written by the service role'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'template-test@example.com', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

CREATE TEMP TABLE instantiated AS
SELECT public.instantiate_roadmap_public_template(
  '10000000-0000-4000-8000-000000000001', NULL,
  '90000000-0000-4000-8000-000000000001', NULL,
  '2026-08-01', '91000000-0000-4000-8000-000000000001', 'marketplace'
) AS result;

SELECT is((SELECT result ->> 'idempotent_replay' FROM instantiated), 'false', 'first instantiation is not a replay');
SELECT is(
  (SELECT status::text FROM public.roadmaps WHERE id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)),
  'draft',
  'instantiated roadmap execution state is reset to draft'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_epics WHERE roadmap_id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)),
  4,
  'instantiation restores all epics'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_features WHERE roadmap_id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)),
  12,
  'instantiation restores all features with new ids'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_tasks t JOIN public.roadmap_features f ON f.id = t.feature_id WHERE f.roadmap_id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)),
  24,
  'instantiation restores actionable tasks'
);
SELECT is(
  (SELECT count(*)::integer FROM public.milestone_features mf JOIN public.roadmap_milestones m ON m.id = mf.milestone_id WHERE m.roadmap_id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)),
  12,
  'milestone-to-feature links are rebuilt'
);
SELECT is(
  (SELECT min(start_date)::date FROM public.roadmap_epics WHERE roadmap_id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)),
  '2026-08-01'::date,
  'relative offsets use the requested start date'
);

UPDATE public.roadmap_tasks
SET checklist = '[{"id":"completed-item","title":"Already done","completed":true}]'::jsonb
WHERE id = (
  SELECT t.id
  FROM public.roadmap_tasks t
  JOIN public.roadmap_features f ON f.id = t.feature_id
  JOIN public.roadmap_epics e ON e.id = f.epic_id
  WHERE f.roadmap_id = (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)
  ORDER BY e.position, f.position, t.position, t.id
  LIMIT 1
);
SELECT is(
  public.snapshot_roadmap_for_public_template(
    (SELECT (result ->> 'roadmap_id')::uuid FROM instantiated)
  ) #>> '{epics,0,features,0,tasks,0,checklist,0,completed}',
  'false',
  'snapshotting clears checklist completion state'
);

CREATE TEMP TABLE replayed AS
SELECT public.instantiate_roadmap_public_template(
  '10000000-0000-4000-8000-000000000001', NULL,
  '90000000-0000-4000-8000-000000000001', NULL,
  '2026-08-01', '91000000-0000-4000-8000-000000000001', 'marketplace'
) AS result;
SELECT is(
  (SELECT result ->> 'roadmap_id' FROM replayed),
  (SELECT result ->> 'roadmap_id' FROM instantiated),
  'duplicate idempotency requests return the same roadmap'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_template_usages WHERE user_id = '90000000-0000-4000-8000-000000000001'),
  1,
  'idempotent replay records only one usage'
);

INSERT INTO public.projects(id, title, client_id)
VALUES (
  '92000000-0000-4000-8000-000000000001',
  'Template project',
  '90000000-0000-4000-8000-000000000001'
);
INSERT INTO public.project_access(
  project_id, user_id, role, origin, granted_by, has_direct_grant
) VALUES (
  '92000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'owner', 'direct', '90000000-0000-4000-8000-000000000001', true
);
CREATE TEMP TABLE project_instantiated AS
SELECT public.instantiate_roadmap_public_template(
  '10000000-0000-4000-8000-000000000001', NULL,
  '90000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '2026-09-01', '91000000-0000-4000-8000-000000000002', 'roadmap_create'
) AS result;
SELECT is(
  (SELECT result ->> 'project_id' FROM project_instantiated),
  '92000000-0000-4000-8000-000000000001',
  'project instantiation attaches the roadmap to the requested project'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmaps WHERE project_id = '92000000-0000-4000-8000-000000000001'),
  1,
  'project instantiation leaves exactly one populated roadmap'
);
SELECT throws_ok(
  $$SELECT public.instantiate_roadmap_public_template(
    '10000000-0000-4000-8000-000000000001', NULL,
    '90000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '2026-10-01', '91000000-0000-4000-8000-000000000003', 'roadmap_create'
  )$$,
  'Project already has a non-empty roadmap',
  'a non-empty project roadmap is never silently replaced'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_template_usages WHERE idempotency_key = '91000000-0000-4000-8000-000000000003'),
  0,
  'a rejected project instantiation records no usage'
);

INSERT INTO public.roadmap_template_ratings(template_id, user_id, rating)
VALUES ('10000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 5);
SELECT is(
  (SELECT rating_average FROM public.roadmap_public_templates WHERE id = '10000000-0000-4000-8000-000000000001'),
  5.00::numeric,
  'eligible rating updates cached aggregates'
);

SELECT throws_ok(
  $$UPDATE public.roadmap_template_versions SET content = '{}'::jsonb WHERE id = '30000000-0000-4000-8000-000000000001'$$,
  'Published roadmap template versions are immutable',
  'published versions cannot be changed'
);

INSERT INTO public.roadmap_public_templates(
  id, slug, title, summary, preview_url, owner_id, origin, status,
  category_id, difficulty, schedule_kind, estimated_duration_days,
  attribution_name, rights_attested_at
) VALUES (
  '93000000-0000-4000-8000-000000000001',
  'rollback-test-template', 'Rollback Test Template',
  'A deliberately invalid version used to prove transactional rollback.',
  'data:image/svg+xml,rollback',
  '90000000-0000-4000-8000-000000000001', 'consultant', 'draft',
  '20000000-0000-4000-8000-000000000001', 'intermediate', 'long_term', 120,
  'Template Test User', now()
);
INSERT INTO public.roadmap_template_versions(
  id, template_id, version_number, contract_version, content, checksum,
  created_by, published_at
)
SELECT
  '94000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001', 1, 1,
  jsonb_set(v.content, '{milestones,0,feature_keys,0}', '"missing-feature"'::jsonb),
  repeat('f', 64), '90000000-0000-4000-8000-000000000001', now()
FROM public.roadmap_template_versions v
WHERE v.id = '30000000-0000-4000-8000-000000000001';
UPDATE public.roadmap_public_templates
SET status = 'published', published_at = now(),
  current_version_id = '94000000-0000-4000-8000-000000000001'
WHERE id = '93000000-0000-4000-8000-000000000001';
SELECT throws_ok(
  $$SELECT public.instantiate_roadmap_public_template(
    '93000000-0000-4000-8000-000000000001', NULL,
    '90000000-0000-4000-8000-000000000001', NULL,
    '2026-11-01', '91000000-0000-4000-8000-000000000004', 'marketplace'
  )$$,
  'Milestone references missing feature key missing-feature',
  'a late hierarchy failure aborts template instantiation'
);
SELECT is(
  (SELECT count(*)::integer FROM public.roadmaps WHERE settings ->> 'template_id' = '93000000-0000-4000-8000-000000000001'),
  0,
  'a late instantiation failure rolls back every inserted roadmap row'
);
UPDATE public.roadmap_public_templates
SET status = 'archived', archived_at = now()
WHERE id = '93000000-0000-4000-8000-000000000001';

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::integer FROM public.roadmap_public_templates WHERE status = 'published'),
  20,
  'anonymous users can read the published catalog through RLS'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
