-- Configurable payout cut-offs per team.
--
-- Until now the "cutoff" period was hardcoded in the web client to the
-- Philippine semi-monthly split (1–15 / 16–EOM) with no pay dates and no
-- per-team configuration. Teams actually run custom cut-offs with their own
-- pay dates (e.g. 1–15 paid on the 22nd; 16–EOM paid on the 7th of the next
-- month). Store that configuration on the team so the client can resolve a
-- "Current cut-off" period and show its scheduled pay date.
--
-- Shape (validated in the backend TeamsService, not by a CHECK so it can
-- evolve without a migration):
--   {
--     "cadence": "monthly",
--     "periods": [
--       { "id": "h1", "label": "1st half", "start_day": 1,  "end_day": 15,
--         "pay_day": 22, "pay_month_offset": 0 },
--       { "id": "h2", "label": "2nd half", "start_day": 16, "end_day": "EOM",
--         "pay_day": 7,  "pay_month_offset": 1 }
--     ]
--   }
--
-- NULL means "use the client default" (the semi-monthly example above), so
-- existing teams keep working with no backfill.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS pay_period_config jsonb;

COMMENT ON COLUMN public.teams.pay_period_config IS
  'Per-team payout cut-off schedule (cadence + periods with pay dates). NULL = client default semi-monthly. Shape validated in TeamsService.';
