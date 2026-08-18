-- Migration: 20260818110100_seed_marketplace_taxonomy.sql
-- Date: August 18, 2026
-- Description:
--   Seeds the curated marketplace taxonomy: 11 categories and
--   84 sub-categories.
--
--   Top level is DISCIPLINE ("what does this consultant do"), not industry.
--   Industries live in the single "Industry Practices" category rather than
--   competing with disciplines at the top level, which is what keeps the
--   categories from overlapping. Contrast roadmap_template_categories, which
--   mixes the two axes because it classifies roadmap subjects instead.
--
--   Ids are deterministic so later migrations can amend rows by id. The
--   30000000-/31000000- namespaces are used because 20000000- is already taken
--   by roadmap_template_categories (20260714101000).
--
--   Idempotent: re-running converges rather than erroring, so dev and
--   production end up identical regardless of apply order.
--
--   These slugs become public URLs (/marketplace/category/$slug/$subSlug).
--   Renaming one after launch breaks inbound links, so amendments should add
--   rows and deactivate old ones rather than rewrite slugs in place.

INSERT INTO public.marketplace_categories (id, slug, name, description, icon, position)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'product-and-strategy', 'Product & Strategy', 'Discovery, positioning, and deciding what to build next', 'Compass', 1),
  ('30000000-0000-4000-8000-000000000002', 'software-engineering', 'Software Engineering', 'Building, reviewing, and rescuing software', 'Code2', 2),
  ('30000000-0000-4000-8000-000000000003', 'ai-and-data', 'AI & Data', 'Applied AI, data platforms, and analytics', 'Sparkles', 3),
  ('30000000-0000-4000-8000-000000000004', 'cloud-devops-and-security', 'Cloud, DevOps & Security', 'Infrastructure, delivery pipelines, and hardening', 'ServerCog', 4),
  ('30000000-0000-4000-8000-000000000005', 'design-and-brand', 'Design & Brand', 'Research, interface, and identity', 'Palette', 5),
  ('30000000-0000-4000-8000-000000000006', 'growth-and-marketing', 'Growth & Marketing', 'Acquisition, retention, and the numbers behind them', 'TrendingUp', 6),
  ('30000000-0000-4000-8000-000000000007', 'sales-and-revenue', 'Sales & Revenue', 'Pipeline, process, and revenue operations', 'Handshake', 7),
  ('30000000-0000-4000-8000-000000000008', 'finance-and-fundraising', 'Finance & Fundraising', 'Models, runway, and raising money', 'Landmark', 8),
  ('30000000-0000-4000-8000-000000000009', 'operations-and-delivery', 'Operations & Delivery', 'Getting work through the building', 'Workflow', 9),
  ('30000000-0000-4000-8000-000000000010', 'people-and-organisation', 'People & Organisation', 'Hiring, structure, and how teams work', 'Users', 10),
  ('30000000-0000-4000-8000-000000000011', 'industry-practices', 'Industry Practices', 'Consultants who already know your sector', 'Building2', 11)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  position = EXCLUDED.position,
  is_active = true;

INSERT INTO public.marketplace_subcategories (id, category_id, slug, name, position)
VALUES
  ('31000000-0000-4000-8000-000001000001', '30000000-0000-4000-8000-000000000001', 'product-discovery', 'Product Discovery', 1),
  ('31000000-0000-4000-8000-000001000002', '30000000-0000-4000-8000-000000000001', 'roadmapping-and-prioritisation', 'Roadmapping & Prioritisation', 2),
  ('31000000-0000-4000-8000-000001000003', '30000000-0000-4000-8000-000000000001', 'product-market-fit', 'Product-Market Fit', 3),
  ('31000000-0000-4000-8000-000001000004', '30000000-0000-4000-8000-000000000001', 'pricing-and-packaging', 'Pricing & Packaging', 4),
  ('31000000-0000-4000-8000-000001000005', '30000000-0000-4000-8000-000000000001', 'mvp-scoping', 'MVP Scoping', 5),
  ('31000000-0000-4000-8000-000001000006', '30000000-0000-4000-8000-000000000001', 'competitive-research', 'Competitive Research', 6),
  ('31000000-0000-4000-8000-000001000007', '30000000-0000-4000-8000-000000000001', 'product-analytics', 'Product Analytics', 7),
  ('31000000-0000-4000-8000-000001000008', '30000000-0000-4000-8000-000000000001', 'zero-to-one-launch', 'Zero-to-One Launch', 8),
  ('31000000-0000-4000-8000-000002000001', '30000000-0000-4000-8000-000000000002', 'web-application-development', 'Web Application Development', 1),
  ('31000000-0000-4000-8000-000002000002', '30000000-0000-4000-8000-000000000002', 'mobile-app-development', 'Mobile App Development', 2),
  ('31000000-0000-4000-8000-000002000003', '30000000-0000-4000-8000-000000000002', 'apis-and-integrations', 'APIs & Integrations', 3),
  ('31000000-0000-4000-8000-000002000004', '30000000-0000-4000-8000-000000000002', 'software-architecture-review', 'Software Architecture Review', 4),
  ('31000000-0000-4000-8000-000002000005', '30000000-0000-4000-8000-000000000002', 'legacy-modernisation', 'Legacy Modernisation', 5),
  ('31000000-0000-4000-8000-000002000006', '30000000-0000-4000-8000-000000000002', 'technical-due-diligence', 'Technical Due Diligence', 6),
  ('31000000-0000-4000-8000-000002000007', '30000000-0000-4000-8000-000000000002', 'qa-and-test-strategy', 'QA & Test Strategy', 7),
  ('31000000-0000-4000-8000-000002000008', '30000000-0000-4000-8000-000000000002', 'performance-optimisation', 'Performance Optimisation', 8),
  ('31000000-0000-4000-8000-000003000001', '30000000-0000-4000-8000-000000000003', 'llm-application-development', 'LLM Application Development', 1),
  ('31000000-0000-4000-8000-000003000002', '30000000-0000-4000-8000-000000000003', 'ai-strategy-and-roadmap', 'AI Strategy & Roadmap', 2),
  ('31000000-0000-4000-8000-000003000003', '30000000-0000-4000-8000-000000000003', 'machine-learning-engineering', 'Machine Learning Engineering', 3),
  ('31000000-0000-4000-8000-000003000004', '30000000-0000-4000-8000-000000000003', 'data-engineering-and-pipelines', 'Data Engineering & Pipelines', 4),
  ('31000000-0000-4000-8000-000003000005', '30000000-0000-4000-8000-000000000003', 'analytics-and-bi', 'Analytics & BI', 5),
  ('31000000-0000-4000-8000-000003000006', '30000000-0000-4000-8000-000000000003', 'mlops-and-evaluation', 'MLOps & Evaluation', 6),
  ('31000000-0000-4000-8000-000003000007', '30000000-0000-4000-8000-000000000003', 'data-governance', 'Data Governance', 7),
  ('31000000-0000-4000-8000-000003000008', '30000000-0000-4000-8000-000000000003', 'computer-vision', 'Computer Vision', 8),
  ('31000000-0000-4000-8000-000004000001', '30000000-0000-4000-8000-000000000004', 'cloud-migration', 'Cloud Migration', 1),
  ('31000000-0000-4000-8000-000004000002', '30000000-0000-4000-8000-000000000004', 'platform-engineering', 'Platform Engineering', 2),
  ('31000000-0000-4000-8000-000004000003', '30000000-0000-4000-8000-000000000004', 'ci-cd-and-release', 'CI/CD & Release', 3),
  ('31000000-0000-4000-8000-000004000004', '30000000-0000-4000-8000-000000000004', 'observability-and-sre', 'Observability & SRE', 4),
  ('31000000-0000-4000-8000-000004000005', '30000000-0000-4000-8000-000000000004', 'cloud-cost-optimisation', 'Cloud Cost Optimisation', 5),
  ('31000000-0000-4000-8000-000004000006', '30000000-0000-4000-8000-000000000004', 'application-security', 'Application Security', 6),
  ('31000000-0000-4000-8000-000004000007', '30000000-0000-4000-8000-000000000004', 'security-and-compliance-audits', 'Security & Compliance Audits', 7),
  ('31000000-0000-4000-8000-000004000008', '30000000-0000-4000-8000-000000000004', 'incident-response', 'Incident Response', 8),
  ('31000000-0000-4000-8000-000005000001', '30000000-0000-4000-8000-000000000005', 'ux-research', 'UX Research', 1),
  ('31000000-0000-4000-8000-000005000002', '30000000-0000-4000-8000-000000000005', 'product-design', 'Product Design', 2),
  ('31000000-0000-4000-8000-000005000003', '30000000-0000-4000-8000-000000000005', 'design-systems', 'Design Systems', 3),
  ('31000000-0000-4000-8000-000005000004', '30000000-0000-4000-8000-000000000005', 'brand-identity', 'Brand Identity', 4),
  ('31000000-0000-4000-8000-000005000005', '30000000-0000-4000-8000-000000000005', 'website-design', 'Website Design', 5),
  ('31000000-0000-4000-8000-000005000006', '30000000-0000-4000-8000-000000000005', 'content-and-ux-writing', 'Content & UX Writing', 6),
  ('31000000-0000-4000-8000-000005000007', '30000000-0000-4000-8000-000000000005', 'accessibility-audits', 'Accessibility Audits', 7),
  ('31000000-0000-4000-8000-000006000001', '30000000-0000-4000-8000-000000000006', 'growth-strategy', 'Growth Strategy', 1),
  ('31000000-0000-4000-8000-000006000002', '30000000-0000-4000-8000-000000000006', 'seo-and-content', 'SEO & Content', 2),
  ('31000000-0000-4000-8000-000006000003', '30000000-0000-4000-8000-000000000006', 'paid-acquisition', 'Paid Acquisition', 3),
  ('31000000-0000-4000-8000-000006000004', '30000000-0000-4000-8000-000000000006', 'lifecycle-and-crm', 'Lifecycle & CRM', 4),
  ('31000000-0000-4000-8000-000006000005', '30000000-0000-4000-8000-000000000006', 'conversion-optimisation', 'Conversion Optimisation', 5),
  ('31000000-0000-4000-8000-000006000006', '30000000-0000-4000-8000-000000000006', 'marketing-analytics', 'Marketing Analytics', 6),
  ('31000000-0000-4000-8000-000006000007', '30000000-0000-4000-8000-000000000006', 'community-and-social', 'Community & Social', 7),
  ('31000000-0000-4000-8000-000006000008', '30000000-0000-4000-8000-000000000006', 'launch-campaigns', 'Launch Campaigns', 8),
  ('31000000-0000-4000-8000-000007000001', '30000000-0000-4000-8000-000000000007', 'sales-strategy', 'Sales Strategy', 1),
  ('31000000-0000-4000-8000-000007000002', '30000000-0000-4000-8000-000000000007', 'outbound-and-prospecting', 'Outbound & Prospecting', 2),
  ('31000000-0000-4000-8000-000007000003', '30000000-0000-4000-8000-000000000007', 'revenue-operations', 'Revenue Operations', 3),
  ('31000000-0000-4000-8000-000007000004', '30000000-0000-4000-8000-000000000007', 'partnerships-and-channels', 'Partnerships & Channels', 4),
  ('31000000-0000-4000-8000-000007000005', '30000000-0000-4000-8000-000000000007', 'sales-enablement', 'Sales Enablement', 5),
  ('31000000-0000-4000-8000-000007000006', '30000000-0000-4000-8000-000000000007', 'customer-success', 'Customer Success', 6),
  ('31000000-0000-4000-8000-000007000007', '30000000-0000-4000-8000-000000000007', 'pricing-and-deal-desk', 'Pricing & Deal Desk', 7),
  ('31000000-0000-4000-8000-000008000001', '30000000-0000-4000-8000-000000000008', 'financial-modelling', 'Financial Modelling', 1),
  ('31000000-0000-4000-8000-000008000002', '30000000-0000-4000-8000-000000000008', 'fundraising-and-pitch', 'Fundraising & Pitch', 2),
  ('31000000-0000-4000-8000-000008000003', '30000000-0000-4000-8000-000000000008', 'unit-economics', 'Unit Economics', 3),
  ('31000000-0000-4000-8000-000008000004', '30000000-0000-4000-8000-000000000008', 'budgeting-and-forecasting', 'Budgeting & Forecasting', 4),
  ('31000000-0000-4000-8000-000008000005', '30000000-0000-4000-8000-000000000008', 'bookkeeping-and-controls', 'Bookkeeping & Controls', 5),
  ('31000000-0000-4000-8000-000008000006', '30000000-0000-4000-8000-000000000008', 'mergers-and-acquisitions', 'Mergers & Acquisitions', 6),
  ('31000000-0000-4000-8000-000008000007', '30000000-0000-4000-8000-000000000008', 'grants-and-non-dilutive', 'Grants & Non-Dilutive', 7),
  ('31000000-0000-4000-8000-000009000001', '30000000-0000-4000-8000-000000000009', 'program-and-project-management', 'Program & Project Management', 1),
  ('31000000-0000-4000-8000-000009000002', '30000000-0000-4000-8000-000000000009', 'process-design', 'Process Design', 2),
  ('31000000-0000-4000-8000-000009000003', '30000000-0000-4000-8000-000000000009', 'agile-transformation', 'Agile Transformation', 3),
  ('31000000-0000-4000-8000-000009000004', '30000000-0000-4000-8000-000000000009', 'vendor-and-outsourcing', 'Vendor & Outsourcing', 4),
  ('31000000-0000-4000-8000-000009000005', '30000000-0000-4000-8000-000000000009', 'supply-chain', 'Supply Chain', 5),
  ('31000000-0000-4000-8000-000009000006', '30000000-0000-4000-8000-000000000009', 'support-operations', 'Support Operations', 6),
  ('31000000-0000-4000-8000-000009000007', '30000000-0000-4000-8000-000000000009', 'tooling-and-automation', 'Tooling & Automation', 7),
  ('31000000-0000-4000-8000-000010000001', '30000000-0000-4000-8000-000000000010', 'hiring-and-recruiting', 'Hiring & Recruiting', 1),
  ('31000000-0000-4000-8000-000010000002', '30000000-0000-4000-8000-000000000010', 'org-design', 'Org Design', 2),
  ('31000000-0000-4000-8000-000010000003', '30000000-0000-4000-8000-000000000010', 'performance-and-compensation', 'Performance & Compensation', 3),
  ('31000000-0000-4000-8000-000010000004', '30000000-0000-4000-8000-000000000010', 'learning-and-development', 'Learning & Development', 4),
  ('31000000-0000-4000-8000-000010000005', '30000000-0000-4000-8000-000000000010', 'culture-and-engagement', 'Culture & Engagement', 5),
  ('31000000-0000-4000-8000-000010000006', '30000000-0000-4000-8000-000000000010', 'remote-and-distributed-teams', 'Remote & Distributed Teams', 6),
  ('31000000-0000-4000-8000-000010000007', '30000000-0000-4000-8000-000000000010', 'founder-and-exec-coaching', 'Founder & Exec Coaching', 7),
  ('31000000-0000-4000-8000-000011000001', '30000000-0000-4000-8000-000000000011', 'fintech', 'Fintech', 1),
  ('31000000-0000-4000-8000-000011000002', '30000000-0000-4000-8000-000000000011', 'healthtech', 'Healthtech', 2),
  ('31000000-0000-4000-8000-000011000003', '30000000-0000-4000-8000-000000000011', 'edtech', 'Edtech', 3),
  ('31000000-0000-4000-8000-000011000004', '30000000-0000-4000-8000-000000000011', 'ecommerce-and-retail', 'E-commerce & Retail', 4),
  ('31000000-0000-4000-8000-000011000005', '30000000-0000-4000-8000-000000000011', 'b2b-saas', 'B2B SaaS', 5),
  ('31000000-0000-4000-8000-000011000006', '30000000-0000-4000-8000-000000000011', 'marketplaces', 'Marketplaces', 6),
  ('31000000-0000-4000-8000-000011000007', '30000000-0000-4000-8000-000000000011', 'climate-and-energy', 'Climate & Energy', 7),
  ('31000000-0000-4000-8000-000011000008', '30000000-0000-4000-8000-000000000011', 'public-sector', 'Public Sector', 8),
  ('31000000-0000-4000-8000-000011000009', '30000000-0000-4000-8000-000000000011', 'gaming-and-media', 'Gaming & Media', 9)
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  position = EXCLUDED.position,
  is_active = true;
