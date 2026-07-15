-- Curated roadmap template batch 08: workflow automation.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_08()
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
    "template_id": "10000000-0000-4000-8000-000000000141",
    "version_id": "30000000-0000-4000-8000-000000000141",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-support-automation",
    "title": "SaaS Support Automation",
    "summary": "Plan and deliver SaaS Support Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "saas",
      "automation",
      "saas-support-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000142",
    "version_id": "30000000-0000-4000-8000-000000000142",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-release-automation",
    "title": "Mobile Release Automation",
    "summary": "Plan and deliver Mobile Release Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "mobile-app-development",
      "automation",
      "mobile-release-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000143",
    "version_id": "30000000-0000-4000-8000-000000000143",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-testing-automation",
    "title": "Web Testing Automation",
    "summary": "Plan and deliver Web Testing Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "web-development",
      "automation",
      "web-testing-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000144",
    "version_id": "30000000-0000-4000-8000-000000000144",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "marketing-operations-automation",
    "title": "Marketing Operations Automation",
    "summary": "Plan and deliver Marketing Operations Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "marketing",
      "automation",
      "marketing-operations-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000145",
    "version_id": "30000000-0000-4000-8000-000000000145",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-analysis-automation",
    "title": "Research Analysis Automation",
    "summary": "Plan and deliver Research Analysis Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "research",
      "automation",
      "research-analysis-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000146",
    "version_id": "30000000-0000-4000-8000-000000000146",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-finance-automation",
    "title": "Startup Finance Automation",
    "summary": "Plan and deliver Startup Finance Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "startup-launch",
      "automation",
      "startup-finance-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000147",
    "version_id": "30000000-0000-4000-8000-000000000147",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-feedback-triage-automation",
    "title": "Product Feedback Triage Automation",
    "summary": "Plan and deliver Product Feedback Triage Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "product-management",
      "automation",
      "product-feedback-triage-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000148",
    "version_id": "30000000-0000-4000-8000-000000000148",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-token-automation",
    "title": "Design Token Automation",
    "summary": "Plan and deliver Design Token Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "ux-ui-design",
      "automation",
      "design-token-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000149",
    "version_id": "30000000-0000-4000-8000-000000000149",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-agent-workflow-automation",
    "title": "AI Agent Workflow Automation",
    "summary": "Plan and deliver AI Agent Workflow Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "ai-machine-learning",
      "automation",
      "ai-agent-workflow-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000150",
    "version_id": "30000000-0000-4000-8000-000000000150",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "data-quality-automation",
    "title": "Data Quality Automation",
    "summary": "Plan and deliver Data Quality Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "data-engineering",
      "automation",
      "data-quality-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000151",
    "version_id": "30000000-0000-4000-8000-000000000151",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "infrastructure-as-code-program",
    "title": "Infrastructure as Code Program",
    "summary": "Plan and deliver Infrastructure as Code Program through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "devops",
      "automation",
      "infrastructure-as-code-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000152",
    "version_id": "30000000-0000-4000-8000-000000000152",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-provisioning-automation",
    "title": "Cloud Provisioning Automation",
    "summary": "Plan and deliver Cloud Provisioning Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "cloud-infrastructure",
      "automation",
      "cloud-provisioning-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000153",
    "version_id": "30000000-0000-4000-8000-000000000153",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "security-operations-automation",
    "title": "Security Operations Automation",
    "summary": "Plan and deliver Security Operations Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "cybersecurity",
      "automation",
      "security-operations-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000154",
    "version_id": "30000000-0000-4000-8000-000000000154",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-fulfillment-automation",
    "title": "E-commerce Fulfillment Automation",
    "summary": "Plan and deliver E-commerce Fulfillment Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "e-commerce",
      "automation",
      "e-commerce-fulfillment-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000155",
    "version_id": "30000000-0000-4000-8000-000000000155",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "education-administration-automation",
    "title": "Education Administration Automation",
    "summary": "Plan and deliver Education Administration Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "education",
      "automation",
      "education-administration-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000156",
    "version_id": "30000000-0000-4000-8000-000000000156",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "healthcare-referral-automation",
    "title": "Healthcare Referral Automation",
    "summary": "Plan and deliver Healthcare Referral Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "healthcare",
      "automation",
      "healthcare-referral-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000157",
    "version_id": "30000000-0000-4000-8000-000000000157",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "accounts-payable-automation",
    "title": "Accounts Payable Automation",
    "summary": "Plan and deliver Accounts Payable Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "finance",
      "automation",
      "accounts-payable-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000158",
    "version_id": "30000000-0000-4000-8000-000000000158",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "hr-service-delivery-automation",
    "title": "HR Service Delivery Automation",
    "summary": "Plan and deliver HR Service Delivery Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "human-resources",
      "automation",
      "hr-service-delivery-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000159",
    "version_id": "30000000-0000-4000-8000-000000000159",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-prospecting-automation",
    "title": "Sales Prospecting Automation",
    "summary": "Plan and deliver Sales Prospecting Automation through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "sales",
      "automation",
      "sales-prospecting-automation"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000160",
    "version_id": "30000000-0000-4000-8000-000000000160",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "workflow-orchestration-program",
    "title": "Workflow Orchestration Program",
    "summary": "Plan and deliver Workflow Orchestration Program through a curated workflow automation program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Workflow and value baseline",
      "Automation and control design",
      "Implementation and validation",
      "Adoption and improvement"
    ],
    "tags": [
      "operations",
      "automation",
      "workflow-orchestration-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T16:00:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_08()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_08();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 160 THEN
    RAISE EXCEPTION 'Batch 08 expected 160 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 8
  ) THEN
    RAISE EXCEPTION 'Batch 08 expected 8 built-ins per category';
  END IF;
END;
$$;
