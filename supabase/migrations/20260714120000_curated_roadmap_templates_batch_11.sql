-- Curated roadmap template batch 11: reliability and continuity.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_11()
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
    "template_id": "10000000-0000-4000-8000-000000000201",
    "version_id": "30000000-0000-4000-8000-000000000201",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-reliability-engineering",
    "title": "SaaS Reliability Engineering",
    "summary": "Plan and deliver SaaS Reliability Engineering through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "saas",
      "resilience",
      "saas-reliability-engineering"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000202",
    "version_id": "30000000-0000-4000-8000-000000000202",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-crash-reduction-program",
    "title": "Mobile Crash Reduction Program",
    "summary": "Plan and deliver Mobile Crash Reduction Program through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "mobile-app-development",
      "resilience",
      "mobile-crash-reduction-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000203",
    "version_id": "30000000-0000-4000-8000-000000000203",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-availability-improvement",
    "title": "Web Availability Improvement",
    "summary": "Plan and deliver Web Availability Improvement through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "web-development",
      "resilience",
      "web-availability-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000204",
    "version_id": "30000000-0000-4000-8000-000000000204",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-campaign-continuity",
    "title": "Marketing Campaign Continuity",
    "summary": "Plan and deliver Marketing Campaign Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "marketing",
      "resilience",
      "marketing-campaign-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000205",
    "version_id": "30000000-0000-4000-8000-000000000205",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-data-preservation",
    "title": "Research Data Preservation",
    "summary": "Plan and deliver Research Data Preservation through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "research",
      "resilience",
      "research-data-preservation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000206",
    "version_id": "30000000-0000-4000-8000-000000000206",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-business-continuity",
    "title": "Startup Business Continuity",
    "summary": "Plan and deliver Startup Business Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "startup-launch",
      "resilience",
      "startup-business-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000207",
    "version_id": "30000000-0000-4000-8000-000000000207",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-incident-management",
    "title": "Product Incident Management",
    "summary": "Plan and deliver Product Incident Management through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "product-management",
      "resilience",
      "product-incident-management"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000208",
    "version_id": "30000000-0000-4000-8000-000000000208",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-system-maintenance",
    "title": "Design System Maintenance",
    "summary": "Plan and deliver Design System Maintenance through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "ux-ui-design",
      "resilience",
      "design-system-maintenance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000209",
    "version_id": "30000000-0000-4000-8000-000000000209",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-service-reliability",
    "title": "AI Service Reliability",
    "summary": "Plan and deliver AI Service Reliability through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "ai-machine-learning",
      "resilience",
      "ai-service-reliability"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000210",
    "version_id": "30000000-0000-4000-8000-000000000210",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-platform-recovery",
    "title": "Data Platform Recovery",
    "summary": "Plan and deliver Data Platform Recovery through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "data-engineering",
      "resilience",
      "data-platform-recovery"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000211",
    "version_id": "30000000-0000-4000-8000-000000000211",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "production-reliability-program",
    "title": "Production Reliability Program",
    "summary": "Plan and deliver Production Reliability Program through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "devops",
      "resilience",
      "production-reliability-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000212",
    "version_id": "30000000-0000-4000-8000-000000000212",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "multi-region-cloud-resilience",
    "title": "Multi-Region Cloud Resilience",
    "summary": "Plan and deliver Multi-Region Cloud Resilience through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "cloud-infrastructure",
      "resilience",
      "multi-region-cloud-resilience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000213",
    "version_id": "30000000-0000-4000-8000-000000000213",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "ransomware-recovery-readiness",
    "title": "Ransomware Recovery Readiness",
    "summary": "Plan and deliver Ransomware Recovery Readiness through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "cybersecurity",
      "resilience",
      "ransomware-recovery-readiness"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000214",
    "version_id": "30000000-0000-4000-8000-000000000214",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-peak-season-readiness",
    "title": "E-commerce Peak Season Readiness",
    "summary": "Plan and deliver E-commerce Peak Season Readiness through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "e-commerce",
      "resilience",
      "e-commerce-peak-season-readiness"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000215",
    "version_id": "30000000-0000-4000-8000-000000000215",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "learning-platform-continuity",
    "title": "Learning Platform Continuity",
    "summary": "Plan and deliver Learning Platform Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "education",
      "resilience",
      "learning-platform-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000216",
    "version_id": "30000000-0000-4000-8000-000000000216",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "clinical-service-continuity",
    "title": "Clinical Service Continuity",
    "summary": "Plan and deliver Clinical Service Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "healthcare",
      "resilience",
      "clinical-service-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000217",
    "version_id": "30000000-0000-4000-8000-000000000217",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "financial-operations-continuity",
    "title": "Financial Operations Continuity",
    "summary": "Plan and deliver Financial Operations Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "finance",
      "resilience",
      "financial-operations-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000218",
    "version_id": "30000000-0000-4000-8000-000000000218",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "workforce-continuity-planning",
    "title": "Workforce Continuity Planning",
    "summary": "Plan and deliver Workforce Continuity Planning through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "human-resources",
      "resilience",
      "workforce-continuity-planning"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000219",
    "version_id": "30000000-0000-4000-8000-000000000219",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "revenue-operations-continuity",
    "title": "Revenue Operations Continuity",
    "summary": "Plan and deliver Revenue Operations Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "sales",
      "resilience",
      "revenue-operations-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000220",
    "version_id": "30000000-0000-4000-8000-000000000220",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "critical-operations-continuity",
    "title": "Critical Operations Continuity",
    "summary": "Plan and deliver Critical Operations Continuity through a curated reliability and continuity program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and service baseline",
      "Resilience design",
      "Operational implementation",
      "Exercises and improvement"
    ],
    "tags": [
      "operations",
      "resilience",
      "critical-operations-continuity"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T17:10:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_11()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_11();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 220 THEN
    RAISE EXCEPTION 'Batch 11 expected 220 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 11
  ) THEN
    RAISE EXCEPTION 'Batch 11 expected 11 built-ins per category';
  END IF;
END;
$$;
