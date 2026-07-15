-- Curated roadmap template batch 09: customer and user experience.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_09()
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
    "template_id": "10000000-0000-4000-8000-000000000161",
    "version_id": "30000000-0000-4000-8000-000000000161",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-customer-feedback-program",
    "title": "SaaS Customer Feedback Program",
    "summary": "Plan and deliver SaaS Customer Feedback Program through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "saas",
      "experience",
      "saas-customer-feedback-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000162",
    "version_id": "30000000-0000-4000-8000-000000000162",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-app-re-engagement",
    "title": "Mobile App Re-Engagement",
    "summary": "Plan and deliver Mobile App Re-Engagement through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "mobile-app-development",
      "experience",
      "mobile-app-re-engagement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000163",
    "version_id": "30000000-0000-4000-8000-000000000163",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-self-service-experience",
    "title": "Web Self-Service Experience",
    "summary": "Plan and deliver Web Self-Service Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "web-development",
      "experience",
      "web-self-service-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000164",
    "version_id": "30000000-0000-4000-8000-000000000164",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "lifecycle-marketing-program",
    "title": "Lifecycle Marketing Program",
    "summary": "Plan and deliver Lifecycle Marketing Program through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "marketing",
      "experience",
      "lifecycle-marketing-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000165",
    "version_id": "30000000-0000-4000-8000-000000000165",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "community-research-program",
    "title": "Community Research Program",
    "summary": "Plan and deliver Community Research Program through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "research",
      "experience",
      "community-research-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000166",
    "version_id": "30000000-0000-4000-8000-000000000166",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "founder-led-customer-development",
    "title": "Founder-Led Customer Development",
    "summary": "Plan and deliver Founder-Led Customer Development through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "startup-launch",
      "experience",
      "founder-led-customer-development"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000167",
    "version_id": "30000000-0000-4000-8000-000000000167",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "voice-of-customer-product-program",
    "title": "Voice of Customer Product Program",
    "summary": "Plan and deliver Voice of Customer Product Program through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "product-management",
      "experience",
      "voice-of-customer-product-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000168",
    "version_id": "30000000-0000-4000-8000-000000000168",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "inclusive-service-design",
    "title": "Inclusive Service Design",
    "summary": "Plan and deliver Inclusive Service Design through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "ux-ui-design",
      "experience",
      "inclusive-service-design"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000169",
    "version_id": "30000000-0000-4000-8000-000000000169",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "conversational-ai-experience",
    "title": "Conversational AI Experience",
    "summary": "Plan and deliver Conversational AI Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "ai-machine-learning",
      "experience",
      "conversational-ai-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000170",
    "version_id": "30000000-0000-4000-8000-000000000170",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-consumer-experience",
    "title": "Data Consumer Experience",
    "summary": "Plan and deliver Data Consumer Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "data-engineering",
      "experience",
      "data-consumer-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000171",
    "version_id": "30000000-0000-4000-8000-000000000171",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "developer-experience-improvement",
    "title": "Developer Experience Improvement",
    "summary": "Plan and deliver Developer Experience Improvement through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "devops",
      "experience",
      "developer-experience-improvement"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000172",
    "version_id": "30000000-0000-4000-8000-000000000172",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-service-experience",
    "title": "Cloud Service Experience",
    "summary": "Plan and deliver Cloud Service Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "cloud-infrastructure",
      "experience",
      "cloud-service-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000173",
    "version_id": "30000000-0000-4000-8000-000000000173",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "secure-customer-authentication",
    "title": "Secure Customer Authentication",
    "summary": "Plan and deliver Secure Customer Authentication through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "cybersecurity",
      "experience",
      "secure-customer-authentication"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000174",
    "version_id": "30000000-0000-4000-8000-000000000174",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "omnichannel-commerce-experience",
    "title": "Omnichannel Commerce Experience",
    "summary": "Plan and deliver Omnichannel Commerce Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "e-commerce",
      "experience",
      "omnichannel-commerce-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000175",
    "version_id": "30000000-0000-4000-8000-000000000175",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "student-support-experience",
    "title": "Student Support Experience",
    "summary": "Plan and deliver Student Support Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "education",
      "experience",
      "student-support-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000176",
    "version_id": "30000000-0000-4000-8000-000000000176",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "patient-portal-experience",
    "title": "Patient Portal Experience",
    "summary": "Plan and deliver Patient Portal Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "healthcare",
      "experience",
      "patient-portal-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000177",
    "version_id": "30000000-0000-4000-8000-000000000177",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "digital-banking-customer-experience",
    "title": "Digital Banking Customer Experience",
    "summary": "Plan and deliver Digital Banking Customer Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "finance",
      "experience",
      "digital-banking-customer-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000178",
    "version_id": "30000000-0000-4000-8000-000000000178",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "employee-experience-redesign",
    "title": "Employee Experience Redesign",
    "summary": "Plan and deliver Employee Experience Redesign through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "human-resources",
      "experience",
      "employee-experience-redesign"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000179",
    "version_id": "30000000-0000-4000-8000-000000000179",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "customer-success-sales-handoff",
    "title": "Customer Success Sales Handoff",
    "summary": "Plan and deliver Customer Success Sales Handoff through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "sales",
      "experience",
      "customer-success-sales-handoff"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000180",
    "version_id": "30000000-0000-4000-8000-000000000180",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "service-operations-experience",
    "title": "Service Operations Experience",
    "summary": "Plan and deliver Service Operations Experience through a curated customer and user experience program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Journey and needs evidence",
      "Experience and service design",
      "Implementation and rollout",
      "Feedback and optimization"
    ],
    "tags": [
      "operations",
      "experience",
      "service-operations-experience"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:10:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_09()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_09();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 180 THEN
    RAISE EXCEPTION 'Batch 09 expected 180 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 9
  ) THEN
    RAISE EXCEPTION 'Batch 09 expected 9 built-ins per category';
  END IF;
END;
$$;
