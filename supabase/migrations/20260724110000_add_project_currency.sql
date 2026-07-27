-- Migration: 20260724110000_add_project_currency.sql
-- Date: July 24, 2026
-- Description:
--   Gives a project its own currency. Until now currency lived only on the
--   team, the member rate, and each frozen time-log snapshot, so a consultant
--   could not say "this project bills in PHP" and have new rates, contracts,
--   and invoices pick it up.
--
--   This is a DEFAULT + DISPLAY currency, NOT a conversion. Existing
--   task_time_logs.currency_snapshot values are immutable and untouched — the
--   same relabel-not-convert stance as the 2026-07-02 team_default_currency
--   backfill. No CHECK constraint: contracts.currency and
--   team_member_rates.currency are already unconstrained, and the UI governs
--   the allowed set via a shared constant.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN public.projects.currency IS
  'Default currency for new member rates, contracts, and invoices on this project, and the display fallback in project-scoped views. Does not convert existing frozen amounts.';
