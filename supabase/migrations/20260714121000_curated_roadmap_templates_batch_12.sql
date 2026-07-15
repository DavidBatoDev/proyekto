-- Curated roadmap template batch 12: growth and expansion.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_12()
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
    "template_id": "10000000-0000-4000-8000-000000000221",
    "version_id": "30000000-0000-4000-8000-000000000221",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-product-led-growth",
    "title": "SaaS Product-Led Growth",
    "summary": "Plan and deliver SaaS Product-Led Growth through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "saas",
      "growth",
      "saas-product-led-growth"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000222",
    "version_id": "30000000-0000-4000-8000-000000000222",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-app-referral-growth",
    "title": "Mobile App Referral Growth",
    "summary": "Plan and deliver Mobile App Referral Growth through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "mobile-app-development",
      "growth",
      "mobile-app-referral-growth"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000223",
    "version_id": "30000000-0000-4000-8000-000000000223",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-platform-monetization",
    "title": "Web Platform Monetization",
    "summary": "Plan and deliver Web Platform Monetization through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "web-development",
      "growth",
      "web-platform-monetization"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000224",
    "version_id": "30000000-0000-4000-8000-000000000224",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "partner-marketing-growth",
    "title": "Partner Marketing Growth",
    "summary": "Plan and deliver Partner Marketing Growth through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "marketing",
      "growth",
      "partner-marketing-growth"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000225",
    "version_id": "30000000-0000-4000-8000-000000000225",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-program-expansion",
    "title": "Research Program Expansion",
    "summary": "Plan and deliver Research Program Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "research",
      "growth",
      "research-program-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000226",
    "version_id": "30000000-0000-4000-8000-000000000226",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-channel-expansion",
    "title": "Startup Channel Expansion",
    "summary": "Plan and deliver Startup Channel Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "startup-launch",
      "growth",
      "startup-channel-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000227",
    "version_id": "30000000-0000-4000-8000-000000000227",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-line-expansion",
    "title": "Product Line Expansion",
    "summary": "Plan and deliver Product Line Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "product-management",
      "growth",
      "product-line-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000228",
    "version_id": "30000000-0000-4000-8000-000000000228",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-team-scaling",
    "title": "Design Team Scaling",
    "summary": "Plan and deliver Design Team Scaling through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "ux-ui-design",
      "growth",
      "design-team-scaling"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000229",
    "version_id": "30000000-0000-4000-8000-000000000229",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-capability-expansion",
    "title": "AI Capability Expansion",
    "summary": "Plan and deliver AI Capability Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "ai-machine-learning",
      "growth",
      "ai-capability-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000230",
    "version_id": "30000000-0000-4000-8000-000000000230",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-product-scaling",
    "title": "Data Product Scaling",
    "summary": "Plan and deliver Data Product Scaling through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "data-engineering",
      "growth",
      "data-product-scaling"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000231",
    "version_id": "30000000-0000-4000-8000-000000000231",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "devops-at-scale",
    "title": "DevOps at Scale",
    "summary": "Plan and deliver DevOps at Scale through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "devops",
      "growth",
      "devops-at-scale"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000232",
    "version_id": "30000000-0000-4000-8000-000000000232",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-platform-scaling",
    "title": "Cloud Platform Scaling",
    "summary": "Plan and deliver Cloud Platform Scaling through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "cloud-infrastructure",
      "growth",
      "cloud-platform-scaling"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000233",
    "version_id": "30000000-0000-4000-8000-000000000233",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "security-program-scaling",
    "title": "Security Program Scaling",
    "summary": "Plan and deliver Security Program Scaling through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "cybersecurity",
      "growth",
      "security-program-scaling"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000234",
    "version_id": "30000000-0000-4000-8000-000000000234",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-marketplace-expansion",
    "title": "E-commerce Marketplace Expansion",
    "summary": "Plan and deliver E-commerce Marketplace Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "e-commerce",
      "growth",
      "e-commerce-marketplace-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000235",
    "version_id": "30000000-0000-4000-8000-000000000235",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "education-program-scaling",
    "title": "Education Program Scaling",
    "summary": "Plan and deliver Education Program Scaling through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "education",
      "growth",
      "education-program-scaling"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000236",
    "version_id": "30000000-0000-4000-8000-000000000236",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "digital-health-service-expansion",
    "title": "Digital Health Service Expansion",
    "summary": "Plan and deliver Digital Health Service Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "healthcare",
      "growth",
      "digital-health-service-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000237",
    "version_id": "30000000-0000-4000-8000-000000000237",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "finance-shared-services-expansion",
    "title": "Finance Shared Services Expansion",
    "summary": "Plan and deliver Finance Shared Services Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "finance",
      "growth",
      "finance-shared-services-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000238",
    "version_id": "30000000-0000-4000-8000-000000000238",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "global-workforce-expansion",
    "title": "Global Workforce Expansion",
    "summary": "Plan and deliver Global Workforce Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "human-resources",
      "growth",
      "global-workforce-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000239",
    "version_id": "30000000-0000-4000-8000-000000000239",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "channel-sales-expansion",
    "title": "Channel Sales Expansion",
    "summary": "Plan and deliver Channel Sales Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "sales",
      "growth",
      "channel-sales-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000240",
    "version_id": "30000000-0000-4000-8000-000000000240",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "multi-site-operations-expansion",
    "title": "Multi-Site Operations Expansion",
    "summary": "Plan and deliver Multi-Site Operations Expansion through a curated growth and expansion program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Opportunity and market evidence",
      "Growth strategy and economics",
      "Capability and rollout",
      "Measurement and scaling"
    ],
    "tags": [
      "operations",
      "growth",
      "multi-site-operations-expansion"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T18:00:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_12()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_12();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 240 THEN
    RAISE EXCEPTION 'Batch 12 expected 240 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 12
  ) THEN
    RAISE EXCEPTION 'Batch 12 expected 12 built-ins per category';
  END IF;
END;
$$;
