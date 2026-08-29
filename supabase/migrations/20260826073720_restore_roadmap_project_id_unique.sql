-- Restore a uniqueness guarantee for roadmaps.project_id.
--
-- 20260111000001_create_roadmap_canvas_schema.sql originally had
-- project_id UUID UNIQUE NOT NULL. 20260210000001_make_project_id_optional.sql
-- made the column nullable (to allow unlinked guest/draft roadmaps) and, in the
-- process, dropped the UNIQUE constraint entirely, replacing it with only a
-- non-unique partial index. Nothing since restored uniqueness for linked rows,
-- so a project could in principle end up with more than one roadmap pointing
-- at it. This migration closes that gap with a partial unique index, which
-- (unlike a plain UNIQUE column) still allows multiple NULL project_id rows
-- for unlinked drafts.

-- Resolve any existing duplicates first: keep each project's most recently
-- updated roadmap linked, and unlink the rest (they become drafts rather than
-- being deleted).
with ranked as (
  select id, project_id,
         row_number() over (partition by project_id order by updated_at desc) as rn
  from roadmaps
  where project_id is not null
)
update roadmaps
set project_id = null
where id in (select id from ranked where rn > 1);

drop index if exists idx_roadmaps_project_id; -- superseded by the unique index below

create unique index if not exists uq_roadmaps_project_id_linked
  on roadmaps (project_id)
  where project_id is not null;
