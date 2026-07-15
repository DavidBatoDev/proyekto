-- Curated roadmap template batch 07: analytics and measurement.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_07()
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
    "template_id": "10000000-0000-4000-8000-000000000121",
    "version_id": "30000000-0000-4000-8000-000000000121",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-revenue-analytics",
    "title": "SaaS Revenue Analytics",
    "summary": "Plan and deliver SaaS Revenue Analytics through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "saas",
      "measurement",
      "saas-revenue-analytics"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000122",
    "version_id": "30000000-0000-4000-8000-000000000122",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-product-analytics",
    "title": "Mobile Product Analytics",
    "summary": "Plan and deliver Mobile Product Analytics through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "mobile-app-development",
      "measurement",
      "mobile-product-analytics"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000123",
    "version_id": "30000000-0000-4000-8000-000000000123",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-experience-analytics",
    "title": "Web Experience Analytics",
    "summary": "Plan and deliver Web Experience Analytics through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "web-development",
      "measurement",
      "web-experience-analytics"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000124",
    "version_id": "30000000-0000-4000-8000-000000000124",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-attribution-measurement",
    "title": "Marketing Attribution Measurement",
    "summary": "Plan and deliver Marketing Attribution Measurement through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "marketing",
      "measurement",
      "marketing-attribution-measurement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000125",
    "version_id": "30000000-0000-4000-8000-000000000125",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-impact-measurement",
    "title": "Research Impact Measurement",
    "summary": "Plan and deliver Research Impact Measurement through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "research",
      "measurement",
      "research-impact-measurement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000126",
    "version_id": "30000000-0000-4000-8000-000000000126",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-kpi-operating-system",
    "title": "Startup KPI Operating System",
    "summary": "Plan and deliver Startup KPI Operating System through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "startup-launch",
      "measurement",
      "startup-kpi-operating-system"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000127",
    "version_id": "30000000-0000-4000-8000-000000000127",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-experimentation-program",
    "title": "Product Experimentation Program",
    "summary": "Plan and deliver Product Experimentation Program through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "product-management",
      "measurement",
      "product-experimentation-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000128",
    "version_id": "30000000-0000-4000-8000-000000000128",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-experience-measurement",
    "title": "Design Experience Measurement",
    "summary": "Plan and deliver Design Experience Measurement through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "ux-ui-design",
      "measurement",
      "design-experience-measurement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000129",
    "version_id": "30000000-0000-4000-8000-000000000129",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-evaluation-benchmarking",
    "title": "AI Evaluation Benchmarking",
    "summary": "Plan and deliver AI Evaluation Benchmarking through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "ai-machine-learning",
      "measurement",
      "ai-evaluation-benchmarking"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000130",
    "version_id": "30000000-0000-4000-8000-000000000130",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-observability-program",
    "title": "Data Observability Program",
    "summary": "Plan and deliver Data Observability Program through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "data-engineering",
      "measurement",
      "data-observability-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000131",
    "version_id": "30000000-0000-4000-8000-000000000131",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "engineering-productivity-measurement",
    "title": "Engineering Productivity Measurement",
    "summary": "Plan and deliver Engineering Productivity Measurement through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "devops",
      "measurement",
      "engineering-productivity-measurement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000132",
    "version_id": "30000000-0000-4000-8000-000000000132",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-reliability-metrics",
    "title": "Cloud Reliability Metrics",
    "summary": "Plan and deliver Cloud Reliability Metrics through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "cloud-infrastructure",
      "measurement",
      "cloud-reliability-metrics"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000133",
    "version_id": "30000000-0000-4000-8000-000000000133",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "security-metrics-and-reporting",
    "title": "Security Metrics and Reporting",
    "summary": "Plan and deliver Security Metrics and Reporting through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "cybersecurity",
      "measurement",
      "security-metrics-and-reporting"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000134",
    "version_id": "30000000-0000-4000-8000-000000000134",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-customer-analytics",
    "title": "E-commerce Customer Analytics",
    "summary": "Plan and deliver E-commerce Customer Analytics through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "e-commerce",
      "measurement",
      "e-commerce-customer-analytics"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000135",
    "version_id": "30000000-0000-4000-8000-000000000135",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "learning-analytics-program",
    "title": "Learning Analytics Program",
    "summary": "Plan and deliver Learning Analytics Program through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "education",
      "measurement",
      "learning-analytics-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000136",
    "version_id": "30000000-0000-4000-8000-000000000136",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "clinical-outcomes-measurement",
    "title": "Clinical Outcomes Measurement",
    "summary": "Plan and deliver Clinical Outcomes Measurement through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "healthcare",
      "measurement",
      "clinical-outcomes-measurement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000137",
    "version_id": "30000000-0000-4000-8000-000000000137",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "management-reporting-modernization",
    "title": "Management Reporting Modernization",
    "summary": "Plan and deliver Management Reporting Modernization through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "finance",
      "measurement",
      "management-reporting-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000138",
    "version_id": "30000000-0000-4000-8000-000000000138",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "people-analytics-foundation",
    "title": "People Analytics Foundation",
    "summary": "Plan and deliver People Analytics Foundation through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "human-resources",
      "measurement",
      "people-analytics-foundation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000139",
    "version_id": "30000000-0000-4000-8000-000000000139",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-forecast-accuracy",
    "title": "Sales Forecast Accuracy",
    "summary": "Plan and deliver Sales Forecast Accuracy through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "sales",
      "measurement",
      "sales-forecast-accuracy"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000140",
    "version_id": "30000000-0000-4000-8000-000000000140",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "operations-performance-dashboard",
    "title": "Operations Performance Dashboard",
    "summary": "Plan and deliver Operations Performance Dashboard through a curated analytics and measurement program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Decision and metric design",
      "Data and instrumentation",
      "Reporting and insight delivery",
      "Adoption and optimization"
    ],
    "tags": [
      "operations",
      "measurement",
      "operations-performance-dashboard"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:10:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_07()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_07();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 140 THEN
    RAISE EXCEPTION 'Batch 07 expected 140 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 7
  ) THEN
    RAISE EXCEPTION 'Batch 07 expected 7 built-ins per category';
  END IF;
END;
$$;
