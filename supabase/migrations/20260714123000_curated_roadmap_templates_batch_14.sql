-- Curated roadmap template batch 14: platform and process modernization.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_14()
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
    "template_id": "10000000-0000-4000-8000-000000000261",
    "version_id": "30000000-0000-4000-8000-000000000261",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-architecture-modernization",
    "title": "SaaS Architecture Modernization",
    "summary": "Plan and deliver SaaS Architecture Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "saas",
      "modernization",
      "saas-architecture-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000262",
    "version_id": "30000000-0000-4000-8000-000000000262",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-codebase-modernization",
    "title": "Mobile Codebase Modernization",
    "summary": "Plan and deliver Mobile Codebase Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "mobile-app-development",
      "modernization",
      "mobile-codebase-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000263",
    "version_id": "30000000-0000-4000-8000-000000000263",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "legacy-web-application-modernization",
    "title": "Legacy Web Application Modernization",
    "summary": "Plan and deliver Legacy Web Application Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "web-development",
      "modernization",
      "legacy-web-application-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000264",
    "version_id": "30000000-0000-4000-8000-000000000264",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-technology-modernization",
    "title": "Marketing Technology Modernization",
    "summary": "Plan and deliver Marketing Technology Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "marketing",
      "modernization",
      "marketing-technology-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000265",
    "version_id": "30000000-0000-4000-8000-000000000265",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-repository-modernization",
    "title": "Research Repository Modernization",
    "summary": "Plan and deliver Research Repository Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "research",
      "modernization",
      "research-repository-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000266",
    "version_id": "30000000-0000-4000-8000-000000000266",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-technology-foundation-modernization",
    "title": "Startup Technology Foundation Modernization",
    "summary": "Plan and deliver Startup Technology Foundation Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "startup-launch",
      "modernization",
      "startup-technology-foundation-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000267",
    "version_id": "30000000-0000-4000-8000-000000000267",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-management-tooling-modernization",
    "title": "Product Management Tooling Modernization",
    "summary": "Plan and deliver Product Management Tooling Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "product-management",
      "modernization",
      "product-management-tooling-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000268",
    "version_id": "30000000-0000-4000-8000-000000000268",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-toolchain-modernization",
    "title": "Design Toolchain Modernization",
    "summary": "Plan and deliver Design Toolchain Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "ux-ui-design",
      "modernization",
      "design-toolchain-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000269",
    "version_id": "30000000-0000-4000-8000-000000000269",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "machine-learning-platform-modernization",
    "title": "Machine Learning Platform Modernization",
    "summary": "Plan and deliver Machine Learning Platform Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "ai-machine-learning",
      "modernization",
      "machine-learning-platform-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000270",
    "version_id": "30000000-0000-4000-8000-000000000270",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-warehouse-modernization",
    "title": "Data Warehouse Modernization",
    "summary": "Plan and deliver Data Warehouse Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "data-engineering",
      "modernization",
      "data-warehouse-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000271",
    "version_id": "30000000-0000-4000-8000-000000000271",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "legacy-deployment-modernization",
    "title": "Legacy Deployment Modernization",
    "summary": "Plan and deliver Legacy Deployment Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "devops",
      "modernization",
      "legacy-deployment-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000272",
    "version_id": "30000000-0000-4000-8000-000000000272",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-network-modernization",
    "title": "Cloud Network Modernization",
    "summary": "Plan and deliver Cloud Network Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "cloud-infrastructure",
      "modernization",
      "cloud-network-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000273",
    "version_id": "30000000-0000-4000-8000-000000000273",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "identity-security-modernization",
    "title": "Identity Security Modernization",
    "summary": "Plan and deliver Identity Security Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "cybersecurity",
      "modernization",
      "identity-security-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000274",
    "version_id": "30000000-0000-4000-8000-000000000274",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-platform-replatforming",
    "title": "E-commerce Platform Replatforming",
    "summary": "Plan and deliver E-commerce Platform Replatforming through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "e-commerce",
      "modernization",
      "e-commerce-platform-replatforming"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000275",
    "version_id": "30000000-0000-4000-8000-000000000275",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "digital-learning-platform-modernization",
    "title": "Digital Learning Platform Modernization",
    "summary": "Plan and deliver Digital Learning Platform Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "education",
      "modernization",
      "digital-learning-platform-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000276",
    "version_id": "30000000-0000-4000-8000-000000000276",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "clinical-systems-modernization",
    "title": "Clinical Systems Modernization",
    "summary": "Plan and deliver Clinical Systems Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "healthcare",
      "modernization",
      "clinical-systems-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000277",
    "version_id": "30000000-0000-4000-8000-000000000277",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "finance-systems-modernization",
    "title": "Finance Systems Modernization",
    "summary": "Plan and deliver Finance Systems Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "finance",
      "modernization",
      "finance-systems-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000278",
    "version_id": "30000000-0000-4000-8000-000000000278",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "hr-technology-modernization",
    "title": "HR Technology Modernization",
    "summary": "Plan and deliver HR Technology Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "human-resources",
      "modernization",
      "hr-technology-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000279",
    "version_id": "30000000-0000-4000-8000-000000000279",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-technology-modernization",
    "title": "Sales Technology Modernization",
    "summary": "Plan and deliver Sales Technology Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "sales",
      "modernization",
      "sales-technology-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000280",
    "version_id": "30000000-0000-4000-8000-000000000280",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "operations-technology-modernization",
    "title": "Operations Technology Modernization",
    "summary": "Plan and deliver Operations Technology Modernization through a curated platform and process modernization program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Current-state assessment",
      "Target architecture and roadmap",
      "Incremental modernization",
      "Migration and optimization"
    ],
    "tags": [
      "operations",
      "modernization",
      "operations-technology-modernization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T19:00:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_14()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_14();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 280 THEN
    RAISE EXCEPTION 'Batch 14 expected 280 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 14
  ) THEN
    RAISE EXCEPTION 'Batch 14 expected 14 built-ins per category';
  END IF;
END;
$$;
