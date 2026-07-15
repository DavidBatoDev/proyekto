-- Curated roadmap template batch 15: sustainable continuous improvement.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_15()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.seed_builtin_roadmap_template_batch(
$batch$
[
  {
    "template_id": "10000000-0000-4000-8000-000000000281",
    "version_id": "30000000-0000-4000-8000-000000000281",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-sustainable-growth-operations",
    "title": "SaaS Sustainable Growth Operations",
    "summary": "Plan and deliver SaaS Sustainable Growth Operations through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "saas",
      "continuous-improvement",
      "saas-sustainable-growth-operations"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000282",
    "version_id": "30000000-0000-4000-8000-000000000282",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-product-continuous-improvement",
    "title": "Mobile Product Continuous Improvement",
    "summary": "Plan and deliver Mobile Product Continuous Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "mobile-app-development",
      "continuous-improvement",
      "mobile-product-continuous-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000283",
    "version_id": "30000000-0000-4000-8000-000000000283",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-platform-sustainability",
    "title": "Web Platform Sustainability",
    "summary": "Plan and deliver Web Platform Sustainability through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "web-development",
      "continuous-improvement",
      "web-platform-sustainability"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000284",
    "version_id": "30000000-0000-4000-8000-000000000284",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "sustainable-marketing-program",
    "title": "Sustainable Marketing Program",
    "summary": "Plan and deliver Sustainable Marketing Program through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "marketing",
      "continuous-improvement",
      "sustainable-marketing-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000285",
    "version_id": "30000000-0000-4000-8000-000000000285",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "longitudinal-research-program",
    "title": "Longitudinal Research Program",
    "summary": "Plan and deliver Longitudinal Research Program through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "research",
      "continuous-improvement",
      "longitudinal-research-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000286",
    "version_id": "30000000-0000-4000-8000-000000000286",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-post-launch-operating-rhythm",
    "title": "Startup Post-Launch Operating Rhythm",
    "summary": "Plan and deliver Startup Post-Launch Operating Rhythm through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "startup-launch",
      "continuous-improvement",
      "startup-post-launch-operating-rhythm"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000287",
    "version_id": "30000000-0000-4000-8000-000000000287",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-continuous-discovery",
    "title": "Product Continuous Discovery",
    "summary": "Plan and deliver Product Continuous Discovery through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "product-management",
      "continuous-improvement",
      "product-continuous-discovery"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000288",
    "version_id": "30000000-0000-4000-8000-000000000288",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-quality-improvement",
    "title": "Design Quality Improvement",
    "summary": "Plan and deliver Design Quality Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "ux-ui-design",
      "continuous-improvement",
      "design-quality-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000289",
    "version_id": "30000000-0000-4000-8000-000000000289",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-continuous-evaluation",
    "title": "AI Continuous Evaluation",
    "summary": "Plan and deliver AI Continuous Evaluation through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "ai-machine-learning",
      "continuous-improvement",
      "ai-continuous-evaluation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000290",
    "version_id": "30000000-0000-4000-8000-000000000290",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-product-lifecycle-management",
    "title": "Data Product Lifecycle Management",
    "summary": "Plan and deliver Data Product Lifecycle Management through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "data-engineering",
      "continuous-improvement",
      "data-product-lifecycle-management"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000291",
    "version_id": "30000000-0000-4000-8000-000000000291",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "devops-continuous-improvement",
    "title": "DevOps Continuous Improvement",
    "summary": "Plan and deliver DevOps Continuous Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "devops",
      "continuous-improvement",
      "devops-continuous-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000292",
    "version_id": "30000000-0000-4000-8000-000000000292",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "sustainable-cloud-operations",
    "title": "Sustainable Cloud Operations",
    "summary": "Plan and deliver Sustainable Cloud Operations through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "cloud-infrastructure",
      "continuous-improvement",
      "sustainable-cloud-operations"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000293",
    "version_id": "30000000-0000-4000-8000-000000000293",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "continuous-security-improvement",
    "title": "Continuous Security Improvement",
    "summary": "Plan and deliver Continuous Security Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "cybersecurity",
      "continuous-improvement",
      "continuous-security-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000294",
    "version_id": "30000000-0000-4000-8000-000000000294",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "sustainable-commerce-operations",
    "title": "Sustainable Commerce Operations",
    "summary": "Plan and deliver Sustainable Commerce Operations through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "e-commerce",
      "continuous-improvement",
      "sustainable-commerce-operations"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000295",
    "version_id": "30000000-0000-4000-8000-000000000295",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "curriculum-continuous-improvement",
    "title": "Curriculum Continuous Improvement",
    "summary": "Plan and deliver Curriculum Continuous Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "education",
      "continuous-improvement",
      "curriculum-continuous-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000296",
    "version_id": "30000000-0000-4000-8000-000000000296",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "healthcare-quality-improvement",
    "title": "Healthcare Quality Improvement",
    "summary": "Plan and deliver Healthcare Quality Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "healthcare",
      "continuous-improvement",
      "healthcare-quality-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000297",
    "version_id": "30000000-0000-4000-8000-000000000297",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "finance-process-excellence",
    "title": "Finance Process Excellence",
    "summary": "Plan and deliver Finance Process Excellence through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "finance",
      "continuous-improvement",
      "finance-process-excellence"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000298",
    "version_id": "30000000-0000-4000-8000-000000000298",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "employee-listening-and-improvement",
    "title": "Employee Listening and Improvement",
    "summary": "Plan and deliver Employee Listening and Improvement through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "human-resources",
      "continuous-improvement",
      "employee-listening-and-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000299",
    "version_id": "30000000-0000-4000-8000-000000000299",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-process-excellence",
    "title": "Sales Process Excellence",
    "summary": "Plan and deliver Sales Process Excellence through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "sales",
      "continuous-improvement",
      "sales-process-excellence"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000300",
    "version_id": "30000000-0000-4000-8000-000000000300",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "lean-operations-program",
    "title": "Lean Operations Program",
    "summary": "Plan and deliver Lean Operations Program through a curated sustainable continuous improvement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and improvement goals",
      "Sustainable practice design",
      "Controlled improvement cycles",
      "Measurement and renewal"
    ],
    "tags": [
      "operations",
      "continuous-improvement",
      "lean-operations-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:10:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_15()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_15();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 300 THEN
    RAISE EXCEPTION 'Batch 15 expected 300 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 15
  ) THEN
    RAISE EXCEPTION 'Batch 15 expected 15 built-ins per category';
  END IF;
END;
$$;

ALTER FUNCTION public.validate_builtin_roadmap_templates()
  RENAME TO validate_builtin_roadmap_templates_legacy_60;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates_legacy_60()
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
  v_base_result := public.validate_builtin_roadmap_templates_legacy_60();
  SELECT COALESCE(jsonb_agg(to_jsonb(issue)), '[]'::jsonb)
  INTO v_issues
  FROM jsonb_array_elements_text(COALESCE(v_base_result -> 'issues', '[]'::jsonb)) AS base_issue(issue)
  WHERE issue NOT IN (
    'Expected exactly 60 built-in templates',
    'Every initial category must have exactly three built-in templates'
  );

  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 300 THEN
    v_issues := v_issues || jsonb_build_array('Expected exactly 300 built-in templates');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 15
  ) THEN
    v_issues := v_issues || jsonb_build_array('Every initial category must have exactly fifteen built-in templates');
  END IF;
  RETURN jsonb_build_object('valid', jsonb_array_length(v_issues) = 0, 'issues', v_issues);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_builtin_roadmap_templates() TO service_role;

CREATE OR REPLACE FUNCTION public.seed_curated_roadmap_template_batches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  v_count := v_count + public.seed_builtin_roadmap_template_batch_04();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_05();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_06();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_07();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_08();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_09();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_10();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_11();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_12();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_13();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_14();
  v_count := v_count + public.seed_builtin_roadmap_template_batch_15();
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_curated_roadmap_template_batches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_curated_roadmap_template_batches() TO service_role;

DO $$
DECLARE
  v_validation jsonb;
BEGIN
  v_validation := public.validate_builtin_roadmap_templates();
  IF NOT COALESCE((v_validation ->> 'valid')::boolean, false) THEN
    RAISE EXCEPTION 'Final built-in roadmap validation failed: %', v_validation -> 'issues';
  END IF;
END;
$$;
