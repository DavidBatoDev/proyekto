-- Built-in roadmap templates: a cover photo that matches the work.
--
-- All 300 built-in templates carry one identical placeholder: a base64 SVG of
-- an orange-to-pink gradient with a white "P". It was built once in
-- 20260714101000_seed_builtin_roadmap_templates.sql and every batch since has
-- copied that exact row's value forward, so the library has 300 covers and one
-- picture. It says nothing about the roadmap, and
-- `instantiate_roadmap_public_template` copies preview_url straight into
-- `roadmaps.preview_url`, so the placeholder follows every roadmap a member
-- creates from a template.
--
-- The curated stock library already exists and needs nothing new: 16 themed
-- pools of 16 JPEGs each, in the proyekto-media R2 bucket, served from
-- cdn.proyekto.tech and addressed by web/src/data/stockPhotoManifest.ts (the
-- generated manifest is the source of truth for both the base URL and the pool
-- size below). This points each template at one of them.
--
-- Alignment is by CATEGORY, not by title. web/src/lib/stockPhoto.ts has to do
-- fuzzy keyword scoring because the categories it sees are invented by the AI
-- metadata generator; these 20 are a closed, curated set, and every title
-- inside one is coherent with it — the whole cybersecurity shelf is security
-- work, the whole ux-ui-design shelf is design work. A hand-written map is both
-- more accurate and easier to argue with than a score.
--
-- Within a pool the photos are dealt round-robin over (category, slug), so no
-- two templates on the same category page share a cover, and the three
-- categories that share the `saas` pool start at different points in it.
--
-- Only untouched built-ins are rewritten: the guard is `origin = 'builtin'` and
-- a preview that is still a data URI, so a consultant's own cover is never
-- overwritten and re-running this is a no-op.

DO $$
DECLARE
  -- Mirrors STOCK_PHOTO_BASE_URL and the pool length in
  -- web/src/data/stockPhotoManifest.ts. Objects are stock/<theme>/NN.jpg,
  -- zero-padded, 01 through 16.
  v_base      constant text := 'https://cdn.proyekto.tech/stock';
  v_pool_size constant int  := 16;
  v_updated   int;
BEGIN
  WITH theme_map(category_slug, theme) AS (VALUES
    ('ai-machine-learning',    'ai-ml'),
    ('cloud-infrastructure',   'devops-cloud'),
    ('cybersecurity',          'security'),
    ('data-engineering',       'data-analytics'),
    ('devops',                 'devops-cloud'),
    ('e-commerce',             'e-commerce'),
    ('education',              'education'),
    ('finance',                'finance'),
    ('healthcare',             'health-fitness'),
    -- People work: the team-collaboration pool is hiring, onboarding, meetings.
    ('human-resources',        'team-collaboration'),
    ('marketing',              'marketing'),
    ('mobile-app-development', 'mobile-app'),
    ('operations',             'operations'),
    -- Product, SaaS and startup all live on the same shelf of product/launch
    -- imagery; the round-robin below keeps their 45 templates from repeating.
    ('product-management',     'saas'),
    -- Research is analysis and insight, which is what the data-analytics pool
    -- shows — closer than the classroom photos in `education`.
    ('research',               'data-analytics'),
    ('saas',                   'saas'),
    -- Sales is pipeline and outreach: the marketing pool, not the finance one.
    ('sales',                  'marketing'),
    ('startup-launch',         'saas'),
    ('ux-ui-design',           'design'),
    ('web-development',        'web-development')
  ),
  assigned AS (
    SELECT
      t.id,
      -- `generic` is the manifest's required fallback pool. No category needs
      -- it today; it is here so a 21st category gets a photo rather than an
      -- exception.
      COALESCE(m.theme, 'generic') AS theme,
      ((row_number() OVER (
          PARTITION BY COALESCE(m.theme, 'generic')
          ORDER BY c.slug, t.slug
        ) - 1) % v_pool_size) + 1 AS photo_no
    FROM public.roadmap_public_templates t
    JOIN public.roadmap_template_categories c ON c.id = t.category_id
    LEFT JOIN theme_map m ON m.category_slug = c.slug
    WHERE t.origin = 'builtin'
      AND t.preview_url LIKE 'data:%'
  )
  UPDATE public.roadmap_public_templates t
  SET preview_url =
        v_base || '/' || a.theme || '/' || lpad(a.photo_no::text, 2, '0') || '.jpg'
  FROM assigned a
  WHERE a.id = t.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Stock photo covers set on % built-in roadmap templates', v_updated;
END $$;
