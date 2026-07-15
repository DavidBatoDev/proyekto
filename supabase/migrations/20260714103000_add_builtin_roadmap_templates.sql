-- Expand the curated marketplace with a second built-in roadmap for every
-- initial category. Deterministic identifiers keep this safe to run during
-- production deployment and local resets.

CREATE OR REPLACE FUNCTION public.seed_additional_builtin_roadmap_templates()
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
  SELECT preview_url
  INTO v_preview
  FROM public.roadmap_public_templates
  WHERE id = '10000000-0000-4000-8000-000000000001';

  IF v_preview IS NULL THEN
    RAISE EXCEPTION 'The initial built-in roadmap library must be seeded first';
  END IF;

  FOR v_row IN SELECT * FROM (VALUES
    (1, '10000000-0000-4000-8000-000000000021'::uuid, '30000000-0000-4000-8000-000000000021'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'saas-customer-success-and-retention', 'SaaS Customer Success and Retention', 'Build a measurable customer success system that improves onboarding, adoption, retention, and expansion for a growing SaaS product.', 'intermediate'::public.roadmap_template_difficulty, 'long_term'::public.roadmap_template_schedule_kind, 120, ARRAY['Customer health baseline','Onboarding and activation','Retention operations','Expansion and learning'], ARRAY['saas','customer-success','retention'], false),
    (2, '10000000-0000-4000-8000-000000000022'::uuid, '30000000-0000-4000-8000-000000000022'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'mobile-app-growth-and-retention', 'Mobile App Growth and Retention', 'Improve a live mobile product through evidence-led acquisition, activation, engagement, retention, and store optimization.', 'intermediate', 'long_term', 120, ARRAY['Growth measurement foundation','Activation improvement','Engagement and retention','Store and channel optimization'], ARRAY['mobile','growth','retention'], false),
    (3, '10000000-0000-4000-8000-000000000023'::uuid, '30000000-0000-4000-8000-000000000023'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 'accessible-website-redesign', 'Accessible Website Redesign', 'Audit, redesign, rebuild, and launch a fast accessible website with clearer journeys and maintainable content foundations.', 'intermediate', 'long_term', 120, ARRAY['Experience and accessibility audit','Information architecture','Accessible implementation','Launch and optimization'], ARRAY['web-development','accessibility','redesign'], false),
    (4, '10000000-0000-4000-8000-000000000024'::uuid, '30000000-0000-4000-8000-000000000024'::uuid, '20000000-0000-4000-8000-000000000004'::uuid, 'content-marketing-engine', 'Content Marketing Engine', 'Create a sustainable content operation covering audience insight, editorial planning, production, distribution, and performance learning.', 'beginner', 'long_term', 120, ARRAY['Audience and topic strategy','Editorial operating system','Production and distribution','Measurement and iteration'], ARRAY['marketing','content-strategy','seo'], true),
    (5, '10000000-0000-4000-8000-000000000025'::uuid, '30000000-0000-4000-8000-000000000025'::uuid, '20000000-0000-4000-8000-000000000005'::uuid, 'customer-insights-research-program', 'Customer Insights Research Program', 'Establish a repeatable customer research program that turns ethical evidence into prioritized product and business decisions.', 'intermediate', 'long_term', 120, ARRAY['Research priorities','Participant and method design','Evidence collection','Synthesis and decision support'], ARRAY['research','customer-insights','qualitative-research'], false),
    (6, '10000000-0000-4000-8000-000000000026'::uuid, '30000000-0000-4000-8000-000000000026'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'investor-readiness-program', 'Investor Readiness Program', 'Prepare a startup for credible fundraising with a defensible narrative, clean metrics, organized diligence, and a focused investor process.', 'intermediate', 'long_term', 120, ARRAY['Fundraising strategy','Narrative and metrics','Diligence readiness','Investor outreach and learning'], ARRAY['startup','fundraising','investor-readiness'], false),
    (7, '10000000-0000-4000-8000-000000000027'::uuid, '30000000-0000-4000-8000-000000000027'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 'outcome-based-product-strategy', 'Outcome-Based Product Strategy', 'Translate company goals and customer evidence into a coherent product strategy, outcome roadmap, and measurable operating cadence.', 'advanced', 'long_term', 120, ARRAY['Strategic context','Opportunity choices','Outcome roadmap','Operating cadence'], ARRAY['product-management','product-strategy','outcomes'], false),
    (8, '10000000-0000-4000-8000-000000000028'::uuid, '30000000-0000-4000-8000-000000000028'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 'scalable-design-system', 'Scalable Design System', 'Create and roll out a governed design system that aligns tokens, accessible components, documentation, and product adoption.', 'intermediate', 'long_term', 120, ARRAY['System audit and principles','Foundations and tokens','Component library','Adoption and governance'], ARRAY['ux-ui','design-system','accessibility'], true),
    (9, '10000000-0000-4000-8000-000000000029'::uuid, '30000000-0000-4000-8000-000000000029'::uuid, '20000000-0000-4000-8000-000000000009'::uuid, 'generative-ai-product-pilot', 'Generative AI Product Pilot', 'Move a generative AI use case from opportunity framing to evaluated prototype, safe integration, controlled pilot, and rollout decision.', 'advanced', 'long_term', 150, ARRAY['Opportunity and risk framing','Knowledge and data readiness','Prototype and evaluation','Safety and product integration','Pilot and rollout decision'], ARRAY['ai','generative-ai','evaluation'], true),
    (10, '10000000-0000-4000-8000-000000000030'::uuid, '30000000-0000-4000-8000-000000000030'::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 'analytics-engineering-foundation', 'Analytics Engineering Foundation', 'Build a trusted analytics engineering practice with modeled data, automated quality, useful documentation, and clear ownership.', 'advanced', 'long_term', 120, ARRAY['Analytics architecture','Modeling standards','Quality and documentation','Serving and ownership'], ARRAY['data-engineering','analytics-engineering','data-quality'], false),
    (11, '10000000-0000-4000-8000-000000000031'::uuid, '30000000-0000-4000-8000-000000000031'::uuid, '20000000-0000-4000-8000-000000000011'::uuid, 'ci-cd-pipeline-modernization', 'CI/CD Pipeline Modernization', 'Modernize software delivery with fast repeatable builds, reliable tests, controlled releases, observability, and recovery practices.', 'intermediate', 'long_term', 120, ARRAY['Delivery baseline','Continuous integration','Release automation','Observability and recovery'], ARRAY['devops','ci-cd','automation'], false),
    (12, '10000000-0000-4000-8000-000000000032'::uuid, '30000000-0000-4000-8000-000000000032'::uuid, '20000000-0000-4000-8000-000000000012'::uuid, 'cloud-cost-optimization', 'Cloud Cost Optimization', 'Create a durable FinOps practice that connects cloud visibility, accountable ownership, workload optimization, and continuous governance.', 'advanced', 'long_term', 120, ARRAY['Cost visibility','Allocation and ownership','Workload optimization','FinOps governance'], ARRAY['cloud','finops','cost-optimization'], false),
    (13, '10000000-0000-4000-8000-000000000033'::uuid, '30000000-0000-4000-8000-000000000033'::uuid, '20000000-0000-4000-8000-000000000013'::uuid, 'incident-response-readiness', 'Incident Response Readiness', 'Prepare teams to detect, contain, communicate, recover from, and learn from security incidents through tested response practices.', 'advanced', 'long_term', 120, ARRAY['Threat and response baseline','Playbooks and ownership','Detection and exercises','Recovery and improvement'], ARRAY['cybersecurity','incident-response','resilience'], false),
    (14, '10000000-0000-4000-8000-000000000034'::uuid, '30000000-0000-4000-8000-000000000034'::uuid, '20000000-0000-4000-8000-000000000014'::uuid, 'e-commerce-conversion-optimization', 'E-commerce Conversion Optimization', 'Improve discovery, product detail, checkout, retention, and measurement across an established e-commerce customer journey.', 'intermediate', 'long_term', 120, ARRAY['Journey and data baseline','Discovery and product detail','Checkout optimization','Retention and experimentation'], ARRAY['e-commerce','conversion','experimentation'], true),
    (15, '10000000-0000-4000-8000-000000000035'::uuid, '30000000-0000-4000-8000-000000000035'::uuid, '20000000-0000-4000-8000-000000000015'::uuid, 'learn-javascript-fundamentals', 'Learn JavaScript Fundamentals', 'Build practical JavaScript foundations through focused concepts, guided exercises, independent challenges, and a working final project.', 'beginner', 'short_learning', 28, ARRAY['Language foundations','Functions and data','Browser interaction','Applied JavaScript project'], ARRAY['education','javascript','web-development'], true),
    (16, '10000000-0000-4000-8000-000000000036'::uuid, '30000000-0000-4000-8000-000000000036'::uuid, '20000000-0000-4000-8000-000000000016'::uuid, 'care-delivery-workflow-improvement', 'Care Delivery Workflow Improvement', 'Redesign a care delivery workflow using frontline evidence, safety controls, measured rollout, and sustainable operational ownership.', 'intermediate', 'long_term', 120, ARRAY['Care pathway baseline','Workflow and safety design','Controlled implementation','Outcome monitoring'], ARRAY['healthcare','care-delivery','workflow'], false),
    (17, '10000000-0000-4000-8000-000000000037'::uuid, '30000000-0000-4000-8000-000000000037'::uuid, '20000000-0000-4000-8000-000000000017'::uuid, 'financial-planning-and-forecasting', 'Financial Planning and Forecasting', 'Build a connected planning process with reliable assumptions, scenario models, accountable reviews, and decision-ready reporting.', 'intermediate', 'long_term', 120, ARRAY['Planning baseline','Driver and scenario model','Forecast operating rhythm','Decision reporting'], ARRAY['finance','forecasting','financial-planning'], false),
    (18, '10000000-0000-4000-8000-000000000038'::uuid, '30000000-0000-4000-8000-000000000038'::uuid, '20000000-0000-4000-8000-000000000018'::uuid, 'performance-management-program', 'Performance Management Program', 'Create a fair performance management system connecting role expectations, coaching, reviews, calibration, and program improvement.', 'intermediate', 'long_term', 120, ARRAY['Performance philosophy','Expectations and coaching','Reviews and calibration','Adoption and improvement'], ARRAY['human-resources','performance-management','people-operations'], false),
    (19, '10000000-0000-4000-8000-000000000039'::uuid, '30000000-0000-4000-8000-000000000039'::uuid, '20000000-0000-4000-8000-000000000019'::uuid, 'enterprise-sales-playbook', 'Enterprise Sales Playbook', 'Build a coordinated enterprise sales motion covering account strategy, discovery, consensus building, commercial process, and expansion.', 'advanced', 'long_term', 150, ARRAY['Market and account strategy','Discovery and value case','Buying group alignment','Commercial execution','Expansion and learning'], ARRAY['sales','enterprise-sales','sales-playbook'], false),
    (20, '10000000-0000-4000-8000-000000000040'::uuid, '30000000-0000-4000-8000-000000000040'::uuid, '20000000-0000-4000-8000-000000000020'::uuid, 'business-process-automation', 'Business Process Automation', 'Identify, redesign, automate, and govern a high-value business process with measurable quality and efficiency outcomes.', 'intermediate', 'long_term', 120, ARRAY['Process and value baseline','Future-state workflow','Automation implementation','Control and improvement'], ARRAY['operations','automation','process-improvement'], true)
  ) AS t(position, template_id, version_id, category_id, slug, title, summary, difficulty, schedule_kind, duration_days, phases, tags, is_featured)
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
      v_row.difficulty, v_row.schedule_kind, v_row.duration_days,
      'Proyekto', NULL, v_row.is_featured,
      '2026-07-14 12:00:00+00', '2026-07-14 12:00:00+00'
    ) ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      preview_url = EXCLUDED.preview_url,
      status = 'published',
      category_id = EXCLUDED.category_id,
      difficulty = EXCLUDED.difficulty,
      schedule_kind = EXCLUDED.schedule_kind,
      estimated_duration_days = EXCLUDED.estimated_duration_days,
      attribution_name = EXCLUDED.attribution_name,
      is_featured = EXCLUDED.is_featured,
      rights_attested_at = EXCLUDED.rights_attested_at,
      published_at = EXCLUDED.published_at,
      unlisted_at = NULL,
      archived_at = NULL;

    INSERT INTO public.roadmap_template_versions (
      id, template_id, version_number, contract_version, content, checksum,
      created_by, published_at
    ) VALUES (
      v_row.version_id, v_row.template_id, 1, 1, v_content, v_checksum,
      NULL, '2026-07-14 12:00:00+00'
    ) ON CONFLICT (id) DO NOTHING;

    UPDATE public.roadmap_public_templates
    SET current_version_id = v_row.version_id, status = 'published'
    WHERE id = v_row.template_id
      AND current_version_id IS DISTINCT FROM v_row.version_id;

    FOREACH v_tag IN ARRAY v_row.tags LOOP
      INSERT INTO public.roadmap_template_tags (slug, name)
      VALUES (v_tag, initcap(replace(v_tag, '-', ' ')))
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_tag_id;

      INSERT INTO public.roadmap_public_template_tags (template_id, tag_id)
      VALUES (v_row.template_id, v_tag_id)
      ON CONFLICT DO NOTHING;
    END LOOP;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_additional_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_additional_builtin_roadmap_templates() TO service_role;

-- Preserve the original structural validator and wrap it with the expanded
-- library cardinality rules. The original function still validates every
-- hierarchy, including the twenty rows added above.
ALTER FUNCTION public.validate_builtin_roadmap_templates()
  RENAME TO validate_builtin_roadmap_templates_legacy_20;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates_legacy_20()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_builtin_roadmap_templates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_result jsonb;
  v_issues jsonb;
BEGIN
  v_base_result := public.validate_builtin_roadmap_templates_legacy_20();

  SELECT COALESCE(jsonb_agg(to_jsonb(issue)), '[]'::jsonb)
  INTO v_issues
  FROM jsonb_array_elements_text(COALESCE(v_base_result -> 'issues', '[]'::jsonb)) AS base_issue(issue)
  WHERE issue NOT IN (
    'Expected exactly 20 built-in templates',
    'Every initial category must have exactly one built-in template'
  );

  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 40 THEN
    v_issues := v_issues || jsonb_build_array('Expected exactly 40 built-in templates');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id
    HAVING count(t.id) <> 2
  ) THEN
    v_issues := v_issues || jsonb_build_array('Every initial category must have exactly two built-in templates');
  END IF;

  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_issues) = 0,
    'issues', v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_builtin_roadmap_templates() TO service_role;

SELECT public.seed_additional_builtin_roadmap_templates();

DO $$
DECLARE
  v_validation jsonb;
BEGIN
  v_validation := public.validate_builtin_roadmap_templates();
  IF NOT COALESCE((v_validation ->> 'valid')::boolean, false) THEN
    RAISE EXCEPTION 'Expanded built-in roadmap validation failed: %', v_validation -> 'issues';
  END IF;
END;
$$;
