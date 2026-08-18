-- Migration: 20260818100000_team_tags.sql
-- Date: August 18, 2026
-- Description:
--   Freeform descriptive labels on `teams`. The welcome deck now asks every new
--   user to name a team, and the labels attached at that moment (cohort,
--   source, intent) need somewhere to live that is neither another table nor a
--   jsonb blob.
--
--   These are LABELS in the exact sense `project_access.origin` is a label
--   (20260818090000): descriptive annotation that takes no part in permission
--   resolution. Nothing may ever gate a capability on a tag.
--
--   text[] rather than a tags catalog + join table because the values are
--   freeform, per-team, never joined across teams and never referenced by FK -
--   the same call made for roadmap_epics.tags (20260111000001) and
--   roadmap_tasks.labels. GIN keeps `tags @> '{...}'` filtering cheap if a
--   listing surface ever wants it.
--
--   NOT NULL DEFAULT '{}' - roadmap_epics.tags is nullable and that was a
--   mistake worth not repeating, since every reader then has to distinguish
--   NULL from empty. PG 11+ applies a non-volatile default without rewriting
--   the table, so this is safe on a live `teams`.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Cardinality backstop only. Per-tag length is enforced in the API
-- (TEAM_TAG_MAX_LENGTH in backend/src/modules/execution/teams/team-tags.ts):
-- a CHECK constraint needs an IMMUTABLE expression, and there is no immutable
-- per-element aggregate over an array without a subquery, which CHECK forbids.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_tags_count_check'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_tags_count_check CHECK (cardinality(tags) <= 20);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_teams_tags ON public.teams USING GIN (tags);

COMMENT ON COLUMN public.teams.tags IS
  'Freeform descriptive labels on the team (onboarding cohort, source, intent). Normalized on write by the API: trimmed, whitespace-collapsed, case-insensitively deduped, max 20 tags of 40 chars. Descriptive only - takes no part in authorization, exactly like project_access.origin.';

-- RLS: nothing new. The `teams` policies (20260507000010) are column-agnostic,
-- so the new column inherits them. `is_personal` is untouched here, so the
-- partial unique index teams_one_personal_per_owner (20260507000040) and the
-- vetting-time provisionPersonalTeam path are unaffected.
