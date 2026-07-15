-- Curated roadmap template batch 04: optimization and efficiency.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch(p_templates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_definition jsonb;
  v_content jsonb;
  v_checksum text;
  v_phases text[];
  v_tags text[];
  v_tag text;
  v_tag_id uuid;
  v_preview text;
  v_count integer := 0;
BEGIN
  IF jsonb_typeof(p_templates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_templates) <> 20 THEN
    RAISE EXCEPTION 'Curated roadmap template batches must contain exactly 20 definitions';
  END IF;

  SELECT preview_url INTO v_preview
  FROM public.roadmap_public_templates
  WHERE id = '10000000-0000-4000-8000-000000000001';
  IF v_preview IS NULL THEN
    RAISE EXCEPTION 'The initial built-in roadmap library must be seeded first';
  END IF;

  FOR v_definition IN SELECT value FROM jsonb_array_elements(p_templates) LOOP
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_definition -> 'phases')) INTO v_phases;
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_definition -> 'tags')) INTO v_tags;
    v_content := public.build_builtin_roadmap_template_content(
      v_definition ->> 'title', v_definition ->> 'summary',
      (v_definition ->> 'schedule_kind')::public.roadmap_template_schedule_kind,
      v_phases
    );
    v_checksum := encode(extensions.digest(v_content::text, 'sha256'), 'hex');

    INSERT INTO public.roadmap_public_templates (
      id, slug, title, summary, preview_url, owner_id, source_roadmap_id,
      origin, status, category_id, difficulty, schedule_kind,
      estimated_duration_days, attribution_name, attribution_url,
      is_featured, rights_attested_at, published_at
    ) VALUES (
      (v_definition ->> 'template_id')::uuid, v_definition ->> 'slug',
      v_definition ->> 'title', v_definition ->> 'summary', v_preview,
      NULL, NULL, 'builtin', 'published', (v_definition ->> 'category_id')::uuid,
      (v_definition ->> 'difficulty')::public.roadmap_template_difficulty,
      (v_definition ->> 'schedule_kind')::public.roadmap_template_schedule_kind,
      (v_definition ->> 'duration_days')::integer, 'Proyekto', NULL,
      COALESCE((v_definition ->> 'is_featured')::boolean, false),
      (v_definition ->> 'published_at')::timestamptz,
      (v_definition ->> 'published_at')::timestamptz
    ) ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug, title = EXCLUDED.title, summary = EXCLUDED.summary,
      preview_url = EXCLUDED.preview_url, status = 'published',
      category_id = EXCLUDED.category_id, difficulty = EXCLUDED.difficulty,
      schedule_kind = EXCLUDED.schedule_kind,
      estimated_duration_days = EXCLUDED.estimated_duration_days,
      attribution_name = EXCLUDED.attribution_name,
      is_featured = EXCLUDED.is_featured,
      rights_attested_at = EXCLUDED.rights_attested_at,
      published_at = EXCLUDED.published_at,
      unlisted_at = NULL, archived_at = NULL;

    INSERT INTO public.roadmap_template_versions (
      id, template_id, version_number, contract_version, content, checksum,
      created_by, published_at
    ) VALUES (
      (v_definition ->> 'version_id')::uuid,
      (v_definition ->> 'template_id')::uuid,
      1, 1, v_content, v_checksum, NULL,
      (v_definition ->> 'published_at')::timestamptz
    ) ON CONFLICT (id) DO NOTHING;

    UPDATE public.roadmap_public_templates
    SET current_version_id = (v_definition ->> 'version_id')::uuid,
      status = 'published'
    WHERE id = (v_definition ->> 'template_id')::uuid
      AND current_version_id IS DISTINCT FROM (v_definition ->> 'version_id')::uuid;

    FOREACH v_tag IN ARRAY v_tags LOOP
      INSERT INTO public.roadmap_template_tags (slug, name)
      VALUES (v_tag, initcap(replace(v_tag, '-', ' ')))
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_tag_id;
      INSERT INTO public.roadmap_public_template_tags (template_id, tag_id)
      VALUES ((v_definition ->> 'template_id')::uuid, v_tag_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_04()
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
    "template_id": "10000000-0000-4000-8000-000000000061",
    "version_id": "30000000-0000-4000-8000-000000000061",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-onboarding-conversion-optimization",
    "title": "SaaS Onboarding Conversion Optimization",
    "summary": "Plan and deliver SaaS Onboarding Conversion Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "saas",
      "optimization",
      "saas-onboarding-conversion-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000062",
    "version_id": "30000000-0000-4000-8000-000000000062",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-app-activation-improvement",
    "title": "Mobile App Activation Improvement",
    "summary": "Plan and deliver Mobile App Activation Improvement through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "mobile-app-development",
      "optimization",
      "mobile-app-activation-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000063",
    "version_id": "30000000-0000-4000-8000-000000000063",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-conversion-optimization",
    "title": "Web Conversion Optimization",
    "summary": "Plan and deliver Web Conversion Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "web-development",
      "optimization",
      "web-conversion-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000064",
    "version_id": "30000000-0000-4000-8000-000000000064",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-funnel-optimization",
    "title": "Marketing Funnel Optimization",
    "summary": "Plan and deliver Marketing Funnel Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "marketing",
      "optimization",
      "marketing-funnel-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000065",
    "version_id": "30000000-0000-4000-8000-000000000065",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-recruitment-operations",
    "title": "Research Recruitment Operations",
    "summary": "Plan and deliver Research Recruitment Operations through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "research",
      "optimization",
      "research-recruitment-operations"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000066",
    "version_id": "30000000-0000-4000-8000-000000000066",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-runway-extension",
    "title": "Startup Runway Extension",
    "summary": "Plan and deliver Startup Runway Extension through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "startup-launch",
      "optimization",
      "startup-runway-extension"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000067",
    "version_id": "30000000-0000-4000-8000-000000000067",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-backlog-flow-improvement",
    "title": "Product Backlog Flow Improvement",
    "summary": "Plan and deliver Product Backlog Flow Improvement through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "product-management",
      "optimization",
      "product-backlog-flow-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000068",
    "version_id": "30000000-0000-4000-8000-000000000068",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-workflow-optimization",
    "title": "Design Workflow Optimization",
    "summary": "Plan and deliver Design Workflow Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "ux-ui-design",
      "optimization",
      "design-workflow-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000069",
    "version_id": "30000000-0000-4000-8000-000000000069",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ml-inference-efficiency",
    "title": "ML Inference Efficiency",
    "summary": "Plan and deliver ML Inference Efficiency through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "ai-machine-learning",
      "optimization",
      "ml-inference-efficiency"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000070",
    "version_id": "30000000-0000-4000-8000-000000000070",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-pipeline-performance",
    "title": "Data Pipeline Performance",
    "summary": "Plan and deliver Data Pipeline Performance through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "data-engineering",
      "optimization",
      "data-pipeline-performance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000071",
    "version_id": "30000000-0000-4000-8000-000000000071",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "deployment-lead-time-reduction",
    "title": "Deployment Lead Time Reduction",
    "summary": "Plan and deliver Deployment Lead Time Reduction through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "devops",
      "optimization",
      "deployment-lead-time-reduction"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000072",
    "version_id": "30000000-0000-4000-8000-000000000072",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-resource-efficiency",
    "title": "Cloud Resource Efficiency",
    "summary": "Plan and deliver Cloud Resource Efficiency through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "cloud-infrastructure",
      "optimization",
      "cloud-resource-efficiency"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000073",
    "version_id": "30000000-0000-4000-8000-000000000073",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "vulnerability-remediation-program",
    "title": "Vulnerability Remediation Program",
    "summary": "Plan and deliver Vulnerability Remediation Program through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "cybersecurity",
      "optimization",
      "vulnerability-remediation-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000074",
    "version_id": "30000000-0000-4000-8000-000000000074",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "marketplace-merchandising-optimization",
    "title": "Marketplace Merchandising Optimization",
    "summary": "Plan and deliver Marketplace Merchandising Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "e-commerce",
      "optimization",
      "marketplace-merchandising-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000075",
    "version_id": "30000000-0000-4000-8000-000000000075",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "learning-experience-improvement",
    "title": "Learning Experience Improvement",
    "summary": "Plan and deliver Learning Experience Improvement through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "education",
      "optimization",
      "learning-experience-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000076",
    "version_id": "30000000-0000-4000-8000-000000000076",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "patient-scheduling-improvement",
    "title": "Patient Scheduling Improvement",
    "summary": "Plan and deliver Patient Scheduling Improvement through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "healthcare",
      "optimization",
      "patient-scheduling-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000077",
    "version_id": "30000000-0000-4000-8000-000000000077",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "working-capital-optimization",
    "title": "Working Capital Optimization",
    "summary": "Plan and deliver Working Capital Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "finance",
      "optimization",
      "working-capital-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000078",
    "version_id": "30000000-0000-4000-8000-000000000078",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "employee-engagement-improvement",
    "title": "Employee Engagement Improvement",
    "summary": "Plan and deliver Employee Engagement Improvement through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "human-resources",
      "optimization",
      "employee-engagement-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000079",
    "version_id": "30000000-0000-4000-8000-000000000079",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-pipeline-conversion",
    "title": "Sales Pipeline Conversion",
    "summary": "Plan and deliver Sales Pipeline Conversion through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "sales",
      "optimization",
      "sales-pipeline-conversion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000080",
    "version_id": "30000000-0000-4000-8000-000000000080",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "inventory-management-optimization",
    "title": "Inventory Management Optimization",
    "summary": "Plan and deliver Inventory Management Optimization through a curated optimization and efficiency program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Baseline and opportunity",
      "Target-state design",
      "Focused implementation",
      "Measurement and optimization"
    ],
    "tags": [
      "operations",
      "optimization",
      "inventory-management-optimization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:00:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_04()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_04();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 80 THEN
    RAISE EXCEPTION 'Batch 04 expected 80 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 4
  ) THEN
    RAISE EXCEPTION 'Batch 04 expected 4 built-ins per category';
  END IF;
END;
$$;
