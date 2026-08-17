-- Fold the persona values out of project_access.origin.
--
-- A project is the execution layer: it has MEMBERS with a permissions catalog.
-- It does not have "a client" and "a consultant" — those are positions on a
-- contract, and they live in marketplace/contracts. `origin` was carrying that
-- assumption in the execution layer's own access table, where four things read
-- it as a role: permission deltas (ORIGIN_DELTAS), a private-channel bypass in
-- chat, the finance project scope, and a "who is the consultant of record"
-- lookup. All four are gone; this retires the data behind them.
--
-- `origin` is provenance — HOW somebody joined — not what they can do. That is
-- `role` plus `capabilities`, and it always was: as of the ORIGIN_DELTAS removal
-- nothing in permission resolution reads this column at all.
--
-- Inert beyond the relabel, verified against the live catalog before writing:
--   * no RLS policy, view, function or trigger reads project_access.origin
--     (provision_personal_workspace writes 'personal_workspace' only, and
--     tg_engagements_guard reads engagements.origin — a different table)
--   * no CHECK constraint and no index on the column
--   * the old three-column unique key was collapsed to (project_id, user_id)
--     in 20260507000130, so origin is not part of any uniqueness
--   * team ordering keys off `origin LIKE 'team:%'` (20260507000110), which
--     'direct' satisfies exactly as 'client'/'consultant' did
--
-- 'direct' is already this codebase's word for a non-team, non-invited grant —
-- revoke's audit metadata has defaulted to `origin ?? 'direct'` all along.
--
-- Affects 23 rows: 17 consultant + 6 client. Effective permissions are
-- unchanged for every one of them; effective-permissions.spec.ts snapshots all
-- eight production role/capability tuples and proves it.

BEGIN;

UPDATE public.project_access
SET origin = 'direct'
WHERE origin IN ('client', 'consultant');

COMMENT ON COLUMN public.project_access.origin IS
  'Provenance of the grant — how the member joined, never what they can do (that is role + capabilities, which no longer consult this column). Values: ''direct'' | ''invited'' | ''personal_workspace'' | ''legacy'' | ''team:<team_id>''. The former ''client'' and ''consultant'' values were folded into ''direct'' on 2026-08-18: they named contract positions, which the execution layer does not model.';

COMMIT;
