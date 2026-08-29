-- Service "About this service" becomes section-based, markdown-bodied.
--
-- Sellers write several titled sections ("My skills", "Why me", "What you
-- get") rather than one flat blob. A jsonb array holds them in display order,
-- each in one of two layouts:
--   prose:   { "layout": "prose", "heading": "...", "body": "<markdown>" }
--   columns: { "layout": "columns", "heading": "...",
--              "columns": [{ "label": "...", "body": "..." }] }  -- max 3
-- A section with no layout is prose, so nothing has to rewrite old rows.
--
-- `description` stays: it is the plain-text blurb that catalog cards, the
-- consultant profile strip and the contract snapshot read, and the backend
-- keeps it derived from the first section on write. Nothing that reads it
-- today has to learn about sections.

alter table public.service_offerings
  add column if not exists description_sections jsonb not null default '[]'::jsonb;

-- Shape guard. The DTO validates heading/body lengths per element; this
-- keeps the column from ever holding a non-array or an unbounded list even
-- if something writes around the API.
alter table public.service_offerings
  drop constraint if exists service_offerings_description_sections_shape;

alter table public.service_offerings
  add constraint service_offerings_description_sections_shape
  check (
    jsonb_typeof(description_sections) = 'array'
    and jsonb_array_length(description_sections) <= 12
  );

-- Backfill: an existing description becomes one section, so no seller loses
-- copy and every published page keeps rendering the same words.
update public.service_offerings
set description_sections = jsonb_build_array(
  jsonb_build_object('heading', 'About this service', 'body', description)
)
where description is not null
  and length(btrim(description)) > 0
  and description_sections = '[]'::jsonb;

comment on column public.service_offerings.description_sections is
  'Ordered sections. layout "prose" => {heading?, body} with markdown body; layout "columns" => {heading?, columns:[{label, body}]} (max 3). Missing layout means prose. description mirrors section 1 as plain text for cards and contract snapshots.';
