-- Migration: 20260508000020_teams_time_tracking_enabled.sql
--
-- Purpose:
--   Per-team feature flag for time tracking. Off by default — a team
--   only becomes a time-tracking team once the owner explicitly enables
--   it under settings. Enabling is gated at the API layer on
--   `profiles.is_consultant_verified` for the team owner; the column
--   itself is just a flag, the gate lives in the service.
--
--   When this flag is false, all /api/team-time/* endpoints reject with
--   a "time tracking not enabled" error, and the team's /time and
--   /rates pages render an explainer + a link back to settings.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS time_tracking_enabled boolean NOT NULL DEFAULT false;
