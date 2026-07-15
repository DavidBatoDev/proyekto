-- Curated roadmap template batch 10: systems and team integration.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_10()
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
    "template_id": "10000000-0000-4000-8000-000000000181",
    "version_id": "30000000-0000-4000-8000-000000000181",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-integration-marketplace",
    "title": "SaaS Integration Marketplace",
    "summary": "Plan and deliver SaaS Integration Marketplace through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "saas",
      "integration",
      "saas-integration-marketplace"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000182",
    "version_id": "30000000-0000-4000-8000-000000000182",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-backend-integration-program",
    "title": "Mobile Backend Integration Program",
    "summary": "Plan and deliver Mobile Backend Integration Program through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "mobile-app-development",
      "integration",
      "mobile-backend-integration-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000183",
    "version_id": "30000000-0000-4000-8000-000000000183",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-api-integration-platform",
    "title": "Web API Integration Platform",
    "summary": "Plan and deliver Web API Integration Platform through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "web-development",
      "integration",
      "web-api-integration-platform"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000184",
    "version_id": "30000000-0000-4000-8000-000000000184",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-technology-integration",
    "title": "Marketing Technology Integration",
    "summary": "Plan and deliver Marketing Technology Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "marketing",
      "integration",
      "marketing-technology-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000185",
    "version_id": "30000000-0000-4000-8000-000000000185",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "mixed-methods-research-integration",
    "title": "Mixed-Methods Research Integration",
    "summary": "Plan and deliver Mixed-Methods Research Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "research",
      "integration",
      "mixed-methods-research-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000186",
    "version_id": "30000000-0000-4000-8000-000000000186",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-partner-ecosystem",
    "title": "Startup Partner Ecosystem",
    "summary": "Plan and deliver Startup Partner Ecosystem through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "startup-launch",
      "integration",
      "startup-partner-ecosystem"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000187",
    "version_id": "30000000-0000-4000-8000-000000000187",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-and-engineering-alignment",
    "title": "Product and Engineering Alignment",
    "summary": "Plan and deliver Product and Engineering Alignment through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "product-management",
      "integration",
      "product-and-engineering-alignment"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000188",
    "version_id": "30000000-0000-4000-8000-000000000188",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-to-development-handoff",
    "title": "Design-to-Development Handoff",
    "summary": "Plan and deliver Design-to-Development Handoff through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "ux-ui-design",
      "integration",
      "design-to-development-handoff"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000189",
    "version_id": "30000000-0000-4000-8000-000000000189",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-knowledge-retrieval-integration",
    "title": "AI Knowledge Retrieval Integration",
    "summary": "Plan and deliver AI Knowledge Retrieval Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "ai-machine-learning",
      "integration",
      "ai-knowledge-retrieval-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000190",
    "version_id": "30000000-0000-4000-8000-000000000190",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "customer-data-integration",
    "title": "Customer Data Integration",
    "summary": "Plan and deliver Customer Data Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "data-engineering",
      "integration",
      "customer-data-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000191",
    "version_id": "30000000-0000-4000-8000-000000000191",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "devsecops-integration",
    "title": "DevSecOps Integration",
    "summary": "Plan and deliver DevSecOps Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "devops",
      "integration",
      "devsecops-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000192",
    "version_id": "30000000-0000-4000-8000-000000000192",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "hybrid-cloud-integration",
    "title": "Hybrid Cloud Integration",
    "summary": "Plan and deliver Hybrid Cloud Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "cloud-infrastructure",
      "integration",
      "hybrid-cloud-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000193",
    "version_id": "30000000-0000-4000-8000-000000000193",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "identity-and-access-integration",
    "title": "Identity and Access Integration",
    "summary": "Plan and deliver Identity and Access Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "cybersecurity",
      "integration",
      "identity-and-access-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000194",
    "version_id": "30000000-0000-4000-8000-000000000194",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-erp-integration",
    "title": "E-commerce ERP Integration",
    "summary": "Plan and deliver E-commerce ERP Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "e-commerce",
      "integration",
      "e-commerce-erp-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000195",
    "version_id": "30000000-0000-4000-8000-000000000195",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "learning-platform-integration",
    "title": "Learning Platform Integration",
    "summary": "Plan and deliver Learning Platform Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "education",
      "integration",
      "learning-platform-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000196",
    "version_id": "30000000-0000-4000-8000-000000000196",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "health-system-integration",
    "title": "Health System Integration",
    "summary": "Plan and deliver Health System Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "healthcare",
      "integration",
      "health-system-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000197",
    "version_id": "30000000-0000-4000-8000-000000000197",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "financial-systems-integration",
    "title": "Financial Systems Integration",
    "summary": "Plan and deliver Financial Systems Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "finance",
      "integration",
      "financial-systems-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000198",
    "version_id": "30000000-0000-4000-8000-000000000198",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "hris-integration-program",
    "title": "HRIS Integration Program",
    "summary": "Plan and deliver HRIS Integration Program through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "human-resources",
      "integration",
      "hris-integration-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000199",
    "version_id": "30000000-0000-4000-8000-000000000199",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "crm-and-sales-stack-integration",
    "title": "CRM and Sales Stack Integration",
    "summary": "Plan and deliver CRM and Sales Stack Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "sales",
      "integration",
      "crm-and-sales-stack-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000200",
    "version_id": "30000000-0000-4000-8000-000000000200",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "enterprise-systems-integration",
    "title": "Enterprise Systems Integration",
    "summary": "Plan and deliver Enterprise Systems Integration through a curated systems and team integration program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Use cases and architecture",
      "Contracts and security",
      "Integration delivery",
      "End-to-end validation"
    ],
    "tags": [
      "operations",
      "integration",
      "enterprise-systems-integration"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:00:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_10()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_10();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 200 THEN
    RAISE EXCEPTION 'Batch 10 expected 200 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 10
  ) THEN
    RAISE EXCEPTION 'Batch 10 expected 10 built-ins per category';
  END IF;
END;
$$;
