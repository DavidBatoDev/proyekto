-- A ceiling on teams.description, now that it holds rich text.
--
-- Until the Overview tab, the only cap on this column was @Length(0, 500) on
-- UpdateTeamDto. Raising that cap so the field can hold a formatted blurb makes
-- an unbounded `text` column reachable by any authenticated owner or admin, so
-- the ceiling belongs in the database too rather than in one DTO that a future
-- edit could quietly widen.
--
-- 8000 matches this repo's only other rich-text HTML cap
-- (ServiceDescriptionSectionDto.body, backend/.../service-offerings.dto.ts).
-- HTML carries roughly two to three times its visible text in markup, so that
-- is ~600-900 words of formatted prose: a team blurb, not a wiki page.
--
-- No backfill: the longest description in production is 91 characters.

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_description_length;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_description_length
  CHECK (description IS NULL OR char_length(description) <= 8000);

COMMENT ON COLUMN public.teams.description IS
  'Team blurb shown on the Overview tab and the team cards. Sanitised rich-text HTML for anything written from 2026-09-01; plain text for older rows, which are not rewritten - the renderer picks per value via looksLikeHtml(). Max 8000 chars.';
