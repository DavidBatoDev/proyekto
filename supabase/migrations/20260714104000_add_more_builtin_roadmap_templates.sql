-- Add a third curated built-in roadmap to every initial marketplace category.
-- IDs, slugs, versions, and publication timestamps are deterministic so the
-- seed remains safe across production migrations and local resets.

CREATE OR REPLACE FUNCTION public.seed_third_builtin_roadmap_templates()
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
    (1, '10000000-0000-4000-8000-000000000041'::uuid, '30000000-0000-4000-8000-000000000041'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'saas-pricing-and-packaging', 'SaaS Pricing and Packaging', 'Redesign SaaS pricing and packaging using customer value, willingness-to-pay evidence, commercial modeling, and controlled rollout.', 'advanced'::public.roadmap_template_difficulty, 'long_term'::public.roadmap_template_schedule_kind, 120, ARRAY['Pricing evidence baseline','Package and metric design','Commercial validation','Rollout and optimization'], ARRAY['saas','pricing','packaging'], true),
    (2, '10000000-0000-4000-8000-000000000042'::uuid, '30000000-0000-4000-8000-000000000042'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'mobile-app-accessibility-upgrade', 'Mobile App Accessibility Upgrade', 'Audit and improve a mobile application for inclusive navigation, readable interfaces, assistive technology support, and verified accessibility.', 'intermediate', 'long_term', 120, ARRAY['Accessibility baseline','Inclusive interaction design','Implementation and remediation','Assistive technology validation'], ARRAY['mobile','accessibility','inclusive-design'], false),
    (3, '10000000-0000-4000-8000-000000000043'::uuid, '30000000-0000-4000-8000-000000000043'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 'web-application-performance-modernization', 'Web Application Performance Modernization', 'Improve web application speed and reliability through measurement, frontend and backend optimization, delivery controls, and continuous monitoring.', 'advanced', 'long_term', 120, ARRAY['Performance measurement','Frontend optimization','Backend and delivery optimization','Monitoring and regression control'], ARRAY['web-development','performance','reliability'], true),
    (4, '10000000-0000-4000-8000-000000000044'::uuid, '30000000-0000-4000-8000-000000000044'::uuid, '20000000-0000-4000-8000-000000000004'::uuid, 'product-launch-communications-plan', 'Product Launch Communications Plan', 'Coordinate a product launch narrative across audiences, channels, enablement, release moments, and post-launch performance learning.', 'intermediate', 'long_term', 120, ARRAY['Launch context and audiences','Messaging and content system','Channel and team activation','Launch measurement and learning'], ARRAY['marketing','product-launch','communications'], false),
    (5, '10000000-0000-4000-8000-000000000045'::uuid, '30000000-0000-4000-8000-000000000045'::uuid, '20000000-0000-4000-8000-000000000005'::uuid, 'competitive-market-analysis', 'Competitive Market Analysis', 'Produce a decision-ready market and competitor analysis with clear framing, credible evidence, differentiated insights, and strategic implications.', 'intermediate', 'long_term', 120, ARRAY['Market framing','Competitor evidence','Comparative analysis','Strategic implications'], ARRAY['research','competitive-analysis','market-research'], true),
    (6, '10000000-0000-4000-8000-000000000046'::uuid, '30000000-0000-4000-8000-000000000046'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'startup-operations-foundation', 'Startup Operations Foundation', 'Build practical startup operations covering goals, financial controls, people practices, decision rights, and a repeatable operating rhythm.', 'beginner', 'long_term', 120, ARRAY['Operating model baseline','Goals and decision rights','Finance and people controls','Operating cadence'], ARRAY['startup','operations','founder'], false),
    (7, '10000000-0000-4000-8000-000000000047'::uuid, '30000000-0000-4000-8000-000000000047'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 'product-analytics-implementation', 'Product Analytics Implementation', 'Implement trustworthy product analytics from outcome questions and event design through instrumentation, dashboards, and decision routines.', 'intermediate', 'long_term', 120, ARRAY['Outcome and metric strategy','Event and identity design','Instrumentation and quality','Insights and decision cadence'], ARRAY['product-management','product-analytics','metrics'], false),
    (8, '10000000-0000-4000-8000-000000000048'::uuid, '30000000-0000-4000-8000-000000000048'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 'ux-research-operations', 'UX Research Operations', 'Establish a scalable research operations practice spanning intake, recruitment, consent, repositories, governance, and insight activation.', 'advanced', 'long_term', 120, ARRAY['Research operations baseline','Intake and participant systems','Knowledge repository','Governance and adoption'], ARRAY['ux-ui','research-operations','user-research'], false),
    (9, '10000000-0000-4000-8000-000000000049'::uuid, '30000000-0000-4000-8000-000000000049'::uuid, '20000000-0000-4000-8000-000000000009'::uuid, 'responsible-ai-governance-program', 'Responsible AI Governance Program', 'Create practical AI governance with risk classification, accountable review, evaluation controls, deployment standards, and ongoing monitoring.', 'advanced', 'long_term', 150, ARRAY['AI portfolio and risk baseline','Policy and accountability','Evaluation and control design','Deployment governance','Monitoring and improvement'], ARRAY['ai','responsible-ai','governance'], true),
    (10, '10000000-0000-4000-8000-000000000050'::uuid, '30000000-0000-4000-8000-000000000050'::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 'data-governance-and-quality', 'Data Governance and Quality', 'Launch a pragmatic data governance program connecting critical data, accountable ownership, quality controls, lineage, and issue resolution.', 'advanced', 'long_term', 120, ARRAY['Critical data baseline','Ownership and standards','Quality and lineage controls','Issue management and adoption'], ARRAY['data-engineering','data-governance','data-quality'], false),
    (11, '10000000-0000-4000-8000-000000000051'::uuid, '30000000-0000-4000-8000-000000000051'::uuid, '20000000-0000-4000-8000-000000000011'::uuid, 'platform-engineering-foundation', 'Platform Engineering Foundation', 'Create an internal developer platform foundation with clear user needs, paved roads, self-service capabilities, reliability, and adoption metrics.', 'advanced', 'long_term', 120, ARRAY['Developer experience baseline','Platform product strategy','Self-service foundation','Reliability and adoption'], ARRAY['devops','platform-engineering','developer-experience'], false),
    (12, '10000000-0000-4000-8000-000000000052'::uuid, '30000000-0000-4000-8000-000000000052'::uuid, '20000000-0000-4000-8000-000000000012'::uuid, 'cloud-disaster-recovery', 'Cloud Disaster Recovery', 'Design and prove cloud disaster recovery with business-aligned objectives, resilient architecture, automated recovery, testing, and ownership.', 'advanced', 'long_term', 120, ARRAY['Recovery requirements','Resilient architecture','Recovery automation','Exercises and governance'], ARRAY['cloud','disaster-recovery','resilience'], false),
    (13, '10000000-0000-4000-8000-000000000053'::uuid, '30000000-0000-4000-8000-000000000053'::uuid, '20000000-0000-4000-8000-000000000013'::uuid, 'security-awareness-and-phishing-defense', 'Security Awareness and Phishing Defense', 'Build a role-aware security behavior program combining risk evidence, practical learning, phishing exercises, support, and measurable improvement.', 'intermediate', 'long_term', 120, ARRAY['Human risk baseline','Learning and support design','Phishing defense rollout','Measurement and reinforcement'], ARRAY['cybersecurity','security-awareness','phishing'], false),
    (14, '10000000-0000-4000-8000-000000000054'::uuid, '30000000-0000-4000-8000-000000000054'::uuid, '20000000-0000-4000-8000-000000000014'::uuid, 'e-commerce-international-expansion', 'E-commerce International Expansion', 'Prepare and launch an e-commerce business in a new market across demand, localization, payments, compliance, fulfillment, and growth.', 'advanced', 'long_term', 150, ARRAY['Market opportunity','Localization and compliance','Commerce and fulfillment readiness','Controlled market launch','Growth and optimization'], ARRAY['e-commerce','international-expansion','localization'], false),
    (15, '10000000-0000-4000-8000-000000000055'::uuid, '30000000-0000-4000-8000-000000000055'::uuid, '20000000-0000-4000-8000-000000000015'::uuid, 'learn-sql-fundamentals', 'Learn SQL Fundamentals', 'Learn practical SQL through four focused weeks of querying, joins, aggregation, data modeling concepts, and an applied analysis project.', 'beginner', 'short_learning', 28, ARRAY['Query foundations','Joins and relationships','Aggregation and analysis','Applied SQL project'], ARRAY['education','sql','data'], true),
    (16, '10000000-0000-4000-8000-000000000056'::uuid, '30000000-0000-4000-8000-000000000056'::uuid, '20000000-0000-4000-8000-000000000016'::uuid, 'healthcare-data-interoperability', 'Healthcare Data Interoperability', 'Deliver a controlled healthcare interoperability initiative covering use cases, data standards, privacy, integration, validation, and operations.', 'advanced', 'long_term', 150, ARRAY['Clinical use case framing','Standards and data contracts','Secure integration','Clinical and technical validation','Operational handover'], ARRAY['healthcare','interoperability','health-data'], false),
    (17, '10000000-0000-4000-8000-000000000057'::uuid, '30000000-0000-4000-8000-000000000057'::uuid, '20000000-0000-4000-8000-000000000017'::uuid, 'finance-close-process-improvement', 'Finance Close Process Improvement', 'Shorten and strengthen the financial close through process evidence, clear ownership, reconciliations, automation, controls, and review cadence.', 'intermediate', 'long_term', 120, ARRAY['Close process baseline','Ownership and control design','Automation and standardization','Close governance and improvement'], ARRAY['finance','financial-close','process-improvement'], false),
    (18, '10000000-0000-4000-8000-000000000058'::uuid, '30000000-0000-4000-8000-000000000058'::uuid, '20000000-0000-4000-8000-000000000018'::uuid, 'hiring-process-redesign', 'Hiring Process Redesign', 'Create a fair efficient hiring system from workforce need and role definition through structured selection, candidate experience, and measurement.', 'intermediate', 'long_term', 120, ARRAY['Hiring evidence baseline','Role and selection design','Candidate journey implementation','Measurement and improvement'], ARRAY['human-resources','hiring','candidate-experience'], false),
    (19, '10000000-0000-4000-8000-000000000059'::uuid, '30000000-0000-4000-8000-000000000059'::uuid, '20000000-0000-4000-8000-000000000019'::uuid, 'sales-enablement-program', 'Sales Enablement Program', 'Build a measurable sales enablement system connecting buyer needs, messaging, skills, content, manager coaching, and revenue outcomes.', 'intermediate', 'long_term', 120, ARRAY['Enablement needs baseline','Messaging and content','Skills and coaching rollout','Adoption and revenue learning'], ARRAY['sales','sales-enablement','coaching'], false),
    (20, '10000000-0000-4000-8000-000000000060'::uuid, '30000000-0000-4000-8000-000000000060'::uuid, '20000000-0000-4000-8000-000000000020'::uuid, 'supply-chain-resilience-program', 'Supply Chain Resilience Program', 'Improve supply continuity through dependency visibility, scenario planning, supplier actions, inventory choices, monitoring, and response governance.', 'advanced', 'long_term', 150, ARRAY['Supply network baseline','Risk and scenario analysis','Resilience interventions','Monitoring and response','Continuous improvement'], ARRAY['operations','supply-chain','resilience'], true)
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
      '2026-07-14 13:00:00+00', '2026-07-14 13:00:00+00'
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
      NULL, '2026-07-14 13:00:00+00'
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

REVOKE ALL ON FUNCTION public.seed_third_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_third_builtin_roadmap_templates() TO service_role;

-- Retain the 40-template validator as the structural layer, then replace its
-- cardinality expectations with the new 60-template contract.
ALTER FUNCTION public.validate_builtin_roadmap_templates()
  RENAME TO validate_builtin_roadmap_templates_legacy_40;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates_legacy_40()
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
  v_base_result := public.validate_builtin_roadmap_templates_legacy_40();

  SELECT COALESCE(jsonb_agg(to_jsonb(issue)), '[]'::jsonb)
  INTO v_issues
  FROM jsonb_array_elements_text(COALESCE(v_base_result -> 'issues', '[]'::jsonb)) AS base_issue(issue)
  WHERE issue NOT IN (
    'Expected exactly 40 built-in templates',
    'Every initial category must have exactly two built-in templates'
  );

  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 60 THEN
    v_issues := v_issues || jsonb_build_array('Expected exactly 60 built-in templates');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id
    HAVING count(t.id) <> 3
  ) THEN
    v_issues := v_issues || jsonb_build_array('Every initial category must have exactly three built-in templates');
  END IF;

  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_issues) = 0,
    'issues', v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_builtin_roadmap_templates() TO service_role;

SELECT public.seed_third_builtin_roadmap_templates();

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
