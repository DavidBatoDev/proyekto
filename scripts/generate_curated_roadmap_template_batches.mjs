import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const categories = [
	["saas", "SaaS"],
	["mobile-app-development", "Mobile App Development"],
	["web-development", "Web Development"],
	["marketing", "Marketing"],
	["research", "Research"],
	["startup-launch", "Startup Launch"],
	["product-management", "Product Management"],
	["ux-ui-design", "UX/UI Design"],
	["ai-machine-learning", "AI & Machine Learning"],
	["data-engineering", "Data Engineering"],
	["devops", "DevOps"],
	["cloud-infrastructure", "Cloud Infrastructure"],
	["cybersecurity", "Cybersecurity"],
	["e-commerce", "E-commerce"],
	["education", "Education"],
	["healthcare", "Healthcare"],
	["finance", "Finance"],
	["human-resources", "Human Resources"],
	["sales", "Sales"],
	["operations", "Operations"],
];

const migrations = [
	"20260714105000",
	"20260714110000",
	"20260714111000",
	"20260714112000",
	"20260714113000",
	"20260714114000",
	"20260714115000",
	"20260714120000",
	"20260714121000",
	"20260714122000",
	"20260714123000",
	"20260714124000",
];

const batches = [
	{
		number: 4,
		slug: "optimization",
		label: "optimization and efficiency",
		phases: [
			"Baseline and opportunity",
			"Target-state design",
			"Focused implementation",
			"Measurement and optimization",
		],
		titles: [
			"SaaS Onboarding Conversion Optimization",
			"Mobile App Activation Improvement",
			"Web Conversion Optimization",
			"Marketing Funnel Optimization",
			"Research Recruitment Operations",
			"Startup Runway Extension",
			"Product Backlog Flow Improvement",
			"Design Workflow Optimization",
			"ML Inference Efficiency",
			"Data Pipeline Performance",
			"Deployment Lead Time Reduction",
			"Cloud Resource Efficiency",
			"Vulnerability Remediation Program",
			"Marketplace Merchandising Optimization",
			"Learning Experience Improvement",
			"Patient Scheduling Improvement",
			"Working Capital Optimization",
			"Employee Engagement Improvement",
			"Sales Pipeline Conversion",
			"Inventory Management Optimization",
		],
	},
	{
		number: 5,
		slug: "governance",
		label: "governance and risk management",
		phases: [
			"Risk and scope baseline",
			"Policy and accountability",
			"Control implementation",
			"Assurance and improvement",
		],
		titles: [
			"SaaS Vendor Risk Management",
			"Mobile Privacy and Permissions Governance",
			"Web Content Governance",
			"Brand Governance Program",
			"Research Ethics and Consent Governance",
			"Startup Legal and Risk Readiness",
			"Product Portfolio Governance",
			"Design Quality Governance",
			"AI Model Risk Management",
			"Master Data Governance",
			"DevOps Change Governance",
			"Cloud Security Governance",
			"Third-Party Security Risk",
			"E-commerce Fraud Prevention",
			"Academic Integrity Program",
			"Clinical Risk Management",
			"Financial Controls Framework",
			"Compensation Governance",
			"Sales Deal Desk Governance",
			"Operational Risk Management",
		],
	},
	{
		number: 6,
		slug: "rollout",
		label: "launch and adoption",
		phases: [
			"Readiness and audience alignment",
			"Launch design and enablement",
			"Controlled rollout",
			"Adoption and learning",
		],
		titles: [
			"SaaS Enterprise Feature Rollout",
			"Mobile Feature Launch Playbook",
			"Web Platform Relaunch",
			"Community-Led Product Launch",
			"Research Findings Adoption",
			"Startup Market Entry",
			"Product Beta Program",
			"UX Pattern Library Rollout",
			"AI Copilot Rollout",
			"Self-Service Analytics Launch",
			"Developer Portal Launch",
			"Cloud Platform Adoption",
			"Zero Trust Rollout",
			"Subscription Commerce Launch",
			"Online Course Launch",
			"Remote Care Service Rollout",
			"Digital Payments Rollout",
			"Hybrid Work Program Launch",
			"Partner Sales Program Launch",
			"Shared Services Launch",
		],
	},
	{
		number: 7,
		slug: "measurement",
		label: "analytics and measurement",
		phases: [
			"Decision and metric design",
			"Data and instrumentation",
			"Reporting and insight delivery",
			"Adoption and optimization",
		],
		titles: [
			"SaaS Revenue Analytics",
			"Mobile Product Analytics",
			"Web Experience Analytics",
			"Marketing Attribution Measurement",
			"Research Impact Measurement",
			"Startup KPI Operating System",
			"Product Experimentation Program",
			"Design Experience Measurement",
			"AI Evaluation Benchmarking",
			"Data Observability Program",
			"Engineering Productivity Measurement",
			"Cloud Reliability Metrics",
			"Security Metrics and Reporting",
			"E-commerce Customer Analytics",
			"Learning Analytics Program",
			"Clinical Outcomes Measurement",
			"Management Reporting Modernization",
			"People Analytics Foundation",
			"Sales Forecast Accuracy",
			"Operations Performance Dashboard",
		],
	},
	{
		number: 8,
		slug: "automation",
		label: "workflow automation",
		phases: [
			"Workflow and value baseline",
			"Automation and control design",
			"Implementation and validation",
			"Adoption and improvement",
		],
		titles: [
			"SaaS Support Automation",
			"Mobile Release Automation",
			"Web Testing Automation",
			"Marketing Operations Automation",
			"Research Analysis Automation",
			"Startup Finance Automation",
			"Product Feedback Triage Automation",
			"Design Token Automation",
			"AI Agent Workflow Automation",
			"Data Quality Automation",
			"Infrastructure as Code Program",
			"Cloud Provisioning Automation",
			"Security Operations Automation",
			"E-commerce Fulfillment Automation",
			"Education Administration Automation",
			"Healthcare Referral Automation",
			"Accounts Payable Automation",
			"HR Service Delivery Automation",
			"Sales Prospecting Automation",
			"Workflow Orchestration Program",
		],
	},
	{
		number: 9,
		slug: "experience",
		label: "customer and user experience",
		phases: [
			"Journey and needs evidence",
			"Experience and service design",
			"Implementation and rollout",
			"Feedback and optimization",
		],
		titles: [
			"SaaS Customer Feedback Program",
			"Mobile App Re-Engagement",
			"Web Self-Service Experience",
			"Lifecycle Marketing Program",
			"Community Research Program",
			"Founder-Led Customer Development",
			"Voice of Customer Product Program",
			"Inclusive Service Design",
			"Conversational AI Experience",
			"Data Consumer Experience",
			"Developer Experience Improvement",
			"Cloud Service Experience",
			"Secure Customer Authentication",
			"Omnichannel Commerce Experience",
			"Student Support Experience",
			"Patient Portal Experience",
			"Digital Banking Customer Experience",
			"Employee Experience Redesign",
			"Customer Success Sales Handoff",
			"Service Operations Experience",
		],
	},
	{
		number: 10,
		slug: "integration",
		label: "systems and team integration",
		phases: [
			"Use cases and architecture",
			"Contracts and security",
			"Integration delivery",
			"End-to-end validation",
		],
		titles: [
			"SaaS Integration Marketplace",
			"Mobile Backend Integration Program",
			"Web API Integration Platform",
			"Marketing Technology Integration",
			"Mixed-Methods Research Integration",
			"Startup Partner Ecosystem",
			"Product and Engineering Alignment",
			"Design-to-Development Handoff",
			"AI Knowledge Retrieval Integration",
			"Customer Data Integration",
			"DevSecOps Integration",
			"Hybrid Cloud Integration",
			"Identity and Access Integration",
			"E-commerce ERP Integration",
			"Learning Platform Integration",
			"Health System Integration",
			"Financial Systems Integration",
			"HRIS Integration Program",
			"CRM and Sales Stack Integration",
			"Enterprise Systems Integration",
		],
	},
	{
		number: 11,
		slug: "resilience",
		label: "reliability and continuity",
		phases: [
			"Risk and service baseline",
			"Resilience design",
			"Operational implementation",
			"Exercises and improvement",
		],
		titles: [
			"SaaS Reliability Engineering",
			"Mobile Crash Reduction Program",
			"Web Availability Improvement",
			"Marketing Campaign Continuity",
			"Research Data Preservation",
			"Startup Business Continuity",
			"Product Incident Management",
			"Design System Maintenance",
			"AI Service Reliability",
			"Data Platform Recovery",
			"Production Reliability Program",
			"Multi-Region Cloud Resilience",
			"Ransomware Recovery Readiness",
			"E-commerce Peak Season Readiness",
			"Learning Platform Continuity",
			"Clinical Service Continuity",
			"Financial Operations Continuity",
			"Workforce Continuity Planning",
			"Revenue Operations Continuity",
			"Critical Operations Continuity",
		],
	},
	{
		number: 12,
		slug: "growth",
		label: "growth and expansion",
		phases: [
			"Opportunity and market evidence",
			"Growth strategy and economics",
			"Capability and rollout",
			"Measurement and scaling",
		],
		titles: [
			"SaaS Product-Led Growth",
			"Mobile App Referral Growth",
			"Web Platform Monetization",
			"Partner Marketing Growth",
			"Research Program Expansion",
			"Startup Channel Expansion",
			"Product Line Expansion",
			"Design Team Scaling",
			"AI Capability Expansion",
			"Data Product Scaling",
			"DevOps at Scale",
			"Cloud Platform Scaling",
			"Security Program Scaling",
			"E-commerce Marketplace Expansion",
			"Education Program Scaling",
			"Digital Health Service Expansion",
			"Finance Shared Services Expansion",
			"Global Workforce Expansion",
			"Channel Sales Expansion",
			"Multi-Site Operations Expansion",
		],
	},
	{
		number: 13,
		slug: "capability",
		label: "team capability and operating models",
		phases: [
			"Capability and mandate baseline",
			"Operating model and standards",
			"Enablement and adoption",
			"Performance and evolution",
		],
		titles: [
			"SaaS Product Operations Team",
			"Mobile Engineering Capability",
			"Web Engineering Standards",
			"Marketing Team Operating Model",
			"Research Center of Excellence",
			"Startup Leadership Operating System",
			"Product Operations Function",
			"Design Operations Function",
			"AI Center of Excellence",
			"Data Team Operating Model",
			"Site Reliability Capability",
			"Cloud Center of Excellence",
			"Security Champions Program",
			"E-commerce Operations Team",
			"Faculty Digital Teaching Capability",
			"Clinical Innovation Team",
			"Finance Business Partnering",
			"Manager Development Program",
			"Sales Coaching System",
			"Continuous Improvement Capability",
		],
	},
	{
		number: 14,
		slug: "modernization",
		label: "platform and process modernization",
		phases: [
			"Current-state assessment",
			"Target architecture and roadmap",
			"Incremental modernization",
			"Migration and optimization",
		],
		titles: [
			"SaaS Architecture Modernization",
			"Mobile Codebase Modernization",
			"Legacy Web Application Modernization",
			"Marketing Technology Modernization",
			"Research Repository Modernization",
			"Startup Technology Foundation Modernization",
			"Product Management Tooling Modernization",
			"Design Toolchain Modernization",
			"Machine Learning Platform Modernization",
			"Data Warehouse Modernization",
			"Legacy Deployment Modernization",
			"Cloud Network Modernization",
			"Identity Security Modernization",
			"E-commerce Platform Replatforming",
			"Digital Learning Platform Modernization",
			"Clinical Systems Modernization",
			"Finance Systems Modernization",
			"HR Technology Modernization",
			"Sales Technology Modernization",
			"Operations Technology Modernization",
		],
	},
	{
		number: 15,
		slug: "continuous-improvement",
		label: "sustainable continuous improvement",
		phases: [
			"Baseline and improvement goals",
			"Sustainable practice design",
			"Controlled improvement cycles",
			"Measurement and renewal",
		],
		titles: [
			"SaaS Sustainable Growth Operations",
			"Mobile Product Continuous Improvement",
			"Web Platform Sustainability",
			"Sustainable Marketing Program",
			"Longitudinal Research Program",
			"Startup Post-Launch Operating Rhythm",
			"Product Continuous Discovery",
			"Design Quality Improvement",
			"AI Continuous Evaluation",
			"Data Product Lifecycle Management",
			"DevOps Continuous Improvement",
			"Sustainable Cloud Operations",
			"Continuous Security Improvement",
			"Sustainable Commerce Operations",
			"Curriculum Continuous Improvement",
			"Healthcare Quality Improvement",
			"Finance Process Excellence",
			"Employee Listening and Improvement",
			"Sales Process Excellence",
			"Lean Operations Program",
		],
	},
];

const slugify = (value) =>
	value
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

const uuid = (prefix, value) =>
	`${prefix}-0000-4000-8000-${String(value).padStart(12, "0")}`;

const genericSeeder = `
CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch(p_templates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_definition jsonb;
  v_content jsonb;
  v_checksum text;
  v_phases text[];
  v_tags text[];
  v_tag text;
  v_tag_id uuid;
  v_preview text;
  v_count integer := 0;
BEGIN
  IF jsonb_typeof(p_templates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_templates) <> 20 THEN
    RAISE EXCEPTION 'Curated roadmap template batches must contain exactly 20 definitions';
  END IF;

  SELECT preview_url INTO v_preview
  FROM public.roadmap_public_templates
  WHERE id = '10000000-0000-4000-8000-000000000001';
  IF v_preview IS NULL THEN
    RAISE EXCEPTION 'The initial built-in roadmap library must be seeded first';
  END IF;

  FOR v_definition IN SELECT value FROM jsonb_array_elements(p_templates) LOOP
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_definition -> 'phases')) INTO v_phases;
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_definition -> 'tags')) INTO v_tags;
    v_content := public.build_builtin_roadmap_template_content(
      v_definition ->> 'title', v_definition ->> 'summary',
      (v_definition ->> 'schedule_kind')::public.roadmap_template_schedule_kind,
      v_phases
    );
    v_checksum := encode(extensions.digest(v_content::text, 'sha256'), 'hex');

    INSERT INTO public.roadmap_public_templates (
      id, slug, title, summary, preview_url, owner_id, source_roadmap_id,
      origin, status, category_id, difficulty, schedule_kind,
      estimated_duration_days, attribution_name, attribution_url,
      is_featured, rights_attested_at, published_at
    ) VALUES (
      (v_definition ->> 'template_id')::uuid, v_definition ->> 'slug',
      v_definition ->> 'title', v_definition ->> 'summary', v_preview,
      NULL, NULL, 'builtin', 'published', (v_definition ->> 'category_id')::uuid,
      (v_definition ->> 'difficulty')::public.roadmap_template_difficulty,
      (v_definition ->> 'schedule_kind')::public.roadmap_template_schedule_kind,
      (v_definition ->> 'duration_days')::integer, 'Proyekto', NULL,
      COALESCE((v_definition ->> 'is_featured')::boolean, false),
      (v_definition ->> 'published_at')::timestamptz,
      (v_definition ->> 'published_at')::timestamptz
    ) ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug, title = EXCLUDED.title, summary = EXCLUDED.summary,
      preview_url = EXCLUDED.preview_url, status = 'published',
      category_id = EXCLUDED.category_id, difficulty = EXCLUDED.difficulty,
      schedule_kind = EXCLUDED.schedule_kind,
      estimated_duration_days = EXCLUDED.estimated_duration_days,
      attribution_name = EXCLUDED.attribution_name,
      is_featured = EXCLUDED.is_featured,
      rights_attested_at = EXCLUDED.rights_attested_at,
      published_at = EXCLUDED.published_at,
      unlisted_at = NULL, archived_at = NULL;

    INSERT INTO public.roadmap_template_versions (
      id, template_id, version_number, contract_version, content, checksum,
      created_by, published_at
    ) VALUES (
      (v_definition ->> 'version_id')::uuid,
      (v_definition ->> 'template_id')::uuid,
      1, 1, v_content, v_checksum, NULL,
      (v_definition ->> 'published_at')::timestamptz
    ) ON CONFLICT (id) DO NOTHING;

    UPDATE public.roadmap_public_templates
    SET current_version_id = (v_definition ->> 'version_id')::uuid,
      status = 'published'
    WHERE id = (v_definition ->> 'template_id')::uuid
      AND current_version_id IS DISTINCT FROM (v_definition ->> 'version_id')::uuid;

    FOREACH v_tag IN ARRAY v_tags LOOP
      INSERT INTO public.roadmap_template_tags (slug, name)
      VALUES (v_tag, initcap(replace(v_tag, '-', ' ')))
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_tag_id;
      INSERT INTO public.roadmap_public_template_tags (template_id, tag_id)
      VALUES ((v_definition ->> 'template_id')::uuid, v_tag_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
`;

const finalizer = `
ALTER FUNCTION public.validate_builtin_roadmap_templates()
  RENAME TO validate_builtin_roadmap_templates_legacy_60;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates_legacy_60()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_builtin_roadmap_templates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_result jsonb;
  v_issues jsonb;
BEGIN
  v_base_result := public.validate_builtin_roadmap_templates_legacy_60();
  SELECT COALESCE(jsonb_agg(to_jsonb(issue)), '[]'::jsonb)
  INTO v_issues
  FROM jsonb_array_elements_text(COALESCE(v_base_result -> 'issues', '[]'::jsonb)) AS base_issue(issue)
  WHERE issue NOT IN (
    'Expected exactly 60 built-in templates',
    'Every initial category must have exactly three built-in templates'
  );

  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> 300 THEN
    v_issues := v_issues || jsonb_build_array('Expected exactly 300 built-in templates');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> 15
  ) THEN
    v_issues := v_issues || jsonb_build_array('Every initial category must have exactly fifteen built-in templates');
  END IF;
  RETURN jsonb_build_object('valid', jsonb_array_length(v_issues) = 0, 'issues', v_issues);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_builtin_roadmap_templates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_builtin_roadmap_templates() TO service_role;

CREATE OR REPLACE FUNCTION public.seed_curated_roadmap_template_batches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
${batches.map((batch) => `  v_count := v_count + public.seed_builtin_roadmap_template_batch_${String(batch.number).padStart(2, "0")}();`).join("\n")}
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_curated_roadmap_template_batches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_curated_roadmap_template_batches() TO service_role;

DO $$
DECLARE
  v_validation jsonb;
BEGIN
  v_validation := public.validate_builtin_roadmap_templates();
  IF NOT COALESCE((v_validation ->> 'valid')::boolean, false) THEN
    RAISE EXCEPTION 'Final built-in roadmap validation failed: %', v_validation -> 'issues';
  END IF;
END;
$$;
`;

for (const [batchIndex, batch] of batches.entries()) {
	if (batch.titles.length !== 20) {
		throw new Error(`Batch ${batch.number} must contain exactly 20 titles`);
	}
	const publishedHour = 14 + Math.floor(batchIndex / 2);
	const publishedMinute = batchIndex % 2 === 0 ? "00" : "10";
	const publishedAt = `2026-07-14T${String(publishedHour).padStart(2, "0")}:${publishedMinute}:00Z`;
	const definitions = batch.titles.map((title, categoryIndex) => {
		const templateNumber = (batch.number - 1) * 20 + categoryIndex + 1;
		const [categorySlug] = categories[categoryIndex];
		const difficulty =
			[5, 7, 8, 9, 10, 11, 12, 15, 16].includes(categoryIndex) &&
			[5, 7, 9, 10, 11, 13, 14].includes(batch.number)
				? "advanced"
				: "intermediate";
		return {
			template_id: uuid("10000000", templateNumber),
			version_id: uuid("30000000", templateNumber),
			category_id: uuid("20000000", categoryIndex + 1),
			slug: slugify(title),
			title,
			summary: `Plan and deliver ${title} through a curated ${batch.label} program with clear evidence, accountable implementation, validation, and measurable operational handover.`,
			difficulty,
			schedule_kind: "long_term",
			duration_days: 120,
			phases: batch.phases,
			tags: [categorySlug, batch.slug, slugify(title)],
			is_featured: false,
			published_at: publishedAt,
		};
	});
	const batchNumber = String(batch.number).padStart(2, "0");
	const expectedTotal = batch.number * 20;
	const migration = `-- Curated roadmap template batch ${batchNumber}: ${batch.label}.
-- Exactly one template is added for each of the 20 marketplace categories.
${batch.number === 4 ? genericSeeder : ""}
CREATE OR REPLACE FUNCTION public.seed_builtin_roadmap_template_batch_${batchNumber}()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.seed_builtin_roadmap_template_batch(
$batch$
${JSON.stringify(definitions, null, 2)}
$batch$::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_builtin_roadmap_template_batch_${batchNumber}()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.seed_builtin_roadmap_template_batch_${batchNumber}();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.roadmap_public_templates WHERE origin = 'builtin') <> ${expectedTotal} THEN
    RAISE EXCEPTION 'Batch ${batchNumber} expected ${expectedTotal} built-in templates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roadmap_template_categories c
    LEFT JOIN public.roadmap_public_templates t
      ON t.category_id = c.id AND t.origin = 'builtin'
    WHERE c.position BETWEEN 1 AND 20
    GROUP BY c.id HAVING count(t.id) <> ${batch.number}
  ) THEN
    RAISE EXCEPTION 'Batch ${batchNumber} expected ${batch.number} built-ins per category';
  END IF;
END;
$$;
${batch.number === 15 ? finalizer : ""}`;
	const filename = `${migrations[batchIndex]}_curated_roadmap_templates_batch_${batchNumber}.sql`;
	writeFileSync(resolve("supabase/migrations", filename), migration, "utf8");
}

console.log(
	"Generated 12 curated roadmap migrations containing 240 templates.",
);
