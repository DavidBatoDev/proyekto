-- Migration: 20260819130100_seed_marketplace_topics.sql
-- Date: August 19, 2026
-- Description:
--   Seeds the third taxonomy level: four topics under each of the 73 active
--   specialities.
--
--   Topics are what a client would type into a search box -- "RAG Systems",
--   "Kubernetes", "SOC 2 Readiness" -- not restatements of the parent. If a
--   topic reads like the speciality with different words it earns nothing and
--   is not here.
--
--   Rows are keyed on (subcategory_id, slug), a real unique constraint, rather
--   than on hand-written UUIDs. The two levels above use explicit ids so later
--   migrations can amend by id; at ~300 rows that is ~300 chances to typo a
--   UUID, and the composite key amends just as precisely.
--
--   Parents resolve by (category slug, sub-category slug) rather than by id, so
--   this file stays readable and survives its parents being re-seeded.
--
--   Idempotent: re-running updates names and positions in place. It
--   deliberately does NOT reset `is_active`. The seeds above it do, which is
--   why re-running one of those on its own would resurrect the categories
--   retired in 20260818130000 / 20260818140000 -- a trap worth not rebuilding.

INSERT INTO public.marketplace_topics (subcategory_id, slug, name, position)
SELECT s.id, v.slug, v.name, v.position
FROM (VALUES
  -- =================================================== Software Engineering
  ('software-engineering', 'web-application-development', 'react-and-nextjs', 'React & Next.js', 1),
  ('software-engineering', 'web-application-development', 'vue-and-nuxt', 'Vue & Nuxt', 2),
  ('software-engineering', 'web-application-development', 'realtime-and-collaborative-apps', 'Realtime & Collaborative Apps', 3),
  ('software-engineering', 'web-application-development', 'saas-multi-tenancy', 'SaaS Multi-Tenancy', 4),

  ('software-engineering', 'mobile-app-development', 'ios-native', 'iOS Native', 1),
  ('software-engineering', 'mobile-app-development', 'android-native', 'Android Native', 2),
  ('software-engineering', 'mobile-app-development', 'react-native-and-flutter', 'React Native & Flutter', 3),
  ('software-engineering', 'mobile-app-development', 'app-store-release', 'App Store Release', 4),

  ('software-engineering', 'apis-and-integrations', 'rest-and-graphql-design', 'REST & GraphQL Design', 1),
  ('software-engineering', 'apis-and-integrations', 'third-party-integrations', 'Third-Party Integrations', 2),
  ('software-engineering', 'apis-and-integrations', 'webhooks-and-event-delivery', 'Webhooks & Event Delivery', 3),
  ('software-engineering', 'apis-and-integrations', 'api-versioning-and-deprecation', 'API Versioning & Deprecation', 4),

  ('software-engineering', 'software-architecture-review', 'monolith-to-services', 'Monolith to Services', 1),
  ('software-engineering', 'software-architecture-review', 'event-driven-architecture', 'Event-Driven Architecture', 2),
  ('software-engineering', 'software-architecture-review', 'database-schema-design', 'Database Schema Design', 3),
  ('software-engineering', 'software-architecture-review', 'scalability-review', 'Scalability Review', 4),

  ('software-engineering', 'legacy-modernisation', 'framework-upgrades', 'Framework Upgrades', 1),
  ('software-engineering', 'legacy-modernisation', 'strangler-migrations', 'Strangler Migrations', 2),
  ('software-engineering', 'legacy-modernisation', 'data-migration', 'Data Migration', 3),
  ('software-engineering', 'legacy-modernisation', 'test-harness-rescue', 'Test Harness Rescue', 4),

  ('software-engineering', 'technical-due-diligence', 'codebase-audit', 'Codebase Audit', 1),
  ('software-engineering', 'technical-due-diligence', 'engineering-team-assessment', 'Engineering Team Assessment', 2),
  ('software-engineering', 'technical-due-diligence', 'technical-debt-valuation', 'Technical Debt Valuation', 3),
  ('software-engineering', 'technical-due-diligence', 'build-vs-buy-analysis', 'Build vs Buy Analysis', 4),

  ('software-engineering', 'qa-and-test-strategy', 'automated-test-suites', 'Automated Test Suites', 1),
  ('software-engineering', 'qa-and-test-strategy', 'end-to-end-testing', 'End-to-End Testing', 2),
  ('software-engineering', 'qa-and-test-strategy', 'load-and-stress-testing', 'Load & Stress Testing', 3),
  ('software-engineering', 'qa-and-test-strategy', 'release-quality-gates', 'Release Quality Gates', 4),

  ('software-engineering', 'performance-optimisation', 'core-web-vitals', 'Core Web Vitals', 1),
  ('software-engineering', 'performance-optimisation', 'database-query-tuning', 'Database Query Tuning', 2),
  ('software-engineering', 'performance-optimisation', 'caching-strategy', 'Caching Strategy', 3),
  ('software-engineering', 'performance-optimisation', 'latency-profiling', 'Latency Profiling', 4),

  -- ============================================================== AI & Data
  ('ai-and-data', 'llm-application-development', 'rag-systems', 'RAG Systems', 1),
  ('ai-and-data', 'llm-application-development', 'agent-frameworks-and-tool-use', 'Agent Frameworks & Tool Use', 2),
  ('ai-and-data', 'llm-application-development', 'prompt-engineering', 'Prompt Engineering', 3),
  ('ai-and-data', 'llm-application-development', 'fine-tuning-and-distillation', 'Fine-Tuning & Distillation', 4),

  ('ai-and-data', 'ai-strategy-and-roadmap', 'ai-opportunity-assessment', 'AI Opportunity Assessment', 1),
  ('ai-and-data', 'ai-strategy-and-roadmap', 'build-vs-buy-for-ai', 'Build vs Buy for AI', 2),
  ('ai-and-data', 'ai-strategy-and-roadmap', 'ai-cost-modelling', 'AI Cost Modelling', 3),
  ('ai-and-data', 'ai-strategy-and-roadmap', 'ai-adoption-and-enablement', 'AI Adoption & Enablement', 4),

  ('ai-and-data', 'machine-learning-engineering', 'recommendation-systems', 'Recommendation Systems', 1),
  ('ai-and-data', 'machine-learning-engineering', 'forecasting-and-time-series', 'Forecasting & Time Series', 2),
  ('ai-and-data', 'machine-learning-engineering', 'nlp-and-text-classification', 'NLP & Text Classification', 3),
  ('ai-and-data', 'machine-learning-engineering', 'feature-engineering', 'Feature Engineering', 4),

  ('ai-and-data', 'data-engineering-and-pipelines', 'etl-and-elt-pipelines', 'ETL & ELT Pipelines', 1),
  ('ai-and-data', 'data-engineering-and-pipelines', 'data-warehouse-modelling', 'Data Warehouse Modelling', 2),
  ('ai-and-data', 'data-engineering-and-pipelines', 'streaming-data', 'Streaming Data', 3),
  ('ai-and-data', 'data-engineering-and-pipelines', 'data-quality-monitoring', 'Data Quality Monitoring', 4),

  ('ai-and-data', 'analytics-and-bi', 'dashboard-design', 'Dashboard Design', 1),
  ('ai-and-data', 'analytics-and-bi', 'metric-definition', 'Metric Definition', 2),
  ('ai-and-data', 'analytics-and-bi', 'self-serve-analytics', 'Self-Serve Analytics', 3),
  ('ai-and-data', 'analytics-and-bi', 'experimentation-analysis', 'Experimentation Analysis', 4),

  ('ai-and-data', 'mlops-and-evaluation', 'model-deployment-and-serving', 'Model Deployment & Serving', 1),
  ('ai-and-data', 'mlops-and-evaluation', 'evaluation-harnesses', 'Evaluation Harnesses', 2),
  ('ai-and-data', 'mlops-and-evaluation', 'drift-and-regression-monitoring', 'Drift & Regression Monitoring', 3),
  ('ai-and-data', 'mlops-and-evaluation', 'guardrails-and-safety', 'Guardrails & Safety', 4),

  ('ai-and-data', 'data-governance', 'pii-handling-and-redaction', 'PII Handling & Redaction', 1),
  ('ai-and-data', 'data-governance', 'data-lineage-and-cataloguing', 'Data Lineage & Cataloguing', 2),
  ('ai-and-data', 'data-governance', 'retention-and-deletion-policy', 'Retention & Deletion Policy', 3),
  ('ai-and-data', 'data-governance', 'access-control-for-data', 'Access Control for Data', 4),

  ('ai-and-data', 'computer-vision', 'object-detection', 'Object Detection', 1),
  ('ai-and-data', 'computer-vision', 'document-and-ocr-extraction', 'Document & OCR Extraction', 2),
  ('ai-and-data', 'computer-vision', 'video-analysis', 'Video Analysis', 3),
  ('ai-and-data', 'computer-vision', 'visual-inspection', 'Visual Inspection', 4),

  -- ============================================== Cloud, DevOps & Security
  ('cloud-devops-and-security', 'cloud-migration', 'aws-migration', 'AWS Migration', 1),
  ('cloud-devops-and-security', 'cloud-migration', 'gcp-and-azure-migration', 'GCP & Azure Migration', 2),
  ('cloud-devops-and-security', 'cloud-migration', 'lift-and-shift-planning', 'Lift & Shift Planning', 3),
  ('cloud-devops-and-security', 'cloud-migration', 'hybrid-and-multi-cloud', 'Hybrid & Multi-Cloud', 4),

  ('cloud-devops-and-security', 'platform-engineering', 'kubernetes', 'Kubernetes', 1),
  ('cloud-devops-and-security', 'platform-engineering', 'infrastructure-as-code', 'Infrastructure as Code', 2),
  ('cloud-devops-and-security', 'platform-engineering', 'internal-developer-platforms', 'Internal Developer Platforms', 3),
  ('cloud-devops-and-security', 'platform-engineering', 'serverless-architecture', 'Serverless Architecture', 4),

  ('cloud-devops-and-security', 'ci-cd-and-release', 'pipeline-design', 'Pipeline Design', 1),
  ('cloud-devops-and-security', 'ci-cd-and-release', 'build-time-reduction', 'Build Time Reduction', 2),
  ('cloud-devops-and-security', 'ci-cd-and-release', 'progressive-delivery', 'Progressive Delivery', 3),
  ('cloud-devops-and-security', 'ci-cd-and-release', 'release-automation', 'Release Automation', 4),

  ('cloud-devops-and-security', 'observability-and-sre', 'logging-and-tracing', 'Logging & Tracing', 1),
  ('cloud-devops-and-security', 'observability-and-sre', 'slos-and-error-budgets', 'SLOs & Error Budgets', 2),
  ('cloud-devops-and-security', 'observability-and-sre', 'alerting-and-on-call', 'Alerting & On-Call', 3),
  ('cloud-devops-and-security', 'observability-and-sre', 'capacity-planning', 'Capacity Planning', 4),

  ('cloud-devops-and-security', 'cloud-cost-optimisation', 'finops-practice', 'FinOps Practice', 1),
  ('cloud-devops-and-security', 'cloud-cost-optimisation', 'rightsizing-and-autoscaling', 'Rightsizing & Autoscaling', 2),
  ('cloud-devops-and-security', 'cloud-cost-optimisation', 'commitment-planning', 'Commitment Planning', 3),
  ('cloud-devops-and-security', 'cloud-cost-optimisation', 'egress-and-storage-costs', 'Egress & Storage Costs', 4),

  ('cloud-devops-and-security', 'application-security', 'threat-modelling', 'Threat Modelling', 1),
  ('cloud-devops-and-security', 'application-security', 'secure-code-review', 'Secure Code Review', 2),
  ('cloud-devops-and-security', 'application-security', 'authentication-and-authorisation', 'Authentication & Authorisation', 3),
  ('cloud-devops-and-security', 'application-security', 'secrets-management', 'Secrets Management', 4),

  ('cloud-devops-and-security', 'security-and-compliance-audits', 'soc-2-readiness', 'SOC 2 Readiness', 1),
  ('cloud-devops-and-security', 'security-and-compliance-audits', 'iso-27001', 'ISO 27001', 2),
  ('cloud-devops-and-security', 'security-and-compliance-audits', 'gdpr-and-privacy', 'GDPR & Privacy', 3),
  ('cloud-devops-and-security', 'security-and-compliance-audits', 'penetration-testing', 'Penetration Testing', 4),

  ('cloud-devops-and-security', 'incident-response', 'incident-command', 'Incident Command', 1),
  ('cloud-devops-and-security', 'incident-response', 'postmortem-practice', 'Postmortem Practice', 2),
  ('cloud-devops-and-security', 'incident-response', 'disaster-recovery-planning', 'Disaster Recovery Planning', 3),
  ('cloud-devops-and-security', 'incident-response', 'breach-response', 'Breach Response', 4),

  -- ========================================================= Design & Brand
  ('design-and-brand', 'ux-research', 'user-interviews', 'User Interviews', 1),
  ('design-and-brand', 'ux-research', 'usability-testing', 'Usability Testing', 2),
  ('design-and-brand', 'ux-research', 'journey-mapping', 'Journey Mapping', 3),
  ('design-and-brand', 'ux-research', 'survey-design', 'Survey Design', 4),

  ('design-and-brand', 'product-design', 'wireframing-and-prototyping', 'Wireframing & Prototyping', 1),
  ('design-and-brand', 'product-design', 'mobile-app-design', 'Mobile App Design', 2),
  ('design-and-brand', 'product-design', 'dashboard-and-data-ui', 'Dashboard & Data UI', 3),
  ('design-and-brand', 'product-design', 'onboarding-flows', 'Onboarding Flows', 4),

  ('design-and-brand', 'design-systems', 'component-libraries', 'Component Libraries', 1),
  ('design-and-brand', 'design-systems', 'design-tokens', 'Design Tokens', 2),
  ('design-and-brand', 'design-systems', 'figma-to-code-handoff', 'Figma to Code Handoff', 3),
  ('design-and-brand', 'design-systems', 'multi-brand-theming', 'Multi-Brand Theming', 4),

  ('design-and-brand', 'brand-identity', 'logo-and-marks', 'Logo & Marks', 1),
  ('design-and-brand', 'brand-identity', 'visual-identity-systems', 'Visual Identity Systems', 2),
  ('design-and-brand', 'brand-identity', 'brand-guidelines', 'Brand Guidelines', 3),
  ('design-and-brand', 'brand-identity', 'rebranding', 'Rebranding', 4),

  ('design-and-brand', 'website-design', 'landing-pages', 'Landing Pages', 1),
  ('design-and-brand', 'website-design', 'marketing-sites', 'Marketing Sites', 2),
  ('design-and-brand', 'website-design', 'ecommerce-storefronts', 'E-commerce Storefronts', 3),
  ('design-and-brand', 'website-design', 'webflow-and-no-code', 'Webflow & No-Code', 4),

  ('design-and-brand', 'content-and-ux-writing', 'interface-copy', 'Interface Copy', 1),
  ('design-and-brand', 'content-and-ux-writing', 'voice-and-tone', 'Voice & Tone', 2),
  ('design-and-brand', 'content-and-ux-writing', 'error-and-empty-states', 'Error & Empty States', 3),
  ('design-and-brand', 'content-and-ux-writing', 'microcopy-testing', 'Microcopy Testing', 4),

  ('design-and-brand', 'accessibility-audits', 'wcag-conformance', 'WCAG Conformance', 1),
  ('design-and-brand', 'accessibility-audits', 'screen-reader-testing', 'Screen Reader Testing', 2),
  ('design-and-brand', 'accessibility-audits', 'keyboard-navigation', 'Keyboard Navigation', 3),
  ('design-and-brand', 'accessibility-audits', 'colour-and-contrast', 'Colour & Contrast', 4),

  -- ====================================================== Content & Writing
  ('content-and-writing', 'technical-writing', 'api-reference-docs', 'API Reference Docs', 1),
  ('content-and-writing', 'technical-writing', 'developer-guides-and-tutorials', 'Developer Guides & Tutorials', 2),
  ('content-and-writing', 'technical-writing', 'release-notes-and-changelogs', 'Release Notes & Changelogs', 3),
  ('content-and-writing', 'technical-writing', 'architecture-decision-records', 'Architecture Decision Records', 4),

  ('content-and-writing', 'documentation-systems', 'docs-as-code-pipelines', 'Docs-as-Code Pipelines', 1),
  ('content-and-writing', 'documentation-systems', 'knowledge-base-setup', 'Knowledge Base Setup', 2),
  ('content-and-writing', 'documentation-systems', 'information-architecture', 'Information Architecture', 3),
  ('content-and-writing', 'documentation-systems', 'docs-search-and-navigation', 'Docs Search & Navigation', 4),

  ('content-and-writing', 'content-strategy', 'editorial-calendars', 'Editorial Calendars', 1),
  ('content-and-writing', 'content-strategy', 'audience-and-messaging', 'Audience & Messaging', 2),
  ('content-and-writing', 'content-strategy', 'content-audits', 'Content Audits', 3),
  ('content-and-writing', 'content-strategy', 'thought-leadership', 'Thought Leadership', 4),

  ('content-and-writing', 'ux-writing', 'product-copy', 'Product Copy', 1),
  ('content-and-writing', 'ux-writing', 'notification-and-email-copy', 'Notification & Email Copy', 2),
  ('content-and-writing', 'ux-writing', 'onboarding-copy', 'Onboarding Copy', 3),
  ('content-and-writing', 'ux-writing', 'in-product-help', 'In-Product Help', 4),

  ('content-and-writing', 'editing-and-style', 'style-guide-authoring', 'Style Guide Authoring', 1),
  ('content-and-writing', 'editing-and-style', 'copy-editing', 'Copy Editing', 2),
  ('content-and-writing', 'editing-and-style', 'terminology-and-glossaries', 'Terminology & Glossaries', 3),
  ('content-and-writing', 'editing-and-style', 'plain-language-rewrites', 'Plain Language Rewrites', 4),

  ('content-and-writing', 'localisation-and-translation', 'i18n-engineering', 'i18n Engineering', 1),
  ('content-and-writing', 'localisation-and-translation', 'translation-management', 'Translation Management', 2),
  ('content-and-writing', 'localisation-and-translation', 'market-adaptation', 'Market Adaptation', 3),
  ('content-and-writing', 'localisation-and-translation', 'rtl-and-locale-formats', 'RTL & Locale Formats', 4),

  -- ========================================================= Growth & Sales
  ('growth-and-sales', 'growth-strategy', 'acquisition-channel-strategy', 'Acquisition Channel Strategy', 1),
  ('growth-and-sales', 'growth-strategy', 'growth-modelling', 'Growth Modelling', 2),
  ('growth-and-sales', 'growth-strategy', 'activation-and-retention', 'Activation & Retention', 3),
  ('growth-and-sales', 'growth-strategy', 'product-led-growth', 'Product-Led Growth', 4),

  ('growth-and-sales', 'seo-and-content', 'technical-seo', 'Technical SEO', 1),
  ('growth-and-sales', 'seo-and-content', 'keyword-and-topic-research', 'Keyword & Topic Research', 2),
  ('growth-and-sales', 'seo-and-content', 'link-building', 'Link Building', 3),
  ('growth-and-sales', 'seo-and-content', 'programmatic-seo', 'Programmatic SEO', 4),

  ('growth-and-sales', 'paid-acquisition', 'google-ads', 'Google Ads', 1),
  ('growth-and-sales', 'paid-acquisition', 'meta-ads', 'Meta Ads', 2),
  ('growth-and-sales', 'paid-acquisition', 'linkedin-ads', 'LinkedIn Ads', 3),
  ('growth-and-sales', 'paid-acquisition', 'creative-testing', 'Creative Testing', 4),

  ('growth-and-sales', 'lifecycle-and-crm', 'email-automation', 'Email Automation', 1),
  ('growth-and-sales', 'lifecycle-and-crm', 'onboarding-sequences', 'Onboarding Sequences', 2),
  ('growth-and-sales', 'lifecycle-and-crm', 'churn-and-winback', 'Churn & Winback', 3),
  ('growth-and-sales', 'lifecycle-and-crm', 'segmentation', 'Segmentation', 4),

  ('growth-and-sales', 'conversion-optimisation', 'landing-page-testing', 'Landing Page Testing', 1),
  ('growth-and-sales', 'conversion-optimisation', 'checkout-and-signup-flows', 'Checkout & Signup Flows', 2),
  ('growth-and-sales', 'conversion-optimisation', 'ab-testing-programmes', 'A/B Testing Programmes', 3),
  ('growth-and-sales', 'conversion-optimisation', 'funnel-diagnostics', 'Funnel Diagnostics', 4),

  ('growth-and-sales', 'marketing-analytics', 'attribution-modelling', 'Attribution Modelling', 1),
  ('growth-and-sales', 'marketing-analytics', 'tracking-implementation', 'Tracking Implementation', 2),
  ('growth-and-sales', 'marketing-analytics', 'cohort-and-ltv-analysis', 'Cohort & LTV Analysis', 3),
  ('growth-and-sales', 'marketing-analytics', 'marketing-dashboards', 'Marketing Dashboards', 4),

  ('growth-and-sales', 'community-and-social', 'community-building', 'Community Building', 1),
  ('growth-and-sales', 'community-and-social', 'social-strategy', 'Social Strategy', 2),
  ('growth-and-sales', 'community-and-social', 'developer-relations', 'Developer Relations', 3),
  ('growth-and-sales', 'community-and-social', 'ambassador-programmes', 'Ambassador Programmes', 4),

  ('growth-and-sales', 'launch-campaigns', 'product-launch-planning', 'Product Launch Planning', 1),
  ('growth-and-sales', 'launch-campaigns', 'press-and-pr', 'Press & PR', 2),
  ('growth-and-sales', 'launch-campaigns', 'launch-day-operations', 'Launch Day Operations', 3),
  ('growth-and-sales', 'launch-campaigns', 'beta-and-waitlist-programmes', 'Beta & Waitlist Programmes', 4),

  ('growth-and-sales', 'sales-strategy', 'icp-and-segmentation', 'ICP & Segmentation', 1),
  ('growth-and-sales', 'sales-strategy', 'sales-motion-design', 'Sales Motion Design', 2),
  ('growth-and-sales', 'sales-strategy', 'territory-and-quota-planning', 'Territory & Quota Planning', 3),
  ('growth-and-sales', 'sales-strategy', 'enterprise-deal-strategy', 'Enterprise Deal Strategy', 4),

  ('growth-and-sales', 'outbound-and-prospecting', 'cold-email-sequences', 'Cold Email Sequences', 1),
  ('growth-and-sales', 'outbound-and-prospecting', 'lead-list-building', 'Lead List Building', 2),
  ('growth-and-sales', 'outbound-and-prospecting', 'sdr-playbooks', 'SDR Playbooks', 3),
  ('growth-and-sales', 'outbound-and-prospecting', 'account-based-marketing', 'Account-Based Marketing', 4),

  ('growth-and-sales', 'revenue-operations', 'crm-implementation', 'CRM Implementation', 1),
  ('growth-and-sales', 'revenue-operations', 'pipeline-hygiene-and-forecasting', 'Pipeline Hygiene & Forecasting', 2),
  ('growth-and-sales', 'revenue-operations', 'sales-tooling-stack', 'Sales Tooling Stack', 3),
  ('growth-and-sales', 'revenue-operations', 'commission-and-comp-plans', 'Commission & Comp Plans', 4),

  ('growth-and-sales', 'partnerships-and-channels', 'reseller-programmes', 'Reseller Programmes', 1),
  ('growth-and-sales', 'partnerships-and-channels', 'technology-integrations', 'Technology Integrations', 2),
  ('growth-and-sales', 'partnerships-and-channels', 'marketplace-listings', 'Marketplace Listings', 3),
  ('growth-and-sales', 'partnerships-and-channels', 'co-marketing', 'Co-Marketing', 4),

  ('growth-and-sales', 'sales-enablement', 'pitch-decks-and-collateral', 'Pitch Decks & Collateral', 1),
  ('growth-and-sales', 'sales-enablement', 'demo-scripts', 'Demo Scripts', 2),
  ('growth-and-sales', 'sales-enablement', 'objection-handling', 'Objection Handling', 3),
  ('growth-and-sales', 'sales-enablement', 'sales-onboarding', 'Sales Onboarding', 4),

  ('growth-and-sales', 'customer-success', 'onboarding-programmes', 'Onboarding Programmes', 1),
  ('growth-and-sales', 'customer-success', 'health-scoring', 'Health Scoring', 2),
  ('growth-and-sales', 'customer-success', 'renewals-and-expansion', 'Renewals & Expansion', 3),
  ('growth-and-sales', 'customer-success', 'qbr-and-account-reviews', 'QBRs & Account Reviews', 4),

  ('growth-and-sales', 'pricing-and-deal-desk', 'packaging-and-tiering', 'Packaging & Tiering', 1),
  ('growth-and-sales', 'pricing-and-deal-desk', 'willingness-to-pay-research', 'Willingness-to-Pay Research', 2),
  ('growth-and-sales', 'pricing-and-deal-desk', 'discount-governance', 'Discount Governance', 3),
  ('growth-and-sales', 'pricing-and-deal-desk', 'usage-based-pricing', 'Usage-Based Pricing', 4),

  -- ================================================== People & Organisation
  ('people-and-organisation', 'hiring-and-recruiting', 'technical-hiring', 'Technical Hiring', 1),
  ('people-and-organisation', 'hiring-and-recruiting', 'interview-process-design', 'Interview Process Design', 2),
  ('people-and-organisation', 'hiring-and-recruiting', 'employer-branding', 'Employer Branding', 3),
  ('people-and-organisation', 'hiring-and-recruiting', 'executive-search', 'Executive Search', 4),

  ('people-and-organisation', 'org-design', 'team-topologies', 'Team Topologies', 1),
  ('people-and-organisation', 'org-design', 'role-and-levelling-frameworks', 'Role & Levelling Frameworks', 2),
  ('people-and-organisation', 'org-design', 'span-of-control', 'Span of Control', 3),
  ('people-and-organisation', 'org-design', 'reorganisation-planning', 'Reorganisation Planning', 4),

  ('people-and-organisation', 'performance-and-compensation', 'review-cycles', 'Review Cycles', 1),
  ('people-and-organisation', 'performance-and-compensation', 'compensation-benchmarking', 'Compensation Benchmarking', 2),
  ('people-and-organisation', 'performance-and-compensation', 'equity-and-option-plans', 'Equity & Option Plans', 3),
  ('people-and-organisation', 'performance-and-compensation', 'career-ladders', 'Career Ladders', 4),

  ('people-and-organisation', 'learning-and-development', 'onboarding-programmes', 'Onboarding Programmes', 1),
  ('people-and-organisation', 'learning-and-development', 'technical-training', 'Technical Training', 2),
  ('people-and-organisation', 'learning-and-development', 'management-training', 'Management Training', 3),
  ('people-and-organisation', 'learning-and-development', 'mentoring-programmes', 'Mentoring Programmes', 4),

  ('people-and-organisation', 'culture-and-engagement', 'values-and-behaviours', 'Values & Behaviours', 1),
  ('people-and-organisation', 'culture-and-engagement', 'engagement-surveys', 'Engagement Surveys', 2),
  ('people-and-organisation', 'culture-and-engagement', 'internal-communications', 'Internal Communications', 3),
  ('people-and-organisation', 'culture-and-engagement', 'retention-programmes', 'Retention Programmes', 4),

  ('people-and-organisation', 'remote-and-distributed-teams', 'async-operating-models', 'Async Operating Models', 1),
  ('people-and-organisation', 'remote-and-distributed-teams', 'distributed-hiring-and-payroll', 'Distributed Hiring & Payroll', 2),
  ('people-and-organisation', 'remote-and-distributed-teams', 'remote-onboarding', 'Remote Onboarding', 3),
  ('people-and-organisation', 'remote-and-distributed-teams', 'timezone-coverage', 'Timezone Coverage', 4),

  ('people-and-organisation', 'founder-and-exec-coaching', 'first-time-founder-coaching', 'First-Time Founder Coaching', 1),
  ('people-and-organisation', 'founder-and-exec-coaching', 'leadership-team-coaching', 'Leadership Team Coaching', 2),
  ('people-and-organisation', 'founder-and-exec-coaching', 'board-readiness', 'Board Readiness', 3),
  ('people-and-organisation', 'founder-and-exec-coaching', 'founder-conflict-resolution', 'Founder Conflict Resolution', 4),

  -- ==================================================== Business Operations
  ('business-operations', 'financial-modelling', 'three-statement-models', 'Three-Statement Models', 1),
  ('business-operations', 'financial-modelling', 'saas-metrics-models', 'SaaS Metrics Models', 2),
  ('business-operations', 'financial-modelling', 'scenario-planning', 'Scenario Planning', 3),
  ('business-operations', 'financial-modelling', 'cap-table-modelling', 'Cap Table Modelling', 4),

  ('business-operations', 'fundraising-and-pitch', 'seed-and-series-a-decks', 'Seed & Series A Decks', 1),
  ('business-operations', 'fundraising-and-pitch', 'investor-data-rooms', 'Investor Data Rooms', 2),
  ('business-operations', 'fundraising-and-pitch', 'valuation-and-term-sheets', 'Valuation & Term Sheets', 3),
  ('business-operations', 'fundraising-and-pitch', 'investor-updates', 'Investor Updates', 4),

  ('business-operations', 'unit-economics', 'cac-and-payback', 'CAC & Payback', 1),
  ('business-operations', 'unit-economics', 'margin-analysis', 'Margin Analysis', 2),
  ('business-operations', 'unit-economics', 'cost-to-serve', 'Cost to Serve', 3),
  ('business-operations', 'unit-economics', 'pricing-impact-modelling', 'Pricing Impact Modelling', 4),

  ('business-operations', 'budgeting-and-forecasting', 'annual-planning', 'Annual Planning', 1),
  ('business-operations', 'budgeting-and-forecasting', 'rolling-forecasts', 'Rolling Forecasts', 2),
  ('business-operations', 'budgeting-and-forecasting', 'cash-flow-and-runway', 'Cash Flow & Runway', 3),
  ('business-operations', 'budgeting-and-forecasting', 'headcount-planning', 'Headcount Planning', 4),

  ('business-operations', 'bookkeeping-and-controls', 'month-end-close', 'Month-End Close', 1),
  ('business-operations', 'bookkeeping-and-controls', 'revenue-recognition', 'Revenue Recognition', 2),
  ('business-operations', 'bookkeeping-and-controls', 'audit-preparation', 'Audit Preparation', 3),
  ('business-operations', 'bookkeeping-and-controls', 'internal-controls', 'Internal Controls', 4),

  ('business-operations', 'mergers-and-acquisitions', 'buy-side-diligence', 'Buy-Side Diligence', 1),
  ('business-operations', 'mergers-and-acquisitions', 'sell-side-preparation', 'Sell-Side Preparation', 2),
  ('business-operations', 'mergers-and-acquisitions', 'post-merger-integration', 'Post-Merger Integration', 3),
  ('business-operations', 'mergers-and-acquisitions', 'deal-modelling', 'Deal Modelling', 4),

  ('business-operations', 'grants-and-non-dilutive', 'rd-tax-credits', 'R&D Tax Credits', 1),
  ('business-operations', 'grants-and-non-dilutive', 'government-grants', 'Government Grants', 2),
  ('business-operations', 'grants-and-non-dilutive', 'grant-writing', 'Grant Writing', 3),
  ('business-operations', 'grants-and-non-dilutive', 'venture-debt', 'Venture Debt', 4),

  ('business-operations', 'program-and-project-management', 'delivery-planning', 'Delivery Planning', 1),
  ('business-operations', 'program-and-project-management', 'programme-recovery', 'Programme Recovery', 2),
  ('business-operations', 'program-and-project-management', 'dependency-management', 'Dependency Management', 3),
  ('business-operations', 'program-and-project-management', 'pmo-setup', 'PMO Setup', 4),

  ('business-operations', 'process-design', 'process-mapping', 'Process Mapping', 1),
  ('business-operations', 'process-design', 'sop-authoring', 'SOP Authoring', 2),
  ('business-operations', 'process-design', 'workflow-redesign', 'Workflow Redesign', 3),
  ('business-operations', 'process-design', 'continuous-improvement', 'Continuous Improvement', 4),

  ('business-operations', 'agile-transformation', 'scrum-and-kanban-adoption', 'Scrum & Kanban Adoption', 1),
  ('business-operations', 'agile-transformation', 'agile-coaching', 'Agile Coaching', 2),
  ('business-operations', 'agile-transformation', 'scaling-frameworks', 'Scaling Frameworks', 3),
  ('business-operations', 'agile-transformation', 'delivery-metrics', 'Delivery Metrics', 4),

  ('business-operations', 'vendor-and-outsourcing', 'vendor-selection', 'Vendor Selection', 1),
  ('business-operations', 'vendor-and-outsourcing', 'contract-negotiation', 'Contract Negotiation', 2),
  ('business-operations', 'vendor-and-outsourcing', 'offshore-team-setup', 'Offshore Team Setup', 3),
  ('business-operations', 'vendor-and-outsourcing', 'sla-management', 'SLA Management', 4),

  ('business-operations', 'supply-chain', 'demand-planning', 'Demand Planning', 1),
  ('business-operations', 'supply-chain', 'inventory-optimisation', 'Inventory Optimisation', 2),
  ('business-operations', 'supply-chain', 'logistics-and-fulfilment', 'Logistics & Fulfilment', 3),
  ('business-operations', 'supply-chain', 'supplier-risk', 'Supplier Risk', 4),

  ('business-operations', 'support-operations', 'helpdesk-setup', 'Helpdesk Setup', 1),
  ('business-operations', 'support-operations', 'support-tiering-and-escalation', 'Support Tiering & Escalation', 2),
  ('business-operations', 'support-operations', 'self-serve-support', 'Self-Serve Support', 3),
  ('business-operations', 'support-operations', 'csat-and-quality', 'CSAT & Quality', 4),

  ('business-operations', 'tooling-and-automation', 'workflow-automation', 'Workflow Automation', 1),
  ('business-operations', 'tooling-and-automation', 'systems-integration', 'Systems Integration', 2),
  ('business-operations', 'tooling-and-automation', 'no-code-and-low-code', 'No-Code & Low-Code', 3),
  ('business-operations', 'tooling-and-automation', 'tool-consolidation', 'Tool Consolidation', 4)
) AS v (category_slug, subcategory_slug, slug, name, position)
JOIN public.marketplace_categories c ON c.slug = v.category_slug
JOIN public.marketplace_subcategories s
  ON s.category_id = c.id AND s.slug = v.subcategory_slug
ON CONFLICT (subcategory_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  position = EXCLUDED.position;
