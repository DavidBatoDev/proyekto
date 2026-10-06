# Migrations and Rollout

> **⚠️ Partly built.** M0 and M1 are on dev and prod, PR-0 is deployed, backend PR-1 and the web PR are built and held unmerged, and M2/M3 are applied to dev only (prod waits for the go/no-go). See [Rollout Status](#rollout-status).

> **Last updated:** 2026-10-06 · **Status:** draft

The rebuild lands as six migrations (M0–M5) and three code pushes, ordered so the running backend never meets a schema it cannot use: expand → cutover → contract. M0/M1 only add, M2 groups legacy entries into timesheets, M3 renames tables behind compatibility views, and M5 removes the old shape once nothing uses it. There are **no feature flags** (the user's standing rule: new user-visible features ship on by default, overriding the "ship dark" wording in `CLAUDE.md`); safety comes from additive files, views, an API alias, invariant prechecks and gates. This page is the only home of the verification SQL.

Part of the [time management proposal](./README.md).

## Rollout Status

State on 2026-10-06:

| Step | State | Evidence |
|---|---|---|
| 0 PR-0 | **Deployed.** On `main` as `1fa64b7f` (heal returns `{scanned: 0, healed: 0}`) and `c7ebf4ba` (a second running timer maps to the existing 400 instead of a 500); `backend-deploy.yml` deploys every `main` push that touches `backend/**`. Safe before or after M1: prod has 0 team-less rows, and M1's context trigger re-derives a consistent team context if the old heal ever writes a `team_id` | Jest 6/6 for `team-time.service.spec.ts`, backend `tsc --noEmit` clean before the merge |
| 1 M0 | **Applied to dev and prod, 2026-10-02** (`time_plan_keys`) | 7 time keys at 120–126, the matrix matches the ladder, 28 keys and 112 rows on both; Prodigitality's workspace resolves `time_team_rules = true` |
| 2 M1 | **Applied to dev and prod, 2026-10-02** (`time_entries_expand`) | Dev passed first; prod then took the same bytes. Prod: 415 entries all `team` (`work_item` other 238 / task 177); `updated_at` fingerprint unchanged; RLS on and 0 `anon`/`authenticated` table, sequence or function grants; L1 = 0 (no curated Prodigitality member below editor); L1b 1 → 0 (D16 added 1 curation row, `project_access` unchanged at 166); Prodigitality sheets resolve to team scope. Dev: L1b 2 → 0, 12 personal and 32 team entries. Rolled-back smoke tests passed on both: review update, old-shape insert, stop, no-access refusal, second running timer refused, period maths, sheet creation, guard refusals, policy audit. `sync_supabase_dev.mjs check` still reports pre-existing drift unrelated to time (prod-only comment threading, `roadmap_notes`, `mobile_app_requirements`, template seed functions; dev-only `uq_invoices_replacement_source`); 0 diff lines touch any time object |
| 3 PR-1 | **Built and held, not merged.** Local branch `feat/time-pr1`, not pushed, one commit per work package, backend-only (no `web/**` path in any commit). Contents: `TimeModule` at `/api/time`, the `/api/team-time` alias, the `time_entries` rename sweep, and the invoice, payout, finance, project, team, account and engagement-assignment changes, plus two later TypeScript-only commits with what the web PR reads (`757c5f19` A1–A13, including the D79 links; `29fab794` A-4 review follow-ups, including D80). What differs from this proposal is recorded on each page ([backend](./backend.md#as-built-in-pr-1), [data model](./data-model.md#as-built-in-m2-and-m3), [edge cases](./edge-cases-and-tests.md#as-built-in-pr-1)). Shipped-docs updates for 00–12 ride the same branch as a separate docs-only commit | Unit suites, `tsc --noEmit` and eslint green after each wave; the full-suite run and module wiring are the integration step (G1) |
| 4 M2 + M3 | **Applied to dev 2026-10-06** (`time_timesheets_backfill`, `rename_time_entries`, via MCP `apply_migration`); **not on prod.** Both files stay untracked in `supabase/migrations/` until prod applies the same bytes: M2 md5 `fbfe9dd9…`, M3 md5 `3c5c99b2…` (re-assembled after `reset_qa_fixture` also clears the fixture's time notifications) | Dev dry run (M2+M3, `ROLLBACK`) clean, 97 smoke results as designed. After the apply: all 34 function bodies equal the files by `md5(prosrc)`; M2 block: 10 sheets (6 submitted, 4 approved), 0 misplaced, hours 64 + 343 = 407 = old; M3 block: 0 old names in bodies, 3 security-invoker views with equal counts, approval tables gone, 0 grants/ACL rows, internal helpers closed to `service_role`. Lock smokes, MD-15 (90/90, 0 PGRST200/201), alias smoke (515/0), flows smoke (147/0), P19 QA script (billing line skipped by the floor, D71), rollback rehearsal with the old backend (all pass), prod period parity (93/93, read-only), integration: every time suite green. `sync_supabase_dev.mjs check` not run (Docker was off); prod Group A bodies re-verified unchanged by md5 instead |
| 5–6 | Not started. Next: the user's [go/no-go](#pr-1-release-gates) for the prod M2+M3 apply (G7–G10), then the PR-1 merge | |
| 7 Web PR | **Built and held, not merged.** Local branch `feat/time-web` (worktree `prdigy-web`), based on `feat/time-pr1`, not pushed, one commit per work package, web-only (no `backend/**` path in any commit). Contents: the `/time` page and the timesheet review screen, workspace settings › Time, the team Time Report with Rates and Payouts, Project › Time (Everyone, Client hours) and Who can log, the timer surfaces on `/api/time`, the `["time", …]` data layer, the mobile classification (`/time` app, team money pages `silent`), redirect stubs for every old team-time link, the plan ladder on pricing, usage and admin plans, and the help articles; `services/team-time.service.ts` and the replaced `components/team-time/*` are deleted. It also needed PR-1 additions A1–A13 and A-4 (TypeScript only, on `feat/time-pr1`). Deviations, decisions D79–D86 and the backlog: [UX › As Built in the Web PR](./ux.md#as-built-in-the-web-pr) | Per wave: the whole web suite (`npx vitest run`), `npm run check`, `tsc -p tsconfig.build.json --noEmit` and `npm run pw:audit:routes` green (after the page wave: 406 files and 4,533 tests, 0 tsc errors, 190 route paths); a final gate re-runs them after the cleanup wave. The dev Playwright persona runs are the integration step |
| 8–11 | Not started | |

## Principles

| Rule | Detail |
|---|---|
| Apply path | **Dev (`vyiedlwasdwmjbztqznl`) first, then prod (`byvbnkpiselvvulsvxgo`)**, via Supabase MCP `apply_migration`, **same name**. Never `supabase db push`; never `sync_supabase_dev.mjs apply` (its `db push --include-all`, `:354-368`, would re-run them because MCP stamps its own version). Compare `list_migrations` **by name**. |
| After each pair | The step's [verification block](#verification-sql) on both databases, then `node scripts/sync_supabase_dev.mjs check` (it diffs only `public`, hence the M1 `btree_gist` query). |
| Every file | Opens with `SET LOCAL lock_timeout = '5s';` (retry on timeout) and a precheck `DO` block asserting **invariants, never counts** (dev has 44 rows, prod 414+); ends with `NOTIFY pgrst, 'reload schema';`; carries a commented `ROLLBACK (manual)` block. |
| Commit timing | Commit only after **both** databases applied it (the hook blocks edits to tracked migrations; committed bytes = applied bytes). M0–M3 ride the PR-1 branch to `main` at step 6, keeping `entitlement-keys.migration-parity.spec.ts` green. M4/M5 are supabase-only commits; no workflow watches `supabase/**`. |
| Function rebuilds | From the newest defining body (/db-migration skill; sources in the [renames table](./data-model.md)). |
| Deploy rule | No commit or push touches `backend/**` and `web/**` together (L5); `backend-deploy.yml`, `web-deploy.yml`, `mobile-ota-deploy.yml` deploy on push to `main` by path. |

## Apply and Deploy Sequence

CHANGE-13. Backend PR-1 stays unmerged until M2 and M3 are on both databases.

| Step | Action | Where | Old backend | Gate to proceed |
|---|---|---|---|---|
| 0 | Pause the `heal-orphaned-logs` Cloud Scheduler job in the GCP console, if it exists (unverified: the repo defines the endpoint but no Scheduler job for it). Merge **backend PR-0**: the handler returns `{scanned: 0, healed: 0}` (the old `{scanned, healed}` shape with zeros; the alias keeps it, D02). Backend-only push, so it deploys. **Done.** | GCP + `main` | works | New revision serves 100%; `POST …/cron/heal-orphaned-logs` returns `{scanned: 0, healed: 0}` |
| 1 | **M0** `20261003090000_time_plan_keys.sql` | dev → verify → prod → verify | works (`time_tracking` keeps its kind and values) | M0 block green |
| 2 | **M1** `20261003090100_time_entries_expand.sql` | dev → verify (incl. old-shape smoke) → prod → verify | works | M1 block green; L1 and L1b counts recorded |
| 3 | **Backend PR-1** built and **held unmerged**: `/api/time`, the alias, new names, `!column` embed hints. **Built** on `feat/time-pr1`. | branch | — | Unit suites green; G1 |
| 4 | **M2** `20261003100000_time_timesheets_backfill.sql`, then **M3** `20261003110000_rename_time_entries.sql`; then the dev verification: M2/M3 blocks, the post-apply `md5(prosrc)` check, MD-15, PR-1 run locally against dev (integration suites, HTTP smoke incl. all 30 alias routes, the rewritten QA script), and the rollback rehearsal. While dev is ahead of prod, never run `sync_supabase_dev.mjs mirror` (it would rebuild dev from prod and erase M2/M3) | dev | works (degraded per [Rollback](#rollback-per-step)) | G2–G6 of the [go/no-go](#pr-1-release-gates); `sync … check` shows only M2/M3 objects as new |
| 5 | **M2** then **M3**, by the user | prod, back to back (low-traffic window, Manila night) | works through the views | G7–G8; M2 and M3 blocks green |
| 6 | **Merge PR-1**: backend-only push, auto-deploys to Cloud Run `proyekto-backend` (asia-southeast1). Commit both migration files first (bytes identical to what was applied; compare `list_migrations` by name) | `main` | replaced | `GET /api/time/me/overview` 200 on the new revision; one alias call (`GET /api/team-time/...`) 200; the B4 spot-check `SELECT count(*) FROM time_entries WHERE status='approved' AND payable_seconds IS NULL AND legacy_status IS NULL`; `time_legacy_backfill(true)` dry run. **`production-qa.yml` is not a gate here** (D53): prod `qa_fixtures` has 0 rows, so its `reset` fails until prod is seeded with `npm run qa:seed:production` |
| 7 | **Merge the web PR** (separate push). It triggers `web-deploy.yml` and `mobile-ota-deploy.yml` together (see below). **Built** and held on `feat/time-web`. | `main` | — | Web smoke on `/time`; the OTA bundle is listed |
| 8 | **M4** `20261003120000_time_timesheets_reconcile.sql` | dev → prod | — | M4 block green |
| 9 | Cloud Scheduler job for `POST /api/time/cron/run` (reminders, auto-submit, 24 h stop) | GCP | — | First run logs OK |
| 10 | **M5** `20261010090000_time_entries_contract.sql` | dev → prod | **breaks**; the rollback window closes | The [M5 gate](#gate-for-m5-l19) |
| 11 | Retire the `/api/team-time` alias: a stub returns 410 `APP_UPDATE_REQUIRED` (code only) | `main` | — | The [alias gate](#gate-for-alias-retirement-l18) |

**Step 7 and the OTA.** The `web/**` push triggers `web-deploy.yml` and `mobile-ota-deploy.yml` together (`mobile-ota-deploy.yml:25-29`). With `OTA_PUBLISH_ENABLED` set, the OTA publishes in that run; do not also dispatch (duplicate bundle). Dispatch only to republish with a non-default `native_build_min`. If the variable is unset, neither path publishes (`:51` gates both), every shell stays on the alias, and the L18 gate cannot pass until OTA is enabled or a native release ships.

```mermaid
flowchart LR
  S0[0 heal no-op PR-0] --> M0[1 M0 keys] --> M1[2 M1 expand] --> PR1[3 PR-1 held]
  PR1 --> D4[4 dev: M2+M3, embeds, sync check] --> P5[5 prod: M2+M3]
  P5 --> B6[6 merge PR-1: backend deploy + smoke] --> W7[7 web push: deploy + OTA]
  W7 --> M4[8 M4 reconcile + digest] --> C9[9 cron job] --> M5[10 M5 after L19 gate] --> A11[11 alias 410 after L18 gate]
```

### PR-1 Release Gates

Every gate must hold before the prod apply; any "no" stops the rollout. Agents run G1–G6 against dev only (every write-capable call names the dev project id); G7–G10 are the user's.

| # | Gate | Pass |
|---|---|---|
| G1 | Unit + full jest, `tsc --noEmit`, eslint on the changed files | green |
| G2 | Dev M2/M3 verification blocks, prosrc scan, ACL queries, post-apply `md5(prosrc)` check of the 34 functions M2/M3 create or rebuild (generated from the file bodies) | as expected; prosrc, ACL and md5 checks 0 rows |
| G3 | MD-15 embed check: every old-backend select through the views, plus every new `ENTRY_*`, comment, segment and timesheet select against the new tables | 0 `PGRST200`/`PGRST201` |
| G4 | Integration suites on dev; period parity on dev (spec) and prod (one read-only MCP `SELECT` over the fixture cases, never prod credentials in a shell) | green |
| G5 | HTTP smoke on dev: all 30 alias routes with both `Origin` values, the new routes, and the rewritten `backend/scripts/verify-production-qa.ts` (`QA_TARGET=development`). Dev's `billing-v1` QA fixture currently lacks its contract row, so `reset_qa_fixture` raises `QA_FIXTURE_CORE_INVALID` until the dev fixture is re-seeded; during the first period after the dev M2 apply the invoice-hours assertion may run with `QA_ALLOW_BILLING_FLOOR_SKIP=1` (D71) | green |
| G6 | Rollback rehearsal: the old backend (worktree of `91d227aa`) against dev | reads, current-week approve and stop/start work; locked edits fail with `TIME_ENTRY_LOCKED` |
| G7 | Prod pre-apply snapshot (read-only, apply day) | 0 running entries, class counts recomputed, L1 recorded |
| G8 | Readiness | previous Cloud Run revision id recorded with the `update-traffic` command ready; web PR approved and mergeable; Scheduler job for `/api/time/cron/run` **not** created yet (step 9); `OTA_PUBLISH_ENABLED` state known |
| G9 | Push preflight | `/deploy-preflight` (`cd backend && npm run build`); no `web/**` in the PR; no shared-contract change, so no `check:roadmap-ai-schema` or agent canary |
| G10 | Sequence | prod M2 then M3, each block verified; commit both files; merge PR-1; step-6 smoke; then the web PR |

No-go triggers: any MD-15 failure; prosrc or ACL rows; an L11 hours-parity mismatch after M2; M2 class counts that differ from the apply-day recomputation for reasons other than new entries; any alias row mismatch; a raw 500 anywhere in the smoke; a rollback rehearsal that cannot read.

## Migration Files

### M0 Plan Keys

`20261003090000_time_plan_keys.sql` (L53). Precheck: `time_tracking` exists and none of the 6 new keys exists with another `kind`. M0 precedes M1 because `time_resolve_policy` reads `time_team_rules`.

```sql
INSERT INTO plan_limit_keys (key, kind, label, description, unit, group_key, sort_order) VALUES
  ('time_tracking','feature','Timesheets and approvals','Group time into timesheets and route them for approval.',NULL,'team',120),
  ('time_billable_invoices','feature','Billable hours on invoices','Bill approved hours on client invoices.',NULL,'team',121),
  ('time_team_rules','feature','Team approvers and time rules','Let a team set its own approvers, periods and rules.',NULL,'team',122),
  ('time_payouts','feature','Payouts','Record payouts for approved team time.',NULL,'team',123),
  ('time_reports_export','feature','Workspace time reports and export','Workspace-wide time reports and CSV export.',NULL,'team',124),
  ('time_approval_chains','feature','Custom approval chains','Multi-step approval for timesheets.',NULL,'team',125),
  ('time_audit_export','feature','Time audit export','Export the full timesheet history.',NULL,'team',126)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
                                group_key = EXCLUDED.group_key, sort_order = EXCLUDED.sort_order;  -- never kind
```

Values go into `plan_limits (plan, limit_key, kind, int_value, bool_value, per_seat, display_label)` with `ON CONFLICT (plan, limit_key) DO NOTHING`, following the [pricing matrix](./README.md). `time_tracking`'s values are unchanged.

| Key | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| `time_billable_invoices` | false | true | true | true |
| `time_team_rules`, `time_payouts`, `time_reports_export` | false | false | true | true |
| `time_approval_chains`, `time_audit_export` | false | false | false | true |

Between steps 1 and 7 the old backend reports the 6 keys as `unknown_to_code` drift (`enforced:false`, `entitlements.logic.ts:151-175`) and the old Usage/pricing pages show the relabelled `time_tracking`. Cosmetic only. The code side ships in PR-1 (`entitlement-keys.ts` and specs) and the web PR (`planLimits.ts`, `pricing.ts`, `WorkspaceUsagePage.tsx`, `/admin/plans`).

### M1 Expand

`20261003090100_time_entries_expand.sql` (additive; L4, L17, L41, L42, L50). Runs under `SET LOCAL app.time_maintenance='on'`, in order; definitions are in the [data model](./data-model.md).

| # | Action |
|---|---|
| 1 | **Precheck** (RAISE): `time_team_rules` exists; no member has two running entries (`SELECT member_user_id FROM task_time_logs WHERE ended_at IS NULL AND member_user_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1` is empty); no row has both `team_id` and `engagement_assignment_id`; `btree_gist` is available. |
| 2 | `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions`. |
| 3 | Create `timesheets`, `timesheet_events`, `time_policies`, `time_policy_events`, `user_time_preferences`, `time_logging_defaults`, `invoice_time_entries`, each with RLS and REVOKE; then the two policy triggers. |
| 4 | Columns on `task_time_logs` (old name): `context_kind`, `workspace_id`, `context_ref`, `context_label_snapshot`, `timesheet_id`, `work_item` (DEFAULT `'task'`), `note`, `payable_seconds`, `amount_snapshot`, `legacy_status`; FKs named `time_entries_*_fkey`. |
| 5 | Rename the updated-at function, then **fill** in one statement before any new trigger exists (`set_time_entries_updated_at` skips under maintenance, preserving `updated_at`). SQL below. |
| 6 | CHECKs: `context_kind_check`, values-only `work_item_check`, `legacy_status_check`, `frozen_check`, `amount_check`, `note_length`. **Not** `time_entries_context_check` (M2). |
| 7 | Indexes: `uq_time_entries_one_running_per_member` (the old backend already enforces one timer), `time_entries_timesheet_idx`, `_assignment_started_idx`, `_team_started_idx`, `_cost_rollup_idx`, `_owed_idx`. |
| 8 | Policy seed (C17, L28, L59). SQL below. |
| 9 | Functions: `time_workspace_has_feature`, `time_period_for`, `time_scope_label`, `time_resolve_policy`, `time_ensure_workspace_policy`, `time_sheet_scope_for`, `time_ensure_timesheet`, `time_can_decide_scope`, `can_decide_timesheet`, `can_view_timesheet`, `time_billing_floor`, `tg_time_entries_context`, `tg_timesheets_guard` (+ trigger), `tg_invoice_time_entries_guard` (+ trigger), `tg_time_policies_guard` and `tg_time_policies_events` (+ triggers). `time_timesheet_transition` and the two `account_deletion_*_has_open_time` functions moved to M3: no caller before PR-1 (see the [data model](./data-model.md#sql-functions)). |
| 10 | Entry triggers: create `trg_time_entries_10_context`; `ALTER TRIGGER trg_task_time_logs_engagement_assignment_guard … RENAME TO trg_time_entries_20_assignment_guard`; `ALTER TRIGGER trg_set_task_time_logs_updated_at … RENAME TO trg_time_entries_90_updated_at`; `ALTER FUNCTION tg_task_time_logs_engagement_assignment_guard() RENAME TO tg_time_entries_assignment_guard`. Do **not** create trg_30 or trg_40 yet. |
| 11 | Rebuild `can_manage_team` (grants kept) and `tg_engagement_assignments_guard`. |
| 12 | `engagement_time_settings` gains `period_kind`, `timezone`, `week_start`. |
| 13 | RLS + REVOKE on `task_time_logs`, `task_time_log_segments`, `time_log_comments`, `team_member_rates`; REVOKE on `payouts`, `engagement_time_settings`, `engagement_time_rates`, `engagement_assignments`, `invoice_line_items`; REVOKE on the two new identity sequences and the new functions (CHANGE-18). |
| 14 | `notification_types` rows (table below). |
| 15 | **D16 back-fill.** Insert `project_team_members` for every (project, team, member) that already has team entries, has a `project_access` row, and satisfies both curation FKs (`project_teams`, `team_members`). SQL below. The insert never touches `project_access`; the sync trigger acts only on DELETE. Measured 2026-10-02: prod 1 pair, already a direct grant; dev 2 pairs. |

Step 5 fill. No contract context is inferred: prod has 0 assignments, and dev's 12 no-team rows become `personal`.

```sql
UPDATE task_time_logs l SET
  context_kind = CASE WHEN engagement_assignment_id IS NOT NULL THEN 'assignment'
                      WHEN team_id IS NOT NULL THEN 'team' ELSE 'personal' END,
  context_ref  = COALESCE(engagement_assignment_id, team_id),
  context_label_snapshot = (SELECT t.name FROM teams t WHERE t.id = l.team_id),
  work_item    = CASE WHEN task_id IS NULL THEN 'other' ELSE 'task' END;
ALTER TABLE task_time_logs ALTER COLUMN context_kind SET NOT NULL;
```

Step 8 policy seed (no-op on dev; the team constant follows `20260702000010`). `tracking_enabled=false` keeps Prodigitality's people on the team option with no new question. Prodigitality has member rates and payouts off; its Business comp makes sheets team-scope with team approvers.

```sql
INSERT INTO time_policies (scope, workspace_id, tracking_enabled, period_kind, week_start, timezone,
                           approval_required, allow_manual_entries, rounding_minutes, reminder_days)
SELECT 'workspace', t.workspace_id, false, 'weekly', 1, 'Asia/Manila', true, true, 0, 1
FROM teams t WHERE t.id = 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba'
ON CONFLICT DO NOTHING;
INSERT INTO time_policies (scope, team_id, approver_scope, retroactive_days)
SELECT 'team', id, 'team', retroactive_log_days FROM teams WHERE id = 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba'
ON CONFLICT DO NOTHING;                                  -- Prodigitality: retroactive NULL (inherit)
INSERT INTO time_policies (scope, team_id, retroactive_days)
SELECT 'team', id, retroactive_log_days FROM teams
WHERE retroactive_log_days IS NOT NULL AND id <> 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba'
ON CONFLICT DO NOTHING;                                  -- dev: 2 teams (30); approver stays workspace
```

Step 15 D16 back-fill (idempotent):

```sql
INSERT INTO project_team_members (project_id, team_id, user_id, added_by)
SELECT DISTINCT l.project_id, l.team_id, l.member_user_id, NULL::uuid
FROM task_time_logs l
JOIN project_access pa ON pa.project_id = l.project_id AND pa.user_id = l.member_user_id
JOIN project_teams pt ON pt.project_id = l.project_id AND pt.team_id = l.team_id
JOIN team_members tm ON tm.team_id = l.team_id AND tm.user_id = l.member_user_id
WHERE l.team_id IS NOT NULL
ON CONFLICT (project_id, team_id, user_id) DO NOTHING;
```

Step 14 notification types: `category='specific'`, `ON CONFLICT (name) DO NOTHING`. Email renderers ship in PR-1; nothing emits these before step 6.

| Name | Priority | `email_eligible` | `email_delay_seconds` |
|---|---|---|---|
| `timesheet_submitted` | medium | true | 3600 |
| `timesheet_returned` | high | true | 600 |
| `timesheet_reminder` | medium | true | 600 |
| `time_payout_recorded` | medium | true | 600 |
| `timesheet_approved`, `timesheet_reopened`, `timesheet_reopen_requested`, `timer_running_long`, `timesheets_imported` | medium | false | 600 |
| `timer_auto_stopped` | high | false | 600 |

**Old backend between M1 and M2.** Inserts without `context_kind` are derived by trg_10 and stay sheetless until M2. Updates to any legacy row work: no context CHECK, trg_30 or trg_40 yet (L4). Viewer inserts pass the viewer floor. The DB team floor needs `project_teams` + `team_members`, not a curated `project_team_members` row, so `resolveTeamRate`'s fallback loggers (`team-time.service.ts:2481-2499`) keep logging; the curated rule lives in the new resolver, and step 15 back-fills today's uncurated loggers (D16) so nobody drops to "Just me" at step 6. Heal is already a no-op.

### M2 Timesheets Backfill

`20261003100000_time_timesheets_backfill.sql` (L4, L15, L32, L47, L48, L49). Runs under `SET LOCAL app.time_maintenance='on'`, then `LOCK TABLE task_time_logs IN ACCESS EXCLUSIVE MODE`. Step 3's validated `ADD`/`DROP CONSTRAINT` need it anyway, so taking it up front avoids a lock upgrade; readers and writers wait a few seconds, bounded by `lock_timeout`.

| # | Action |
|---|---|
| 1 | **Precheck invariants** (D21): `time_ensure_timesheet` exists and `time_legacy_backfill` does not; `timesheets` is empty; every row has `context_kind`; no non-personal row has `context_ref IS NULL` **or `member_user_id IS NULL`**; no `status IN ('approved','paid','rejected')` row has `ended_at IS NULL`; the `work_item` biconditional already holds; the Prodigitality policy rows exist when that team exists. |
| 2 | Helpers `time_raise(code, detail)` (every new M2/M3 error goes through it, so `message` is the bare code and `details` is JSON), `time_legacy_sheet_facts`, `time_legacy_approver_scope`, `time_legacy_freeze`; then `time_legacy_backfill(p_reconcile boolean)` (service role only; body starts `#variable_conflict use_column`), called with `false`. It never modifies `status`. Logic in [Legacy grouping](#legacy-grouping). |
| 3 | Constraints (L49): `ADD CONSTRAINT time_entries_context_check` (validated); `DROP` and re-`ADD` `time_entries_work_item_check` with the biconditional. |
| 4 | Triggers: `trg_time_entries_30_timesheet` fires on `INSERT OR UPDATE OF started_at, member_user_id, context_kind, context_ref, team_id, workspace_id, engagement_assignment_id, timesheet_id` (D19; a caller-set `timesheet_id` is ignored outside maintenance). `trg_time_entries_40_lock` reads the sheet `FOR SHARE`, lets `payout_id` change only under `app.time_settlement` and `payable_seconds`/`amount_snapshot`/`legacy_status` only under `app.time_freeze`, on every row (D20); the backend retries a `40P01` deadlock once. |
| 5 | Payout RPCs, build #1: `create_payout_and_mark_paid` and `void_payout_and_revert` on `task_time_logs` (Renames A1, A2), `search_path` pinned to `public, pg_temp`. Create refuses `p_created_by = p_member_user_id` (`PAYOUT_SELF_NOT_ALLOWED`) and fixed-rate entries (`FIXED_RATE_NOT_PAYABLE_BY_ENTRY`), pays `context_kind='team' AND legacy_status IS NULL AND (payable_seconds IS NOT NULL OR status='approved')`, totals `round(sum(coalesce(payable_seconds, duration_seconds)/3600 × rate_snapshot), 2)`, and sets `app.time_settlement` only around its entry UPDATE. The `status='paid'` write is the RPC's own (`20260907090000:137-143`), not the old backend's. |
| 6 | Notifications (L32): `UPDATE notifications SET is_read = true, read_at = now() WHERE is_read = false AND type_id = (SELECT id FROM notification_types WHERE name = 'time_log_approval_requested')`. Prod had 643 rows for 414 logs on 2026-10-02. |
| 7 | Privileges: every new function `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`; the two trigger functions get the REVOKE only. |

The file opens with a ticked self-review checklist and a `-- ROLLBACK (manual)` block in its header comment, and ends with the M2 verification block as a trailing comment after `COMMIT`.

### Legacy Grouping

Decision 3, with D12 and D13 as decided. `time_legacy_backfill(false)` judges "today" in each sheet's timezone.

> **Recomputed 2026-10-05 (prod, read-only):** 64 sheets, **30 approved / 34 submitted / 0 open**, markers `paid_outside` 4 and `rejected` 1. The two current-period sheets of 2026-10-02 have ended since, so they import as submitted. Recompute again on the apply day (G7). **Markers are by fact (D18):** on every row that was grouped into a sheet, `status='rejected'` → `legacy_status='rejected'` and `status='paid' AND payout_id IS NULL` → `'paid_outside'`, whatever class the sheet falls in; personal rows are never marked.

**Group.** Each non-personal row with `timesheet_id IS NULL` gets `time_ensure_timesheet(member, scope_for(...), started_at)`; under maintenance sheets get `origin='legacy_migration'`, `submission_kind='legacy'`. Prodigitality resolves to `scope_kind='team'`, weekly / Monday / Asia/Manila: **64** person-weeks on prod, identical in Manila and UTC. On dev, teams without an override row group into `workspace`-scope sheets and workspace policies materialise lazily (UTC; no `user_time_preferences` yet).

**Classify each sheet:**

| Class | Prod on 2026-10-02 | Sheet result | Entry result |
|---|---|---|---|
| Past period (`period_end < today`), no pending and no running entry | 30, incl. 1 approved + rejected week and 2 approved + paid weeks | `approved`, `decision_kind='legacy'`. `approver_scope` = `team` for team scope with `approver_scope='team'`, else `workspace`. `submitted_at = min(created_at)`, `submitted_by = member`. `decided_at = max(reviewed_at)`, else `max(updated_at)` (preserved by M1/M2). `decided_by` = latest non-null `reviewed_by` (NULL on 3 sheets; equals the member on 1). Totals written. | `payable_seconds = coalesce(duration_seconds,0)`, or 0 for `rejected`. `rate_snapshot` kept; `amount_snapshot = round(payable/3600 × rate_snapshot, 2)` for hourly (D13; display gated by `costVisible`). `status='paid'` without `payout_id` (4) → `legacy_status='paid_outside'`: counted as approved, excluded from Owed, blocks reopen of its 2 weeks. `rejected` (1, 744 h) → `legacy_status='rejected'`, 0 payable; its week can still be reopened (D12). Paid with a `payout_id` (0) keeps it. |
| Past period with ≥ 1 pending entry | 32 (0 weeks mix pending with decided) | `submitted`, `approver_scope` as above, `submission_kind='legacy'`, `submitted_by = member`, `submitted_at = max(created_at)`; history reads "Imported from per-entry review" | Unchanged. A `rejected` entry here gets `legacy_status='rejected'` (0 today). |
| Current period (`period_end ≥ today`) or holding a running entry | 2 sheets, 8 pending entries; 0 running | stays `open` (D3) | Unchanged. An entry approved per entry here (0 today) stays payable through the M2–M5 payout fallback. |
| No team | 0 (dev 12) | none (`personal`) | none |

Each sheet gets one `legacy_import` event (`from_status NULL`, `to_status` = result) and `policy_snapshot` = `time_resolve_policy(...)` at `period_start` plus `{"legacy": true}`. Counts are recomputed on the apply date (weeks ended by then become `submitted`). Known quirks, accepted: 34 entries fall on another calendar day in Manila than UTC (1 in another week); 6 entries overlap.

**Reconcile mode** (`p_reconcile = true`, M4, written now): re-groups and re-marks (the `rejected` marker skipped), then per legacy sheet whose entries changed after its import event: `flagged_approved_changed`, `reconciled_returned`, or `reconciled_approved`. `reconciled_approved` also requires no running entry, because freezing a running entry would violate `time_entries_frozen_check`; both reconcile branches rewrite `total_seconds`.

### M3 Rename

`20261003110000_rename_time_entries.sql` (L52).

| # | Action |
|---|---|
| 1 | **Precheck:** `engagement_time_approvals` and `engagement_time_approval_items` have 0 rows; M2 objects exist (`time_legacy_backfill`, trg_30, `time_entries_context_check`); no non-personal entry lacks a `timesheet_id`; `time_entries` does not exist yet. |
| 2 | **Renames:** `task_time_logs` → `time_entries` (`reviewed_*` → `legacy_reviewed_*`); `task_time_log_segments` → `time_entry_segments` and `time_log_comments` → `time_entry_comments` (`log_id` → `entry_id`); `trg_time_log_comments_updated_at` → `trg_time_entry_comments_updated_at`. |
| 3 | **Compatibility views** (SQL below), REVOKEd from `anon`/`authenticated`, granted to `service_role` explicitly. |
| 4 | **Drops:** the 3 segment and comment policies; `engagement_time_approval_items`, then `engagement_time_approvals`, with both guard functions and their triggers. |
| 4b | **Policy audit survives a DELETE (D23):** `time_policy_events.policy_id` becomes nullable with FK `ON DELETE SET NULL`; new columns `scope`, `team_id`, `workspace_id` (back-filled, two partial indexes); `tg_time_policies_events` rebuilt to fill them; new `BEFORE DELETE` trigger `trg_time_policies_delete_event` writes a `{deleted: true, row}` event; new `time_policy_delete(p_policy_id, p_actor)` sets `app.time_policy_actor` and deletes. Team override DELETE goes through it. |
| 5 | **Rebuilds:** Group A: A1, A2 (build #2), A3, A5 → new `account_deletion_close_running_entries_for_workspace`, A6–A10; all of Group B (including `time_timesheet_transition`, which mirrors decisions into `status` while it exists; see the [renames table](./data-model.md)); then `DROP FUNCTION account_deletion_close_running_logs_for_workspace(uuid)`; create `time_test_cleanup`. |
| 5b | **Transition engine** (new): `time_sheet_has_cost_money`, `time_scope_deciders`, `time_timesheet_deciders`, `time_approval_queue_ids`, `time_stop_running_entries`, `time_apply_freeze`, `time_clear_freeze`, `time_route_sheet`, `time_sheet_routing_preview`, `time_timesheet_transition` ([data model](./data-model.md#as-built-in-m2-and-m3)). The three internal helpers (`time_apply_freeze`, `time_clear_freeze`, `time_route_sheet`) are revoked from `service_role` too: Supabase's default privileges grant it EXECUTE on new functions, and the freeze helpers could rewrite frozen columns outside a transition. |
| 6 | **Dev only, before prod (MD-15, L52):** the embed check below. |

The file was assembled from five section files (head, carry-over, engine, Group A, tail), and a carry-over check diffed every carried-over body against its M2/M1 source with the rename map applied (one-off PR-1 build tooling, not kept in the repository).

The views are security invoker, revoked and column-for-column, so they stay auto-updatable; base-table BEFORE triggers fire for writes through them (NOT NULL `context_kind` is checked after trg_10 derives it). Constraint names stay until M5, so `!task_time_logs_*_fkey` hints keep resolving.

```sql
CREATE VIEW public.task_time_logs WITH (security_invoker = true) AS
  SELECT id, project_id, task_id, member_user_id, started_at, ended_at, duration_seconds, status,
         legacy_reviewed_by AS reviewed_by, legacy_reviewed_at AS reviewed_at, legacy_review_note AS review_note,
         source, created_at, updated_at, rate_snapshot, currency_snapshot, team_id, work_type_snapshot, payout_id,
         rate_type_snapshot, break_minutes, paused_at, break_seconds, member_display_name_snapshot,
         engagement_assignment_id, flagged_reason     -- prod ordinal order: rate_type_snapshot before break_minutes
  FROM public.time_entries;
CREATE VIEW public.task_time_log_segments WITH (security_invoker = true) AS
  SELECT id, entry_id AS log_id, kind, started_at, ended_at, created_at FROM public.time_entry_segments;
CREATE VIEW public.time_log_comments WITH (security_invoker = true) AS
  SELECT id, entry_id AS log_id, author_user_id, body, created_at, updated_at FROM public.time_entry_comments;
REVOKE ALL ON public.task_time_logs, public.task_time_log_segments, public.time_log_comments FROM anon, authenticated;
```

**MD-15 embed check.** Run the old backend revision locally against dev (or the equivalent PostgREST selects with the service key) for every embed: `team-time.service.ts:36-39,71,1215,2241-2242` (including `reviewer:profiles!task_time_logs_reviewed_by_fkey` through the aliased `legacy_reviewed_by AS reviewed_by`, and the `!inner` form), `finance-export.service.ts:131`, `invoice-composition.service.ts:169`, `backend/src/modules/marketplace/payouts/payouts.service.ts:391,459-460`, `financials.service.ts:396` (`teams!inner`), and `time_log_comments_author_user_id_fkey` on the comments view. Also one INSERT → PATCH `?select=` → DELETE round trip through the `task_time_logs` view, and every new select of PR-1 against the new tables: the `time-entry.select.ts` constants (`ENTRY_*`, `SEGMENT_SELECT`, `COMMENT_SELECT*`, `TIMESHEET_*`), the reports' `timesheets!timesheet_id!inner(...)` with `count:'exact'`, `BOOK_TIME_SELECT`, `TIME_EXPORT_SELECT`, and the `timesheet_events`/`time_policy_events` audit-export selects. **Any `PGRST200`/`PGRST201` stops the rollout before prod.**

### M4 Reconcile

`20261003120000_time_timesheets_reconcile.sql`, after step 7. Forward-only, idempotent; expected result 0 rows.

- **Reconcile.** `SELECT * FROM time_legacy_backfill(true)` under maintenance examines legacy sheets with entries updated after the sheet's `legacy_import` event. `submitted` with all entries now decided → `approved`, frozen (M2 rules). `submitted` with a newly `rejected` entry → `returned`, note "Returned during the move to timesheets", no `legacy_status` (the member fixes and resubmits).
- **Digest** (L32). One `timesheets_imported` notification per decider for sheets still `submitted` with `submission_kind='legacy'`. Deciders are found by testing `can_decide_timesheet` over candidates (team owners, team members with role owner/admin, admins of the policy workspace), excluding profiles with `deleted_at IS NOT NULL`. Push title "Timesheets waiting"; `content.message` = "<N> timesheets moved from per-entry review are waiting", with no amount (CHANGE-19); `link_url = '/time#waiting'`.

### M5 Contract

`20261010090000_time_entries_contract.sql`, after the [L19 gate](#gate-for-m5-l19).

| # | Action |
|---|---|
| 1 | **Precheck:** no `time_entries` row has `status='pending'` inside an `approved` sheet. Record non-default `teams.retroactive_log_days` and `contract_enforcement` values as `RAISE NOTICE` (prod none; dev 2 and 1). |
| 2 | **Archive:** `CREATE TABLE time_entries_status_archive_<YYYYMMDD of apply> AS SELECT id, status FROM time_entries`, plus RLS and REVOKE. |
| 3 | Drop the 3 views. |
| 4 | `CREATE OR REPLACE tg_time_entries_assignment_guard` without the `OLD.status` branch, then drop and recreate `trg_time_entries_20_assignment_guard` without `status` in its column list (otherwise the list blocks the column drop). |
| 5 | Drop indexes `idx_task_time_logs_project_status_started`, `task_time_logs_team_status_started_idx`, `idx_task_time_logs_cost_rollup`, `idx_task_time_logs_engagement_assignment`, `uq_task_time_logs_one_active_per_member_project`. |
| 6 | `ALTER TABLE time_entries DROP COLUMN status` (its CHECK goes with it). |
| 7 | Rebuilds: `tg_time_entries_lock` without the `status` / `legacy_reviewed_*` allowance; `time_timesheet_transition` without `status` writes; payout RPCs build #3, with no `status` writes and no fallback (L15). |
| 8 | Every constraint and index rename in the [renames table](./data-model.md), as explicit `ALTER … RENAME`. |
| 9 | Drop `teams.retroactive_log_days`, `teams.contract_enforcement`, `time_legacy_backfill` and its helpers. `time_legacy_sheet_facts` **must** go: it reads `e.status`, so the M5 status scan below flags it. |

## Compatibility Windows

| Surface | Open | Closes when |
|---|---|---|
| Old backend writing directly to `task_time_logs` (table) | today → step 6 | Step 6 (a rollback re-opens it until M5) |
| Views `task_time_logs`, `task_time_log_segments`, `time_log_comments` | M3 → M5 | The L19 gate |
| `status` and `reviewed_*` / `legacy_reviewed_*` writes (old backend, the M2/M3 payout RPCs, and `time_timesheet_transition`'s approve/reopen mirror) | M1 → M5 | M5 |
| Old FK-name embed hints | until M5 | M5 renames |
| `/api/team-time/*` alias | step 6 → step 11 | The L18 gate; afterwards 410 `APP_UPDATE_REQUIRED` |
| Old `link_url`s `/w/<slug>/teams/<id>/time/*`, bare `/teams/<id>/time/**` | permanent | Never; the redirect shells stay |
| `heal-orphaned-logs` | neutralised at step 0 | Removed with the alias controller |
| Native shells below build 7000 (Capacitor 7, no OTA) | until alias retirement | D15: forced-update screen, or accepted breakage |

## Rollback per Step

| Step | Rollback | Data effect |
|---|---|---|
| 0 PR-0 | Revert the commit (deploys). **Do not revert after M1**: heal would write `team_id` onto personal and workspace entries. | none |
| 1 M0 | `DELETE FROM plan_limits WHERE limit_key IN (<6 new>)`, then the key rows; restore `time_tracking` label "Time tracking and timesheets" and description "Log time against work and review team timesheets." (`20260922120000:211-212`). Only while PR-1 is undeployed. | none |
| 2 M1 | Under maintenance: drop trg_10 and the new functions; rename the two triggers and two functions back; restore `set_task_time_logs_updated_at` (`20260320131000:37-45`), `can_manage_team` (`20260901160000:52-68`), `tg_engagement_assignments_guard` (`20260814020000:444-534`); drop the new indexes, CHECKs, columns and the 7 new tables; drop the 3 `engagement_time_settings` columns. The 10 notification types and the D16 curation rows may stay: nothing references the types before PR-1, and the curation rows grant nothing. **Keep** RLS and the REVOKEs; never restore the old grants. `btree_gist` may stay. | lossless (new columns only) |
| 3 | n/a (unmerged PR) | — |
| 4–5 M2 | Under maintenance: drop trg_30 and trg_40 and `time_entries_context_check`; restore the values-only `work_item_check`; restore the payout RPCs from `20260907090000:48-147` and `20260701000020:179-214`; clear `timesheet_id`, `payable_seconds`, `amount_snapshot`, `legacy_status`; delete `timesheet_events` and `timesheets`; drop `time_legacy_backfill`. Notifications marked read stay read (cosmetic; the old queue reads entry `status`). | lossless; old-backend reviews after M2 live on `status` |
| 4–5 M3 | Drop the views; rename tables, columns and the comments trigger back; re-run the M1/M2 definitions of Group B (old table name); restore A1/A2 (build #1), A3 (`20260814021000:489-508`), A6–A10 and `reset_qa_fixture` from their source lines; recreate `account_deletion_close_running_logs_for_workspace` (`20260923090200:165-178`); drop `time_test_cleanup` and the `_entries_` helper; recreate the engagement approval tables (`20260814021000:94-161`), their guards (`:322-382`, `:384-439`) and triggers; recreate the 3 policies (`20260810150000:45`, `20260528000010:26,49`); reverse D23 (drop the three `time_policy_events` columns, restore `NOT NULL` and the CASCADE FK, restore `tg_time_policies_events` from M1, drop `trg_time_policies_delete_event` and `time_policy_delete`); drop the engine functions. The full block is the M3 file's `-- ROLLBACK (manual)` header. | lossless (audit rows of deleted policies are lost) |
| 6 PR-1 | Shift traffic to the previous revision: `gcloud run services update-traffic proyekto-backend --region asia-southeast1 --to-revisions=<prev>=100`. **Roll web back first** if step 7 ran. **No DB rollback.** The old backend through the views supports **read, approve, and stop/start in the current week only** (L16). Expected old-UI errors: PATCH/DELETE of entries in submitted or approved sheets (`TIME_ENTRY_LOCKED`); manual entries into locked periods (`TIME_PERIOD_LOCKED`). New-model approvals and reopens are mirrored into `status` until M5. On the next forward deploy, `SELECT * FROM time_legacy_backfill(true)` re-reconciles. | none |
| 7 web / OTA | Redeploy the previous web commit by `workflow_dispatch`; republish the previous bundle. Devices on the new bundle keep working: the new backend serves both `/api/time` and the alias. | none |
| 8 M4 | Not needed (forward-only, idempotent). Digests can be deleted by type. | none |
| 9 cron | Pause the Scheduler job. | none |
| 10 M5 | `ADD COLUMN status` with the old CHECK; fill from the archive. Rows newer than the archive: `paid` when `payout_id` is set, `approved` when Approved, `rejected` when `legacy_status='rejected'`, else `pending`. Recreate the old indexes, the views, the guard trigger with `status`, the lock allowance and payout RPCs build #2; reverse the M5 renames; re-add `teams.retroactive_log_days` (from `time_policies.retroactive_days`) and `contract_enforcement` (DEFAULT `'off'`, plus the NOTICE values). Only needed to resurrect the old backend. | near-lossless |
| 11 alias | Re-add the controller (revert the commit). | none |

## Verification SQL

Run the block for each step on **both** databases after it applies, dev first. This is the single source; the [test plan](./edge-cases-and-tests.md) points here rather than copying it. Expected values are prod as of 2026-10-02 and are recomputed on the apply date.

```sql
-- ── M0 ──────────────────────────────────────────────────────────────────
SELECT key, label, sort_order FROM plan_limit_keys WHERE key ~ '^time_' ORDER BY sort_order;      -- 7 rows, 120..126
SELECT limit_key, string_agg(plan || '=' || bool_value, ',' ORDER BY plan_rank(plan))
FROM plan_limits WHERE limit_key ~ '^time_' GROUP BY 1;                                            -- matches the matrix

-- ── M1 ──────────────────────────────────────────────────────────────────
SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist';                                   -- 1
SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('timesheets','timesheet_events','time_policies','time_policy_events',
  'time_logging_defaults','user_time_preferences','invoice_time_entries','task_time_logs',
  'task_time_log_segments','time_log_comments','team_member_rates');                              -- all true
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
  AND (table_name ~ '^(time_|timesheet|task_time|team_member_rates|user_time_preferences|invoice_time_entries)'
       OR table_name IN ('payouts','engagement_time_settings','engagement_assignments','engagement_time_rates')); -- 0 rows
SELECT p.oid::regprocedure, a.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
  LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
WHERE n.nspname = 'public' AND a.privilege_type = 'EXECUTE'
  AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
  AND (p.proname ~ '^(time_|timesheet|tg_time|tg_timesheet|tg_invoice_time)'
       OR p.proname IN ('can_decide_timesheet','can_view_timesheet',
                        'account_deletion_team_has_open_time','account_deletion_workspace_has_open_time'));  -- 0 rows
SELECT context_kind, count(*), count(*) FILTER (WHERE context_ref IS NULL) AS no_ref
FROM task_time_logs GROUP BY 1;                                    -- prod: team 414+ / no_ref 0; dev also personal 12 (no_ref = all)
SELECT count(*) FROM task_time_logs WHERE (task_id IS NULL) <> (work_item <> 'task');            -- 0
SELECT max(updated_at) FROM task_time_logs;                       -- equals the value captured just before M1
SELECT scope, count(*) FROM time_policies GROUP BY 1;             -- prod: workspace 1, team 1
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.task_time_logs'::regclass AND NOT tgisinternal ORDER BY 1;
  -- trg_time_entries_10_context, trg_time_entries_20_assignment_guard, trg_time_entries_90_updated_at
SELECT pg_get_functiondef('public.can_manage_team(uuid,uuid)'::regprocedure) ~ $$role IN \('owner', ?'admin'\)$$;  -- true
SELECT has_function_privilege('authenticated', 'public.can_manage_team(uuid,uuid)', 'EXECUTE'); -- true (kept)
-- L1: Prodigitality curated members below editor (record the number; they lose logging at step 6)
SELECT count(DISTINCT ptm.user_id) FROM project_team_members ptm JOIN projects p ON p.id = ptm.project_id
WHERE ptm.team_id = 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba' AND p.owner_id <> ptm.user_id
  AND NOT EXISTS (SELECT 1 FROM project_access pa WHERE pa.project_id = ptm.project_id
                  AND pa.user_id = ptm.user_id AND pa.role IN ('owner','admin','editor'));
-- L1b: uncurated team loggers (D16). Run before M1 and record the number; after M1 it must be 0
-- (step 15 back-fills them). A non-zero result after M1 means a pair failed the FK joins: investigate.
SELECT count(DISTINCT (l.project_id, l.member_user_id)) FROM task_time_logs l
JOIN project_access pa ON pa.project_id = l.project_id AND pa.user_id = l.member_user_id
WHERE l.team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM project_team_members m WHERE m.project_id = l.project_id
                  AND m.team_id = l.team_id AND m.user_id = l.member_user_id);
-- Dev smoke (BEGIN … ROLLBACK):
--   UPDATE task_time_logs SET status='approved', reviewed_at=now() WHERE id = <a pending legacy row>;   -> succeeds (L4)
--   INSERT an old-shape team row (no context_kind, no task) -> kind team, ref, label, work_item 'other', timesheet_id NULL
--   INSERT an old-shape row for a user with no project_access -> TIME_ENTRY_NO_PROJECT_ACCESS
--   two running INSERTs for one member on different projects -> 23505

-- ── M2 (table still named task_time_logs) ───────────────────────────────
SELECT status, origin, submission_kind, count(*) FROM timesheets GROUP BY 1,2,3;
  -- prod 2026-10-05: approved/legacy_migration/legacy 30, submitted/…/legacy 34, open 0 (recompute on apply date)
SELECT count(*) FROM task_time_logs WHERE context_kind <> 'personal' AND timesheet_id IS NULL;   -- 0
SELECT legacy_status, count(*) FROM task_time_logs WHERE legacy_status IS NOT NULL GROUP BY 1;  -- prod: paid_outside 4, rejected 1
SELECT count(*) FROM task_time_logs e JOIN timesheets t ON t.id = e.timesheet_id
CROSS JOIN LATERAL time_sheet_scope_for(e.context_kind, e.context_ref, e.project_id) s
WHERE (e.started_at AT TIME ZONE t.timezone)::date NOT BETWEEN t.period_start AND t.period_end
   OR e.member_user_id IS DISTINCT FROM t.member_user_id
   OR (s.scope_kind, s.scope_ref) IS DISTINCT FROM (t.scope_kind, t.scope_ref);                -- 0
SELECT count(*) FROM task_time_logs e JOIN timesheets t ON t.id = e.timesheet_id
WHERE t.status = 'approved' AND e.payable_seconds IS NULL;                                        -- 0
-- L11 hours parity: new approved hours + approved-in-open-sheet hours = old approved+paid hours
SELECT round(sum(payable_seconds) FILTER (WHERE payable_seconds IS NOT NULL AND legacy_status IS DISTINCT FROM 'rejected') / 3600.0, 2) AS new_h,
       round(sum(duration_seconds) FILTER (WHERE status IN ('approved','paid') AND payable_seconds IS NULL) / 3600.0, 2) AS open_h,
       round(sum(duration_seconds) FILTER (WHERE status IN ('approved','paid')) / 3600.0, 2) AS old_h
FROM task_time_logs;                                                    -- new_h + coalesce(open_h,0) = old_h; prod 2026-10-02: 677.18 / NULL / 677.18
SELECT status, count(*) FROM task_time_logs GROUP BY 1;            -- equals the pre-M2 snapshot (184/225/4/1 on 2026-10-02 + new)
SELECT count(*) FROM timesheets t
WHERE (SELECT count(*) FROM timesheet_events v WHERE v.timesheet_id = t.id AND v.event = 'legacy_import') <> 1;  -- 0
SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('time_entries_context_check','time_entries_work_item_check');                  -- both true
SELECT count(*) FROM notifications n JOIN notification_types y ON y.id = n.type_id
WHERE y.name = 'time_log_approval_requested' AND NOT n.is_read;                                   -- 0
-- Dev smoke (BEGIN … ROLLBACK):
--   old-shape UPDATE status='approved' on a pending entry in a submitted legacy sheet -> succeeds
--   UPDATE duration_seconds on the same entry -> TIME_ENTRY_LOCKED
--   INSERT into a past submitted week -> TIME_PERIOD_LOCKED
--   create_payout_and_mark_paid on a fixture with one status='approved', payable NULL entry -> succeeds, writes status='paid'

-- ── M3 ──────────────────────────────────────────────────────────────────
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosrc ~ '(task_time_log|time_log_comments|engagement_time_approval)';  -- 0 rows
SELECT c.relname, c.relkind, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('task_time_logs','task_time_log_segments','time_log_comments');
  -- 3 rows, relkind 'v', reloptions {security_invoker=true}
SELECT (SELECT count(*) FROM task_time_logs) = (SELECT count(*) FROM time_entries);              -- true
SELECT to_regclass('public.engagement_time_approvals'), to_regclass('public.engagement_time_approval_items');  -- NULL, NULL
SELECT count(*) FROM pg_policies WHERE tablename IN ('time_entry_segments','time_entry_comments');  -- 0
-- repeat the M1 grants and ACL queries (views and time_test_cleanup included) -> 0 rows
SELECT has_function_privilege('service_role', 'public.time_apply_freeze(uuid,jsonb)', 'EXECUTE'),
       has_function_privilege('service_role', 'public.time_clear_freeze(uuid)', 'EXECUTE'),
       has_function_privilege('service_role', 'public.time_route_sheet(public.timesheets,text)', 'EXECUTE');  -- false, false, false
SELECT is_nullable FROM information_schema.columns
WHERE table_name = 'time_policy_events' AND column_name = 'policy_id';                            -- YES (D23)
-- After the real apply: an md5(prosrc) check of the 34 functions M2/M3 create or rebuild, generated from the file bodies -> 0 rows.
-- Dev: the MD-15 embed check. Prod after step 6: the step-6 smoke (production-qa.yml is not a gate, D53).

-- ── M4 ──────────────────────────────────────────────────────────────────
SELECT count(*) FROM timesheets t WHERE t.status = 'submitted' AND t.submission_kind = 'legacy'
  AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.timesheet_id = t.id AND e.status = 'pending');  -- 0
SELECT count(*) FROM notifications n JOIN notification_types y ON y.id = n.type_id
WHERE y.name = 'timesheets_imported';                                       -- = number of distinct deciders (prod: Prodigitality approvers)

-- ── M5 ──────────────────────────────────────────────────────────────────
SELECT conname FROM pg_constraint WHERE conname ~ '^(task_time_log|time_log_)';                    -- 0
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname ~ '(task_time_log|time_log_comments)';  -- 0
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'time_entries' AND column_name = 'status';         -- 0
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'teams' AND column_name IN ('retroactive_log_days','contract_enforcement');  -- 0
SELECT to_regprocedure('public.time_legacy_backfill(boolean)');                                   -- NULL
-- No body may read or write time_entries.status. Convention: time_entries is aliased e/te in every body.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosrc ~ '\mtime_entries\M'
  AND (p.prosrc ~ '\m(e|te|time_entries)\.status\M' OR p.prosrc ~* 'update\s+public\.time_entries[^;]*\mstatus\s*=');  -- 0
-- Dev smoke (BEGIN … ROLLBACK): call each rebuilt function once (payout create/void, transition approve/reopen,
--   reset_qa_fixture, delete_account preflight); a body that still names status fails at runtime here.
```

## Gates

### Gate for M5 (L19)

All three must hold. There is no `pg_stat_user_tables` check: views have no stats rows, and view writes count against the base table. Planning default: about one week after step 6; the checks are the gate itself.

| Check | How | Pass |
|---|---|---|
| No old backend serving | `gcloud run revisions list --service proyekto-backend --region asia-southeast1` and `gcloud run services describe proyekto-backend --region asia-southeast1 --format='value(status.traffic)'` | Only revisions at or after the step-6 revision hold traffic; older revisions have 0 instances |
| No old API callers on the DB path | The alias per-route counter ([backend endpoints](./backend.md)) | 0 |
| No old names in code | `git grep -nE "task_time_log\|time_log_comments\|retroactive_log_days\|contract_enforcement" -- backend/src backend/test scripts web/src` | 0 hits. Fix `scripts/seed_dev_project_finance.mjs`, `scripts/seed_finance_demo.mjs` and `qa-fixture.integration-spec.ts` first. The two `teams` columns are in the grep because M5 drops them. |

### Gate for Alias Retirement (L18)

All three must hold. `native_build_min` alone cannot retire old clients: it filters which bundles are offered (`mobile-updates.service.ts:92`) and never moves a shell off its baked-in bundle.

| Check | Pass |
|---|---|
| `native_build_min` of the current production bundle | ≥ the first native build whose baked-in bundle calls `/api/time` |
| Alias hits | 30 consecutive days at 0 |
| `ota-stat` log lines (`mobile-updates.service.ts:193`) | No active device on a bundle version from before `/api/time` |

After retirement, `/api/team-time/*` answers **410 `APP_UPDATE_REQUIRED`** from a stub, not 404. Shells below build 7000 never received OTA bundles; D15 decides between a forced-update screen and accepted breakage. If `OTA_PUBLISH_ENABLED` is unset at step 7, this gate cannot pass until OTA is enabled or a native release ships.
