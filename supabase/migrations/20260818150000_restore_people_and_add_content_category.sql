-- Take the taxonomy from six top-level categories to eight.
--
-- Two additions, one restored and one new:
--
--   People & Organisation  - un-merged back out of Business Operations. The
--     merge left that panel holding 21 specialities against 7-8 everywhere
--     else, which reads as a wall of links rather than a menu. Hiring, org
--     design and coaching are also a different thing to buy than bookkeeping
--     and supply chain, so the split is honest rather than cosmetic. Its seven
--     rows move back with their slugs intact, so no URL changes and no
--     membership is touched.
--
--   Content & Writing      - genuinely uncovered. The only writing anywhere in
--     the taxonomy is "SEO & Content" under Growth & Sales, which is a
--     marketing channel; technical writing, documentation and localisation are
--     none of those and had nowhere to sit.
--
-- Business Operations drops to 14, which is still the largest but no longer an
-- outlier.
--
-- Idempotent: the category insert is `on conflict (slug) do nothing`, the
-- sub-category insert is `on conflict (category_id, slug) do nothing`, and the
-- re-parenting keys off the seven slugs so a second run finds them already
-- moved.

begin;

-- --------------------------------------------------- People & Organisation
update public.marketplace_categories
set is_active = true, updated_at = now()
where slug = 'people-and-organisation';

update public.marketplace_subcategories as s
set
  category_id = (
    select id from public.marketplace_categories where slug = 'people-and-organisation'
  ),
  position = v.position,
  updated_at = now()
from (
  values
    ('hiring-and-recruiting', 1),
    ('org-design', 2),
    ('performance-and-compensation', 3),
    ('learning-and-development', 4),
    ('culture-and-engagement', 5),
    ('remote-and-distributed-teams', 6),
    ('founder-and-exec-coaching', 7)
) as v (slug, position)
where s.slug = v.slug
  and s.category_id = (
    select id from public.marketplace_categories where slug = 'business-operations'
  );

update public.marketplace_categories
set description = 'Money, process, and the systems that run them', updated_at = now()
where slug = 'business-operations';

-- ------------------------------------------------------- Content & Writing
insert into public.marketplace_categories (slug, name, description, icon, position, is_active)
values (
  'content-and-writing',
  'Content & Writing',
  'Documentation, technical writing, and the words in the product',
  'PenLine',
  5,
  true
)
on conflict (slug) do nothing;

insert into public.marketplace_subcategories (category_id, slug, name, description, position, is_active)
select
  c.id,
  v.slug,
  v.name,
  v.description,
  v.position,
  true
from public.marketplace_categories as c
cross join (
  values
    ('technical-writing', 'Technical Writing', 'API references, guides, and developer docs', 1),
    ('documentation-systems', 'Documentation Systems', 'Knowledge bases, docs tooling, and information architecture', 2),
    ('content-strategy', 'Content Strategy', 'What to publish, for whom, and why', 3),
    ('ux-writing', 'UX Writing', 'Product copy, empty states, and error messages', 4),
    ('editing-and-style', 'Editing & Style Guides', 'Editorial standards and voice across a product', 5),
    ('localisation-and-translation', 'Localisation & Translation', 'Adapting a product for another language and market', 6)
) as v (slug, name, description, position)
where c.slug = 'content-and-writing'
on conflict (category_id, slug) do nothing;

-- ------------------------------------------------------------------ Ordering
update public.marketplace_categories as c
set position = v.position, updated_at = now()
from (
  values
    ('software-engineering', 1),
    ('ai-and-data', 2),
    ('cloud-devops-and-security', 3),
    ('design-and-brand', 4),
    ('content-and-writing', 5),
    ('growth-and-sales', 6),
    ('people-and-organisation', 7),
    ('business-operations', 8)
) as v (slug, position)
where c.slug = v.slug;

commit;
