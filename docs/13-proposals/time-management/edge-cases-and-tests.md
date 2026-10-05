# Edge Cases and Tests

> **⚠️ Built, held unmerged.** Backend PR-1 implements these cases (2026-10-06); M2/M3 and the integration suites have not run against an applied database yet, and the web and Playwright rows wait for the web PR. Cases PR-1 settled differently are corrected inline and listed in [As Built in PR-1](#as-built-in-pr-1).

> **Last updated:** 2026-10-06 · **Status:** draft

This page lists the cases that break naive time tracking, the tests that prove each is handled, and the docs that change when this ships. Every edge case names its source: review finding ids (lens prefixes F, S, U, M, m, MD), ledger rows (L-n) and design changes (CHANGE-n), all explained in the [pressure-test log](./pressure-test-log.md); `—` marks a base-design case. Numbers are stable (E1–E29 base, E30 onward from review), so references from other pages resolve. CI has no test gates, so these local suites, run through `/deploy-preflight`, are the only quality gate.

Part of the [time management proposal](./README.md).

## As Built in PR-1

| Case | Change (decision) |
|---|---|
| E31, `time-entries` integration row | An uncurated attached-team **editor** gets the workspace option (with a seat, when no team is curated for them) or "Just me", not 403; 403 `NO_LOGGING_CONTEXT` only below editor (D58) |
| E66 | Guests get 404 everywhere except `me/overview` (empty shape) and `me/running` / alias `logs/me/running` (`null`) (D08) |
| E35 | Only placed talent (`talent_engagement_id` set) is masked; a consultant's own client-only time is named to the client hirer (D57) |
| E34 | Team suppression only by an **available** assignment option (D59) |
| E52 | Two teams with their own rate cards never collapse into one option (D60) |
| E48 | The freeze cuts only by the contract limit (engagement sheets, contract-set) and the team member caps; a workspace/team policy limit is an indicator and a warning, never a cut (D65) |
| E20, E8 | Cost money is structural (D12); `submit_on_deletion` is never `self` (D14) |
| E38 | `auto`/`self` sheets may submit before the period ends; manual routes get `too_early` (D13); cron jobs 3/5 look back 45 days (D67) |
| E10, E32 | PATCH re-gates only a changed `logging_for`, and never re-checks caps or `allow_manual_entries` (D66) |
| E24 | Turning `access.time` off on a member also turns `time.log` off (D64) |
| E25 | 410 copy depends on the origin: native "Update the app to approve timesheets.", web "Approvals now happen by timesheet. Reload Proyekto." (D06) |
| E36 | The billing floor is the M2 apply day: hours before it never bill (D71) |
| E65 | A team manager also reads every team-context entry of their team on workspace-scope sheets (D49) |
| E72a | The return transition also mirrors `status` (D16) |
| E77 | `time_test_cleanup` refuses projects not titled `itest …` or `[QA] …` (D22) |
| E82–E84 | New cases below (gap behaviour B12, B13, masked ids in old filters) |

## Edge Cases

### Timers, periods and timezones

| # | Case | Handling | Source |
|---|---|---|---|
| E1 | Timer crosses midnight or a period, or is forgotten | Belongs to the day and period of its local start date; caps count it there. Submit refused while running. 10 h → one `timer_running_long` (a Redis marker keeps it to one even if the user deletes the bell row). 24 h → time cron stops it at `started_at + 24h`, `flagged_reason='auto_stopped_24h'`, `timer_auto_stopped`. A 72 h timer never reaches a sheet. | F22 · L61 · CHANGE-22 |
| E2 | DST zone (America/New_York) | Periods are local dates; `time_period_for` (SQL) and `time-periods.ts` parity-tested across both transitions on one fixture. | — |
| E3 | Period, timezone or week start changes mid-period | Existing bounds never change; next sheet starts at `max(natural boundary, last end + 1)`, may be short; `timesheets_no_overlap` never trips. Submitted sheets keep frozen `policy_snapshot`. | L40 |
| E4 | Two starts at once | `uq_time_entries_one_running_per_member`; loser gets 409 `TIMER_ALREADY_RUNNING`. | — |
| E5 | Two sheets created at once | `time_ensure_timesheet` inserts `ON CONFLICT DO NOTHING` (no target, so the exclusion constraint applies) and re-selects: one row. | — |
| E28 | Overlapping entries of one person | Allowed; submit sheet warns on both. | — |
| E51 | Strip and grid day totals disagree (34 prod entries differ Manila vs UTC) | No UTC default when a hint exists (CHANGE-11). Strip uses the `?for=` context's timezone and week start; "All" uses `user_time_preferences`, labelled "Your time (Asia/Manila)" when a visible card differs. | U4 · L29 |
| E41 | New Pro workspace, no policy row | Default: `tracking_enabled=true` with `time_tracking`, weekly, Monday, `approval_required=true`, `reminder_days=1`. Row materialises on first need; timezone from editing admin's browser → earliest owner's preference → entry member's preference → `UTC`. Owners/admins see "Acme tracks time weekly from Monday in Asia/Manila. [Looks right] [Change]"; no opt-in card. Prodigitality seed keeps `tracking_enabled=false`. | F12 · U3 · L28 · CHANGE-11 |

### Logging context and the resolver

| # | Case | Handling | Source |
|---|---|---|---|
| E24 | Viewer or commenter logs | Every option kind needs `time.log` (editor+). `GET logging-for` → `options: []` with `reason:'none'`; writes → 403 `NO_LOGGING_CONTEXT`; timer buttons hidden. A permission write that turns `access.time` off also turns `time.log` off (D64). DB floor stays at viewer (`TIME_ENTRY_NO_PROJECT_ACCESS` only with no `project_access` row and not owner), so old-backend viewer inserts work in the window. Affected curated viewers are counted on the apply date ([verification SQL](./migrations-and-rollout.md#verification-sql)). | F1 · S1 · L1 · CHANGE-1 |
| E31 | Attached-team member not curated onto the project (224 prod pairs lack `project_access`) | Resolver step 3 (TypeScript) needs a `project_team_members` row plus `time.log` for the team option. Without the curated row an **editor** falls to step 4 (the workspace option, when they hold a seat in the project's workspace) or "Just me"; only someone below editor gets 403 `NO_LOGGING_CONTEXT`, and no `project_access` row is 404 (D58). The DB floor checks only `project_teams` (project, team) and `team_members` (team, member) → `TIME_ENTRY_NOT_ON_PROJECT_TEAM`: the old `resolveTeamRate` falls back to `project_teams ∩ team_members` without a curated row (`team-time.service.ts:2481-2499`), so a curated DB floor would break old-backend logging from M1 to step 6 (a deviation from L1 as first written). Uncurated pairs that log team time today are back-filled into `project_team_members` by M1 (**D16**, decided), so they keep the team option; the L1b query counts them before and after. `GET /time/projects/:id/work-items` asserts `access.roadmap`. | F1 · S1 · L1 · D16 |
| E13 | Seatless team member (8 of 39 prod) | Logs for the team when curated with `time.log`; never the workspace option (step 4 needs `workspace_members`). | CHANGE-12 |
| E46 | Attached team on time off or plan-less | Still "team present": `unavailable: team_time_off \| plan` suppresses the workspace option. "Just me" only if nothing else (L31). | F21 · U8 · L34 |
| E49 | Free-workspace editor on the owner's project | "Just me" for anyone with `time.log` and no governed option. Why?: "Your workspace's plan doesn't include timesheets; this time is just for you." | U5 · L31 · D2→(b) |
| E52 | Two attached teams, no Business override | Same sheet scope (`workspace`, `team.workspace_id`) and rate source → auto-pick, read-only chip. Two teams that each use member rates stay two options, because the collapse key adds the team id for `team_member_rates` (D60). | U1 · L26 · CHANGE-2 |
| E53 | Projects A (team) and B (no team), one Pro workspace, one week | One `workspace` sheet; `context_kind` is a reporting tag (was two sheets and approvals). | U1 · L26 |
| E26 | Stale remembered default | Ignored; next ambiguous write asks. | — |
| E40 | Two agreements on one project (500/h vs 900/h) | Default is a prefill needing one tap on start and manual add, never silent. Alias uses the default. | F10 · L38 |
| E34 | Placed talent asked "team or agreement?" (signing adds them to the hirer team, `20261001100000:362-366`) | `assignment.team_id` defaults to the hirer `engagement_parties.team_id`; step 3 suppresses teams equal to an **available** assignment's `team_id` or hirer party team (D59: an assignment that is `no_settings`, `contract_disabled` or `engagement_inactive` never removes the team). Team report gains hours-only "Under agreements" (identity per L22). | F4 · U10 · L35 |
| E10 | Entry moved to another project | Uncached re-resolve; `context_kind`, `context_ref` and FK change together, only while both sheets are `open`/`returned`; rate, currency, label re-snapshot as estimates; `trg_time_entries_30_timesheet` moves it; locked target → `TIMESHEET_LOCKED`. | F2 · L2 · L60 |
| E32 | Edit or bulk "Change For…" | As E10; FK `SET NULL` never touches `context_ref`. A PATCH that round-trips the entry's current `logging_for` is not re-resolved, so a plan downgrade or a lost curation never blocks a note fix; PATCH never re-checks caps or `allow_manual_entries` (D66). | F2 · L2 |
| E42 | "Change For…" into a backdated assignment | Only `created_at ≥ assignment.created_at` and `started_at ≥ assignment.started_at`; no re-attribution (`off-platform-engagement-adoption.md:153,159`). | F15 · L58 |
| E30 | Team detached with open sheets or a running timer | Sheets stay submittable; stop changes only `ended_at` (trg_10 ignores it); no new team option. Writes resolve uncached; only `logging-for` and pickers use the 30 s Redis cache, evicted by policy writes and assignment create/end. | F20 · L60 |
| E7 | Member leaves the team with an open sheet | Can submit; trg_10 validates only INSERT or non-NULL change of project, team or member. | L17 |

### Assignments and engagements

| # | Case | Handling | Source |
|---|---|---|---|
| E14 | Assignment ends mid-period | Manual entries in the window allowed. Rebuilt `tg_engagement_assignment_running_timer_guard` stops the timer at `NEW.ended_at`, `flagged_reason='stopped_by_assignment_end'`, `timer_auto_stopped`; ending never refuses. | F9 · L37 · CHANGE-22 |
| E39 | Engagement ends with active assignments | `EngagementsService` ends them in the same transaction (E14). Step 2 needs governing engagement `status='active'` and settings in force (else `engagement_inactive` / `no_settings`). `14-engagement/lifecycle-and-edge-cases.md:66,139` drop "End is blocked while a timer runs". | F9 · L37 |
| E15 | Adopted, backdated engagement | Assignment `started_at` ≥ engagement start, inside the retroactive window; no re-attribution (E42); `time_billing_floor(contract)` (E36). | L6 · L58 |
| E33 | Placed talent's hours must reach the client invoice | Talent branch of `POST /api/engagements/:id/assignments` sets `client_engagement_id` to the active client engagement whose consultant provider is the talent hirer; several → `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED`. Rebuilt `tg_engagement_assignments_guard` → `ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER`. Entry carries the talent **cost** rate; client price at composition (L9). | F3 · M7 · L8 |
| E58 | Hirer-seat holder, no longer project admin, creates an assignment | Created; grant only with `members.manage`, as an upsert on one-row-per-pair `project_access (project_id, user_id)` (`20260507000130`): new row = editor, `origin='engagement:<talent_engagement_id>'`, `has_direct_grant=true`; existing row = `has_direct_grant=true`, role raised to editor only if lower, `origin` untouched. Otherwise `access_needed: true` ("Ask a project admin to add <name>"). Client-engagement self-assignment needs existing `time.log`. | S6 · L25 |
| E43 | Backdated amendment or retroactive team rate | Write-time rate is an estimate. `TimesheetsService` re-resolves per entry for local date `d` in TypeScript (`TimeRatesService`, `ratesInForceOn`, `settingsInForceOn`): team row with `start_date ≤ d ≤ coalesce(end_date, ∞)`, or the engagement row by `rate_kind` preferring `work_type = entry.work_type_snapshot` over `work_type IS NULL`; passes it as `p_freeze`, which `time_timesheet_transition` checks against the sheet's entry ids and applies under `app.time_freeze`. Legacy entries are frozen in SQL (M2, M4). | F16 · M3 · L10 · CHANGE-4 |

### Approvals and timesheet state

| # | Case | Handling | Source |
|---|---|---|---|
| E20 | Submitter is the only decider | `self` only without cost money (structural, `time_sheet_has_cost_money`, D12): a team entry whose team has `member_rates_enabled` **and** whose workspace has `time_team_rules`, or any talent-engagement entry. On account deletion the same case routes `auto`, never `self` (D14). With cost → `can_manage_workspace(policy_workspace_id)`, member excluded; nobody → stays `submitted`, "No one else can approve this. Add a workspace admin." | S4 · L23 · CHANGE-9 |
| E21 | Submitter is an approver among others | Cannot decide own sheet; others notified. | — |
| E54 | Sole rated team owner skips approval or pays self | `approval_required=false` with `member_rates_enabled=true` → `TEAM_RATES_REQUIRE_APPROVAL` (read as true if rates turn on later). `create_payout_and_mark_paid` refuses `p_created_by = p_member_user_id` (`PAYOUT_SELF_NOT_ALLOWED`). Every write → `time_policy_events`. | S4 · L23 |
| E38 | `auto`/`self` sheet needs a late entry | Member reopens own approved `auto`/`self` sheet (note optional) → `open`, event `reopened`, until any entry is reserved, paid or has `legacy_status`. The member may also submit an `auto`/`self` sheet before the period ends; a manual-route sheet answers `too_early` until its last local day (D13). Time cron auto-submits `max(reminder_days,1)` days after period end, skipping running entries (`submission_kind='auto'`, `auto_submitted`), for periods that ended within the last 45 days (D67). Invoice cron no longer auto-submits. | F8 · U7 · L33 |
| E55 | Someone forgets to submit | `reminder_days = 1` → `timesheet_reminder`; auto/self auto-submit (E38); others get the welcome-line nudge; billable hours caught up later (E36). | U7 · L33 |
| E11 | Plan downgrade | Frozen `policy_snapshot`/`approver_scope` keeps sheets decidable; `can_decide_timesheet` never checks plan. No new governed entries; overrides ignored, kept. Hourly contracts keep composing (E59). | F13 · L40 · L13 |
| E19 | Reopen after payout or invoice | `TIMESHEET_HAS_SETTLED_ENTRIES` while any entry has `payout_id`, `legacy_status='paid_outside'` or an `invoice_time_entries` row (draft or issued); `'rejected'` does not block. | L6 · L48 |
| E48 | Contract limit or team cap exceeded | Contract `weekly_limit_minutes` (engagement sheets, only when the contract sets it) per (worker, governing engagement) across projects, in the sheet timezone and `week_start`; team caps per (member, team) per week, then month. Freeze: round → cap → price; `payable_seconds` cut unless `approve_overtime: true` (`timesheets.overtime_approved`). A workspace or team **policy** weekly limit never cuts: the review screen shows it as an indicator (D65). Writes warn (`CONTRACT_WEEKLY_LIMIT` only for a contract-set limit), except `HOUR_CAP_EXCEEDED` where `overtime_requires_approval` blocks today (D46). | M9 · L12 |
| E27 | Approvals from several workspaces | Card and queue unfiltered; each row carries the sheet's policy-workspace tag when it differs from the viewer's current workspace (as on the dashboard card). L57 applies to the For chip only. | U15 · L57 |
| E56 | Approver who never logs (P7) | Decider or has waiting approvals, and 0 entries in 30 days → approver mode: "Start timer" only, Waiting for you first; `GET /time/me/overview` returns `approver_mode`. | U11 · L36 |

### Money, invoices and payouts

| # | Case | Handling | Source |
|---|---|---|---|
| E16 | Two client engagements on one project | Bill (a) assignment entries with `client_engagement_id = contract.engagement_id`, (b) team entries of the provider party's `engagement_parties.team_id` on a project with an active `engagement_project_links` row. `invoice_time_entries UNIQUE(entry_id)`. | F7 · L6 · L7 |
| E17 | Two legacy `time_based`/`hybrid` contracts | `LEGACY_CONTRACT_AMBIGUOUS`; `hybrid` counts. | m4 · L6 · L7 |
| E57 | Legacy contract, client staff also log | Only team entries of the provider seat's `contract_positions.team_id` (NULL → a team owned by the provider seat user) bill; none or several → `LEGACY_CONTRACT_AMBIGUOUS`. | F6 · L7 |
| E62 | Consultant in-house staff on an engagement project | Bill under E16 (b), keeping today's revenue. | M6 · L7 |
| E63 | Consultant's own client-engagement time | Cost `rate_snapshot = 0`, `amount_snapshot = NULL`; finance reads only `amount_snapshot`; billing priced at composition. | M1 · L3 · CHANGE-3 |
| E36 | Hours approved after their period was invoiced | Approved, unreserved, non-training, `local_date ≤ period_end`, `≥ time_billing_floor(contract_id)`; pre-`period_start` hours on "Earlier hours", never against a hybrid allowance. Floor `greatest(service_start_date, first legacy_import date)` — the M2 apply day — keeps 225 legacy approved (664 h) and 4 paid out, and means nothing dated before M2 ever bills (D71). Local date in the policy timezone of `contracts.workspace_id` (NULL → contract project's workspace). | F7 · M4 · L6 · CHANGE-6 |
| E37 | Void-and-replace, void, draft delete, recompose | Replace moves reservations (`UPDATE invoice_id`); the others delete dropped ones. Issue verifies the set and per line `round(Σ bill_seconds/3600, 2)` = quantity. | F7 · M5 · L6 |
| E73 | Retainer (`attach_hours=false`) | Never reserves or blocks reopen. | m4 · L6 |
| E61 | Rate unit `month`/`fixed`, or fixed team rate | Billing: retainer/fixed lines. Cost: `rate_type_snapshot='fixed'`, amount NULL. Payouts → `FIXED_RATE_NOT_PAYABLE_BY_ENTRY`; pay manually. | M2 · m1 · L9 · L62 |
| E72 | `detailed` invoice, client level `none` | `least(invoice.hours_detail_level, client_hours_detail_level)`; approved hours, never identity; legacy = `none`. | M13 · L22 · CHANGE-7 |
| E59 | Free/downgraded workspace with signed hourly contract | `time_billable_invoices` checked only at create/sign (`BILLING_HOURS_REQUIRES_PLAN`); no zero-hour drafts. | M10 · L13 · CHANGE-21 |
| E60 | Pro team billing periods (all 6 prod contracts `period_source='team_config'`) | `pay_period_config` stays in Team › Settings › Time as "Billing and pay cut-offs", editable with `time_billable_invoices` or `time_payouts`. | M11 · L14 |
| E18 | Payout across sheets | Owed = approved, team context, `payout_id IS NULL`, `legacy_status IS NULL`; single currency; `round(sum(payable_seconds/3600 × rate_snapshot), 2)` once. | m2 · L63 · CHANGE-5 |
| E22 | Mixed currencies (4 prod person-weeks PHP + USD) | Per-entry amounts; "Amount at approval" per currency; sheet totals in hours. | m3 · L64 |
| E74 | Rounding; entries under half an increment | Per entry, nearest, ties up (D14); < 7.5 min at 15-min → 0, shown. Line `round(bill_seconds_sum/3600 × bill_rate, 2)`; total = Σ lines. | m2 · L63 · CHANGE-23 |
| E75 | Owed `until` and cut-offs | Via team policy timezone (`time-periods.ts`), never raw `started_at`. | m5 · L65 |
| E64 | Legacy rejected entry (744 h) | Approved = `payable_seconds IS NOT NULL AND legacy_status IS DISTINCT FROM 'rejected'`; totals sum `payable_seconds`, so it never reaches invoices, `getUncostedHours`, reports or dashboards. Week imports approved with the marker (D12). | M8 · MD-11 · L11 · L48 |
| E45 | Prodigitality legacy money, rates off (289 entries) | Frozen from stored `rate_snapshot` (D13); `costVisible` hides it under `member_rates_enabled=false`; `retroactive_log_days` NULL inherits. | F18 · L59 |

### Privacy and authorization

| # | Case | Handling | Source |
|---|---|---|---|
| E23 | Client-side admin opens Project › Time | `ENTRY_SELECT` has no money or email; assignment rows "Delivery team"; "Client hours" tab unless `none`. Nav/route need `time.log`, `time.view_team_logs` or client level ≠ `none`. "Mine" → "Your time on this project →" (`/time?project=<id>`). | F19 · U9 · U13 · L22 · L55 |
| E35 | Talent identity on a client-owned project (Scenario 1) | Placed talent (an assignment with a `talent_engagement_id`) is visible to the worker, talent hirer and provider, and client provider; all others, incl. client hirer at `detailed`, see "Delivery team". A consultant's own client-only assignment time stays named, the client hirer included (D57). Members list masks a row as "Delivery team member" when the user is the worker of an assignment on this project under an engagement where the viewer is not a provider-side party — keyed on assignment workers, never `origin` (one `project_access` row per pair). "Who can log time here" omits them for non-parties. | F5 · S3 · L22 · CHANGE-7 |
| E12 | Cross-workspace team (3 prod links) | Policy and approver from `team.workspace_id`. Axis 7: person, interval, duration, work-item kind, totals; titles and notes only with `access.time`, else "A project you can't open" (review, reports, exports). Attach dialog: "Time this team logs here is approved in <team workspace>. Approvers who can't open this project see hours only." | F14 · S2 · L21 · CHANGE-8 |
| E65 | Probed ids | `can_view_timesheet` covers sheets, entries, segments, comments, plus a team manager on every team-context entry of their team (D49); personal is member-only; misses are 404, and so is a non-owner with no `project_access` row and any non-uuid id. `policy?for=`/`logging-for` accept only the caller's options. `approve-bulk` checks each id in the RPC, all-or-nothing. | S5 · L24 · CHANGE-17 |
| E66 | Guest (`x-guest-user-id`) | All `TimeModule` controllers and the alias → 404, except `GET /time/me/overview` (empty shape, `can_log:false`) and `GET /time/me/running` plus alias `GET logs/me/running` (`null`): every signed-in client polls them, and `null` reveals nothing (D08). | S10 · L44 |
| E67 | Payout recorded | Message "A payment was recorded for your time"; no amount in push, email or content (spec-asserted for every time type). | S9 · L43 · CHANGE-19 |
| E68 | Report export | `exportColumns`-style gating on `costVisible`; notes/titles per E12, identity per E35; same authority query as the screen. | S11 · L45 |

### Deletion

| # | Case | Handling | Source |
|---|---|---|---|
| E6 | Team deleted with live sheets | `context_ref` and label survive; `trg_timesheets_guard` allows `team_id` SET NULL; approval falls to `policy_workspace_id` admins (D6 → a). | L2 · L17 |
| E8 | Account deleted | `delete_account` (M3) submits `open`/`returned` sheets, `submission_kind='on_deletion'`, actor NULL, no `p_freeze` (cron job 4 freezes), never `self` (D14); after the deletion the backend sends `timesheet_submitted` to the deciders of those sheets that wait on a person (D54). "Deleted user" snapshots. Purge/preflight functions refuse `TEAM_HAS_OPEN_TIME` / `WORKSPACE_HAS_OPEN_TIME` while submitted sheets or approved-unpaid team entries (teams with `payouts_enabled` only, D17) exist; the preflight lists them as `blockers` and `delete_account` raises the first. Copy: "This team has time waiting for approval or payment. Hand it to another member instead of deleting it." (D70). Notifications skip `profiles.deleted_at IS NOT NULL`. | F11 · L39 · CHANGE-20 |
| E9 | Project deleted | `TimeEntriesService.stopRunningForProject` (replacing `stopRunningLogsForProject`, called at `projects.service.ts:1317`) first, then `project_id` SET NULL; labels kept. | L17 |
| E69 | FK SET NULL (team, profile, workspace) | trg_10 checks non-NULL only; `_30_timesheet` ignores NULL member; `trg_timesheets_guard` allows NULL `member_user_id`, `team_id`, `workspace_id`, `policy_workspace_id`. | MD-5 · L17 · CHANGE-14 |

### Migration, compatibility and first visit

| # | Case | Handling | Source |
|---|---|---|---|
| E29 | Old backend writes between M1 and step 6 | trg_10 derives kind, ref, label, `work_item` (`'other'` without task); M1 back-fills legacy rows first, so old updates (`status='approved'`, stop, edit) succeed. CHECK, sheet and lock triggers arrive in M2; M4 reconciles post-M2 reviews. | MD-1 · MD-12 · L4 · L49 |
| E70 | Trigger order M1–M5 | M1 renames `trg_task_time_logs_engagement_assignment_guard` → `trg_time_entries_20_assignment_guard` and `trg_set_task_time_logs_updated_at` → `trg_time_entries_90_updated_at`, so name order = designed order; guard keeps `status` in its column list until M5. | F17 · MD-13 · L50 |
| E71 | Old `heal-orphaned-logs` would set `team_id` on personal/workspace entries | Before M1: pause its Cloud Scheduler job; PR-0 handler returns `{healed:0}`. | MD-4 · L16 |
| E72a | Rollback to the old backend before M5 | "Read, approve, stop and start in the current week only"; edits in submitted/approved sheets and locked periods error. Payouts work: M2/M3 bodies pay `payable_seconds IS NULL AND status='approved'`. Until M5, `time_timesheet_transition` mirrors `status` (approve → `'approved'`, or `'rejected'` for legacy rejected; reopen → `'pending'` wherever it clears a freeze; return → `'pending'` on old per-entry approvals, D16), so a reopened or returned entry is never paid via the fallback. The new backend never pays those rollback-era approvals itself (D70). | MD-3 · MD-4 · M12 · L15 · L16 |
| E25 | Old mobile bundle calls per-entry review | 410 `TIMESHEETS_REPLACED_REVIEW` with origin-aware copy: native "Update the app to approve timesheets.", web "Approvals now happen by timesheet. Reload Proyekto." (D06); after alias retirement every `/api/team-time/*` → 410 `APP_UPDATE_REQUIRED`. Shells below 7000 cannot OTA (D15). | MD-6 · L18 |
| E76 | Legacy sheet reviewed by the member (1) or by nobody (3) | `trg_timesheets_guard` skips the decider check for `decision_kind='legacy'` and allows NULL `decided_by` (`can_decide_timesheet` never special-cases legacy). Under `app.time_maintenance`: `origin='legacy_migration'`, `submission_kind='legacy'`. | MD-10 · L47 |
| E77 | QA fixture re-run after a submitting run | `reset_qa_fixture` deletes fixture sheets in any status under `app.time_maintenance`; harness calls service-role `time_test_cleanup(p_project_id)`, which refuses any project not titled `itest …` or `[QA] …` (`TIME_TEST_CLEANUP_FORBIDDEN`, D22). | MD-8 · L20 |
| E78 | First visit: 361 unread legacy notices, 32 imported sheets | M2 marks `time_log_approval_requested` read. History: "Imported from per-entry review". M4: one `timesheets_imported` per decider ("<N> timesheets moved from per-entry review are waiting", title "Timesheets waiting", link `/time#waiting`). Logger banner "Your time is now grouped into timesheets. Past weeks were sent for approval for you.", dismissal in try/catch localStorage. | U6 · L32 |
| E79 | No workspace membership (12 of 43 prod) | `/time` is bare `_execution`; no slug or `NoWorkspaceFallback`. | U2 · L27 · CHANGE-10 |
| E80 | `/time` prefixes `/timeline` (`04-web/routing-and-access.md:178`) | `platformSurfaces.ts` matches segments (`isUnder`, `:134-135`). `FloatingActiveTimer` is an allowlist (`TIMER_VISIBLE_PATH_PREFIXES`, `:16-23`, after `stripWorkspacePrefix`, `:68-69`): `/time` is simply not added, no exclusion needed, and Timeline (`/project/…`) keeps the timer. `/work-items` dropped (redirect only). | U16 · L27 |
| E81 | Payouts and rates in the mobile shell | `/teams` is `app` (`platformSurfaces.ts:121`); a single-segment wildcard adds `["/teams/*/time/payouts","silent"]`, `["/teams/*/time/manage-rates","silent"]` ahead of it. | U12 · L54 |
| E82 | Old client logs on a project whose only team is off or plan-less (gap until the web PR) | The resolver offers only "Just me", so an old-client timer or manual add saves a **personal** entry where the old backend answered 403, and the team My Logs page then hides it (B11). Prod: 0 (Prodigitality is on and Business-comped). The rewritten QA script asserts the new behaviour | Critic CC14 · B12 |
| E83 | Timesheet notice opened on the current web | `/time/timesheets/<id>` 404s until the web PR; in the gap only the account-deletion path emits sheet notices (the cron job is created at step 9). Comment and timer notices keep team-page links for team-context entries (D29) | CC14 · B13 |
| E84 | Old team-logs member filter with a masked worker | The alias lists a masked placed-talent worker as `masked:<assignment>` / "Delivery team member"; filtering by that id is a 400 from the old DTO. Accepted: prod has no placed talent | P15 |

## Test Plan

A repo grep finds no time references in the agent, realtime or MCP, and `schemas/roadmap-ai-operations.json` is untouched, so the agent canary and `check:roadmap-ai-schema` are not required. Non-test proofs: L5, L16, L18, L19 by the CHANGE-13 runbook gates and step-6 smoke; L30 by runbook rules; L52 by the MD-15 embed check.

### Backend unit (Jest, `backend/src/modules/execution/time/`)

| New spec | Covers | Ledger |
|---|---|---|
| `time-periods.spec.ts` | Four kinds; semi-monthly 1–15/16–end incl. Feb and leap years; Manila vs UTC; DST (E2); `week_start` 1 and 7; E3; `local_date`; owed `until`. Shares `time/__fixtures__/period-parity.json` with SQL. | E2, E3, L65 |
| `logging-context.service.spec.ts` | Each CHANGE-12 step: guest/viewer/commenter → none; uncurated → `NO_LOGGING_CONTEXT`; order `is_primary DESC, attached_at, team_id`; `unavailable` reasons (`team_time_off`, `plan`, `contract_disabled`, `engagement_inactive`, `no_settings`) suppressing workspace; E34 suppression; `required` drops others; "Just me"; collapse (E52); confirm-prefill (E40); stale default; alias fallback; `LOGGING_FOR_INVALID`; writes skip Redis. | L1, L26, L31, L34, L35, L37, L38, L60 |
| `time-policy.service.spec.ts` | Layer precedence; override needs `time_team_rules`; contract wins per field; E41 defaults and hint order; `TEAM_RATES_REQUIRE_APPROVAL`; `approval_required` forced true; `time_policy_events`; assignment policy workspace `contracts.workspace_id` → hirer party `teams.workspace_id` → NULL, never `projects.workspace_id`. | L23, L28, CHANGE-11 |
| `time-rates.service.spec.ts` | E43 re-resolution (team row in force; 0 without rates or `time_team_rules`; `rate_kind` `cost`/`billing`; `work_type_snapshot` before NULL); E61, E63, E45; round → cap → amount; E48 caps and `approve_overtime`; nearest, ties up. | L3, L9, L10, L12, L59, L63 |
| `time-authority.service.spec.ts` | `costVisible` matrix; Axis 7 redaction; `email` only self and team-manager; E35 identity matrix with the assignment-worker mask (not `origin`); hirer money only on own talent engagement; client `least(...)`, legacy `none`; `can_view_timesheet`; Project Time nav gate; E65 404s. | L21, L22, L24, CHANGE-7/8/17 |
| `timesheets.service.spec.ts` | Four-state transitions; return needs a note; submit blocked while running; member reopen → `open` (E38), decider reopen → `returned`; `TIMESHEET_HAS_SETTLED_ENTRIES` (draft and issued); `STALE_REVISION`; `approve-bulk` all-or-nothing; E20 cost-money rule and fallback; `policy_snapshot`; post-downgrade decisions; `p_freeze` built in TypeScript, refused on entry-id mismatch; submit without it stays `submitted`. | L23, L24, L33, L40, CHANGE-9 |
| `timesheets.service.cron.spec.ts` | `POST /time/cron/run`: E38 auto-submit; `timesheet_reminder` once; 10 h notice once; 24 h stop; job 4 freezes sheets submitted without `p_freeze`. | L33, L61 |
| `time-entries.service.spec.ts` | Start/stop/pause/resume; 23505 → `TIMER_ALREADY_RUNNING` (alias 400); `MANUAL_ENTRIES_DISABLED`; `RETROACTIVE_WINDOW`; `HOUR_CAP_EXCEEDED` rule; E10/E42 moves; `TIME_ENTRY_LOCKED`/`TIME_PERIOD_LOCKED` → `TIMESHEET_LOCKED {reason}`; `expected_updated_at`; unchanged `logging_for` never re-resolved; timer notices cleared on edit-end and delete. | L2, L12, L58 |
| `time-errors.spec.ts`, `time-freeze.spec.ts`, `time-cache.spec.ts`, `guards/time-guest.guard.spec.ts`, `dto/dtos.spec.ts` (built) | Every sentinel → status and code, alias variants, no Postgres text in a 500; rounding ties up, cap order, fixed → no amount; null Redis no-op, epoch read once, buffered alias flush; guest 404 vs empty shape; whitelisting and the legacy DTO field sets | D30, D50, D55, D56 |
| `time-projects.facade.spec.ts` (built) | Dashboard counts by D03 predicates, `sheet_status_counts`, fees from cost-visible entries only, masked person filter, roster masking | D69 |
| `legacy/team-time-legacy.{service,mapper}.spec.ts` (built) | Row builder, status map over every column combination, review fields, cost keys absent when hidden, summaries, member lists and masking | D03, D05, D32 |
| `time-entries.service.plan-gate.spec.ts` | Port of `team-time.service.plan-gate.spec.ts` to split keys on the context's workspace; contract and personal never gated; wind-down and own reads open. | CHANGE-21 |
| `time-reports.service.spec.ts` | `team`/`project`/`workspace`/`engagement` scopes; "Under agreements"; `payable_seconds` totals; E68 export; `audit-export` needs `time_audit_export`. | L11, L35, L45 |
| `time-notifications.service.spec.ts` | One row per sheet per decider; `clearForSubject`; links `/time/timesheets/<id>`, `/time` (`time_payout_recorded`), `/time#waiting` (`timesheets_imported`); tombstones skipped; E78 digest; `timer_auto_stopped`; **no digit-bearing money in any time `content.message`**. | L32, L39, L43, CHANGE-19 |
| `team-time-legacy.controller.spec.ts` | All 30 old routes (the 29 the web calls plus heal): delegation with `purpose:'alias'`, response keys, 201 vs 200, uuid 404s, 410 `TIMESHEETS_REPLACED_REVIEW` per origin, buffered telemetry, plus an in-process HTTP block. The `APP_UPDATE_REQUIRED` stub comes with retirement. | L18, D30 |
| `time.controller.guest.spec.ts` | E66 + D08: every handler of every time controller 404s a guest, except `me/overview`, `me/running`, alias `logs/me/running` and the two `@Public` cron routes. | L44 |

**Existing specs** (paths verified; `execution/team-time/*.spec.ts` is deleted with the module in PR-1):

| Spec | Change | Ledger |
|---|---|---|
| `execution/projects/permissions/project-permissions.spec.ts`, `effective-permissions.spec.ts` | `time.log` editor+; in the effective-permissions snapshot | L1 |
| `projects.controller` `my-permissions` spec | Adds `time_client_hours_level` | L22 |
| `execution/projects/projects.service.dashboard-summary.spec.ts` | `payable_seconds`; fee total behind `costVisible` | L11 |
| `execution/projects/projects.service.delete.spec.ts` | E9 via the time service | E9 |
| `execution/teams/team-authority.spec.ts` (new); `teams.service` `assertCanManageTeam` spec | Owner-role row and admin accepted, parity with `can_manage_team`; `assertCanManageTeam` routed through `team-authority` | L41 |
| `execution/teams/teams.service.plan-limits.spec.ts` | E60 cut-off editor | L14 |
| `entitlement.guard` specs | Deleted | CHANGE-21 |
| `marketplace/invoices/invoice-composition.service.spec.ts` | E16, E17, E57 scope; E36 eligibility incl. NULL `contracts.workspace_id`; `ratesInForceOn` `billing` with `work_type` across an amendment, grouped `(task, bill_rate)`; E61 lines; E74 rounding; `assertNoInternalRates` unchanged | L6, L7, L9, L63 |
| `marketplace/invoices/invoices.service.time-reservations.spec.ts` (new) | E37 and E73 | L6 |
| `marketplace/invoices/invoice-scheduler.service.spec.ts` | No period-end auto-submit; `team_config` unchanged; E59 | L13, L14, L33 |
| `marketplace/contracts/contracts.service.write.spec.ts`, `contracts.service.signing.spec.ts` | `BILLING_HOURS_REQUIRES_PLAN` at create/sign only | L13 |
| `marketplace/payouts/payouts.service.qa-fixture.spec.ts` + new `payouts.service.spec.ts` | E18, E54, E61, E75, E67 | L15, L43, L62, L63, L65 |
| `marketplace/financials/financials.service.uncosted.spec.ts` (new) | E64 in `getUncostedHours` | L11 |
| `marketplace/finance/books/finance-books.service.hub.spec.ts`, `finance/exports/finance-export.spec.ts`, `finance/finance.service.spec.ts`, `finance/eligibility/engagement-eligibility.service.spec.ts` | Read `time_entries`; cost from `amount_snapshot`; export redaction | L3, L45 |
| `marketplace/engagements/engagements.service.spec.ts`, `engagements.rates-in-force.spec.ts` | `settingsInForceOn`, `assignmentIdsForClientEngagement`, `policyWorkspaceFor`, `hirerPartyTeamId`; E39 | L37, L46 |
| `marketplace/engagements/engagement-assignments.service.spec.ts` (new) | E33, E34 default, E58 incl. the `project_access` upsert | L8, L25, L35 |
| `marketplace/engagements/engagement-project.service.spec.ts` | `ensureProviderAssignment` on renamed tables | — |
| `shared/account/account.service.spec.ts` | E8 refusals | L39 |
| `shared/entitlements/entitlement-keys.migration-parity.spec.ts`, test kit (`buildSeedLimitRows`/`buildSeedKeyRows`), `services/workspace-usage.service.spec.ts` | Seven keys, M0 labels, sort 120–126 (PR-1) | L53 |
| `shared/push/notification-push.spec.ts`, `shared/notifications/email/notification-email-registry.spec.ts`, `notification-email-parity.spec.ts` | New types; phantom `time_log_marked_*` titles deleted; email eligibility | L43 |

Run `npx jest <paths>` from `backend/`; lint with `npx eslint <files>`, never `npm run lint` (it fixes the whole repo).

### Real-DB integration (`backend/test/integration/`, `npm run test:integration`)

Loads `backend/.env.development.local`. New helper `describeDevOnly` skips unless `SUPABASE_URL` contains `vyiedlwasdwmjbztqznl`. `h.cleanup()` calls `time_test_cleanup(p_project_id)` before LIFO deletes (PostgREST cannot `SET LOCAL` the GUC).

| Spec | Runs on | Covers | Ledger |
|---|---|---|---|
| `time-rename-compat` | dev; prod read-only only with `TIME_RENAME_COMPAT_PROD_READONLY=1` (SELECTs, never AppModule) | View insert/select derive kind, ref, label, `work_item`; MD-15 embeds; `anon`/`authenticated` denied; function ACLs | L4, L42, L52 |
| `time-functions` | dev | Payout create/void (M2/M3 fallback, then M5); `time_timesheet_transition` `status` mirroring (E72a); `delete_account`; `reset_qa_fixture`; both engagement guards; three purge/preflight rebuilds; `time_test_cleanup`; `time_policy_delete` keeps the audit | L15, L20, L37, L39 |
| `time-period-parity` | dev (bare client, never the harness); prod by one read-only MCP `SELECT` over the 93 fixture cases | `time_period_for` = `time-periods.ts` | E2 |
| `time-entries` | dev | One of two concurrent starts wins; no `project_access` → 404; viewer → 403 `NO_LOGGING_CONTEXT`; uncurated editor → workspace option or "Just me" (D58); personal on Free; guest 404 and `me/running` `null`; open entries only | L1, L44, L49 |
| `timesheets` | dev | Freeze from `p_freeze` (mismatch refused); `trg_time_entries_40_lock`; reopen refused after payout/reservation; member reopen → `open`; exclusion constraint; FK SET NULL; legacy guard; E20 fallback; overtime | L12, L17, L23, L47 |
| `engagement-assignments` | dev | E58 grant and upsert (no downgrade, `origin` kept); non-party 404; `ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER`; E39 with `stopped_by_assignment_end`; hirer-approved sheet | L8, L25, L37 |
| `invoice-billable-hours` | dev | E16, E17 (incl. hybrid), E36, E37, E57, E62, E73; `UNIQUE(entry_id)` blocks a second draft | L6, L7, L9 |
| `time-legacy-migration` | dev (deleted with `time_legacy_backfill` in M5) | 414-shaped fixture → approved/submitted/open sheets; `paid_outside`, `rejected` markers; D12; `origin='legacy_migration'`, `submission_kind='legacy'`; NULL and self deciders; no inferred assignment; approved hours = old `approved+paid` | L11, L47, L48 |
| `qa-fixture` (extended: team-context `createTimeEntry`, `time_test_cleanup`, sheets cleared on reset) | dev (the harness boots AppModule, so never prod) | E77 | L19, L20 |

`describeDevOnly` (exported by `harness.ts`; P01/P02B specs keep a local copy) skips unless `SUPABASE_URL` names the dev project. The production QA script `backend/scripts/verify-production-qa.ts` is rewritten for timesheets (log on the previous closed period, submit, consultant approves, invoice that day, 7 h × 100 = 700) and is run with `QA_TARGET=development`; `production-qa.yml` is not a rollout gate until prod `qa_fixtures` is seeded (D53).

All files are `*.integration-spec.ts`.

### Migration verification

Run the **Verification SQL** in [migrations and rollout](./migrations-and-rollout.md#verification-sql) after each step on both databases, dev first. It is the single source (including the L1b count for D16, the dev smokes, the step-6 smoke and the M5 gates) and is not duplicated here.

### Web unit (Vitest, `npm test` from `web/`)

| Test | Covers | Ledger |
|---|---|---|
| `lib/platformSurfaces.test.ts`, `platformSurfaces.routes.test.ts` + snapshot | `["/time","app"]`; `*` wildcard; E81 rows; `/project/x/timeline` not matched by `/time` | L54, E80 |
| `lib/workspacePaths.test.ts` | `/time`, `/time/timesheets/<id>` stay bare | L27 |
| `lib/pushLink.test.ts` | Bare timesheet links open in place | CHANGE-10 |
| `routes/_execution/workspaceRedirectStubs.test.ts` | `my-logs[?log=X]` → `/time?for=team:<t>[&entry=X]`; `team-logs?log=X` → its sheet; `time/log/:id` → `/time?entry=`; `?view=team` → `?view=everyone` | Redirects |
| `api/axios.test.ts` | 403 silencing on `/api/time/me/*`; `team-time` rule kept while the alias lives | L18 |
| `components/project/projectNavItems.test.ts` | E23 nav gate; `ownsSegment` `/time` vs `/timeline` | L22 |
| `components/project/permissions/permissionCatalog`, `roleTemplates` tests | `time.log` placement and defaults | L1 |
| `executionNavigation` / `SidebarContent` test | Time item, badge, overview gate | L27 |
| `components/workspace/settings/workspaceSettingsNavigation.test.ts` | `settings/time` entry | L28 |
| `components/finance/team/TeamFinanceChrome.test.tsx` | `time-logs` tab kept for book roles | L55 |
| `lib/planLimits.test.ts`, `lib/pricing.test.ts`; `lib/tours/demo/dashboardDemoDataset` fixture test | Seven keys, labels, tiers (web PR) | M0 |
| `NotificationBell` test | New type labels | L43 |
| `content/docs.manifest.test.ts`, `docs.content.test.ts`, `docsContent.test.ts` | New articles; no prices, `/pricing`, "per user", "USD"; body > 400 chars, no leading `# ` | Docs |
| New: `TimePage`, `ForChip`, `SubmitSheet`, `TimesheetReview`, `FloatingActiveTimer` (`.test.tsx`), `useActiveTimer.test.ts`, `services/time.service.test.ts` | E56 approver mode; E51 label; E41 card; E78 banner with throwing `localStorage`; chip "For", popover "Who approves this time"; E40 prefill; E27 tag; real-label truncation; E28; submit blocked while running; four states ("Reopened by you" under Open); E22; E48 overtime; "A project you can't open", "Delivery team"; E20 empty state; E80 timer (absent on `/time`, present on `/project/…/timeline`); `["time"]` prefix; `Header.tsx` `validPaths` has `/time` | L29, L32, L36, L38, L56, L57, L64 |

### Playwright e2e (headless, minted dev session, dev DB)

`web/playwright/tests/time.spec.ts` (`npm run pw:test`) plus the adaptive driver `web/playwright/time-qa.mjs` (modelled on `meetings-qa.mjs`, `HEADLESS=1`), which observes each screen before acting, titles rows "[QA] …" and cleans up via `time_test_cleanup`.

| # | Scenario | Asserts |
|---|---|---|
| 1 | Log → submit → approve → payout (Business team with rates) | Timer from a task, manual add, Submit sheet, Approved sublabel, owed amount rounded once, amount-free payout notice |
| 2 | Approver-only landing | E56 |
| 3 | Scenario 1 (placed talent, client-owned project) | "Delivery team" rows, no money, no talent in members, no "Client hours" at `none` |
| 4 | Two agreements | Prefill needs a tap; rate follows the choice |
| 5 | Viewer | No timer buttons; Time nav hidden at client level `none` |
| 6 | Cross-workspace attach | Dialog copy; "A project you can't open" |
| 7 | First visit and import | Confirm card; banner stays dismissed; "Imported from per-entry review" |
| 8 | Old links | `team-logs?log=`, `my-logs`, `/time/log/:id` |
| 9 | 390×844 viewport | No horizontal scroll on `/time` and review; no floating timer on `/time` |

**Audit harness:** `web/playwright/audit/routes.mjs:142-146` adds `/time`, `/time/timesheets/:timesheetId`, `/w/:slug/settings/time`, `/teams/:teamId/time` (Report · Rates · Payouts), keeping old team routes as redirect checks; `capture.mjs:144-148` discovers an entry and a timesheet from `/time` instead of `/time/log/` links. Run `npm run pw:audit:routes`.

## Docs to Update

### Developer docs (`docs/`)

**Done with PR-1 (backend side, a separate docs-only commit on the same branch, shipping with the merge):** `03-backend/api-reference.md`, `03-backend/modules.md`, `03-backend/authorization-axes.md` (Axes 5–6 rewritten, Axis 7 added), `07-data-and-db/schema-overview.md`, `11-domains/teams-and-time/README.md`, `11-domains/notifications/README.md`, `11-domains/finance/README.md`, `11-domains/finance/finance-books.md`. Everything else below, every `04-web/*` page and the in-app help wait for the web PR or their own step.

| Page | Change | Ledger |
|---|---|---|
| `11-domains/teams-and-time/README.md` | Full rewrite: context kinds, resolver (CHANGE-12), sheet scope (CHANGE-2), defaults (CHANGE-11), states (CHANGE-15), freeze (CHANGE-4), segments, delivery loop; fixes today's missing segments, `flagged_reason`, pause state, plan gate | all |
| `11-domains/finance/README.md` | `:24-38` payout RPCs (owed predicate, self and fixed refusals); `:49` `source_type` adds `retainer`/`overage`, "Earlier hours"; `:193-199` `invoice_time_entries` flow | L6, L15, L62 |
| `11-domains/finance/finance-books.md` | `:99-102` export cost columns and redaction; `:104-119` contract-gated time retired (`contract_enforcement` dropped in M5); `:121-129` split keys | L45, CHANGE-21 |
| `11-domains/workspaces/README.md` | `:496` limits, `:643` gates (seven keys); workspace policy and materialisation; Axis 7 | L13, L28 |
| `11-domains/notifications/README.md` | `:21` producers; `:65` email table (`timesheet_submitted` 60-min delay, `_returned`, `_reminder`, amount-free `time_payout_recorded`); `timer_auto_stopped`, `timesheets_imported`; historical `time_log_*` kept | L32, L43 |
| `11-domains/talent/README.md:58,74`, `access-and-permissions.md:64-65`, `discovery-and-delivery.md:41-42` | Talent logs under the assignment; `project_access` upsert grant; worker-keyed "Delivery team" mask | L22, L25 |
| `11-domains/guests/README.md` | Guests get 404 from Time | L44 |
| `14-engagement/{README,data-model,integration,end-to-end-flow,action-surface,scenarios,test-matrix,finance-navigation}.md` | Approval tables dropped in M3 for timesheets; governing engagement (CHANGE-3); `test-matrix.md:77-78` gaps closed | L3, L8 |
| `14-engagement/lifecycle-and-edge-cases.md` | `:66` ending stops the timer; `:139` end ends assignments; `:116` late entries in the window | L37 |
| `03-backend/api-reference.md` | `/time` endpoints; alias `/api/team-time` and 410 codes; `TimesheetActionDto`; error codes | — |
| `03-backend/modules.md` | `:43,55,208-216` `TimeModule`; `EngagementsService` exports; `team-authority.ts` | L46 |
| `03-backend/authorization-axes.md` | `:28` Axis 6 split keys; `:116-135` talent walk-through (`time.log`, step 0); `:132` editor+ fix; new **Axis 7** (CHANGE-8); `:158` no assignment `project_access` writes without `members.manage`; `can_manage_team` noted as anon-callable oracle, out of scope | L1, L21, L25, L41 |
| `04-web/routing-and-access.md` | `:20` team Time sub-nav, `settings/time`; `routes/_execution/time/index.tsx` (optional `time/route.tsx`) and `time/timesheets/$timesheetId.tsx`; `:178` `FloatingActiveTimer` allowlist without `/time`; `:302`; redirect map | L27, E80 |
| `04-web/state-and-services.md` | `:51` `services/time.service.ts`, `TimeEntry`, `["time"]` | — |
| `07-data-and-db/schema-overview.md` | `:9,122-123,231` new/renamed tables, `invoice_time_entries`, RLS + REVOKE, GUCs | CHANGE-18 |
| `07-data-and-db/migrations-workflow.md` | `:85`; `SET LOCAL lock_timeout='5s'`; invariant prechecks; commit after both databases apply; never `sync_supabase_dev.mjs apply` for MCP-stamped files; `NOTIFY pgrst` per file | L30, L51 |
| `09-mobile/ota-updates.md` | `:31-35` `native_build_min` filters bundles, cannot retire an alias; three-condition rule; D15 | L18 |
| `09-mobile/store-readiness.md` | New `/time` app surface; `/teams/*/time/{payouts,manage-rates}` silent; wildcard matcher | L54 |
| `10-infra-deploy/gcp-cloud-run.md` | `:64-67` Scheduler job for `POST /api/time/cron/run`; `heal-orphaned-logs` removed | L16, CHANGE-13 |
| `10-infra-deploy/ci-cd.md` | No commit spans `backend/**` and `web/**`. The web-PR merge runs `web-deploy.yml` and `mobile-ota-deploy.yml` together (`:25-29`); with `OTA_PUBLISH_ENABLED` the OTA publishes in that run (no extra dispatch, or a duplicate ships); dispatch only for a non-default `native_build_min`; unset, `:51` blocks both paths | L5 |
| `12-runbooks/time-entries-cutover.md` (new), `12-runbooks/README.md` | CHANGE-13 steps 0–11 and gates (L18, L19), MD-15 check, rollback limits; deleted after alias retirement | L5, L16, L18, L19 |
| `12-runbooks/production-qa-fixture.md` | `:7` any-status clear; `time_test_cleanup` | L20 |
| `01-product/glossary.md` | `:37` "Time log" → **Time entry**; add **Timesheet**, **For**, **Just me**, **Delivery team**, **Governing engagement** | CHANGE-15 |
| `01-product/project-lifecycle.md` | `:53-90` delivery loop with timesheets | — |
| `13-proposals/pricing-tiers-and-add-ons.md` | Time add-on (`:46-50`), D4, E7, B3/B5 → seven keys | CHANGE-21 |
| `13-proposals/README.md`, `docs/README.md` | Index row for `time-management/` | — |

When this ships, rewrite the folder into `11-domains/teams-and-time/` and delete it from `13-proposals/` after grepping inbound links.

### In-app help (`web/src/content/docs/`, ships with the web PR)

New files need a `docs.manifest.ts` entry. Tier names only, gates link to `/docs/workspaces-and-plans/plans`, never prices, "per user" or `/pricing` (`docs.content.test.ts`); copy says "Proyekto"; `teams-time-and-rates` keeps its name (public URLs).

| Article | Action |
|---|---|
| `teams-time-and-rates/time-tracking.md` | Rewrite as "Tracking time": timer, Add time, presets, "For" chip, one timer, 24 h auto-stop; drop "Pro and above", `:98-107` "not shown on Free", "primary team wins"; personal time on every plan |
| `teams-time-and-rates/timesheets.md` (new) | Periods, timezone, week start; four states and sublabels; withdraw, return, reopen (own auto/self); auto-submit after the grace day; locked rows; imported weeks |
| `teams-time-and-rates/approving-time.md` (new) | Waiting for you, review, bulk approve, overtime, "A project you can't open", no self-approval with cost, dashboard card |
| `teams-time-and-rates/time-policy.md` (new) | Workspace policy and first-visit confirm, team overrides (Business), agreement terms win, timezone and week start |
| `teams-time-and-rates/payouts.md` | Approved entries; no self-payment; manual fixed pay; "Billing and pay cut-offs" set invoice periods |
| `teams-time-and-rates/rates-and-currency.md` | Pre-approval rate is an estimate; the rate in force on the entry's date fixes at approval; per-currency amounts |
| `teams-time-and-rates/teams.md` | Replace the four-tab table with Report · Rates · Payouts and "Under agreements" |
| `workspaces-and-plans/plans.md` (`:12,43-44`), `limits-and-usage.md` (`:81-85`), `members-and-seats.md` | Time features by tier; no seat needed to log for a team |
| `start-here/navigating-proyekto.md` (`:57,94,110`), `start-here/what-is-proyekto.md` | Time in the sidebar at `/time`, outside any workspace |
| `account-and-apps/mobile-app.md` (`:72`) | Time on the phone; no payouts or rates in the app |
| `account-and-apps/deleting-your-account.md` (`:24`) | Open timesheets are submitted; teams/workspaces with open time must be handed on |
| `account-and-apps/notifications.md` | New time notices; payments never show an amount |
| `projects/access-and-roles.md`, `permissions.md`, `inside-a-project.md` (`:86-87,108`) | Editors+ log, viewers and clients can't; Project Time shows Everyone plus a link to your time; "Client hours" when allowed |
| `clients-and-marketplace/contracts-and-invoices.md` | Hours bill by their agreement, never twice; "Earlier hours"; clients see approved hours at the agreed level, never who |
| `ai-assistant/context-and-mentions.md:81` | Time-entry wording |

### Scripts and fixtures

Zero-hit grep required before M5 (L19): `scripts/seed_dev_project_finance.mjs:253` and `scripts/seed_finance_demo.mjs:248,596` (→ `time_entries` with `context_kind`); `backend/test/integration/qa-fixture.integration-spec.ts:85,117,143`; `web/src/lib/tours/demo/dashboardDemoDataset.ts:29,45` (`time_tracking_enabled`). **Done in PR-1** for the two seed scripts and the qa-fixture spec: they write `time_entries` with context columns and approve through timesheets (`time_timesheet_transition` or the API), and `seed_finance_demo.mjs` refuses to run unless the resolved Supabase URL is the dev project (D73). The web file waits for the web PR.

## See Also

- Siblings: [data model](./data-model.md), [backend](./backend.md), [UX](./ux.md), [migrations and rollout](./migrations-and-rollout.md), [pressure-test log](./pressure-test-log.md)
- [Pricing Tiers & Add-ons](../pricing-tiers-and-add-ons.md) (plan keys); [Off-platform Engagement Adoption](../off-platform-engagement-adoption.md) (no-backfill, `:153,159`); [Identity and Enrollment](../identity-and-enrollment.md) (capability gating)
- [Teams and Time](../../11-domains/teams-and-time/README.md) (current state); [Finance](../../11-domains/finance/README.md); [Finance Books](../../11-domains/finance/finance-books.md)
- [Engagement data model](../../14-engagement/data-model.md), [lifecycle and edge cases](../../14-engagement/lifecycle-and-edge-cases.md), [action surface](../../14-engagement/action-surface.md) (`:168`, client never sees talent identity)
- [Authorization axes](../../03-backend/authorization-axes.md); [Routing and access](../../04-web/routing-and-access.md) (`:178`); [OTA updates](../../09-mobile/ota-updates.md); [Production QA fixture](../../12-runbooks/production-qa-fixture.md)
- Migrations: [`20260810140000`](../../../supabase/migrations/20260810140000_rename_project_finance_tables.sql) (rename precedent); [`20260814021000`](../../../supabase/migrations/20260814021000_engagement_time.sql) (dark engagement-time tables replaced); [`20260814020000:444-534`](../../../supabase/migrations/20260814020000_engagement_core.sql) (`tg_engagement_assignments_guard`, rebuilt in M1); [`20260907090000:48-147`](../../../supabase/migrations/20260907090000_split_rates_and_payouts.sql) and [`20260701000020:179-214`](../../../supabase/migrations/20260701000020_create_payouts.sql) (latest payout bodies); `20260923090200_*`, `20260923090100_*` (account deletion, rebuilt in M3); [`20261001100000`](../../../supabase/migrations/20261001100000_external_amendment_backdating.sql) (effective-dated rates, signing insert `:362-366`)
