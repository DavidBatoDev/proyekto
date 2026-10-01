-- Migration: 20261001110000_team_trading_names.sql
-- Date: October 1, 2026
-- Description:
--   Trading names (aliases) on `teams`. A team often appears on paper under a
--   name that is neither its display name nor its registered legal name:
--   "PRODIGITALITY" on invoices issued by team "JC Studio". Document intake
--   matches the importer's side of each document against the importer's own
--   names; listing trading names here lets it recognise the team instead of
--   warning that the paper names someone else.
--
--   Additive only. text[] NOT NULL DEFAULT '{}' follows teams.tags
--   (20260818100000): per-team freeform values, never joined or referenced by
--   FK. PG 11+ applies a constant default without a table rewrite.
--
--   Owner-only on write (enforced in the API with the billing identity
--   fields), normalized on write: trimmed, whitespace-collapsed,
--   case-insensitively deduped, max 10 names of 120 chars.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS trading_names text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_trading_names_count_check'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_trading_names_count_check
      CHECK (cardinality(trading_names) <= 10);
  END IF;
END
$$;

COMMENT ON COLUMN public.teams.trading_names IS
  'Other names the team trades under (e.g. "PRODIGITALITY" for JC Studio). Document intake treats any of them as the team. Owner-only on write; normalized by the API: trimmed, deduped case-insensitively, max 10 names of 120 chars.';

-- RLS: nothing new. The `teams` policies are column-agnostic, so the column
-- inherits them; direct writes to teams are already API-only for the
-- columns that matter (20260922130000).
