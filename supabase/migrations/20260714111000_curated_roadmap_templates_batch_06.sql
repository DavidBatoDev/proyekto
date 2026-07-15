-- Curated roadmap template batch 06: launch and adoption.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_06()
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
    "template_id": "10000000-0000-4000-8000-000000000101",
    "version_id": "30000000-0000-4000-8000-000000000101",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-enterprise-feature-rollout",
    "title": "SaaS Enterprise Feature Rollout",
    "summary": "Plan and deliver SaaS Enterprise Feature Rollout through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "saas",
      "rollout",
      "saas-enterprise-feature-rollout"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000102",
    "version_id": "30000000-0000-4000-8000-000000000102",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-feature-launch-playbook",
    "title": "Mobile Feature Launch Playbook",
    "summary": "Plan and deliver Mobile Feature Launch Playbook through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "mobile-app-development",
      "rollout",
      "mobile-feature-launch-playbook"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000103",
    "version_id": "30000000-0000-4000-8000-000000000103",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-platform-relaunch",
    "title": "Web Platform Relaunch",
    "summary": "Plan and deliver Web Platform Relaunch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "web-development",
      "rollout",
      "web-platform-relaunch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000104",
    "version_id": "30000000-0000-4000-8000-000000000104",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "community-led-product-launch",
    "title": "Community-Led Product Launch",
    "summary": "Plan and deliver Community-Led Product Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "marketing",
      "rollout",
      "community-led-product-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000105",
    "version_id": "30000000-0000-4000-8000-000000000105",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-findings-adoption",
    "title": "Research Findings Adoption",
    "summary": "Plan and deliver Research Findings Adoption through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "research",
      "rollout",
      "research-findings-adoption"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000106",
    "version_id": "30000000-0000-4000-8000-000000000106",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-market-entry",
    "title": "Startup Market Entry",
    "summary": "Plan and deliver Startup Market Entry through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "startup-launch",
      "rollout",
      "startup-market-entry"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000107",
    "version_id": "30000000-0000-4000-8000-000000000107",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-beta-program",
    "title": "Product Beta Program",
    "summary": "Plan and deliver Product Beta Program through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "product-management",
      "rollout",
      "product-beta-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000108",
    "version_id": "30000000-0000-4000-8000-000000000108",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "ux-pattern-library-rollout",
    "title": "UX Pattern Library Rollout",
    "summary": "Plan and deliver UX Pattern Library Rollout through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "ux-ui-design",
      "rollout",
      "ux-pattern-library-rollout"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000109",
    "version_id": "30000000-0000-4000-8000-000000000109",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-copilot-rollout",
    "title": "AI Copilot Rollout",
    "summary": "Plan and deliver AI Copilot Rollout through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "ai-machine-learning",
      "rollout",
      "ai-copilot-rollout"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000110",
    "version_id": "30000000-0000-4000-8000-000000000110",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "self-service-analytics-launch",
    "title": "Self-Service Analytics Launch",
    "summary": "Plan and deliver Self-Service Analytics Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "data-engineering",
      "rollout",
      "self-service-analytics-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000111",
    "version_id": "30000000-0000-4000-8000-000000000111",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "developer-portal-launch",
    "title": "Developer Portal Launch",
    "summary": "Plan and deliver Developer Portal Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "devops",
      "rollout",
      "developer-portal-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000112",
    "version_id": "30000000-0000-4000-8000-000000000112",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-platform-adoption",
    "title": "Cloud Platform Adoption",
    "summary": "Plan and deliver Cloud Platform Adoption through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "cloud-infrastructure",
      "rollout",
      "cloud-platform-adoption"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000113",
    "version_id": "30000000-0000-4000-8000-000000000113",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "zero-trust-rollout",
    "title": "Zero Trust Rollout",
    "summary": "Plan and deliver Zero Trust Rollout through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "cybersecurity",
      "rollout",
      "zero-trust-rollout"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000114",
    "version_id": "30000000-0000-4000-8000-000000000114",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "subscription-commerce-launch",
    "title": "Subscription Commerce Launch",
    "summary": "Plan and deliver Subscription Commerce Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "e-commerce",
      "rollout",
      "subscription-commerce-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000115",
    "version_id": "30000000-0000-4000-8000-000000000115",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "online-course-launch",
    "title": "Online Course Launch",
    "summary": "Plan and deliver Online Course Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "education",
      "rollout",
      "online-course-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000116",
    "version_id": "30000000-0000-4000-8000-000000000116",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "remote-care-service-rollout",
    "title": "Remote Care Service Rollout",
    "summary": "Plan and deliver Remote Care Service Rollout through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "healthcare",
      "rollout",
      "remote-care-service-rollout"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000117",
    "version_id": "30000000-0000-4000-8000-000000000117",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "digital-payments-rollout",
    "title": "Digital Payments Rollout",
    "summary": "Plan and deliver Digital Payments Rollout through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "finance",
      "rollout",
      "digital-payments-rollout"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000118",
    "version_id": "30000000-0000-4000-8000-000000000118",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "hybrid-work-program-launch",
    "title": "Hybrid Work Program Launch",
    "summary": "Plan and deliver Hybrid Work Program Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "human-resources",
      "rollout",
      "hybrid-work-program-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000119",
    "version_id": "30000000-0000-4000-8000-000000000119",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "partner-sales-program-launch",
    "title": "Partner Sales Program Launch",
    "summary": "Plan and deliver Partner Sales Program Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "sales",
      "rollout",
      "partner-sales-program-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000120",
    "version_id": "30000000-0000-4000-8000-000000000120",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "shared-services-launch",
    "title": "Shared Services Launch",
    "summary": "Plan and deliver Shared Services Launch through a curated launch and adoption program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Readiness and audience alignment",
      "Launch design and enablement",
      "Controlled rollout",
      "Adoption and learning"
    ],
    "tags": [
      "operations",
      "rollout",
      "shared-services-launch"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T15:00:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_06()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_06();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 120 THEN
    RAISE EXCEPTION 'Batch 06 expected 120 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 6
  ) THEN
    RAISE EXCEPTION 'Batch 06 expected 6 built-ins per category';
  END IF;
END;
$$;
