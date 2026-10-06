# Backend

> **⚠️ Built, held unmerged.** PR-1 implements this page on the local branch `feat/time-pr1` (2026-10-06), waiting for M2/M3 on both databases. [As Built in PR-1](#as-built-in-pr-1) lists every place the build differs from, or settles a question left open by, the sections below; statements that were wrong are corrected inline. When PR-1 merges, the shipped behaviour is described in [Teams and Time](../../11-domains/teams-and-time/README.md) and the [API reference](../../03-backend/api-reference.md#time--time-and-team-time).

> **Last updated:** 2026-10-06 · **Status:** draft

A `TimeModule` under `/api/time` replaces the 2,673-line `team-time.service.ts`. Four rules shape it: one resolver picks each entry's **For** context; one layered resolver answers every policy field; SQL predicates answer every authority question and TypeScript only calls them; money, content and identity are redacted by choosing a different select, never by a serializer. `/api/team-time` survives as an alias until telemetry shows no shell calls it. File:line references were re-checked read-only on 2026-10-02; ledger ids (L-n, CHANGE-n, D#, E#) are explained in the [pressure-test log](./pressure-test-log.md).

Part of the [time management proposal](./README.md).

## As Built in PR-1

D-numbers are the PR-1 build plan's binding decisions; "B" items are the accepted gap behaviours until the web PR merges. Rows without a number record a package's documented deviation.

### Module, contract and errors

| # | Topic | As built |
|---|---|---|
| D25 | Module cycle | `TimeModule` imports Supabase, Authorization, Notifications, Workspaces, EntitlementsCore and the new **`EngagementsCoreModule`** (provides and exports `EngagementsService`), never `EngagementsModule`; no `forwardRef`. `ProjectsModule`, `TeamsModule`, `PayoutsModule`, `InvoicesModule`, `EngagementsModule`, `FinanceModule` and `AccountModule` import `TimeModule`, which imports none of them. `FinanceModule` also imports and re-exports `EngagementsCoreModule` |
| — | Extra files | `time-cache.ts` (Redis, epoch-keyed), `time-errors.ts`, `time-freeze.ts`, `time-periods.ts`, `time-request.ts` (`isNativeOrigin`: exactly `capacitor://localhost` or `https://localhost`), `guards/time-guest.guard.ts`, `time-cron.service.ts`, `time-projects.facade.ts` (the projects module's only door), and `legacy/` (alias service, mapper, telemetry interceptor, old response types). No `team-time-retired.controller.ts` yet: it comes with alias retirement |
| D55, D68 | Unmapped DB errors | `throwTimeDb` maps a known sentinel, else logs `{code, message, detail, hint}` and throws 500 `{code:'TIME_INTERNAL', message:"Proyekto couldn't save this time. Try again."}`; read paths say "Proyekto couldn't load … Try again." No Postgres text reaches a response |
| D50 | Error extras | Body `{code, message, ...extras}`; extras never use `message`, `status`, `path` or `timestamp` (the exception filter overwrites them), so the period lock carries `sheet_status` |
| D33 | Transition errors | `TIMESHEET_TRANSITION_INVALID` is always 409 with `reason`; the guard backstop `TIMESHEET_DECIDER_INVALID` reads as `reason:'not_allowed'`; `return` or a decider `reopen` without a note is a 400 before the RPC ("Add a note so the person knows what to change.") |
| D56 | Logging-for cache | `getLoggingFor` returns `{value, epoch}` and `setLoggingFor` writes under the epoch read **before** the compute, so a bump during a compute never stores a stale result under the new epoch. Only `purpose:'read'` reads with no `requested` and `at` within 60 s of now use the cache; `remember()` bumps the epoch when the stored default changes |
| — | Constructors | `TimeEntriesService` appends `@Optional() engagements` (the friendly into-assignment pre-check; the DB still refuses without it). `TimeNotificationsService` appends `@Optional()` Redis (notify-once markers) and gains public `timerStopped(entry)` (D61). `TeamsService` and `AccountService` append optional time services; `PayoutsService` drops `NotificationsService`/`WorkspacesService` and takes `EntitlementsService`, `TimePolicyService`, `TimeNotificationsService` |
| — | Facade | `TimeProjectsFacade.dashboardTime(…, q: {from?, to?, team_id?, member_user_id?})` and an added `maskedWorkerIdsByProject(projectIds, viewer)` (one assignments probe instead of one read per project) |
| D48 | Old guard | `execution/entitlements/entitlement.guard.ts` is deleted with `team-time/`. `EngagementEligibilityService` keeps only its table rename and has no caller after PR-1 (the timer was its one consumer) |

### Resolver and policy

| # | Topic | As built |
|---|---|---|
| D08 | Guests | 404 on every `/time/*` and alias route, except `GET /time/me/overview` (the empty shape) and `GET /time/me/running` plus alias `GET logs/me/running` (`null`): every signed-in client polls them every 3–30 s, and `null` reveals nothing. The two cron routes are `@Public` |
| D58 | Uncurated editor (E31) | An editor whose attached team does not curate them gets the workspace option (with a seat and no curated team) or "Just me". 403 `NO_LOGGING_CONTEXT` only below editor. B12 below is the old-client consequence |
| D59 | L35 suppression | Only an **available** assignment option suppresses its team; `no_settings`, `contract_disabled`, `engagement_inactive` never do. So a set-up consultant whose client agreement has no settings in force keeps the team option, and their alias timers save team entries |
| D60 | Collapse key | `(sheet_scope.kind, sheet_scope.ref, rate_source, rate_source === 'team_member_rates' ? team_id : '')`; two teams with their own rate cards never merge. `requested` is matched before the collapse |
| — | Assignment window | Ended assignments count inside their window for every purpose except `timer` (not only `manual`) |
| — | `reason`, hints | `reason`: `none` = no `time.log`; `required` = several options, no valid default; `confirm` = several with a prefill; absent otherwise. `approver_hint` is never `self` (it would need a decider count). A workspace whose effective `tracking_enabled` is false is simply absent; one without `time_tracking` is listed `unavailable: plan`, which is what produces `personal_reason:'plan'` on Free |
| — | `workspace_tag` (L57) | The **governing** workspace's name when it differs from the project's workspace. [UX › For chip](./ux.md#for-chip) still says "the project's workspace name"; the web PR aligns it |
| D24 | Contract layer | `time_resolve_policy` (M1) already applies `engagement_time_settings`; TypeScript adds only the member caps and `client_hours_detail_level` (legacy → `none`). Member caps attach on any scope when a team id is given (Free/Pro team entries sit on workspace sheets). When the contract sets the timezone, the contract row is dated in the policy workspace's timezone, as SQL does |
| D62 | Team override writers | Owner-only: `approval_required`, `approver_scope`, `retroactive_days`, `rounding_minutes` (403 "Only the team owner can change: …"). The rest is manager-writable with `time_team_rules` |
| CC16 | Workspace PUT | `time_ensure_workspace_policy`, then an UPDATE of the sent fields plus `updated_by`; TypeScript never inserts a workspace row. A null core field is 422 `TIME_POLICY_INVALID {fields}`; `hidden_presets` deduped; every PUT counts as a confirmation |
| — | Team PUT / DELETE | An empty team PUT writes nothing. DELETE is owner-only and ungated, goes through `time_policy_delete` (the audit rows survive with `policy_id` NULL plus a `deleted` event), is a no-op 200 without an override, and answers the refreshed view. `TEAM_RATES_REQUIRE_APPROVAL` is pre-checked with "Approval stays on while member rates are on." |
| D28 | Retroactive days | `PATCH /teams/:id` `retroactive_log_days` writes through before the teams UPDATE: n > 0 upserts the team row; 0 sets an existing row to NULL and never inserts; fractions truncated, clamped to 3650. The teams column is still written (rollback safety until M5); there is no reverse sync from a policy PUT. `contract_enforcement` is still accepted and has no effect |
| — | Policy audit | Written by the triggers (`trg_time_policies_events`, the M3 delete event), not by TypeScript; there is no restore-on-failure path |

### Entries

| # | Topic | As built |
|---|---|---|
| D07, D77 | Second timer | 409 `TIMER_ALREADY_RUNNING`; the alias answers the PR-0 400 string. `start` checks the caller's running timer **first**, so that error wins over resolver and cap errors; the unique index stays the race backstop |
| D26, D27 | Gates | The resolver is the plan gate (team/workspace options without `time_tracking` are `unavailable: plan`); no extra `assertFeature` on entries. Delete-own is ungated |
| D42 | Stale edits | `expected_updated_at` is required on `PATCH /time/entries/:id`; a mismatch is 409 `STALE_REVISION {entry_id, updated_at}` "This entry changed. Reload to see the latest version." The alias never sends it |
| D46, D76 | Caps | `HOUR_CAP_EXCEEDED` (422, extras `limit_window, limit_hours, logged_hours, window_start, window_end`) blocks only when the team member rate in force has `overtime_requires_approval`, per (member, team) in the team policy timezone: a timer start once the window already holds its limit, a manual entry when logged + new exceeds it. `CONTRACT_WEEKLY_LIMIT` is a warning, raised only when the contract itself sets the limit. A workspace/team policy limit has no write-time warning yet (needs a new warning type, web PR) |
| D66 | PATCH | No `HOUR_CAP_EXCEEDED` or `allow_manual_entries` re-check (old behaviour; the freeze cap is the money backstop). The retroactive window is checked when `started_at` or the context changes. Only a **changed** `logging_for` re-resolves: a round-tripped current context is never re-gated by plan, curation or a lost `time.log` |
| — | Entry errors | `RETROACTIVE_WINDOW {earliest_date}` in the policy timezone; task missing or on another project → 422 `WORK_ITEM_INVALID` "Pick a task from this project."; `task_id` with `work_item` → 422; a hidden preset is refused only when `work_item` is sent; stop/pause/resume state errors → 409 `TIMER_NOT_RUNNING`; locked → 409 `TIMESHEET_LOCKED {reason:'entry', lock, entry_id}` before the resolver runs |
| — | Breaks and edits | `break_seconds` wins, else `round(break_minutes × 60)` (D43); manual breaks are clamped to the interval. An edit that ends a running timer folds its pause; boundary changes drop the segment timeline (old behaviour) |
| — | Reads | `me/summary` refuses a range over about a year (400); `me/entries` `limit` ≤ 200; `PUT logging-for` answers the refreshed resolver result; `DELETE` answers no body; a masked worker's comments come back with `author_user_id: null` |
| D61 | Timer notices | `timerStopped` clears "Timer still running" on a manual stop, on an edit that ends a running timer, and on deleting a running entry |

### Timesheets and cron

| # | Topic | As built |
|---|---|---|
| D09, D13–D16 | State machine | See [Timesheet State Machine](#timesheet-state-machine); rows corrected there |
| D10 | `p_freeze` | `{ "<sheet id>": { "<entry id>": FreezeEntryValue } }`; the entry-set check runs only where a freeze is applied |
| D65 | Freeze caps | Only the contract `weekly_limit_minutes` (engagement sheets, contract-set values only) and the team member caps cut payable time. The policy weekly limit is returned in `rules` for the review indicator and never cuts |
| D67 | Accepted details | Jobs 3 and 5 scan sheets whose `period_end` is within the last 45 days (`TIME_CRON_LOOKBACK_DAYS`); entries of one window under different rate rows take the strictest cap; `deciders_count` also goes to the member of a submitted sheet (they see "No one else can approve this"); every queue row carries the `policy_workspace` tag because the queue has no current-workspace parameter; a member reopening their own auto/self sheet notifies nobody; the submit freeze is always built (the RPC applies it only on an auto/self chain); `me/timesheets` returns at most the 200 newest |
| D52 | Cron budget | At most 200 rows per job, a 20 s soft budget shared across jobs, `truncated: true` when cut short. Job 3 pre-filters with `time_sheet_routing_preview`, so manual-route sheets are never frozen; residual `not_auto`/`too_early`/`running_entry`/`empty`/`state` refusals count as skipped. Response `{auto_stopped, long_notified, auto_submitted, finished, reminders, errors, truncated}`, at most 50 error strings of the form `job[:id]: CODE` |
| — | Notify-once | Reminder and long-timer notices also set a Redis marker (40 days), so a user deleting the bell row does not trigger a resend every hour; the clears drop the marker too |
| D63 | Auto/self submit | `sheetSubmitted(sheet, [], actor)` still runs with no recipients, clearing the member's reminder |
| — | Retries and reads | A `40P01` is retried once; a NULL actor rebuilds the freeze once on `STALE_REVISION {reason:'entry_set'}`. Detail: `rules` = snapshot minus `routing`; deciders get `freeze_preview`, with `amounts_by_currency` only when cost is visible for every entry |

### Reports, finance and dashboard

| # | Topic | As built |
|---|---|---|
| D69 | Two `sheet_status_counts` | Reports count **distinct sheets** per status among the entries in range. The project dashboard counts **entries** by their sheet's status plus `personal` (a sheetless non-personal entry counts as `open`) |
| D69 | Other report semantics | `under_agreements_seconds` = logged seconds (legacy rejected excluded); the For label is shown on masked rows (it names a team, workspace or the hirer, never the worker); exports cap at 10,000 rows (400 "Pick a shorter range") |
| — | Client hours | No per-entry list or export at `summary`; groupings limited by level (day at `summary`; day/project/task at `detailed`); duration, end times, sheet, payout and context label withheld; never priced. Identity per D57 |
| D57 | Identity | Only placed-talent assignments (`talent_engagement_id` set) are masked; a consultant's own client-only time is named to the client hirer. `maskedWorkerIds` follows the same rule |
| — | Person filters | Dashboard and report `member_user_id` filters exclude the person's masked assignment rows (decided per assignment with `identityVisible`; the report probe pages through every row), so a filter never confirms a masked worker |
| — | Finance readers | Books: `approved_seconds` includes paid time; legacy rejected time is excluded from every figure; `uncosted_seconds` added behind `view_costs`; project books show masked rows as `user_id 'masked:<assignment>'`. Export keeps `kind=time_logs` and a `status` column derived from the predicates, adds For, approved hours, timesheet status and period columns, drops email |
| — | Dashboard | `total_seconds` = payable seconds of approved entries; other people's personal entries excluded; fees = Σ `amount_snapshot` of cost-visible entries; overtime windows per (member, team) in the team policy timezone, capped by the rate row in force on the window's latest entry |

### Money

| # | Topic | As built |
|---|---|---|
| D37 | Payout compat | `log_ids` stays a synonym of `entry_ids` (exactly one, non-empty); `GET /payouts/:id` keeps `logs` and adds `entries` (same rows, each with a synthesized `status:'paid'`); `owed` keeps `from`/`to` (`to` → `until`) and accepts `until`; owed rows keep `log_count` and add `entry_count` |
| — | Payout rules | Owed also excludes fixed-rate entries; the manager check runs before the flag checks (a stranger no longer learns "payouts are disabled"); `owed` dates are local dates in the team timezone (an ISO instant is read as its local date, anything else 400); route ids 404 on a non-uuid; duplicate entry ids are deduped; plain-text RPC refusals become fixed-copy 400s; owed rows stay ordered by amount. TypeScript refuses entries without `payable_seconds` even though the M3 RPC still pays old-backend approvals (safe direction, D70) |
| D39 | Cut-off editor | A non-null `pay_period_config` needs `time_billable_invoices` or `time_payouts`; clearing it (null) is never gated |
| D38 | Invoices | Full reservation rework. `hours_from`, `hours_to`, `hours_member_user_id` stay in the DTOs and are ignored; hours bill by the invoice's own `period_start`/`period_end` |
| — | Invoice details | One plan gate in `createContractInternal` (covers every create path, `context:'create'`) and one on the provider `signContract` (`context:'write'`); talent contracts never gated; a NULL `contracts.workspace_id` falls back to the project's workspace, then the author's default. Engagement (b) bills provider-team entries on any linked project. Legacy team: the provider seat's team, else the one team the seat user owns, narrowed to teams attached to the project; otherwise 409 `LEGACY_CONTRACT_AMBIGUOUS {reason:'teams'}` "More than one team could bill hours on this contract. Set the provider's team on the contract first." or `{reason:'contracts'}` "Another hourly contract on this project bills the same team's hours. End or amend one of them first." Missing engagement settings at `period_end` → detail `none`. Zero-payable entries are never reserved. A refused composition deletes the just-created draft; moving a draft's period recomposes; an inverted period is 400. A time-based compose with nothing billable keeps the old priced zero line (no `time_key`, so verification ignores it); the void-and-replace replacement keeps `attach_hours: false`. Labels: "Earlier hours: <task>" (detailed), "Earlier hours (before <start>)" (summary), "Earlier hours" (none); detailed overage "<task>: additional hours beyond <n> included (<period>)"; presets read Meetings, Reviews, Admin, and "Project work" for other and untitled tasks. `verifyReservations` rebuilds lines from each line's stored `metadata.time_context`/`time_key` (lines without a key, from before PR-1, are not verified); a mismatch is 409 `INVOICE_TIME_ENTRY_NOT_BILLABLE {reason:'reservation_mismatch'}`. `getBillableHours` is gone |
| D71 | Billing floor | `time_billing_floor` = greatest(contract `service_start_date`, first `legacy_import` day), i.e. the M2 apply day: nothing logged before M2 ever bills. The QA script reports the floor as the likely cause when an invoice has no hours line (`QA_ALLOW_BILLING_FLOOR_SKIP=1` turns that one assertion into `SKIP` during the first period after a dev M2 apply) |

### Projects, teams, account, assignments

| # | Topic | As built |
|---|---|---|
| D64 | Permission editor | A project permission write that turns `access.time` off also turns `time.log` off, so today's web editor never hits `permission_dependency_unmet` |
| D72, D78 | Project reads | `GET /api/projects/:id` answers 404 for a malformed id or a caller without a `project_access` row, then masks the roster; the MCP `projects_get` tool and project resource pass the viewer |
| — | Roster masking | Applies to the project payload, `GET /projects`, `GET /projects/dashboard` and member-write responses (not `addMember`, whose identity the caller supplied). A masked row's user id becomes `masked:<project_access id>` (`masked:<projectId>:<index>` in lists), `display_name` "Delivery team member", every other profile key null; the viewer is never masked to themselves. Old-web actions keyed on a masked id fail until the web PR |
| D70 | Account copy | `TEAM_HAS_OPEN_TIME`: "This team has time waiting for approval or payment. Hand it to another member instead of deleting it."; `WORKSPACE_HAS_OPEN_TIME` the same for a workspace; both `conflict`. A named variant needs a details field (web PR) |
| D54 | Deletion notices | `AccountService.afterDeletion`, right after the token revoke and best effort, sends `timesheet_submitted` to the deciders of the user's `on_deletion` sheets that are `submitted` on a route other than `auto`/`self` |
| — | Assignments | The `setUp` hook is best effort (a failure is logged; the project and link stand). Masked rows also null `talent_engagement_id`. Added rules: start or end more than 5 minutes in the future → 400; an end before time already logged → 400; a non-default `team_id` must be a team the caller manages; a `project_specific` engagement is never placed on another project. Extra codes `ASSIGNMENT_ALREADY_ACTIVE` (409), `ASSIGNMENT_NOT_ACTIVE` (409), `ASSIGNMENT_PROJECT_LINK_REQUIRED` (403). `access_needed` is false when the worker already holds `time.log`. When the project is not linked and the caller cannot open it, the answer is 404 |

### Notifications

| # | Topic | As built |
|---|---|---|
| D79 (was D29) | Links | Every time notice, email and push links to the Time pages through `timePath(...)`: timesheet types → `/time/timesheets/<id>`; comment and timer notices → `/time?entry=<id>` for every context (D82); `time_payout_recorded` → `/time`; approval digests → `/time#waiting`. The D29 gap links to the team pages and their builders (`teamTimePath`, `teamTimeEntryPath`) are gone, because PR-1 and the web PR merge in one cutover; rows already stored with team-page links resolve through the web's redirect stubs ([UX › As Built in the Web PR](./ux.md#as-built-in-the-web-pr)) |
| D51 | Failure | Every `TimeNotificationsService` method catches and logs at `warn`, is awaited (never `void`), and fans out with `Promise.all`; a failed notice never turns a committed transition into an error |
| — | Recipients | `commentAdded` also notifies the team managers of team-context entries; the legacy reviewer only while they can still view the sheet. `project_id` is null on every time type. `sheetSubmitted` and `reopenRequested` replace the recipient's older row for the same sheet. An `auto` approval notifies the member; `self` is skipped |
| — | Copy | Messages add "for <scope>"; timer messages name no task; one comment message for every recipient; user-typed notes and comments appear, cut to 140 characters; no amount anywhere |
| D41 | Email | The four email types (`timesheet_submitted`, `_returned`, `_reminder`, `time_payout_recorded`) send from deploy: M1 already set `email_eligible`, PR-1 ships the renderers |

### Alias

| # | Topic | As built |
|---|---|---|
| D01, D02 | Fixed shapes | `contract-status` → `{enforcement:'off', engagement_status:'engaged'}`; heal → `{scanned:0, healed:0}` (`@Public` + `CronSecretGuard`, 200); `my-rate` → `null` (D45) |
| D03 | Status map | Column predicates only (no sheet join, so `count:'exact'` stays exact): `paid` = `payout_id IS NOT NULL OR legacy_status='paid_outside'`; `rejected` = `legacy_status='rejected'` and not paid; `approved` = `payable_seconds IS NOT NULL AND payout_id IS NULL AND legacy_status IS NULL`; `pending` = the rest. Never reads `time_entries.status` |
| — | Review fields | `reviewed_by/at`, `review_note` and `reviewer` come from the sheet decision when the sheet is approved or returned by a manual, auto or self decision, else from `legacy_reviewed_*` |
| D05 | Cost | Per row by `costVisible`; hidden cost keys are absent (never selected); hidden-cost summaries `buckets:{}`, `currencies:[]`; project routes never carry cost; email only on self and team-manager routes. When a manager's team cost is hidden, the team summary's fees come from their own rows only |
| D06 | Copy by origin | Locked write: "This week was sent for approval, so it can't be changed here. " + "Update the app to see timesheets." (native) or "Reload Proyekto to see timesheets." (web). Review routes 410 `TIMESHEETS_REPLACED_REVIEW`: native "Update the app to approve timesheets.", web "Approvals now happen by timesheet. Reload Proyekto." The 410 handlers take no body and do not parse the id |
| D30 | Telemetry | Counted in process per (route, UTC day) before the handler (410s, 400s and pipe 404s count; guard 404s do not); every 60 s and at shutdown one pipeline of `INCRBY n` + `EXPIRE 3456000` per key `time:alias:hits:<route>:<yyyymmdd>` plus one log line `{evt:'team_time_alias', route, count_since_last}`. Null Redis is a no-op |
| D32 | Masked rows | `member_user_id = 'masked:' + context_ref`, `display_name` "Delivery team member", no avatar or email; hidden content `task_id`/`task`/`project` null. Picking a masked member in the old filter sends a `masked:` id, which the DTO refuses (400) |
| D34, D35 | Detail and tasks | `GET logs/:id` follows `can_view_timesheet` (+ D49); tasks routes return tasks only, old flat shape, gated by `access.roadmap` (the old "team not attached" 400 is gone) |
| D36, D43, D44 | Writes | `limit_context` from the team member caps (omitted when none apply; window dates are local `YYYY-MM-DD`, logged hours rounded to 2 decimals, and it appears on every list route, as before); `break_minutes` ↔ `break_seconds` rounding; resolver `purpose:'alias'` |
| — | Contract details | Every write response is re-read through the alias row builder (status, review fields, `limit_context`), best effort after a committed write; lists default `limit` 50, max 200, `statusCounts` always present; POSTs answer 201 (heal 200); `:logId`/`:teamId`/`:projectId` 404 on a non-uuid; comment add trims and refuses an empty body (400 "Comment body cannot be empty."); member lists keep `avatar_url` (masked: null); a row whose member account is gone carries `member_user_id: ''` and a member built from the display-name snapshot; the project member list scans at most 20,000 rows (summaries are uncapped, as before) |
| D74 | Accepted changes | Team reads no longer check the team's time toggle (history stays readable) and a non-member gets 404 (old: 403); the `rejected` filter also requires `payout_id IS NULL`, matching the mapper |

### Known gaps until the web PR

Accepted; the web PR merges right after step 6. **B1** nobody can approve from the old UI (410). **B2** no submit UI. **B3** 409 on edits in imported submitted weeks (readable message). **B4** per-log approvals made by the old backend between the prod M2/M3 apply and the merge read as pending in open sheets (spot-checked at step 6). **B5** viewers and commenters get 403 on start (prod: 0). **B6** the project team tab shows 0.00 fees and no emails. **B7** rate teams without `time_team_rules` show 0/USD (prod: 0). **B10** retroactive days write through (D28). **B11** an entry resolved to a non-team context does not show on the team My Logs page. **B12** when a project's only team is off (`team_time_off`) or lacks `time_tracking`, the resolver offers only "Just me", so an old-client timer or manual add silently saves a **personal** entry where the old backend answered 403, and B11 then hides it (prod: 0, Prodigitality is on and Business-comped). **B13** every time notification and email link (`/time/…`, D79) 404s on the web deployed before the web PR. In the gap, sheet notices come only from the account-deletion path (the cron job is created at step 9), but comments and payments recorded through the old UI also send `/time` links. The web PR (built and held on `feat/time-web`) closes it.

## Module Layout

`backend/src/modules/execution/team-time/` → `backend/src/modules/execution/time/`. Line refs in "Replaces" are `team-time.service.ts` unless named.

| File | Responsibility | Replaces |
|---|---|---|
| `time.module.ts` | imports Supabase, Authorization, Notifications, Workspaces, EntitlementsCore, `EngagementsCoreModule` (D25; never `EngagementsModule`, no `forwardRef`); replaces `TeamTimeModule` in `app.module.ts` | `team-time.module.ts`; drops `EngagementEligibilityModule`, `EntitlementGuard` |
| `controllers/time-entries.controller.ts` | `@Controller('time')`: logging-for, policy, work-items, entries, timer, segments, comments, `me/*` | log routes |
| `controllers/timesheets.controller.ts` | timesheets, transitions, approvals | `logs/:id/review*` |
| `controllers/time-reports.controller.ts` | ledger by scope, export, audit export | `teams/:id/logs*`, `projects/:id/logs*` |
| `controllers/time-policies.controller.ts` | workspace and team policy CRUD | time fields of team settings |
| `controllers/time-cron.controller.ts` | `POST /time/cron/run` (`@Public` + `CronSecretGuard`, `common/guards/cron-secret.guard.ts`) | — |
| `controllers/team-time-legacy.controller.ts` + `legacy/` | `@Controller('team-time')` alias; `legacy/team-time-legacy.service.ts` (reads and the old row builder), `legacy/team-time-legacy.mapper.ts`, `legacy/alias-telemetry.interceptor.ts` | old controller |
| `controllers/team-time-retired.controller.ts` (later) | `410 APP_UPDATE_REQUIRED` after retirement; not part of PR-1 | alias, once L18 passes |
| `logging-context.service.ts` | For resolver | team pick in `resolveTeamRate` (`:2453-2462`), `healOrphanedTeamIds` (`:335`), `assertResolvedTeamTimeTrackingEnabled` (`:182-195`, called `:452`), `applyContractGate` (`:239`) |
| `time-policy.service.ts` | `time_resolve_policy` + `time_ensure_workspace_policy`, then contract layer (`settingsInForceOn`) and member caps | scattered `teams.*` reads, limit windows `:1611-1852` |
| `time-rates.service.ts` | rate estimate at write; per-entry re-resolution at freeze (L10) | rate half of `resolveTeamRate` (`:2503-2541`) |
| `time-entries.service.ts` | start/stop/pause/resume/manual/edit/context change/delete, retroactive window, caps, `stopRunningForProject` | `stopRunningLogsForProject` (`:654`, called `projects.service.ts:1317`) |
| `timesheets.service.ts` | freeze payloads, `time_timesheet_transition`, queue, bulk approve, approver-mode probe | per-log review (`:1295/1323/2285`) |
| `time-authority.service.ts` | `canViewTimesheet`, `canDecide` (RPCs), `costVisible`, `contentVisible` (L21), `identityVisible` (L22), `approversFor` | `assertTeamApprover` (`:2576`), `assertCanViewFetchedLog` (`:2374-2397`), `listTeamApproverRecipientIds` |
| `time-reports.service.ts` | one ledger builder for scope me/team/project/workspace/engagement + export column classes | `listProjectLogs`, `logsSummary` (`:1163-1193`, `:2138`), calendar |
| `time-notifications.service.ts` | one notification per transition; skips tombstones (L39) | `notifyApprovalRequested`, `computeDaySummaryForLog` (`:2031-2050`) |
| `time-periods.ts` | pure `date-fns-tz` period math, local dates, UTC ranges; parity-tested against `time_period_for` | UTC windows `:1611-1852` |
| `time-entry.select.ts` | `ENTRY_AUTH_SELECT`, `ENTRY_BASE_SELECT`, `ENTRY_IDENTITY_SELECT` (and its email variant), `ENTRY_CONTENT_SELECT`, `ENTRY_COST_SELECT`, `ENTRY_SELF_SELECT`, `ENTRY_LEGACY_REVIEW_SELECT`, `SEGMENT_SELECT`, `COMMENT_SELECT*`, `TIMESHEET_*`; column hints only | `TIME_LOG_SELECT` (`:29-40`) |
| `dto/*.dto.ts` | [DTOs](#dtos) | `dto/team-time.dto.ts` |

**Shared changes**

| Where | Change |
|---|---|
| `execution/teams/team-authority.ts` (new) | `isTeamManager(supabase, teamId, userId)` → `rpc('can_manage_team')` (a non-uuid id is `false`, any other DB error a fixed-copy 500), and `teamManagerIds(supabase, teamId)` (owner first, tombstones excluded). Used by `PayoutsService` (replacing `assertTeamApprover`), `TimeAuthority`, `TimePolicyService` and the notifications. `TeamsService.assertCanManageTeam` keeps its own body (it returns the role); a spec pins its parity with `isTeamManager`. Flags and plan keys are checked separately, never in the predicate. |
| `execution/projects/permissions/project-permissions.ts` | new **`time.log`**: `PermissionPath` union (near `:227`), path list (near `:285`), editor block of `buildRoleDefault` (`:478-492`), dependency `['access.time']` (near `:605`). Mirrored in web `permissionCatalog.ts`, `roleTemplates.ts`; `project-permissions.spec.ts`, `effective-permissions.spec.ts` snapshots. |
| `marketplace/engagements/engagements.service.ts` | new exports `listActiveAssignmentsForWorker`, `getAssignment`, `assignmentsForProject`, `engagementKind`, `hirerUserIdForEngagement`, `providerUserIdForEngagement`, `hirerPartyTeamId`, `providerPartyTeamId` (L7b), `isParty`, `settingsInForceOn`, `ratesFor`, `assignmentIdsForClientEngagement`, `policyWorkspaceFor`, `engagementForContract`, `isLinkedToProject`, plus the pure `pickRate` (matching work type before NULL, then `hour` before `month`/`fixed`, then latest `effective_from`); existing `ratesInForceOn` (`:129`). Provided by the new `EngagementsCoreModule` (D25). Only this module reads engagement tables (`authorization-axes.md:160`). |
| `marketplace/engagements/engagement-assignments.service.ts` (new) | [assignment slice](#assignment-creation) |
| `execution/workspaces/workspace-paths.ts` | `timePath(sub)` → `/time`, `/time/timesheets/<id>`, `/time?entry=<id>`, `/time#waiting` (the parts compose in URL order). The team-page builders are removed (D79) |
| `shared/account/account.service.ts` (`:55-90`) | blockers `TEAM_HAS_OPEN_TIME` ("This team has time waiting for approval or payment. Hand it to another member instead of deleting it.") and `WORKSPACE_HAS_OPEN_TIME` (the same for a workspace), `status: 'conflict'` (D70); `afterDeletion` sends the `on_deletion` notices (D54) |

**Removals.** `heal-orphaned-logs` in **PR-0** before M1 (deployed: the handler returns `{scanned: 0, healed: 0}`; the alias keeps the no-op, D02). `entitlement.guard.ts` in PR-1 (its only key `time_tracking` read only `teams.time_tracking_enabled`, `:44-72`). `applyContractGate`, `getProjectContractStatus`, `flagIfContractLapsed` (`:239/275/302`) in PR-1; `teams.contract_enforcement` drops in M5 (C12/D5). `EngagementEligibilityService` time call sites go; the service stays, with a table rename (`engagement-eligibility.service.ts:139`), and has no caller left.

- PostgREST embeds use column hints (`profiles!member_user_id`, `roadmap_tasks!task_id`, `projects!project_id`) from PR-1, so M5 constraint renames break nothing.
- **Commit rule (L5):** no commit touches `backend/**` and `web/**` together; PR-1 stays unmerged until M2 and M3 are verified on both databases ([rollout](./migrations-and-rollout.md)).

## For Resolver

`LoggingContextService.resolve(callerId, projectId, {requested?, at, purpose: 'read'|'timer'|'manual'|'edit'|'alias'})` (writes call `select`, which always resolves uncached):

```ts
{ options: LoggingOption[]; selected: LoggingOption | null;
  prefill: LoggingOption | null;            // remembered default awaiting one tap (L38)
  reason?: 'required' | 'confirm' | 'none';
  personal_reason?: 'plan' | 'no_governed_option';
  unavailable: { kind; id; label; reason: 'team_time_off' | 'plan' | 'contract_disabled' | 'engagement_inactive' | 'no_settings' }[] }

LoggingOption = { kind: 'assignment' | 'team' | 'workspace' | 'personal'; id: uuid | null;
  label: string;                            // "Rico for Pixel", "Design team", "Acme", "Just me"
  sheet_scope: { kind: 'engagement' | 'team' | 'workspace'; ref: uuid } | null;   // CHANGE-2
  rate_source: 'team_member_rates' | 'engagement_cost' | 'none';
  workspace_tag: string | null;             // project workspace ≠ governing workspace (L57)
  approver_hint: 'team' | 'workspace' | 'hirer' | 'auto' | 'self' | null }
```

| Step (CHANGE-12) | Rule |
|---|---|
| 0 | Guests: no options, 404 on every route but `me/overview` (empty shape) and `me/running` / alias `logs/me/running` (`null`) (L44, D08). No `project_access` row and not `projects.owner_id` → **404**. No **`time.log`** (editor+) → `options: []`, `reason: 'none'`, for every kind incl. assignments and personal (CHANGE-1). |
| 1 | Load `projects.workspace_id`, `owner_id`. |
| 2 | **Assignments** (L37): `listActiveAssignmentsForWorker` — caller is worker, `status <> 'cancelled'`, `started_at ≤ at < coalesce(ended_at, ∞)` (every purpose but `timer` accepts an ended one when `at` is inside its window). The governing engagement (talent, else client; CHANGE-3) needs `status='active'` (else `engagement_inactive`) and settings in force (else `no_settings`); `tracking_mode='disabled'` → `contract_disabled`. Order `started_at, id`. |
| 3 | **Teams:** in `project_teams` **and** a curated `project_team_members` row (project, team, caller). The curated rule lives only here; trg_10 checks `project_teams` + `team_members`, because the old backend's `resolveTeamRate` falls back to `project_teams ∩ team_members` (`team-time.service.ts:2481-2499`) and a curated DB floor would break it from M1 to step 6. `time_tracking_enabled=false` → `team_time_off`; no `time_tracking` → `plan`. Order `is_primary DESC, attached_at, team_id` (L1). Suppress a team equal to an **available** assignment's `team_id` or `hirerPartyTeamId(talent_engagement_id)` (L35, D59). |
| 4 | **Workspace**, only if step 3 found no team curated for the caller (L34; an unavailable or suppressed curated team still counts as found): `workspace_members` row, effective `tracking_enabled` (CHANGE-11), `time_tracking`. An uncurated editor on a team project gets this option or "Just me" (D58). |
| 5 | An assignment with `tracking_mode='required'` removes all non-assignment options. |
| 6 | **Just me** only if 2–4 left nothing available (L31, D2 → b); sets `personal_reason`. |
| 7 | (a) `requested` not among options → **422 `LOGGING_FOR_INVALID` `{options}`**, foreign ids never echoed or looked up (L24). (b) Collapse equal `(sheet_scope, rate_source)`, plus the team id for `team_member_rates` (D60); `requested` is matched before the collapse. (c) One → selected. (d) Several → valid `time_logging_defaults` row as `prefill`; a write without `requested` → **409 `LOGGING_FOR_REQUIRED` `{options, prefill}`**; one tap resends with `logging_for`, never silent (L38). (e) None → **403 `NO_LOGGING_CONTEXT`**. |
| 8 | `purpose='alias'` (old bundles cannot answer a 409): remembered default, else first after collapse — reproduces `resolveTeamRate`. |

- **Caching (L60):** writes (start, manual, PATCH, move, context change) resolve uncached. `GET logging-for` and picker reads use a 30 s Redis entry per (user, project) under a global epoch that policy writes, assignment create/end, the team toggles and a changed remembered default bump (D56: the epoch is captured before the compute).
- **Remembering:** `PUT …/logging-for` or `remember: true` upserts `time_logging_defaults (user_id, project_id)`; stale rows are ignored (E26).

**Edits and context changes (L2, L58)**

| Change | Rule |
|---|---|
| Task, same project | context kept; `work_item` follows `task_id` (L49) |
| Task in another project (today `:760-783`) | project move: resolver re-runs at `started_at`; `logging_for` required if ambiguous |
| `logging_for` on PATCH (bulk "Change For…" = one PATCH per entry) | `context_kind`, `context_ref` and context FK change together; both sheets `open`/`returned` (trg_40 current, trg_30 target) else 409 `TIMESHEET_LOCKED` |
| Into an assignment | only if `entry.created_at ≥ assignment.created_at` and `entry.started_at ≥ assignment.started_at`, else 422 `LOGGING_FOR_INVALID` (no backfill, `off-platform-engagement-adoption.md:153,159`) |
| Any context change | re-snapshot `rate_snapshot`, `rate_type_snapshot`, `currency_snapshot`, `context_label_snapshot` (estimates, L10) |
| Stop | touches only `ended_at`/duration, unchecked by trg_10; a detached team's timer still stops and stays submittable (L60, E30) |

**Behaviour changes counted at apply (L1)**, queries in [verification SQL](./migrations-and-rollout.md): Prodigitality curated viewers lose logging; members with access and team membership but no `project_team_members` row (today's fallback) would fall to Just me, since the seed keeps `tracking_enabled=false` (L28) — the L1b query, which **D16** (decided) back-fills in M1, so they keep the team option.

## Policy Resolver

`TimePolicyService.resolve(context, at)` → `ResolvedTimePolicy`, each field with `source: 'default'|'workspace'|'team'|'contract'|'member'`. SQL `time_resolve_policy(p_scope_kind, p_scope_ref, p_policy_workspace_id, p_at)` ([data model](./data-model.md)) resolves default, workspace, team **and the contract layer** for engagement scope; TS adds only the member caps and `client_hours_detail_level` (from `settingsInForceOn`, D24).

| Field | Default (CHANGE-11) | WS | Team (needs `time_team_rules`) | Contract (wins) |
|---|---|---|---|---|
| `tracking_enabled` | true where plan has `time_tracking` | ✓ | — | `tracking_mode` disabled/optional/required |
| `period_kind` / `week_start` / `timezone` | `weekly` / 1 / chain below | ✓ | ✓ | new nullable `engagement_time_settings` columns |
| `period_anchor` | 2024-01-01 shifted to `week_start` | ✓ | ✓ | — |
| `approval_required` | true | ✓ | ✓ (false refused while `member_rates_enabled`, L23) | from `approval_mode` |
| `approver_scope` | `workspace` | — | `team` \| NULL | `hirer` (talent) / `auto` (client) |
| `allow_manual_entries` | true | ✓ | ✓ | ✓ |
| `retroactive_days` | 0 = no limit | ✓ | ✓ (takes `teams.retroactive_log_days`; Prodigitality NULL = inherit, L59) | — |
| `rounding_minutes` | 0 | ✓ | ✓ | ✓ per entry at freeze |
| `weekly_limit_minutes` | none | ✓ | ✓ | ✓ per worker × governing engagement (L12) |
| `reminder_days` | 1 | ✓ | ✓ | — |
| `hidden_presets` | `{}` | ✓ | — | — |
| `client_hours_detail_level` | — | — | — | ✓ (legacy contracts `none`, L22) |

Member layer (team context only): `weekly/monthly_limit_hours`, `overtime_requires_approval` from the `team_member_rates` row in force on the local date.

**Policy workspace:** `team` → `team.workspace_id`; `workspace` → W; `engagement` → `policyWorkspaceFor(engagementId)` = `contracts.workspace_id` via `engagements.activated_by_contract_id` (`20260930100000:16`), else the hirer party team's `teams.workspace_id`, else NULL (platform default). Never `projects.workspace_id` — an engagement sheet spans projects, so it would depend on which entry created the sheet; `contracts.workspace_id` is nullable and `origin='legacy'` engagements have no activating contract. It supplies only period, timezone and week start the contract leaves NULL, never gating.

**Materialisation (CHANGE-11).** `time_ensure_workspace_policy(workspace_id, tz_hint)` creates the row on first need; timezone = hint (only from a caller who `can_manage_workspace`, via `?tz=` on overview or policy GET) → earliest owner's `user_time_preferences.timezone` → entry member's → `UTC`. Owners/admins see `policy_unconfirmed: true` while the row is missing or `updated_by IS NULL`; "Looks right" PUTs the same values. Overview seeds a missing `user_time_preferences` row from `?tz=` (never overwrites); explicit changes use `PUT /time/me/preferences`.

**Freezing layers (L40).** `policy_snapshot` is written at submit; the freeze reads workspace/team only from it and contract per entry from `settingsInForceOn` (L10). `can_decide_timesheet` uses the frozen `approver_scope`, never the plan. Sheet bounds never move; the next sheet follows new layering (E3).

**Writes.** Team PUT `approval_required=false` while `member_rates_enabled` → **422 `TEAM_RATES_REQUIRE_APPROVAL`** (if rates turn on later, the resolver reads true). The `time_policy_events` triggers write the audit row in the same statement (`{policy_id, actor_user_id, changes}`, plus `scope`, `team_id`, `workspace_id` since M3); a team DELETE goes through `time_policy_delete`, whose `deleted` event survives the row (D23). Workspace PUT never inserts (CC16); owner-only team fields per D62.

## Authorization

**Predicates (CHANGE-17, L24):** SQL SECURITY DEFINER, service_role EXECUTE only (L42), called by RPC, never re-implemented.

| Predicate | Definition |
|---|---|
| `can_decide_timesheet(id, user)` | by frozen `approver_scope`: `team` → `can_manage_team(team_id)`; `workspace` → `can_manage_workspace(policy_workspace_id)`; `hirer` → `engagement_parties.position='hirer'` on the sheet's talent `engagement_id`. Member excluded except `self`. No legacy case: `decision_kind='legacy'` is admitted by `trg_timesheets_guard` (L47). |
| `can_view_timesheet(id, user)` | member OR `can_decide_timesheet` OR (`can_manage_team(team_id)` AND `scope_kind='team'`) |
| entries, segments, comments | follow their sheet; personal = member only |
| `can_manage_team(team, user)` | `owner_id` OR `team_members.role IN ('owner','admin')`, `CREATE OR REPLACE`, same signature, **keeps grants** (6 `team_resource_*` RLS policies call it as `authenticated`); remains an anon-callable oracle with arbitrary `p_user_id`, out of scope (L41) |

**Every route:** misses are **404**, never 403 (sheet, entry, segment, comment, report scope, non-party engagement). `policy?for=` and `logging-for` accept only the caller's resolved options. `approve-bulk` checks each id inside the RPC and fails the batch. A non-uuid id is a 404 too. Guests get 404 on all `TimeModule` and alias routes except: `me/overview` returns `{can_log:false, approver_mode:false, contexts:[], approvals_waiting:0, workspace_time_admin:[]}`, and `me/running` / alias `logs/me/running` return `null` (D08). Picker and overview reads never 403 (`options: []`). **Entry reads (D49):** `assertViewEntry` = personal: member only; else `can_view_timesheet(sheet)` OR (`context_kind='team'` AND `isTeamManager(team_id)`), so a manager can open every team-context entry the team report lists, including those on workspace-scope sheets.

| Actor | Log | Decide | Sees | Titles/notes (L21) | Assignment worker identity (L22) | Money |
|---|---|---|---|---|---|---|
| Member | resolver (`time.log`) | own sheet only as `self`; reopens own `auto`/`self` until settled (L33) | all own, across workspaces (by `member_user_id`, never slug) | yes | own | own (estimate, frozen on approval) |
| Team manager | resolver | `approver_scope='team'` | `scope_kind='team'` sheets; team report + "Under agreements" hours (L35) | with `access.time` | provider-side only | team entries if `member_rates_enabled` + `time_team_rules` |
| Workspace owner/admin (Axis 7, CHANGE-8) | resolver | `'workspace'`, their `policy_workspace_id` | those sheets; workspace report needs `time_reports_export` | with `access.time`, else "A project you can't open" | placed talent masked ("Delivery team"); a consultant's own client-only time named (D57) | never via time; `view_costs` via finance books |
| Talent hirer | — | `'hirer'` on own talent engagement | those sheets | with `access.time` | yes | own engagement's talent cost |
| Client-engagement provider (consultant) | resolver (own assignment) | — (client sheets `auto`) | assignment entries under their client engagement | with `access.time` | yes | own; talent cost only as its hirer |
| Client party (client hirer) | — | — | approved hours: invoice, Project › Time "Client hours" | task-level at `detailed` only | placed talent **never**; their own consultant's client-only time is named (D57) | never |
| `time.view_team_logs` (admin+) | — | — | team, workspace, assignment hours; **never personal** | yes | provider-side only | **never** |
| Finance `view_time`/`view_costs` | — | — | unchanged (`finance-book-permissions.ts:57-118`), L22 on project books | as today | provider-side only | `view_costs` |
| Viewer/commenter | **no** | — | own | own | — | own |
| Guest | no | no | 404 | — | — | — |

- **Project Time nav (L22)** needs `time.log` OR `time.view_team_logs` OR client level ≠ `none`. `GET /api/projects/:id/my-permissions` (`projects.controller.ts:356`) adds `time_client_hours_level: 'none'|'summary'|'detailed'` = `least(...)` over the caller's active client-engagement hirer seats linked to the project.
- **Roster masking (L22).** `project_access` has one row per (project, user) (`project_access_project_user_unique`, `20260507000130`) and `origin` is only a label, so masking is not keyed on `origin`. Every member read returning `project_access` rows (project payload `projects.controller.ts:113`, people and permissions reads) shows "Delivery team member" when the user is the worker of an assignment on the project under an engagement where the viewer is not a provider-side party. "Who can log time here" comes from party-only `GET /api/engagements/:id/assignments`.

## Cost and Content Redaction

| Rule | Definition |
|---|---|
| Selects | Per-class selects in `time-entry.select.ts`: base (`ENTRY_BASE_SELECT`, which carries `payable_seconds`: hours, not money, D31), identity (`ENTRY_IDENTITY_SELECT`, plus an email variant), content, cost (`ENTRY_COST_SELECT`: `rate_snapshot`, `rate_type_snapshot`, `currency_snapshot`, `amount_snapshot`). `TimeAuthorityService.hydrate` reads the base for all ids, then each class only `.in('id', allowed)`, so hidden columns are never selected. `email` only in self and team-manager views. Project endpoints never use the cost select. |
| `costVisible` | the member; team entry with `isTeamManager`, `member_rates_enabled`, `time_team_rules`; assignment entry whose governing **talent** engagement the viewer hires. Books apply `view_costs` separately; the project ladder never grants cost ("no origin deltas", `project-permissions.ts:544-563`). |
| `contentVisible` | project/task title, note: member or `access.time` on `entry.project_id`, else "A project you can't open" — review, reports, exports (L21) |
| `identityVisible` | placed-talent assignment entries (`talent_engagement_id` set): worker, talent hirer and provider, client provider; else "Delivery team", no avatar or id (L22). Client-only assignment entries (a consultant's own client time) are visible to every viewer of the entry (D57); an assignment that can no longer be read is masked |
| Dashboard fees | `projects.service.ts` stops keying on `time.view_team_logs` (`:586-608`, `:654`, `:747`); sums only `costVisible` entries |

## Endpoints

`/api/time`, `SupabaseAuthGuard`, guests 404 unless noted. Gate = plan key ([plan gating](#plan-gating)).

| Route | Who | Notes |
|---|---|---|
| `GET /time/projects/:projectId/logging-for?at=` | project access | resolver shape, cached 30 s |
| `PUT /time/projects/:projectId/logging-for` `{logging_for}` | own option | upserts default |
| `GET /time/projects/:projectId/policy?for=<kind>:<id>` | own option | `ResolvedTimePolicy` + sources; no money or contract rates |
| `GET /time/projects/:projectId/work-items` | `access.roadmap` (L1) | tasks + presets minus `hidden_presets`; replaces both `tasks` routes |
| `GET /time/me/running` | self; guests get `null` | ≤ 1 row (`uq_time_entries_one_running_per_member`) |
| `POST /time/entries/start` | resolver, uncached | 201. The caller's running timer is checked first (D77); 23505 → 409 `TIMER_ALREADY_RUNNING`; contract limit warns; team `HOUR_CAP_EXCEEDED` blocks only with `overtime_requires_approval` (D46). Gate: the resolver (`time_tracking` for team/workspace, D26). |
| `POST /time/entries/:id/{stop,pause,resume}` | member | 200; segments kept; never gated; wrong state → 409 `TIMER_NOT_RUNNING` |
| `POST /time/entries` | resolver | 201. `MANUAL_ENTRIES_DISABLED`, `RETROACTIVE_WINDOW {earliest_date}` (policy tz), caps; overlap warns (E28). Gate as start. |
| `PATCH /time/entries/:id` | member, sheet `open`/`returned` | move/context rules; `expected_updated_at` required (D42); gated as start only on a changed `logging_for` or a project move (D66) |
| `DELETE /time/entries/:id` | member, sheet `open`/`returned` | trg_40 refuses locked |
| `GET /time/entries/:id`, `/segments`, `/comments`; `POST …/comments` | `can_view_timesheet` (personal: member) | redacted; comment notifies member and deciders |
| `GET /time/me/entries?from&to&project_id&for&page&limit` | self | `user_time_preferences` tz unless `for` |
| `GET /time/me/summary?from&to` | self | by day/context/project/sheet status; approved from `payable_seconds`; a range over about a year → 400 |
| `GET /time/me/overview?tz=` | any signed-in (guests: empty shape) | `{can_log, approver_mode, contexts[], approvals_waiting, workspace_time_admin[]}` |
| `GET\|PUT /time/me/preferences` `{timezone, week_start?}` | self | upserts `user_time_preferences` (an omitted `week_start` is kept) |
| `GET /time/me/timesheets?from&to` | self | items include `origin` and `submission_kind`; at most the 200 newest |
| `GET /time/timesheets/:id` | `can_view_timesheet` | deciders also get a freeze preview: `over_cap_seconds` per entry, amounts per currency (L64), `deciders_count` (0 → "No one else can approve this. Add a workspace admin.") |
| `POST /time/timesheets/:id/{submit,withdraw,approve,return,reopen,request-reopen}` | [state machine](#timesheet-state-machine) | `STALE_REVISION` on mismatch |
| `POST /time/timesheets/approve-bulk` | `can_decide_timesheet` on all | one RPC, all or none |
| `GET /time/approvals?status=submitted\|decided&since=<date>&scope_kind&page` | — | cross-workspace queue: (`team` ∧ managed team) ∪ (`workspace` ∧ managed `policy_workspace_id`) ∪ (`hirer` ∧ own talent engagement), `member_user_id <> caller`; `decided` + `since` lists recent decisions; rows carry the policy-workspace tag when it differs from the viewer's current workspace (E27); `timesheets_queue_idx`, `timesheets_policy_ws_idx` |
| `GET /time/approvals/count` | — | dashboard card, bell badge |
| `GET /time/reports/{entries,summary}?scope=team:<id>` / `project:<id>` | `isTeamManager` / `time.view_team_logs` | — |
| `…?scope=workspace:<id>` | `can_manage_workspace`, sheets with that `policy_workspace_id` | gate `time_reports_export` |
| `…?scope=engagement:<id>` | parties; client hirer gets approved hours, no identity, at client level, 404 at `none` ("Client hours") | — |
| `GET /time/reports/export?scope=…&format=csv\|xlsx` | screen's authority query | `time_reports_export` on scope workspace (team → `team.workspace_id`, project → `project.workspace_id`, engagement → `policyWorkspaceFor`, workspace → W) |
| `GET /time/reports/audit-export?scope=workspace:<id>` | `can_manage_workspace` | `time_audit_export` |
| `GET\|PUT /time/policies/workspaces/:workspaceId` | `can_manage_workspace` | tz and week start always writable; rest needs `time_tracking` except tracking off |
| `GET\|PUT\|DELETE /time/policies/teams/:teamId` | GET manager; PUT approval/money fields and DELETE owner (`teams.service.ts:186-205`) | PUT needs `time_team_rules`; DELETE ungated |
| `POST /time/cron/run` | `@Public` + `CronSecretGuard` (`x-cron-secret` = `MEETINGS_CRON_SECRET`, as `invoices/cron/run`) | 200 `{auto_stopped, long_notified, auto_submitted, finished, reminders, errors, truncated}` (D52) |

**`me/overview`:** `can_log` = `time.log` on any project; `contexts[]` = `{kind, id, label, sheet_scope, current_sheet: {id, status, period_start, period_end, total_seconds}}` with entries in 30 days or `open`/`returned` sheets; `workspace_time_admin[]` = `{workspace_id, name, slug, has_time_tracking, policy_unconfirmed}`; **`approver_mode` (L36)** = (`approvals_waiting > 0` OR decider anywhere — `can_manage_workspace` with `time_tracking`, manager of a team with override `approver_scope='team'`, or active talent hirer) AND no own entries in 30 days.

**Cron** (Cloud Scheduler hourly, idempotent, in order): (1) **24 h auto-stop** (L61): `ended_at = started_at + 24h` via `TimeEntriesService.stop` (system actor), segment closed, `flagged_reason='auto_stopped_24h'`, `timer_auto_stopped`. (2) **10 h notice** `timer_running_long` once. (3) **Auto-submit** (L33): open `auto`/`self` sheets with local date ≥ `period_end + max(reminder_days, 1)` and nothing running → `submission_kind='auto'`, event `auto_submitted`, with freeze. (4) **Finish auto/self** submitted without decision (e.g. `on_deletion`, where `delete_account` cannot compute a TS freeze) → approved with freeze. (5) **Reminders**: manual-route `open`/`returned` sheets on `period_end + reminder_days` (`> 0`) → `timesheet_reminder` once.

### `/api/team-time` Alias

Status map to `TaskTimeLog` (D03, entry columns only, never a sheet join, so `count:'exact'` stays exact): Paid (`payout_id IS NOT NULL OR legacy_status='paid_outside'`) → `paid`; `legacy_status='rejected'` (not paid) → `rejected`; `payable_seconds IS NOT NULL` (not paid, no marker) → `approved`; everything else → `pending`. `reviewed_*` come from the sheet decision when the sheet is approved or returned by a manual, auto or self decision, else from `legacy_reviewed_*`. Full alias contract: [As Built › Alias](#alias).

| Old routes | Alias |
|---|---|
| `logs/start`, `logs/manual`, stop/pause/resume, PATCH/DELETE/GET `logs/:id`, `logs/me/running`, segments, comments | kept; context from step 8, uncached; locked write → 409 `TIMESHEET_LOCKED` "This week was sent for approval, so it can't be changed here. " + "Update the app to see timesheets." (native origin) or "Reload Proyekto to see timesheets." (web) (D06); a second timer → the PR-0 400 |
| `teams/:id/my`, `my/summary`, `projects`, `members`, `projects/:pid/my-rate`, `/tasks`; project `my`, `my/summary`, `tasks` | read adapters, new redaction |
| `teams/:id/logs`, `logs/summary`; project `logs`, `logs/summary`, `members` | alias-own reads in `legacy/team-time-legacy.service.ts` (D04, not `TimeReportsService`): per-row cost on team routes (D05), never on project routes; email only on self and team-manager routes; masked identity per D32 |
| `projects/:pid/contract-status` | `{enforcement:'off', engagement_status:'engaged'}` (D01, today's typed shape) |
| `logs/:id/review`, `logs/review-bulk` | **410 `TIMESHEETS_REPLACED_REVIEW`**: native "Update the app to approve timesheets.", web "Approvals now happen by timesheet. Reload Proyekto." (D06) |
| `cron/heal-orphaned-logs` | `{scanned:0, healed:0}` (D02) |

- **Telemetry, not a flag** — Proyekto ships without feature flags. Hits are counted in process and flushed every 60 s (and at shutdown) as one `INCRBY` + `EXPIRE 3456000` pipeline per Redis key `time:alias:hits:<route>:<yyyymmdd>`, with one structured log line per route (D30: a per-hit pipeline would cost two Upstash commands per `logs/me/running` poll). The `web/src/api/axios.ts:117-126` 403-silencing stays for alias paths only.
- **Retirement (L18)**, a code change once all hold: current bundle's `native_build_min` (`mobile-updates.service.ts:92`) ≥ the first native build whose baked bundle calls `/api/time`; 30 consecutive days of 0 hits; `ota-stat` shows no active device on a pre-`/api/time` bundle. Then every `/api/team-time/*` answers **410 `APP_UPDATE_REQUIRED`**, never 404. D15 (shells below 7000) stays open.

## DTOs

`time/dto/*.dto.ts`, all fields whitelisted for `forbidNonWhitelisted`.

| DTO | Fields |
|---|---|
| `LoggingForDto` | `kind: 'assignment'\|'team'\|'workspace'\|'personal'`, `id?` (required unless personal) |
| `StartEntryDto` | `project_id`, `task_id?` XOR `work_item?: 'meeting'\|'review'\|'admin'\|'other'`, `logging_for?`, `remember?`, `work_type?: 'real_work'\|'training'`, `note?` ≤ 2000 |
| `CreateEntryDto` | Start + `started_at`, `ended_at`, `break_seconds?` (`break_minutes?` deprecated) |
| `UpdateEntryDto` | partial Create + `logging_for?` + `expected_updated_at` |
| `TimesheetActionDto` | `expected_revision`, `note?` ≤ 2000 (required for `return` and decider `reopen`), `approve_overtime?` (approve) |
| `ApproveBulkDto` | `ids` (1–100), `expected_revisions` (same length), `note?`, `approve_overtime?` |
| `UpdateTimePreferencesDto` | `timezone` (`Intl.supportedValuesOf('timeZone')`), `week_start?` 1–7 |
| `ListMyEntriesQueryDto` | `from`, `to`, `project_id?`, `for?: '<kind>:<id>'`, `page`, `limit ≤ 200` |
| `ReportQueryDto` | `scope: '<team\|project\|workspace\|engagement>:<id>'`, `from`, `to` (scope policy tz), `member_user_id?`, `status?` (open/submitted/returned/approved), `context_kind?`, `group_by?` (day/member/project/task/context), `page`, `limit ≤ 200`, `format?` csv/xlsx |
| `WorkspaceTimePolicyDto` | `tracking_enabled?`, `period_kind?`, `week_start?` 1–7, `timezone?` (`Intl`), `period_anchor?` (biweekly, `isodow` = `week_start`), `approval_required?`, `allow_manual_entries?`, `retroactive_days?` 0–3650, `rounding_minutes?` 0/5/6/10/15/30, `weekly_limit_minutes?`, `reminder_days?` 0–14, `hidden_presets?` |
| `TeamTimePolicyDto` | all nullable (null = inherit) + `approver_scope?: 'team'\|null`; no `tracking_enabled`, `hidden_presets` |
| `CreateAssignmentDto` / `EndAssignmentDto` | `project_id`, `worker_user_id?`, `client_engagement_id?`, `role_title?`, `team_id?`, `started_at?` / `ended_at?`, `reason?` |

**Error codes**

| HTTP | Codes (source) |
|---|---|
| 403 | `NO_LOGGING_CONTEXT` (resolver; only below editor, D58); `TIME_ENTRY_NO_PROJECT_ACCESS`, `TIME_ENTRY_NOT_ON_PROJECT_TEAM`, `TIME_ENTRY_NOT_WORKSPACE_MEMBER` (trg_10 floor, only on an access-change race); `MANUAL_ENTRIES_DISABLED`; `PAYOUT_SELF_NOT_ALLOWED`; `BILLING_HOURS_REQUIRES_PLAN` (contract create / provider sign: the ordinary `PlanLimitException` for `time_billable_invoices`, not a custom code, D26); plan gates (`EntitlementsService.assertFeature`, `entitlements.service.ts:421`); `ASSIGNMENT_PROJECT_LINK_REQUIRED` |
| 404 | `TIME_NOT_FOUND`, `TIMESHEET_NOT_FOUND` (every miss, and every non-uuid id) |
| 409 | `LOGGING_FOR_REQUIRED {options, prefill}`; `TIMESHEET_LOCKED {reason:'entry', lock, entry_id}` / `{reason:'period', timesheet_id, sheet_status}` (from `TIME_ENTRY_LOCKED`/`TIME_PERIOD_LOCKED`); `TIMER_ALREADY_RUNNING`; `TIMER_NOT_RUNNING`; `TIMESHEET_TRANSITION_INVALID {reason}`; `TIMESHEET_HAS_SETTLED_ENTRIES {reason}`; `STALE_REVISION`; `LEGACY_CONTRACT_AMBIGUOUS {reason}`; `INVOICE_TIME_ENTRY_NOT_BILLABLE`; `ASSIGNMENT_ALREADY_ACTIVE`, `ASSIGNMENT_NOT_ACTIVE`; `TEAM_HAS_OPEN_TIME`, `WORKSPACE_HAS_OPEN_TIME` (`status:'conflict'`, deletion preflight and purge) |
| 422 | `LOGGING_FOR_INVALID {options}` (step 7, edit into assignment L58); `RETROACTIVE_WINDOW {earliest_date}`; `HOUR_CAP_EXCEEDED`; `TEAM_RATES_REQUIRE_APPROVAL`; `TIME_POLICY_INVALID`; `WORK_ITEM_INVALID`; `FIXED_RATE_NOT_PAYABLE_BY_ENTRY`; `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED {client_engagements}`, `ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER` |
| 410 | `TIMESHEETS_REPLACED_REVIEW`, `APP_UPDATE_REQUIRED` (alias) |
| 400 | DTO validation; `return`/decider `reopen` without a note; `expected_revisions` of the wrong length |
| 500 | `TIME_INTERNAL` with fixed Proyekto copy, never Postgres text (D55, D68) |

## Plan Gating

Subject: `team` → `team.workspace_id` (`resolveScopeForTeam`, `:248`); `workspace` → W; `assignment` and `personal` → none (contract time never gated; Free included).

| Key (CHANGE-21) | Enforced at | Never at |
|---|---|---|
| `time_tracking` ("Timesheets and approvals") | resolver steps 3–4; team toggle on (`teams.service.ts:609-616`, `assertTimeTrackingAllowed` `:1123`); workspace policy writes except tz, week start, tracking off | reads; wind-down |
| `time_billable_invoices` | `time_based`/`hybrid` hourly `client_services` contract create (one check in `createContractInternal`, which every create path reaches) and provider `signContract`, on `contracts.workspace_id` (NULL → the project's workspace, then the author's default); cut-off editor (or `time_payouts`; clearing never gated). **Choice:** client in-app signature and `signAsTokenBearer` ungated; talent contracts never gated. | composing, issuing, recomposing, voiding signed contracts' invoices; downgrade never zeroes a scheduled draft (L13) |
| `time_team_rules` | team PUT; overrides in `time_resolve_policy` / `time_sheet_scope_for`; team rates at freeze (0 without, L10) | team DELETE; deciding sheets frozen `team` |
| `time_payouts` | `POST /payouts`; `GET /payouts/teams/:teamId/owed`; cut-off editor | void; list and view; member's own payouts |
| `time_reports_export` | `scope=workspace`; all exports | on-screen team/project/engagement |
| `time_approval_chains` | `enforced:false` (reserved) | — |
| `time_audit_export` | audit export | — |

- **Never gated** (today's split, `team-time.service.plan-gate.spec.ts`): stop, pause, resume, submit, withdraw, approve, return, reopen, request-reopen, approve-bulk, own reads, personal time, contract time, payout void, override removal.
- **Downgrade (E11):** team/workspace options become `unavailable: plan` for new entries; open sheets still submit, submitted sheets decide by frozen `approver_scope`; overrides kept but ignored.
- **Prod:** Prodigitality is on a Business comp (every key true); `payouts` gains its first plan check but `payouts_enabled=false` (L59); all 6 prod contracts are retainers.

## Timesheet State Machine

```mermaid
stateDiagram-v2
  [*] --> open: first entry in the period (time_ensure_timesheet)
  open --> submitted: submit (member) · auto-submit (cron) · on_deletion
  submitted --> open: withdraw (member)
  submitted --> approved: approve (decider) · auto · self
  submitted --> returned: return (decider, note required)
  returned --> submitted: resubmit (member)
  approved --> returned: reopen (decider, note required)
  approved --> open: reopen (member, own auto/self sheet)
```

States `open | submitted | returned | approved` (CHANGE-15); `decision_kind` drives "Self-approved" (`self`) and "Confirmed" (`auto`). Paid is an entry badge; "Paid outside Proyekto" and "Not approved (legacy)" show only in entry detail (L56).

All transitions call `time_timesheet_transition(p_ids uuid[], p_actor uuid, p_action text, p_expected_revisions integer[], p_note text DEFAULT NULL, p_approve_overtime boolean DEFAULT false, p_freeze jsonb DEFAULT NULL) → SETOF timesheets`: row locks, `expected_revision`, ownership or `can_decide_timesheet`, entry set; freeze columns under `app.time_freeze`; `timesheet_events`; `revision` bump. Single and bulk share one transaction; TS never writes status columns. **Until M5** the RPC mirrors decisions into `time_entries.status`: approve writes `'approved'` (`'rejected'` for `legacy_status='rejected'`), reopen writes `'pending'` on every entry whose freeze it clears ([rollout](./migrations-and-rollout.md)).

| Verb | Actor | From → to | Preconditions | Effects · event · notification |
|---|---|---|---|---|
| submit | member | open → submitted | ≥ 1 entry, none running; from `open` on a manual route not before the period's last local day (`too_early`; `auto`/`self` may submit early, D13) | `policy_snapshot` + frozen `approver_scope`; `auto`/`self` with `p_freeze` chains to approved, without stays for cron 4 · `submitted` · `timesheet_submitted` to deciders (not auto/self, which only clears the reminder, D63) |
| auto-submit | cron | open → submitted (→ approved) | L33 timing, `auto`/`self` | `submission_kind='auto'` · `auto_submitted` |
| on_deletion | `delete_account` (actor NULL) | open/returned → submitted | no timing rule | `submission_kind='on_deletion'`, never chains, never `self` (no money and no decider → `auto`, D14) · `submitted` · deciders, tombstone excluded, sent by `AccountService.afterDeletion` (D54) |
| withdraw | member | submitted → open | undecided | clears `approver_scope`, `policy_snapshot` · `withdrawn` · clears `timesheet_submitted` |
| approve | decider (not member); cron job 4 with actor NULL on `auto`/`self` (D09) | submitted → approved | `approve_overtime?`; freeze required | freeze, `decision_kind='manual'` (or the scope for cron), `overtime_approved` · `approved` · `timesheet_approved`; clears `timesheet_submitted` |
| return | decider | submitted → returned | note | `returned`; old per-entry approvals in the sheet mirrored back to `status='pending'` (D16) · `timesheet_returned`; clears `timesheet_submitted` |
| resubmit | member | returned → submitted | as submit | as submit |
| reopen (decider) | decider | approved → returned | note; `TIMESHEET_HAS_SETTLED_ENTRIES` while any entry has a reservation (`invoice_time_entries`), `payout_id` or `legacy_status='paid_outside'` (`rejected` does not block, L48) | clears `payable_seconds`/`amount_snapshot` under `app.time_freeze`, `status='pending'` until M5 · `reopened` · `timesheet_reopened` |
| reopen (member) | member | approved → open | own, `decision_kind IN ('auto','self')`; refused if any entry reserved, paid or with any `legacy_status` (L33); note optional | as above · `reopened` |
| request-reopen | member | approved (unchanged) | `decision_kind IN ('manual','legacy')` (D15) | `reopen_requested` · `timesheet_reopen_requested` to deciders |

**Routing at submit (CHANGE-9, L23).** A sheet **carries cost money** structurally (D12, `time_sheet_has_cost_money`): a team entry whose team has `member_rates_enabled` and whose workspace has `time_team_rules`, or an assignment entry with a talent engagement; no rate is resolved for the test. `self`/`auto` only without money. Deciders always exclude the member. The routing is stored as `policy_snapshot.routing = {base, cost_money, deciders_count, fallback}`.

| Sheet scope | Condition | `approver_scope` → deciders |
|---|---|---|
| `team` | override `approver_scope='team'` | `team` → `can_manage_team`. Member sole holder: `self` without money; with money → `workspace` (`can_manage_workspace(policy_workspace_id)` minus member); nobody → stays submitted, `deciders_count=0` |
| `team` | override without `approver_scope` | `workspace`; `self` only without money |
| `team`/`workspace` | effective `approval_required=false` (impossible on team rows with rates) | `auto` without money, else as above |
| `workspace` | — | `workspace`; `self` if sole admin and no money |
| `engagement` | talent-governed (`provider_submit_hirer_approve`, `20260814021000:208-212`) | `hirer` → the `position='hirer'` party |
| `engagement` | client-governed (`approval_mode='none'`) | `auto` (cost 0, L3) |
| any team sheet | team deleted (D6 a) | `workspace` |

**The freeze (CHANGE-4).** `TimesheetsService` builds `p_freeze` keyed by sheet id for any action that can end approved; per entry in `started_at` order:

1. Local start date `d` in the sheet timezone.
2. **Rate** (L10): team → `team_member_rates` with `start_date ≤ d ≤ coalesce(end_date, ∞)`, 0 without `member_rates_enabled` or `time_team_rules`; engagement → `ratesInForceOn` with `rate_kind='cost'`, `work_type = entry.work_type_snapshot` before a `work_type IS NULL` row (`engagement_time_rates.work_type`, `20260814021000:70-71`); `month`/`fixed` → `rate_type_snapshot='fixed'`, `amount_snapshot=NULL` (L9/L63); client-governed → 0, `amount_snapshot=NULL` (L3); workspace → 0.
3. **Round** to `rounding_minutes` (layers from `policy_snapshot`, contract from `settingsInForceOn(d)`), nearest, ties up (D14 pending); 0 = none.
4. **Cap** (L12, D65): team caps per (member, team) over the sheet-tz week, then month (strictest cap when one window spans several rate rows); contract `weekly_limit_minutes` per (worker, governing engagement) across linked projects over the engagement week, only on engagement sheets and only when the contract itself sets it. `payable_seconds = min(rounded, cap − Σ approved payable in window)` unless `approve_overtime`. A workspace or team policy `weekly_limit_minutes` never cuts; `get()` returns it in `rules` for the review indicator.
5. **Amount** = `round(payable_seconds/3600 × rate, 2)` for hourly (display, L63).

Legacy entries freeze from their stored snapshot (D13); only the M2/M4 legacy freezes are computed in SQL. The RPC checks payload entry ids equal the sheet's (`STALE_REVISION` otherwise) and sets `total_seconds` = Σ `duration_seconds`, `payable_seconds` = Σ approved (CHANGE-5).

## Notifications

One row per transition per recipient (ending the per-log fan-out behind 643 rows); skips the actor and `profiles.deleted_at IS NOT NULL` (L39). **CHANGE-19:** no message, push or email carries an amount.

| Type | To | Push title | Email | Clears / content |
|---|---|---|---|---|
| `timesheet_submitted` | deciders | "Timesheet to review" | 60-min delay | all deciders' rows on approve/return/withdraw (`clearForSubject(…,'timesheet_id',id)`) |
| `timesheet_returned` | member | "Timesheet returned" | yes | older ones for the id |
| `timesheet_approved` | member (not `self`) | "Timesheet approved" | no | — |
| `timesheet_reopened` | member | "Timesheet reopened" | no | — |
| `timesheet_reopen_requested` | deciders | "Reopen requested" | no | on reopen |
| `timesheet_reminder` | member | "Time to submit" | yes | on submit |
| `timer_running_long` | member | "Timer still running" | no | on stop |
| `timer_auto_stopped` (new) | member | "Timer stopped" | no | `{entry_id, reason: 'auto_stopped_24h'\|'stopped_by_assignment_end'}` |
| `time_payout_recorded` | member | "Payment recorded" | yes | "A payment was recorded for your time"; `{payout_id, entry_count}`, no amount/currency; replaces `time_log_approved` `status:'paid'` (`payouts.service.ts:630-654`, message `:647`, amount `:644`) |
| `timesheets_imported` (new) | deciders | "Timesheets waiting" | no | one-time M4 digest |
| `time_log_comment_added` (kept) | member, deciders, team managers of team-context entries; the legacy reviewer only while they can still view the sheet | "New comment on your time" | no | — |

- **Content** `{timesheet_id, scope_kind, team_id?, workspace_id?, period_start, period_end, total_seconds}`; `notifications.project_id` null (sheets span projects).
- **Links (CHANGE-10, D79)**: every type via `timePath()`: sheet types `/time/timesheets/<id>`, comment and `timer_*` notices `/time?entry=<id>` for every context, `time_payout_recorded` `/time`, `timesheets_imported` `/time#waiting`. Old `/w/<slug>/teams/<id>/time/*` links redirect on the web.
- `shared/push/notification-push.ts:29-33`: add new titles and historical `time_log_approved`/`_rejected`/`_pending`; delete phantom `time_log_marked_paid`/`_marked_rejected`.
- Email registry (`shared/notifications/email/notification-email-registry.ts` + parity spec): `timesheet_submitted` (delay 60), `timesheet_returned`, `timesheet_reminder`, `time_payout_recorded` (no amount).
- `time-notifications.service.spec.ts` asserts no money number in any time `content.message` (L43). Historical `time_log_*` stay, not emitted; M2 marks `time_log_approval_requested` rows read (L32).

## Invoices

`invoice-composition.service.ts`, `invoices.service.ts`. **Reservation (CHANGE-6, L6):** no `billed_invoice_id`, no `app.time_billing`; `invoice_time_entries (invoice_id, entry_id UNIQUE, contract_id, bill_seconds, bill_rate, bill_amount, currency)`, guarded by `trg_invoice_time_entries_guard` (approved, non-personal only).

| Path | Effect |
|---|---|
| `createInvoice` (`:289`, compose `:367`), `createScheduledInvoice` (`:391`, compose `:447`) | `composeForContract(contract, invoiceId, …)` inserts with `ON CONFLICT (entry_id) DO NOTHING`, re-reads by `invoice_id`, builds lines only from that set — concurrent drafts never share an entry |
| `attach_hours=false` (`:329`, `:435`) | never reserves |
| `updateInvoice` recompose (`:557-616`, `:586/:610`) | delete rows, compose again |
| `deleteInvoice` (`:631-651`) | FK CASCADE |
| `issueInvoice` (`:653-705`) | verifies reserved entries still approved and, per line, `round(Σ bill_seconds/3600, 2)` = line quantity; a mismatch is an invariant failure (trg_40 locks, reopen refused) |
| `voidAndReplaceInvoice` (`:1009-1108`) | after `:1036-1079`: `UPDATE invoice_time_entries SET invoice_id = <replacement> WHERE invoice_id = <voided>` |
| void without replacement (none today) | delete rows |

**Eligibility (L6, L11):** approved, unreserved, `work_type_snapshot='real_work'`; `local_date` (start in the policy tz of `contracts.workspace_id`, NULL → the contract project's workspace) ≤ `period_end` and ≥ `time_billing_floor(contract_id)` = `greatest(contracts.service_start_date, min(timesheet_events.created_at)::date WHERE event='legacy_import')`; hours = `payable_seconds`. `time-periods.ts` replaces `T00:00:00.000Z` / `slice(0,10)` (`:174`, `:189`).

| Contract (L7, L46) | Bills | Never |
|---|---|---|
| Engagement | (a) entries of `assignmentIdsForClientEngagement(engagement_id)`; (b) team entries with `team_id = providerPartyTeamId(engagement_id)` on a project with an active `engagement_project_links` row | workspace, personal, other teams |
| Legacy | team entries on `contract.project_id` of the provider seat's `contract_positions.team_id`, or (NULL) the team owned by the provider seat user | assignment, workspace, personal |
| Legacy, ambiguous | none/several teams, or two live `time_based`/`hybrid` legacy contracts → **409 `LEGACY_CONTRACT_AMBIGUOUS`** | — |

**Pricing (L9, L63, CHANGE-23).**
- Engagement `bill_rate` = `rate_kind='billing'`/`hour` from `ratesInForceOn(rates, entry_local_date)`, `work_type = entry.work_type_snapshot` before `work_type IS NULL`; none → the version's `client_hourly_rate`; `month`/`fixed` → retainer/fixed lines only. Legacy: `client_hourly_rate` (`:114`, `:127`). `assertNoInternalRates` unchanged.
- `bill_seconds` = `payable_seconds`, re-rounded to the client engagement's `rounding_minutes` for two-engagement assignments; the client weekly limit is not re-applied.
- Lines by `(task, bill_rate)` at `detailed`, `bill_rate` at `summary`; amount = `round(Σ bill_seconds/3600 × bill_rate, 2)`, total = Σ lines (replaces `:222-228`); row `bill_amount` is audit only.
- Hybrid: current-period entries consume `included_hours` in `started_at` order, reserved at `bill_amount=0`; the rest bill as overage. "Earlier hours" (`local_date < period_start`) get their own lines, outside any allowance.
- **Detail (L22):** engagement level = `least(invoice.hours_detail_level, settingsInForceOn(period_end).client_hours_detail_level)`. **Choice:** legacy keeps `invoice.hours_detail_level` (`invoices.service.ts:328`, `:412`); its "Client hours" level is `none`. No line names a person (`:59`).
- **Cron (L33):** `invoice-scheduler.service.ts` stops auto-submitting; time cron 3 does it. `pay_period_config` still drives `period_source='team_config'` (`:178`, `:271`).

## Payouts

`marketplace/payouts/payouts.service.ts`, team only (D7 defers engagement payouts).

| Item | Rule |
|---|---|
| Authority | `isTeamManager` + `time_tracking_enabled`, `payouts_enabled` (CHECK keeps payouts behind rates) + `time_payouts` on `team.workspace_id`; replaces `assertTeamApprover` (`:566-606`); `assertCanViewPayout` (`:557`) still lets the member read |
| `POST /payouts` | `{member_user_id, team_id, entry_ids[], …}` (`log_ids[]` deprecated synonym; RPC keeps `p_log_ids`). Entries Owed (approved, team, `payout_id IS NULL`, `legacy_status IS NULL`; CHANGE-5), one team/member/currency, no `fixed` (**`FIXED_RATE_NOT_PAYABLE_BY_ENTRY`**; fixed pay is manual). Self → **`PAYOUT_SELF_NOT_ALLOWED`** (TS pre-check + RPC). |
| Total | `round(Σ payable_seconds/3600 × rate_snapshot, 2)`, once (L63) |
| `GET /payouts/teams/:teamId/owed?until=` | `local_date ≤ until` in the team policy tz (L65) as an exclusive UTC instant (replaces `lte('started_at', to)`, `:398-399`); per-currency totals rounded once; `pay_period_config` only suggests `until` |
| RPCs (L15) | `create_payout_and_mark_paid` (latest `20260907090000:48-147`; its `status` write `:137-143`) and `void_payout_and_revert` (`20260701000020:179-214`; `000030` grants only), rebuilt M2, M3, M5. Through M3 payable = `payout_id IS NULL AND legacy_status IS NULL AND (payable_seconds IS NOT NULL OR status='approved')`, total `coalesce(payable_seconds, duration_seconds)`, so rollback-era approvals stay payable. This fallback is safe only because `time_timesheet_transition` mirrors approve/reopen into `status` until M5 — a decider reopen of a legacy-approved sheet writes `status='pending'`, so returned entries never become payable. The payout RPC's own `status`/`reviewed_*` writes continue until M5. Both refuse `fixed` and self. |
| Account deletion | `payouts.team_id` stays NOT NULL CASCADE, so `account_deletion_team_has_payouts`/`_workspace_has_payouts` (`20260923090100:46-68`) hold; `*_has_open_time` adds the open-time blockers (L39) |

**Cut-off editor (L14):** `teams.pay_period_config` stays in Team › Settings › Time as "Billing and pay cut-offs", owner-writable with `time_billable_invoices` or `time_payouts`; `validatePayPeriodConfig` (`:672-730`) unchanged.

## Finance, Exports and Dashboard

Approved = `payable_seconds IS NOT NULL AND legacy_status IS DISTINCT FROM 'rejected'`; hours = Σ `payable_seconds` (CHANGE-5).

| File | Change |
|---|---|
| `finance/books/finance-books.service.ts` `overviewTime` (`:534`), `getMySummary` (`:913`), `getPersonalDashboard` (`:1176`) | personal book incl. personal entries, no cost; team book by `team_id`; project book non-personal, assignment rows per `identityVisible`. Cost = Σ `amount_snapshot` behind `view_costs`; `NULL` listed uncosted. Pending = sheet `open`/`submitted`/`returned` on `duration_seconds`. Permissions unchanged. |
| `finance/exports/finance-export.service.ts:86-125` | keeps `kind=time_logs`; adds `logging_for` (L22 mask), `timesheet_status`, `period_start`, `period_end`, `payable_hours`; rate/amount are cost columns (`export-columns.ts:53-61`, `view_costs`); drops `email` |
| `TimeReportsService` export | classes **base** (masked person, date, start, end, duration, payable, work item, For, status), **content** (`contentVisible`), **cost** (`costVisible`); screen's authority query (L45) |
| `financials/financials.service.ts` `getCostRows` (`:385`) | approved `real_work` non-personal, Σ `amount_snapshot`; consultant's client-engagement time is NULL, never cost |
| `getUncostedHours` (`:354`) | drops `teams!inner(member_rates_enabled)`; uncosted = team entries of rate-enabled teams with `rate_snapshot=0`, or talent entries with `amount_snapshot IS NULL`; workspace and client-governed excluded |
| `finance/finance.service.ts:80` | same cost source |
| `projects/projects.service.ts` (`:574-878`, `:1317`) | counts by sheet status; `payable_seconds`; `costVisible` fees (replaces `feeVisibleProjectIds`); overtime windows (`:773`) from `TimePolicyService`; `:1317` calls `stopRunningForProject` |
| `engagement-eligibility.service.ts:139` | table rename |
| `scripts/seed_dev_project_finance.mjs`, `scripts/seed_finance_demo.mjs`, `backend/test/integration/qa-fixture.integration-spec.ts` | `time_entries` names before the L19 grep gate |

**Cents note:** book cost (Σ per-entry `amount_snapshot`) can differ from a payout total by ≤ 0.005 × entries; the payout total is what was paid.

## Assignment Creation

`EngagementAssignmentsService`, routes on `EngagementsController`, non-parties 404.

| Route | Who | Behaviour |
|---|---|---|
| `GET /api/engagements/:id/assignments` | parties | worker shown to provider-side parties only (L22); feeds "Who can log time here" |
| `POST …/assignments` (talent) | hirer seat | Worker = talent provider. `client_engagement_id` auto-set when exactly one active client engagement on the project has this hirer as consultant provider; several → **`ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED`** (L8). `team_id` defaults to `hirerPartyTeamId(id)` (L35). No project link → `operational_assignment` `engagement_project_links` row (project admin). **Access (L25)** needs the caller's `members.manage` at call time and **upserts** `project_access (project_id, user_id)` (one row per pair since `20260507000130`): new row = editor, `origin='engagement:<talent_engagement_id>'`, `has_direct_grant=true` (owner-lockout rule); existing row → `has_direct_grant=true`, role raised to editor only if lower, `origin` untouched, never downgraded. Without `members.manage`: created, no grant, `access_needed: true` ("Ask a project admin to add <name>"). |
| `POST …/assignments` (client) | consultant provider | worker = self; must already hold `time.log` (L25) |
| both | — | `started_at` defaults now, backdatable but not before `engagement.started_at` or the retroactive window; entries never re-attributed. `tg_engagement_assignments_guard` (rebuilt M1 from `20260814020000:444-534`) adds **`ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER`**; codes → 422. Resolver cache evicted. |
| `POST …/assignments/:aid/end` `{ended_at?, reason?}` | talent hirer; client provider for own | rebuilt `tg_engagement_assignment_running_timer_guard` (M3, from `20260814021000:489-508`) **stops** the running entry at `NEW.ended_at`, `flagged_reason='stopped_by_assignment_end'`, never refuses (L37, CHANGE-22); service reads it first and sends `timer_auto_stopped` |

- **Engagement end:** any ending path ends active assignments in the same transaction via `EngagementsService`. As of 2026-10-02 nothing sets `engagements.status='ended'`, so this binds the first writer; resolver step 2's `status='active'` is the backstop.
- **Auto-hook:** `EngagementProjectService.setUp` (`engagement-project.service.ts:141`) calls `ensureProviderAssignment` after `linkEngagement` (`:190`), with `team_id = providerPartyTeamId`.
- Two-engagement entries snapshot the talent **cost** rate; client pricing comes only from invoices (L8/L9).
- **Web:** "Assign to project" / "End assignment" on `web/src/routes/_execution/engagements/$engagementId.tsx` (types `services/engagement.service.ts`), `access_needed` as an inline notice — see [UX](./ux.md) and [edge cases and tests](./edge-cases-and-tests.md).
