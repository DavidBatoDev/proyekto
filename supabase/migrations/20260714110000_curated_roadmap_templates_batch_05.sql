-- Curated roadmap template batch 05: governance and risk management.
-- Exactly one template is added for each of the 20 marketplace categories.

CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_05()
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
    "template_id": "10000000-0000-4000-8000-000000000081",
    "version_id": "30000000-0000-4000-8000-000000000081",
    "category_id": "20000000-0000-4000-8000-000000000001",
    "slug": "saas-vendor-risk-management",
    "title": "SaaS Vendor Risk Management",
    "summary": "Plan and deliver SaaS Vendor Risk Management through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "saas",
      "governance",
      "saas-vendor-risk-management"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000082",
    "version_id": "30000000-0000-4000-8000-000000000082",
    "category_id": "20000000-0000-4000-8000-000000000002",
    "slug": "mobile-privacy-and-permissions-governance",
    "title": "Mobile Privacy and Permissions Governance",
    "summary": "Plan and deliver Mobile Privacy and Permissions Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "mobile-app-development",
      "governance",
      "mobile-privacy-and-permissions-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000083",
    "version_id": "30000000-0000-4000-8000-000000000083",
    "category_id": "20000000-0000-4000-8000-000000000003",
    "slug": "web-content-governance",
    "title": "Web Content Governance",
    "summary": "Plan and deliver Web Content Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "web-development",
      "governance",
      "web-content-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000084",
    "version_id": "30000000-0000-4000-8000-000000000084",
    "category_id": "20000000-0000-4000-8000-000000000004",
    "slug": "brand-governance-program",
    "title": "Brand Governance Program",
    "summary": "Plan and deliver Brand Governance Program through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "marketing",
      "governance",
      "brand-governance-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000085",
    "version_id": "30000000-0000-4000-8000-000000000085",
    "category_id": "20000000-0000-4000-8000-000000000005",
    "slug": "research-ethics-and-consent-governance",
    "title": "Research Ethics and Consent Governance",
    "summary": "Plan and deliver Research Ethics and Consent Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "research",
      "governance",
      "research-ethics-and-consent-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000086",
    "version_id": "30000000-0000-4000-8000-000000000086",
    "category_id": "20000000-0000-4000-8000-000000000006",
    "slug": "startup-legal-and-risk-readiness",
    "title": "Startup Legal and Risk Readiness",
    "summary": "Plan and deliver Startup Legal and Risk Readiness through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "startup-launch",
      "governance",
      "startup-legal-and-risk-readiness"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000087",
    "version_id": "30000000-0000-4000-8000-000000000087",
    "category_id": "20000000-0000-4000-8000-000000000007",
    "slug": "product-portfolio-governance",
    "title": "Product Portfolio Governance",
    "summary": "Plan and deliver Product Portfolio Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "product-management",
      "governance",
      "product-portfolio-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000088",
    "version_id": "30000000-0000-4000-8000-000000000088",
    "category_id": "20000000-0000-4000-8000-000000000008",
    "slug": "design-quality-governance",
    "title": "Design Quality Governance",
    "summary": "Plan and deliver Design Quality Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "ux-ui-design",
      "governance",
      "design-quality-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000089",
    "version_id": "30000000-0000-4000-8000-000000000089",
    "category_id": "20000000-0000-4000-8000-000000000009",
    "slug": "ai-model-risk-management",
    "title": "AI Model Risk Management",
    "summary": "Plan and deliver AI Model Risk Management through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "ai-machine-learning",
      "governance",
      "ai-model-risk-management"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000090",
    "version_id": "30000000-0000-4000-8000-000000000090",
    "category_id": "20000000-0000-4000-8000-000000000010",
    "slug": "master-data-governance",
    "title": "Master Data Governance",
    "summary": "Plan and deliver Master Data Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "data-engineering",
      "governance",
      "master-data-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000091",
    "version_id": "30000000-0000-4000-8000-000000000091",
    "category_id": "20000000-0000-4000-8000-000000000011",
    "slug": "devops-change-governance",
    "title": "DevOps Change Governance",
    "summary": "Plan and deliver DevOps Change Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "devops",
      "governance",
      "devops-change-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000092",
    "version_id": "30000000-0000-4000-8000-000000000092",
    "category_id": "20000000-0000-4000-8000-000000000012",
    "slug": "cloud-security-governance",
    "title": "Cloud Security Governance",
    "summary": "Plan and deliver Cloud Security Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "cloud-infrastructure",
      "governance",
      "cloud-security-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000093",
    "version_id": "30000000-0000-4000-8000-000000000093",
    "category_id": "20000000-0000-4000-8000-000000000013",
    "slug": "third-party-security-risk",
    "title": "Third-Party Security Risk",
    "summary": "Plan and deliver Third-Party Security Risk through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "cybersecurity",
      "governance",
      "third-party-security-risk"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000094",
    "version_id": "30000000-0000-4000-8000-000000000094",
    "category_id": "20000000-0000-4000-8000-000000000014",
    "slug": "e-commerce-fraud-prevention",
    "title": "E-commerce Fraud Prevention",
    "summary": "Plan and deliver E-commerce Fraud Prevention through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "e-commerce",
      "governance",
      "e-commerce-fraud-prevention"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000095",
    "version_id": "30000000-0000-4000-8000-000000000095",
    "category_id": "20000000-0000-4000-8000-000000000015",
    "slug": "academic-integrity-program",
    "title": "Academic Integrity Program",
    "summary": "Plan and deliver Academic Integrity Program through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "education",
      "governance",
      "academic-integrity-program"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000096",
    "version_id": "30000000-0000-4000-8000-000000000096",
    "category_id": "20000000-0000-4000-8000-000000000016",
    "slug": "clinical-risk-management",
    "title": "Clinical Risk Management",
    "summary": "Plan and deliver Clinical Risk Management through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "healthcare",
      "governance",
      "clinical-risk-management"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000097",
    "version_id": "30000000-0000-4000-8000-000000000097",
    "category_id": "20000000-0000-4000-8000-000000000017",
    "slug": "financial-controls-framework",
    "title": "Financial Controls Framework",
    "summary": "Plan and deliver Financial Controls Framework through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "advanced",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "finance",
      "governance",
      "financial-controls-framework"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000098",
    "version_id": "30000000-0000-4000-8000-000000000098",
    "category_id": "20000000-0000-4000-8000-000000000018",
    "slug": "compensation-governance",
    "title": "Compensation Governance",
    "summary": "Plan and deliver Compensation Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "human-resources",
      "governance",
      "compensation-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000099",
    "version_id": "30000000-0000-4000-8000-000000000099",
    "category_id": "20000000-0000-4000-8000-000000000019",
    "slug": "sales-deal-desk-governance",
    "title": "Sales Deal Desk Governance",
    "summary": "Plan and deliver Sales Deal Desk Governance through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "sales",
      "governance",
      "sales-deal-desk-governance"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  },
  {
    "template_id": "10000000-0000-4000-8000-000000000100",
    "version_id": "30000000-0000-4000-8000-000000000100",
    "category_id": "20000000-0000-4000-8000-000000000020",
    "slug": "operational-risk-management",
    "title": "Operational Risk Management",
    "summary": "Plan and deliver Operational Risk Management through a curated governance and risk management program with clear evidence, accountable implementation, validation, and measurable operational handover.",
    "difficulty": "intermediate",
    "schedule_kind": "long_term",
    "duration_days": 120,
    "phases": [
      "Risk and scope baseline",
      "Policy and accountability",
      "Control implementation",
      "Assurance and improvement"
    ],
    "tags": [
      "operations",
      "governance",
      "operational-risk-management"
    ],
    "is_featured": false,
    "published_at": "2026-07-14T14:10:00Z"
  }
]
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_05()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_05();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 100 THEN
    RAISE EXCEPTION 'Batch 05 expected 100 built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 5
  ) THEN
    RAISE EXCEPTION 'Batch 05 expected 5 built-ins per category';
  END IF;
END;
$$;
