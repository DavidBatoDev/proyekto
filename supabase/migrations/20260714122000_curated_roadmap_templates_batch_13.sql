-- Curated roadmap template batch 13: team capability and operating models.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_13()
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
    "template_id": "10000000-0000-4000-8000-000000000241",
    "version_id": "30000000-0000-4000-8000-000000000241",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-product-operations-team",
    "title": "SaaS Product Operations Team",
    "summary": "Plan and deliver SaaS Product Operations Team through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "saas",
      "capability",
      "saas-product-operations-team"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000242",
    "version_id": "30000000-0000-4000-8000-000000000242",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-engineering-capability",
    "title": "Mobile Engineering Capability",
    "summary": "Plan and deliver Mobile Engineering Capability through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "mobile-app-development",
      "capability",
      "mobile-engineering-capability"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000243",
    "version_id": "30000000-0000-4000-8000-000000000243",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-engineering-standards",
    "title": "Web Engineering Standards",
    "summary": "Plan and deliver Web Engineering Standards through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "web-development",
      "capability",
      "web-engineering-standards"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000244",
    "version_id": "30000000-0000-4000-8000-000000000244",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-team-operating-model",
    "title": "Marketing Team Operating Model",
    "summary": "Plan and deliver Marketing Team Operating Model through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "marketing",
      "capability",
      "marketing-team-operating-model"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000245",
    "version_id": "30000000-0000-4000-8000-000000000245",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-center-of-excellence",
    "title": "Research Center of Excellence",
    "summary": "Plan and deliver Research Center of Excellence through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "research",
      "capability",
      "research-center-of-excellence"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000246",
    "version_id": "30000000-0000-4000-8000-000000000246",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-leadership-operating-system",
    "title": "Startup Leadership Operating System",
    "summary": "Plan and deliver Startup Leadership Operating System through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "startup-launch",
      "capability",
      "startup-leadership-operating-system"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000247",
    "version_id": "30000000-0000-4000-8000-000000000247",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-operations-function",
    "title": "Product Operations Function",
    "summary": "Plan and deliver Product Operations Function through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "product-management",
      "capability",
      "product-operations-function"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000248",
    "version_id": "30000000-0000-4000-8000-000000000248",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-operations-function",
    "title": "Design Operations Function",
    "summary": "Plan and deliver Design Operations Function through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "ux-ui-design",
      "capability",
      "design-operations-function"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000249",
    "version_id": "30000000-0000-4000-8000-000000000249",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-center-of-excellence",
    "title": "AI Center of Excellence",
    "summary": "Plan and deliver AI Center of Excellence through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "ai-machine-learning",
      "capability",
      "ai-center-of-excellence"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000250",
    "version_id": "30000000-0000-4000-8000-000000000250",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-team-operating-model",
    "title": "Data Team Operating Model",
    "summary": "Plan and deliver Data Team Operating Model through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "data-engineering",
      "capability",
      "data-team-operating-model"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000251",
    "version_id": "30000000-0000-4000-8000-000000000251",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "site-reliability-capability",
    "title": "Site Reliability Capability",
    "summary": "Plan and deliver Site Reliability Capability through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "devops",
      "capability",
      "site-reliability-capability"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000252",
    "version_id": "30000000-0000-4000-8000-000000000252",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-center-of-excellence",
    "title": "Cloud Center of Excellence",
    "summary": "Plan and deliver Cloud Center of Excellence through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "cloud-infrastructure",
      "capability",
      "cloud-center-of-excellence"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000253",
    "version_id": "30000000-0000-4000-8000-000000000253",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "security-champions-program",
    "title": "Security Champions Program",
    "summary": "Plan and deliver Security Champions Program through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "cybersecurity",
      "capability",
      "security-champions-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000254",
    "version_id": "30000000-0000-4000-8000-000000000254",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-operations-team",
    "title": "E-commerce Operations Team",
    "summary": "Plan and deliver E-commerce Operations Team through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "e-commerce",
      "capability",
      "e-commerce-operations-team"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000255",
    "version_id": "30000000-0000-4000-8000-000000000255",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "faculty-digital-teaching-capability",
    "title": "Faculty Digital Teaching Capability",
    "summary": "Plan and deliver Faculty Digital Teaching Capability through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "education",
      "capability",
      "faculty-digital-teaching-capability"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000256",
    "version_id": "30000000-0000-4000-8000-000000000256",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "clinical-innovation-team",
    "title": "Clinical Innovation Team",
    "summary": "Plan and deliver Clinical Innovation Team through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "healthcare",
      "capability",
      "clinical-innovation-team"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000257",
    "version_id": "30000000-0000-4000-8000-000000000257",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "finance-business-partnering",
    "title": "Finance Business Partnering",
    "summary": "Plan and deliver Finance Business Partnering through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "finance",
      "capability",
      "finance-business-partnering"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000258",
    "version_id": "30000000-0000-4000-8000-000000000258",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "manager-development-program",
    "title": "Manager Development Program",
    "summary": "Plan and deliver Manager Development Program through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "human-resources",
      "capability",
      "manager-development-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000259",
    "version_id": "30000000-0000-4000-8000-000000000259",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-coaching-system",
    "title": "Sales Coaching System",
    "summary": "Plan and deliver Sales Coaching System through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "sales",
      "capability",
      "sales-coaching-system"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000260",
    "version_id": "30000000-0000-4000-8000-000000000260",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "continuous-improvement-capability",
    "title": "Continuous Improvement Capability",
    "summary": "Plan and deliver Continuous Improvement Capability through a curated team capability and operating models program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Capability and mandate baseline",
      "Operating model and standards",
      "Enablement and adoption",
      "Performance and evolution"
    ],
    "tags": [
      "operations",
      "capability",
      "continuous-improvement-capability"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:10:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_13()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_13();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 260 THEN
    RAISE EXCEPTION 'Batch 13 expected 260 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 13
  ) THEN
    RAISE EXCEPTION 'Batch 13 expected 13 built-ins per category';
  END IF;
END;
$$;
