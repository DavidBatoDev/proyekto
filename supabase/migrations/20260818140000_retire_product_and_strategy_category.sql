-- Retire the Product & Strategy category and its eight specialities.
--
-- It was the broadest entry in the taxonomy and the least specific: Product
-- Discovery, Roadmapping, Product-Market Fit, MVP Scoping and Zero-to-One
-- Launch describe a stage of building a company rather than a discipline a
-- client hires for, and each of them is really the opening phase of work that
-- lands in one of the remaining six categories. A nav entry that overlaps every
-- other entry costs a slot without narrowing anything.
--
-- Same mechanism as the Industry Practices retirement: `is_active = false`
-- rather than a delete, so `consultant_subcategories` keeps its foreign keys
-- and reversing this is an UPDATE, not a re-seed. Zero memberships exist on any
-- of the eight, so nobody's expertise is dropped.
--
-- The parent URL is NOT redirected. There is no merged destination - this is a
-- retirement, not a merge - and forwarding it to an unrelated discipline would
-- be a worse answer than the not-found page. `industry-practices` is absent
-- from that map for the same reason.
--
-- Idempotent: the second run finds `is_active` already false and the position
-- values already assigned, so it changes nothing.

begin;

update public.marketplace_subcategories
set is_active = false, updated_at = now()
where category_id = (
  select id from public.marketplace_categories where slug = 'product-and-strategy'
);

update public.marketplace_categories
set is_active = false, updated_at = now()
where slug = 'product-and-strategy';

-- Close the gap left at position 1 rather than leaving the strip numbered from
-- two. Explicit values, because the reading order is an editorial decision.
update public.marketplace_categories as c
set position = v.position, updated_at = now()
from (
  values
    ('software-engineering', 1),
    ('ai-and-data', 2),
    ('cloud-devops-and-security', 3),
    ('design-and-brand', 4),
    ('growth-and-sales', 5),
    ('business-operations', 6)
) as v (slug, position)
where c.slug = v.slug;

commit;
