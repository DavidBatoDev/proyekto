-- Reduce the marketplace taxonomy from 11 top-level categories to 7.
--
-- Eleven entries overflowed the category strip - the last one rendered as a
-- clipped "Pe" - and a nav the user cannot read in one pass is not a nav. The
-- cut is by merging, not deleting: all 75 discipline sub-categories keep their
-- rows, their slugs and their memberships, and only change parent.
--
--   Growth & Marketing + Sales & Revenue                 -> Growth & Sales
--   Finance & Fundraising + Operations & Delivery
--                         + People & Organisation        -> Business Operations
--
-- Industry Practices is retired outright, along with its 9 entries. It is the
-- only category on a different axis - Fintech and Healthtech are sectors, not
-- disciplines - so every one of its members also belongs under a discipline,
-- and there is no honest discipline to re-parent a sector into. The taxonomy's
-- own design note said industries were deliberately not top-level; this makes
-- that true. They come back as a separate industry facet when there is one.
--
-- Nothing is hard-deleted. Retired rows are flagged `is_active = false`, which
-- every read path already filters on, so `consultant_subcategories` keeps its
-- foreign keys and a reversal is an UPDATE rather than a re-seed.
--
-- Naturally idempotent: every statement keys off a slug or parent that no
-- longer matches once the migration has run, so a second run is a no-op. In
-- particular the `position` shifts cannot double-apply, because the rows they
-- target have already left the category being read.

begin;

-- ---------------------------------------------------------------- Growth & Sales
-- Sales sits after Growth's existing 8, so the merged panel reads
-- growth-first rather than interleaved.
update public.marketplace_subcategories
set
  category_id = (
    select id from public.marketplace_categories where slug = 'growth-and-marketing'
  ),
  position = position + 8,
  updated_at = now()
where category_id = (
  select id from public.marketplace_categories where slug = 'sales-and-revenue'
);

update public.marketplace_categories
set
  slug = 'growth-and-sales',
  name = 'Growth & Sales',
  description = 'Demand, pipeline, and the revenue that follows',
  updated_at = now()
where slug = 'growth-and-marketing';

update public.marketplace_categories
set is_active = false, updated_at = now()
where slug = 'sales-and-revenue';

-- ----------------------------------------------------------- Business Operations
-- Finance keeps 1-7, Operations takes 8-14, People takes 15-21.
update public.marketplace_subcategories
set
  category_id = (
    select id from public.marketplace_categories where slug = 'finance-and-fundraising'
  ),
  position = position + 7,
  updated_at = now()
where category_id = (
  select id from public.marketplace_categories where slug = 'operations-and-delivery'
);

update public.marketplace_subcategories
set
  category_id = (
    select id from public.marketplace_categories where slug = 'finance-and-fundraising'
  ),
  position = position + 14,
  updated_at = now()
where category_id = (
  select id from public.marketplace_categories where slug = 'people-and-organisation'
);

update public.marketplace_categories
set
  slug = 'business-operations',
  name = 'Business Operations',
  description = 'Money, process, and the people who run them',
  updated_at = now()
where slug = 'finance-and-fundraising';

update public.marketplace_categories
set is_active = false, updated_at = now()
where slug in ('operations-and-delivery', 'people-and-organisation');

-- ------------------------------------------------------------ Industry Practices
update public.marketplace_subcategories
set is_active = false, updated_at = now()
where category_id = (
  select id from public.marketplace_categories where slug = 'industry-practices'
);

update public.marketplace_categories
set is_active = false, updated_at = now()
where slug = 'industry-practices';

-- ------------------------------------------------------------------- Ordering
-- Explicit rather than derived, because the strip's reading order is an
-- editorial decision: what a visitor is most likely to be shopping for first.
update public.marketplace_categories as c
set position = v.position, updated_at = now()
from (
  values
    ('product-and-strategy', 1),
    ('software-engineering', 2),
    ('ai-and-data', 3),
    ('cloud-devops-and-security', 4),
    ('design-and-brand', 5),
    ('growth-and-sales', 6),
    ('business-operations', 7)
) as v (slug, position)
where c.slug = v.slug;

commit;
