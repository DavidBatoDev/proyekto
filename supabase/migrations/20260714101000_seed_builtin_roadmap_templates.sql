-- Canonical built-in template library. The function is intentionally kept in
-- the database so production migrations and local resets use identical data.

CREATE OR REPLACE FUNCTION public.build_builtin_roadmap_template_content(
  p_title text,
  p_summary text,
  p_schedule_kind public.roadmap_template_schedule_kind,
  p_phases text[]
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_epics jsonb := '[]'::jsonb;
  v_milestones jsonb := '[]'::jsonb;
  v_features jsonb;
  v_tasks jsonb;
  v_feature_keys jsonb;
  v_epic jsonb;
  v_feature jsonb;
  v_i integer;
  v_j integer;
  v_feature_count integer;
  v_epic_start integer;
  v_epic_end integer;
  v_feature_start integer;
  v_feature_end integer;
  v_day_number integer;
  v_week_number integer;
  v_phase text;
  v_feature_title text;
  v_feature_label text;
BEGIN
  IF cardinality(p_phases) NOT BETWEEN 4 AND 6 THEN
    RAISE EXCEPTION 'Built-in templates require 4-6 phases';
  END IF;

  FOR v_i IN 1..cardinality(p_phases) LOOP
    v_phase := p_phases[v_i];
    v_features := '[]'::jsonb;
    v_feature_keys := '[]'::jsonb;
    v_feature_count := CASE WHEN p_schedule_kind = 'short_learning' THEN 5 ELSE 3 END;
    v_epic_start := CASE WHEN p_schedule_kind = 'short_learning' THEN (v_i - 1) * 7 ELSE (v_i - 1) * 30 END;
    v_epic_end := CASE WHEN p_schedule_kind = 'short_learning' THEN v_epic_start + 6 ELSE v_epic_start + 29 END;

    FOR v_j IN 1..v_feature_count LOOP
      IF p_schedule_kind = 'short_learning' THEN
        v_day_number := (v_i - 1) * 7 + v_j;
        v_feature_start := v_epic_start + v_j - 1;
        v_feature_end := v_feature_start;
        v_feature_label := format('(Day %s)', v_day_number);
        v_feature_title := CASE v_j
          WHEN 1 THEN v_phase || ' concepts'
          WHEN 2 THEN v_phase || ' guided practice'
          WHEN 3 THEN v_phase || ' independent exercise'
          WHEN 4 THEN v_phase || ' applied challenge'
          ELSE v_phase || ' review and reflection'
        END;
      ELSE
        v_week_number := (v_i - 1) * 4 + CASE v_j WHEN 1 THEN 1 WHEN 2 THEN 2 ELSE 4 END;
        v_feature_start := v_epic_start + CASE v_j WHEN 1 THEN 0 WHEN 2 THEN 7 ELSE 21 END;
        v_feature_end := v_epic_start + CASE v_j WHEN 1 THEN 6 WHEN 2 THEN 20 ELSE 29 END;
        v_feature_label := CASE v_j
          WHEN 1 THEN format('(Week %s)', v_week_number)
          WHEN 2 THEN format('(Week %s-%s)', v_week_number, v_week_number + 1)
          ELSE format('(Week %s)', v_week_number)
        END;
        v_feature_title := CASE v_j
          WHEN 1 THEN v_phase || ' planning'
          WHEN 2 THEN v_phase || ' implementation'
          ELSE v_phase || ' validation'
        END;
      END IF;

      v_tasks := jsonb_build_array(
        jsonb_build_object(
          'key', format('epic-%s-feature-%s-task-1', v_i, v_j),
          'title', CASE WHEN p_schedule_kind = 'short_learning'
            THEN 'Complete the focused practice exercise'
            ELSE 'Define acceptance criteria and prepare the work' END,
          'description', format('Produce a reviewable outcome for %s and record the decisions made.', lower(v_feature_title)),
          'priority', 'high',
          'position', 0,
          'work_type', CASE WHEN p_schedule_kind = 'short_learning' THEN 'training' ELSE 'real_work' END,
          'due_day_offset', v_feature_end,
          'checklist', jsonb_build_array(
            jsonb_build_object('id', 'prepare', 'title', 'Confirm inputs and success criteria', 'completed', false),
            jsonb_build_object('id', 'document', 'title', 'Document the finished outcome', 'completed', false)
          )
        ),
        jsonb_build_object(
          'key', format('epic-%s-feature-%s-task-2', v_i, v_j),
          'title', CASE WHEN p_schedule_kind = 'short_learning'
            THEN 'Review the result and explain the key lesson'
            ELSE 'Complete the deliverable and run a peer review' END,
          'description', format('Validate the %s outcome against its acceptance criteria and capture follow-up actions.', lower(v_feature_title)),
          'priority', 'medium',
          'position', 1,
          'work_type', CASE WHEN p_schedule_kind = 'short_learning' THEN 'training' ELSE 'real_work' END,
          'due_day_offset', v_feature_end,
          'checklist', jsonb_build_array(
            jsonb_build_object('id', 'verify', 'title', 'Test the outcome against the criteria', 'completed', false),
            jsonb_build_object('id', 'review', 'title', 'Capture feedback and next steps', 'completed', false)
          )
        )
      );

      v_feature := jsonb_build_object(
        'key', format('epic-%s-feature-%s', v_i, v_j),
        'title', v_feature_title,
        'time_label', v_feature_label,
        'description', format('A concrete, reviewable step in the %s phase.', lower(v_phase)),
        'start_day_offset', v_feature_start,
        'end_day_offset', v_feature_end,
        'is_deliverable', true,
        'tasks', v_tasks
      );
      v_features := v_features || jsonb_build_array(v_feature);
      v_feature_keys := v_feature_keys || jsonb_build_array(format('epic-%s-feature-%s', v_i, v_j));
    END LOOP;

    v_epic := jsonb_build_object(
      'key', format('epic-%s', v_i),
      'title', v_phase,
      'time_label', CASE WHEN p_schedule_kind = 'short_learning'
        THEN format('(Week %s)', v_i)
        ELSE format('(Month %s)', v_i) END,
      'description', format('Deliver the %s phase with clear evidence and stakeholder review.', lower(v_phase)),
      'start_day_offset', v_epic_start,
      'end_day_offset', v_epic_end,
      'priority', CASE WHEN v_i = 1 THEN 'high' ELSE 'medium' END,
      'tags', jsonb_build_array(lower(replace(v_phase, ' ', '-'))),
      'features', v_features
    );
    v_epics := v_epics || jsonb_build_array(v_epic);

    v_milestones := v_milestones || jsonb_build_array(jsonb_build_object(
      'key', format('milestone-%s', v_i),
      'title', v_phase || ' approved',
      'time_label', CASE WHEN p_schedule_kind = 'short_learning'
        THEN format('(End of Week %s)', v_i)
        ELSE format('(End of Month %s)', v_i) END,
      'description', format('Evidence for the %s phase has been reviewed and accepted.', lower(v_phase)),
      'target_day_offset', v_epic_end,
      'feature_keys', v_feature_keys
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'contract_version', 1,
    'schedule_kind', p_schedule_kind,
    'roadmap', jsonb_build_object(
      'name', p_title,
      'description', p_summary,
      'schedule_kind', p_schedule_kind,
      'start_day_offset', 0,
      'end_day_offset', CASE WHEN p_schedule_kind = 'short_learning'
        THEN cardinality(p_phases) * 7 - 1
        ELSE cardinality(p_phases) * 30 - 1 END
    ),
    'milestones', v_milestones,
    'epics', v_epics
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_templates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row record;
  v_content jsonb;
  v_checksum text;
  v_tag text;
  v_tag_id uuid;
  v_preview text;
  v_count integer := 0;
BEGIN
  INSERT INTO public.roadmap_template_categories (id, slug, name, description, position)
  SELECT * FROM (VALUES
    ('20000000-0000-4000-8000-000000000001'::uuid, 'saas', 'SaaS', 'Software-as-a-service products and platforms', 1),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'mobile-app-development', 'Mobile App Development', 'Native and cross-platform mobile applications', 2),
    ('20000000-0000-4000-8000-000000000003'::uuid, 'web-development', 'Web Development', 'Websites and full-stack web products', 3),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'marketing', 'Marketing', 'Campaign planning and market growth', 4),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'research', 'Research', 'Structured qualitative and quantitative research', 5),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'startup-launch', 'Startup Launch', 'Company validation and launch programs', 6),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'product-management', 'Product Management', 'Product discovery, prioritization, and delivery', 7),
    ('20000000-0000-4000-8000-000000000008'::uuid, 'ux-ui-design', 'UX/UI Design', 'User experience and interface design programs', 8),
    ('20000000-0000-4000-8000-000000000009'::uuid, 'ai-machine-learning', 'AI & Machine Learning', 'Production artificial intelligence and ML systems', 9),
    ('20000000-0000-4000-8000-000000000010'::uuid, 'data-engineering', 'Data Engineering', 'Reliable data platforms and pipelines', 10),
    ('20000000-0000-4000-8000-000000000011'::uuid, 'devops', 'DevOps', 'Continuous delivery and operating practices', 11),
    ('20000000-0000-4000-8000-000000000012'::uuid, 'cloud-infrastructure', 'Cloud Infrastructure', 'Cloud foundations and migration programs', 12),
    ('20000000-0000-4000-8000-000000000013'::uuid, 'cybersecurity', 'Cybersecurity', 'Security readiness, risk, and hardening', 13),
    ('20000000-0000-4000-8000-000000000014'::uuid, 'e-commerce', 'E-commerce', 'Online retail and commerce launches', 14),
    ('20000000-0000-4000-8000-000000000015'::uuid, 'education', 'Education', 'Learning plans and educational programs', 15),
    ('20000000-0000-4000-8000-000000000016'::uuid, 'healthcare', 'Healthcare', 'Digital health and care delivery products', 16),
    ('20000000-0000-4000-8000-000000000017'::uuid, 'finance', 'Finance', 'Financial products and compliance programs', 17),
    ('20000000-0000-4000-8000-000000000018'::uuid, 'human-resources', 'Human Resources', 'People operations and employee programs', 18),
    ('20000000-0000-4000-8000-000000000019'::uuid, 'sales', 'Sales', 'Repeatable sales motions and revenue operations', 19),
    ('20000000-0000-4000-8000-000000000020'::uuid, 'operations', 'Operations', 'Operational systems and continuous improvement', 20)
  ) AS c(id, slug, name, description, position)
  ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug, name = EXCLUDED.name, description = EXCLUDED.description,
    position = EXCLUDED.position, is_active = true;

  v_preview := 'data:image/svg+xml;base64,' || replace(encode(convert_to(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g"><stop stop-color="#f97316"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="190" text-anchor="middle" fill="white" font-size="120" font-family="sans-serif" font-weight="700">P</text></svg>',
    'UTF8'), 'base64'), E'\n', '');

  FOR v_row IN SELECT * FROM (VALUES
    (1, '10000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'saas-mvp-launch', 'SaaS MVP Launch', 'Validate, build, release, and grow a focused SaaS minimum viable product with measurable customer evidence.', 'long_term'::public.roadmap_template_schedule_kind, 120, ARRAY['Product foundation','Core MVP','Beta validation','Launch and growth'], ARRAY['saas','mvp','product-launch']),
    (2, '10000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'cross-platform-mobile-app-launch', 'Cross-Platform Mobile App Launch', 'Take a cross-platform mobile application from product definition through store-ready launch and early optimization.', 'long_term', 120, ARRAY['Product and platform foundation','Core application experience','Quality and beta readiness','Store launch and optimization'], ARRAY['mobile','cross-platform','app-launch']),
    (3, '10000000-0000-4000-8000-000000000003'::uuid, '30000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 'full-stack-web-product', 'Full-Stack Web Product', 'Design and deliver a secure, observable full-stack web product from architecture through production rollout.', 'long_term', 120, ARRAY['Architecture and experience','Core product build','Integration and quality','Production release'], ARRAY['web','full-stack','software-delivery']),
    (4, '10000000-0000-4000-8000-000000000004'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000004'::uuid, 'go-to-market-campaign', 'Go-to-Market Campaign', 'Build an evidence-led go-to-market campaign covering positioning, production, activation, and performance learning.', 'long_term', 120, ARRAY['Audience and positioning','Campaign production','Channel activation','Measurement and optimization'], ARRAY['marketing','go-to-market','campaign']),
    (5, '10000000-0000-4000-8000-000000000005'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, '20000000-0000-4000-8000-000000000005'::uuid, 'structured-research-study', 'Structured Research Study', 'Plan and execute a rigorous research study with ethical collection, traceable analysis, and useful dissemination.', 'long_term', 120, ARRAY['Research framing','Study design','Data collection','Analysis and dissemination'], ARRAY['research','study','insights']),
    (6, '10000000-0000-4000-8000-000000000006'::uuid, '30000000-0000-4000-8000-000000000006'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'startup-from-idea-to-launch', 'Startup from Idea to Launch', 'Move from an initial venture idea to validated demand, a usable product, and a disciplined public launch.', 'long_term', 120, ARRAY['Problem validation','Business foundation','MVP and traction','Launch readiness'], ARRAY['startup','validation','launch']),
    (7, '10000000-0000-4000-8000-000000000007'::uuid, '30000000-0000-4000-8000-000000000007'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 'product-discovery-and-delivery', 'Product Discovery and Delivery', 'Connect continuous discovery to prioritized delivery, measurable outcomes, and an actionable product learning loop.', 'long_term', 120, ARRAY['Opportunity discovery','Solution validation','Delivery planning','Release and learning'], ARRAY['product-management','discovery','delivery']),
    (8, '10000000-0000-4000-8000-000000000008'::uuid, '30000000-0000-4000-8000-000000000008'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 'end-to-end-product-redesign', 'End-to-End Product Redesign', 'Research, redesign, validate, and ship a coherent product experience grounded in a reusable design system.', 'long_term', 120, ARRAY['Experience audit','Design direction','Prototype validation','Handoff and launch'], ARRAY['ux','ui','redesign']),
    (9, '10000000-0000-4000-8000-000000000009'::uuid, '30000000-0000-4000-8000-000000000009'::uuid, '20000000-0000-4000-8000-000000000009'::uuid, 'production-ai-product', 'Production AI Product', 'Deliver an AI product with accountable data, reproducible evaluation, safe integration, and production monitoring.', 'long_term', 120, ARRAY['Use case and data readiness','Model baseline','Product integration','Safety and operations'], ARRAY['ai','machine-learning','mlops']),
    (10, '10000000-0000-4000-8000-000000000010'::uuid, '30000000-0000-4000-8000-000000000010'::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 'modern-data-platform', 'Modern Data Platform', 'Establish a governed data platform with reliable ingestion, transformation, serving, and operational ownership.', 'long_term', 120, ARRAY['Platform architecture','Ingestion foundation','Transformation and quality','Serving and operations'], ARRAY['data-engineering','data-platform','analytics']),
    (11, '10000000-0000-4000-8000-000000000011'::uuid, '30000000-0000-4000-8000-000000000011'::uuid, '20000000-0000-4000-8000-000000000011'::uuid, 'devops-delivery-transformation', 'DevOps Delivery Transformation', 'Improve delivery flow through repeatable automation, observability, resilience, and sustainable operating practices.', 'long_term', 120, ARRAY['Delivery assessment','Continuous integration','Continuous delivery','Reliability and improvement'], ARRAY['devops','ci-cd','reliability']),
    (12, '10000000-0000-4000-8000-000000000012'::uuid, '30000000-0000-4000-8000-000000000012'::uuid, '20000000-0000-4000-8000-000000000012'::uuid, 'cloud-migration-program', 'Cloud Migration Program', 'Plan and execute a controlled cloud migration with secure foundations, workload waves, and operational readiness.', 'long_term', 120, ARRAY['Discovery and business case','Landing zone foundation','Workload migration','Optimization and handover'], ARRAY['cloud','migration','infrastructure']),
    (13, '10000000-0000-4000-8000-000000000013'::uuid, '30000000-0000-4000-8000-000000000013'::uuid, '20000000-0000-4000-8000-000000000013'::uuid, 'security-readiness-and-hardening', 'Security Readiness and Hardening', 'Reduce material security risk with an evidence-based baseline, prioritized controls, testing, and response readiness.', 'long_term', 120, ARRAY['Risk and asset baseline','Identity and platform hardening','Detection and validation','Response readiness'], ARRAY['cybersecurity','hardening','risk']),
    (14, '10000000-0000-4000-8000-000000000014'::uuid, '30000000-0000-4000-8000-000000000014'::uuid, '20000000-0000-4000-8000-000000000014'::uuid, 'e-commerce-store-launch', 'E-commerce Store Launch', 'Launch an e-commerce storefront with a dependable catalog, checkout, fulfillment operation, and growth measurement.', 'long_term', 120, ARRAY['Commercial foundation','Storefront build','Commerce operations','Launch and growth'], ARRAY['e-commerce','retail','store-launch']),
    (15, '10000000-0000-4000-8000-000000000015'::uuid, '30000000-0000-4000-8000-000000000015'::uuid, '20000000-0000-4000-8000-000000000015'::uuid, 'learn-html-and-css', 'Learn HTML & CSS', 'Build practical front-end foundations through four focused weeks of semantic HTML, modern CSS, and responsive projects.', 'short_learning', 28, ARRAY['Semantic HTML foundations','CSS foundations','Responsive layouts','Accessible portfolio project'], ARRAY['education','html','css']),
    (16, '10000000-0000-4000-8000-000000000016'::uuid, '30000000-0000-4000-8000-000000000016'::uuid, '20000000-0000-4000-8000-000000000016'::uuid, 'digital-health-product-launch', 'Digital Health Product Launch', 'Develop a patient-centered digital health product with clinical input, privacy controls, validation, and launch readiness.', 'long_term', 120, ARRAY['Clinical and user discovery','Safety and product design','Build and validation','Launch and care operations'], ARRAY['healthcare','digital-health','compliance']),
    (17, '10000000-0000-4000-8000-000000000017'::uuid, '30000000-0000-4000-8000-000000000017'::uuid, '20000000-0000-4000-8000-000000000017'::uuid, 'fintech-mvp-and-compliance', 'FinTech MVP and Compliance', 'Deliver a trustworthy financial MVP by integrating product validation, risk controls, compliance evidence, and operations.', 'long_term', 120, ARRAY['Market and regulatory framing','Control and product design','MVP implementation','Assurance and launch'], ARRAY['finance','fintech','compliance']),
    (18, '10000000-0000-4000-8000-000000000018'::uuid, '30000000-0000-4000-8000-000000000018'::uuid, '20000000-0000-4000-8000-000000000018'::uuid, 'employee-onboarding-program', 'Employee Onboarding Program', 'Create a consistent employee onboarding journey that connects readiness, role clarity, belonging, and measurable improvement.', 'long_term', 120, ARRAY['Program and role discovery','Preboarding readiness','Onboarding experience','Measurement and improvement'], ARRAY['human-resources','onboarding','people-operations']),
    (19, '10000000-0000-4000-8000-000000000019'::uuid, '30000000-0000-4000-8000-000000000019'::uuid, '20000000-0000-4000-8000-000000000019'::uuid, 'b2b-sales-engine', 'B2B Sales Engine', 'Build a repeatable B2B sales engine spanning target accounts, messaging, pipeline execution, and revenue learning.', 'long_term', 120, ARRAY['Ideal customer foundation','Offer and outreach system','Pipeline execution','Forecasting and optimization'], ARRAY['sales','b2b','revenue']),
    (20, '10000000-0000-4000-8000-000000000020'::uuid, '30000000-0000-4000-8000-000000000020'::uuid, '20000000-0000-4000-8000-000000000020'::uuid, 'operational-excellence-program', 'Operational Excellence Program', 'Improve an operating system through process evidence, focused redesign, controlled rollout, and continuous management.', 'long_term', 120, ARRAY['Operational baseline','Future-state design','Controlled implementation','Performance management'], ARRAY['operations','process-improvement','excellence'])
  ) AS t(position, template_id, version_id, category_id, slug, title, summary, schedule_kind, duration_days, phases, tags)
  LOOP
    v_content := public.build_builtin_roadmap_template_content(v_row.title, v_row.summary, v_row.schedule_kind, v_row.phases);
    v_checksum := encode(extensions.digest(v_content::text, 'sha256'), 'hex');

    INSERT INTO public.roadmap_public_templates (
      id, slug, title, summary, preview_url, owner_id, source_roadmap_id,
      origin, status, category_id, difficulty, schedule_kind,
      estimated_duration_days, attribution_name, attribution_url,
      is_featured, rights_attested_at, published_at
    ) VALUES (
      v_row.template_id, v_row.slug, v_row.title, v_row.summary, v_preview,
      NULL, NULL, 'builtin', 'published', v_row.category_id,
      (CASE WHEN v_row.schedule_kind = 'short_learning' THEN 'beginner' ELSE 'intermediate' END)::public.roadmap_template_difficulty,
      v_row.schedule_kind, v_row.duration_days, 'Proyekto', NULL,
      v_row.position <= 6, '2026-07-14 00:00:00+00', '2026-07-14 00:00:00+00'
    ) ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      preview_url = EXCLUDED.preview_url,
      category_id = EXCLUDED.category_id,
      difficulty = EXCLUDED.difficulty,
      schedule_kind = EXCLUDED.schedule_kind,
      estimated_duration_days = EXCLUDED.estimated_duration_days,
      attribution_name = EXCLUDED.attribution_name,
      is_featured = EXCLUDED.is_featured;

    INSERT INTO public.roadmap_template_versions (
      id, template_id, version_number, contract_version, content, checksum,
      created_by, published_at
    ) VALUES (
      v_row.version_id, v_row.template_id, 1, 1, v_content, v_checksum,
      NULL, '2026-07-14 00:00:00+00'
    ) ON CONFLICT (id) DO NOTHING;

    UPDATE public.roadmap_public_templates
    SET current_version_id = v_row.version_id, status = 'published'
    WHERE id = v_row.template_id AND current_version_id IS DISTINCT FROM v_row.version_id;

    FOREACH v_tag IN ARRAY v_row.tags LOOP
      INSERT INTO public.roadmap_template_tags (slug, name)
      VALUES (v_tag, initcap(replace(v_tag, '-', ' ')))
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_tag_id;
      INSERT INTO public.roadmap_public_template_tags (template_id, tag_id)
      VALUES (v_row.template_id, v_tag_id) ON CONFLICT DO NOTHING;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_builtin_roadmap_templates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issues jsonb := '[]'::jsonb;
  v_template record;
  v_epic jsonb;
  v_feature jsonb;
  v_task jsonb;
  v_milestone jsonb;
  v_epic_count integer;
  v_feature_count integer;
  v_task_count integer;
  v_expected_min_features integer;
  v_expected_max_features integer;
  v_expected_min_tasks integer;
  v_expected_max_tasks integer;
  v_previous_epic_end integer;
  v_previous_feature_end integer;
  v_previous_milestone_target integer;
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 20 THEN
    v_issues := v_issues || jsonb_build_array('Expected exactly 20 built-in templates');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20 GROUP BY c.id HAVING count(t.id) <> 1
  ) THEN
    v_issues := v_issues || jsonb_build_array('Every initial category must have exactly one built-in template');
  END IF;

  FOR v_template IN
    SELECT t.slug, t.schedule_kind, v.content
    FROM public.roadmap_public_templates t
    JOIN public.roadmap_template_versions v ON v.id = t.current_version_id
    WHERE t.origin = 'builtin'
  LOOP
    v_epic_count := jsonb_array_length(COALESCE(v_template.content -> 'epics', '[]'::jsonb));
    IF v_epic_count NOT BETWEEN 4 AND 6 THEN
      v_issues := v_issues || jsonb_build_array(v_template.slug || ': epic count must be 4-6');
    END IF;
    v_expected_min_features := CASE WHEN v_template.schedule_kind = 'short_learning' THEN 3 ELSE 3 END;
    v_expected_max_features := CASE WHEN v_template.schedule_kind = 'short_learning' THEN 7 ELSE 5 END;
    v_expected_min_tasks := CASE WHEN v_template.schedule_kind = 'short_learning' THEN 1 ELSE 2 END;
    v_expected_max_tasks := CASE WHEN v_template.schedule_kind = 'short_learning' THEN 3 ELSE 4 END;
    v_previous_epic_end := -1;

    FOR v_epic IN SELECT value FROM jsonb_array_elements(v_template.content -> 'epics') LOOP
      v_feature_count := jsonb_array_length(COALESCE(v_epic -> 'features', '[]'::jsonb));
      IF v_feature_count NOT BETWEEN v_expected_min_features AND v_expected_max_features THEN
        v_issues := v_issues || jsonb_build_array(v_template.slug || ': invalid feature count');
      END IF;
      IF NOT ((v_epic ->> 'time_label') ~ (CASE WHEN v_template.schedule_kind = 'short_learning'
        THEN '^\(Week [0-9]+\)$' ELSE '^\(Month [0-9]+(?:-[0-9]+)?\)$' END)) THEN
        v_issues := v_issues || jsonb_build_array(v_template.slug || ': invalid epic time label');
      END IF;
      IF (v_epic ->> 'start_day_offset')::integer <= v_previous_epic_end THEN
        v_issues := v_issues || jsonb_build_array(v_template.slug || ': epic offsets overlap');
      END IF;
      v_previous_epic_end := (v_epic ->> 'end_day_offset')::integer;
      v_previous_feature_end := (v_epic ->> 'start_day_offset')::integer - 1;

      FOR v_feature IN SELECT value FROM jsonb_array_elements(v_epic -> 'features') LOOP
        v_task_count := jsonb_array_length(COALESCE(v_feature -> 'tasks', '[]'::jsonb));
        IF v_task_count NOT BETWEEN v_expected_min_tasks AND v_expected_max_tasks THEN
          v_issues := v_issues || jsonb_build_array(v_template.slug || ': invalid task count');
        END IF;
        IF NOT ((v_feature ->> 'time_label') ~ (CASE WHEN v_template.schedule_kind = 'short_learning'
          THEN '^\(Day [0-9]+(?:-[0-9]+)?\)$' ELSE '^\(Week [0-9]+(?:-[0-9]+)?\)$' END)) THEN
          v_issues := v_issues || jsonb_build_array(v_template.slug || ': invalid feature time label');
        END IF;
        IF (v_feature ->> 'start_day_offset')::integer < (v_epic ->> 'start_day_offset')::integer
          OR (v_feature ->> 'end_day_offset')::integer > (v_epic ->> 'end_day_offset')::integer
          OR (v_feature ->> 'end_day_offset')::integer < (v_feature ->> 'start_day_offset')::integer
          OR (v_feature ->> 'start_day_offset')::integer <= v_previous_feature_end THEN
          v_issues := v_issues || jsonb_build_array(v_template.slug || ': feature offsets fall outside epic');
        END IF;
        v_previous_feature_end := (v_feature ->> 'end_day_offset')::integer;

        FOR v_task IN SELECT value FROM jsonb_array_elements(v_feature -> 'tasks') LOOP
          IF length(trim(COALESCE(v_task ->> 'title', ''))) < 3
            OR length(trim(COALESCE(v_task ->> 'description', ''))) < 10
            OR COALESCE(v_task ->> 'priority', '') NOT IN ('urgent', 'high', 'medium', 'low')
            OR COALESCE(v_task ->> 'work_type', '') NOT IN ('real_work', 'training')
            OR jsonb_typeof(v_task -> 'checklist') IS DISTINCT FROM 'array'
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_task -> 'checklist') = 'array'
                  THEN v_task -> 'checklist' ELSE '[]'::jsonb END
              ) item
              WHERE COALESCE((item ->> 'completed')::boolean, true) <> false
                OR length(trim(COALESCE(item ->> 'title', ''))) < 3
            ) THEN
            v_issues := v_issues || jsonb_build_array(v_template.slug || ': task realism fields are incomplete');
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;

    IF jsonb_array_length(COALESCE(v_template.content -> 'milestones', '[]'::jsonb)) <> v_epic_count THEN
      v_issues := v_issues || jsonb_build_array(v_template.slug || ': milestone coverage mismatch');
    END IF;
    v_previous_milestone_target := -1;
    FOR v_milestone IN SELECT value FROM jsonb_array_elements(COALESCE(v_template.content -> 'milestones', '[]'::jsonb)) LOOP
      IF NOT ((v_milestone ->> 'time_label') ~ (CASE WHEN v_template.schedule_kind = 'short_learning'
        THEN '^\(End of Week [0-9]+\)$' ELSE '^\(End of Month [0-9]+\)$' END))
        OR (v_milestone ->> 'target_day_offset')::integer <= v_previous_milestone_target
        OR jsonb_array_length(COALESCE(v_milestone -> 'feature_keys', '[]'::jsonb)) = 0 THEN
        v_issues := v_issues || jsonb_build_array(v_template.slug || ': invalid milestone label, offset, or links');
      END IF;
      v_previous_milestone_target := (v_milestone ->> 'target_day_offset')::integer;
    END LOOP;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_template.content -> 'epics') epic_node,
        jsonb_array_elements(epic_node -> 'features') feature_node
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_template.content -> 'milestones') milestone_node,
          jsonb_array_elements_text(milestone_node -> 'feature_keys') linked_key
        WHERE linked_key = feature_node ->> 'key'
      )
    ) THEN
      v_issues := v_issues || jsonb_build_array(v_template.slug || ': at least one feature is not covered by a milestone');
    END IF;
    IF v_template.content::text ~ '"(assignee|reporter|owner|comment|attachment|actual_hours|completed_at)"' THEN
      v_issues := v_issues || jsonb_build_array(v_template.slug || ': runtime or personal data found');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('valid', jsonb_array_length(v_issues) = 0, 'issues', v_issues);
END;
$$;

REVOKE ALL ON FUNCTION public.build_builtin_roadmap_template_content(text, text, public.roadmap_template_schedule_kind, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_builtin_roadmap_templates() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_builtin_roadmap_templates() TO service_role;
