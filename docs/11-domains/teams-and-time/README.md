# Teams & Time

> **Last updated:** 2026-10-06 · **Status:** current

Delivery runs on **teams** — reusable groups of people that attach to projects — and
**time entries** grouped into **timesheets** that are approved, paid and billed. The clever
bit on the team side is *curation*: attaching a team to a project and picking which members
participate automatically grants them the right project access. On the time side it is
**"For"**: every entry says which agreement, team or workspace it was logged for, and that
alone decides who approves it, what it costs, and which invoice may bill it.

## Teams

A team is owned by any user and reused across projects. Since 2026-09-01 it also has an
organizational home: `teams.workspace_id`, set on create from
`WorkspacesService.resolveWorkspaceForWrite` (an explicit `workspace_id` on `POST /api/teams`
requires membership of any role; otherwise the caller's default workspace). It is **nullable,
`ON DELETE SET NULL`, and permanently so** — a deleted workspace orphans the team rather than
destroying it. `workspace_id` is on `CreateTeamDto` only and **not** on `UpdateTeamDto`: there
is no "move team between workspaces" endpoint, because moving one would have to carry its
projects, rates, and payouts with it. Team access is still `teams.owner_id` + `team_members`;
the workspace grants nothing. See [Workspaces](../workspaces/README.md).

| Table | Holds |
| --- | --- |
| `teams` | The team (rate/time flags, default currency, freeform `tags`, and a nullable `workspace_id`) |
| `team_members` | Roster + role (`owner` \| `admin` \| `member`) |
| `team_invites` | Email invites to join a team |
| `project_teams` | Attaches a team to a project (primary / contributor) |
| `project_team_members` | Which team members participate on a given project |
| `team_member_rates` | Per-member (and per-project) rate cards |

**Curation → access (the key mechanic):** when a member is curated into a project via
`project_team_members`, a **DB trigger** (`tg_project_team_members_sync_shares`) fans
out a `project_access` row — so their roadmap/chat access follows automatically. You
don't grant access twice. See [Data → RLS & security](../../07-data-and-db/rls-and-security.md).

Rate rules are guarded at the service layer: setting a member's rate is owner-or-admin
(`assertCanManageMembers`), and a trigger stops the team owner from being removed. Rates
used to additionally require the team owner to hold a verified consultant enrollment —
both that check and its `tg_team_member_rates_check_consultant` trigger were removed on
2026-09-06, when time tracking was decoupled from consultant capability. `team_member_rates`
has RLS enabled with no policies, so it is reachable only by the backend's service role.

**Money is opt-in, in two steps.** Time tracking on its own records hours and nothing else.
Two owner-only flags on `teams`, both defaulting to false, layer money on top:

| Flag | Turns on |
| --- | --- |
| `member_rates_enabled` | Per-member rate cards, the cost rate snapshotted onto each team entry (frozen at approval), and every fee figure in the UI |
| `payouts_enabled` | The payouts module and the cut-off schedule |

`payouts_enabled` **requires** `member_rates_enabled` — a payout totals `payable hours × rate_snapshot`,
so payouts without rates would record a zero-value payment. The CHECK constraint
`teams_payouts_require_rates` makes that state unrepresentable, `TeamsService.updateTeam`
cascades payouts off when rates go off, and `create_payout_and_mark_paid` re-checks
`payouts_enabled` in SQL so the invariant holds even if a caller bypasses the service.

With rates off, or on a plan without `time_team_rules` (Business and above), `TimeRatesService` gives
team entries a 0 rate — the single point through which every fee enters an entry — so a team
cannot mint priced time from stale rate rows. The rate is re-resolved for each entry's local
date when its timesheet is approved, using the `team_member_rates` row in force on that date.
Time imported from the old per-log system kept its stored snapshot. Because zero-rated hours
carry no cost, `ProjectFinancials.uncosted` reports them so the cost and margin figures can be
labelled incomplete rather than reading as pure profit.

Hour caps (`weekly_limit_hours`, `monthly_limit_hours`, `overtime_requires_approval`) live on
`team_member_rates` but are a **time** policy, not a money one: they stay in force with rates
off, which is why rate *reads* are deliberately ungated.

`teams.time_tracking_enabled` is the team's own switch (turning it on needs the workspace
plan's `time_tracking`). `teams.retroactive_log_days` is still accepted and written through to
the team's time policy; `teams.contract_enforcement` is accepted but has no effect. Both columns
are dropped once the old backend can no longer come back (M5).

**Tags are labels, not permissions.** `teams.tags` is a freeform `text[]` (GIN-indexed,
`NOT NULL DEFAULT '{}'`) that the API normalizes on write — trimmed, whitespace-collapsed,
case-insensitively deduped, capped at 20 tags of 40 characters. They are descriptive in
exactly the sense `project_access.origin` is descriptive: nothing in authorization reads
them, and nothing may start. They are set when a team is created (the `/welcome` deck and
the `/teams` modal) and edited under Team settings → General.

**Where onboarding invites go — changed 2026-09-01.** The `/welcome` deck no longer creates a
team at all: that step was removed when the workspace step became required, and the invite step
now invites people to the **workspace** (`POST /api/workspaces/:id/invites`), not to a team and
not to the personal project. Nothing about access changed by it — a workspace seat grants no
project access either. Team membership alone still grants no project access: access appears only
once a team is attached (`project_teams`) and its members are curated in
(`project_team_members`), which is what fires the trigger above.

## Time tracking

> **One ledger, one model.** A **time entry** is a plain fact — person, project, optional task
> or preset, interval — logged **for** exactly one context. Entries land on a **timesheet**
> (one per person, sheet scope and period), and approval happens on the sheet, never per
> entry. Approval freezes payable hours and cost per entry. The module is
> [`backend/src/modules/execution/time/`](../../../backend/src/modules/execution/time/), served
> at `/api/time`; the web's [Time pages](#on-the-web) call it, and older app bundles still call
> the old routes through the [`/api/team-time` alias](#the-apiteam-time-alias). Design history
> and the remaining rollout steps: [time management proposal](../../13-proposals/time-management/README.md).

### Time entries

| Rule | Detail |
| --- | --- |
| Fact | `time_entries` row: member, project, `task_id` **or** a `work_item` preset (`meeting`, `review`, `admin`, `other`; `task` exactly when `task_id` is set), interval, breaks (`break_seconds`; `time_entry_segments` keep the work/break timeline for display), optional `note` (≤ 2000) |
| Timer | Start, pause, resume, stop, or add time manually. **One running timer per person** across all projects (`uq_time_entries_one_running_per_member`); a second start is 409 `TIMER_ALREADY_RUNNING` |
| Long timers | 10 h → one "Timer still running" notice; 24 h → the time cron stops it at `started_at + 24h` with `flagged_reason='auto_stopped_24h'` and a "Timer stopped" notice (the cron's Cloud Scheduler job is created at [rollout step 9](../../13-proposals/time-management/migrations-and-rollout.md#apply-and-deploy-sequence); until then forgotten timers keep running) |
| Who logs | The `time.log` project capability: editor and above, requires `access.time`. Viewers and commenters read their own past entries only. Guests get 404 (the running-timer and overview polls answer empty) |
| Manual time | Refused when the policy turns manual entries off (403 `MANUAL_ENTRIES_DISABLED`) or before the retroactive window (422 `RETROACTIVE_WINDOW {earliest_date}`, judged in the policy timezone). Overlaps only warn |
| Edits | `PATCH` needs `expected_updated_at` (409 `STALE_REVISION` otherwise). Moving to another project or changing "For" re-resolves the context and re-snapshots rate, currency and label; both sheets must be `open` or `returned`. An entry on a submitted or approved sheet, or one that is paid, billed or frozen, is **locked** (409 `TIMESHEET_LOCKED`) |
| Hour caps | Team member caps (`team_member_rates`, per member and team, in the team policy timezone) cut payable time at approval unless the decider approves overtime; when the rate in force has `overtime_requires_approval` they also block the write (422 `HOUR_CAP_EXCEEDED`). A contract's weekly limit warns at write time and cuts at approval |

### "For": the four context kinds

Every entry carries `context_kind` + `context_ref` and the matching FK:

| Kind | Offered when | Sheet scope | Cost rate |
| --- | --- | --- | --- |
| `assignment` | The caller is the worker of an engagement assignment on the project, inside its window, whose governing engagement (the talent engagement, else the client one) is active with settings in force | `engagement` (the governing engagement) | Talent cost rate in force on the entry's date; a consultant's own client time is 0, no amount |
| `team` | The team is attached to the project **and** the caller is curated onto it (`project_team_members`) | `team` when the team has an override and its workspace has `time_team_rules` (Business and above), else `workspace` (`teams.workspace_id`) | The member's rate card in force on the date; 0 without `member_rates_enabled` or `time_team_rules` |
| `workspace` | No team is curated for the caller, they hold a seat in the project's workspace, and its policy has tracking on | `workspace` | 0 |
| `personal` ("Just me") | Nothing governed is available | none: never approved, billed or paid | none |

`LoggingContextService` resolves the options per (caller, project): no project access is 404;
no `time.log` means no options (writes 403 `NO_LOGGING_CONTEXT`); a team on time off or on a
plan without `time_tracking` is listed as **unavailable** with its reason and still blocks the
workspace option; an agreement whose `tracking_mode` is `required` removes the others; an
available agreement suppresses the team it was placed through. One option is picked
silently; several make a write answer 409 `LOGGING_FOR_REQUIRED {options, prefill}` until the
caller chooses (`remember: true` stores the choice in `time_logging_defaults`). Reads are
cached for 30 s in Redis; writes always resolve fresh.

### Timesheets

```
entry ── context_kind ──► personal ─────────────► no timesheet
                          assignment ───────────► scope engagement (governing engagement)
                          team ── override + time_team_rules? ── yes ► scope team
                                                             └── no ─► scope workspace (team.workspace_id)
                          workspace ────────────► scope workspace
```

A database trigger (`trg_time_entries_30_timesheet`) puts every non-personal entry on the
member's sheet for that scope and period, creating it on first use. Periods come from the
policy (weekly from Monday by default; biweekly, semi-monthly, monthly) in the policy
timezone; a policy change applies from the next period boundary.

| State | Means |
| --- | --- |
| `open` | Collecting entries; editable |
| `submitted` | Sent for approval (by the member, automatically, or on account deletion); entries locked |
| `returned` | Sent back by a decider with a note; editable, resubmittable |
| `approved` | Decided; entries frozen. Sublabels "Confirmed" (`auto`) and "Self-approved" (`self`) |

Every transition goes through one SQL function, `time_timesheet_transition`, called only by
`TimesheetsService` (TypeScript never writes a sheet's status or decision columns):

| Action | Who | Rule |
| --- | --- | --- |
| submit | member | Refused while an entry runs or with no entries; a manual-route sheet not before the period's last local day |
| withdraw | member | Submitted → open, before a decision |
| approve | a decider (never the member) | Freezes payable hours; optional `approve_overtime` |
| return | a decider | Note required → returned |
| reopen | a decider (note required) → returned; the member, on their own `auto`/`self` sheet → open | Refused while any entry is paid, paid outside Proyekto, or reserved on an invoice (`TIMESHEET_HAS_SETTLED_ENTRIES`) |
| request reopen | member, on a manually or legacy-decided sheet | Notifies the deciders |
| approve-bulk | a decider | 1–100 sheets in one transaction, all or nothing |

**Who approves** is frozen on the sheet at submit (`approver_scope`): `team` (the team owner
and admins — a Business team override with team approvers), `workspace` (owners and admins of
the sheet's policy workspace), `hirer` (the talent engagement's hirer), or nobody: `auto`
(client-engagement time, or approval turned off without money) and `self` (the member is the
only possible decider and the sheet carries no **cost money** — team member rates under
`time_team_rules`, or a talent engagement). With cost money and no other team decider, the
sheet falls back to the workspace's admins; with nobody at all it waits ("No one else can
approve this. Add a workspace admin."). See
[Authorization axes → timesheet decision](../../03-backend/authorization-axes.md#7-timesheet-decision--who-may-approve-this-sheet).

**The freeze.** On approval (and on a submit that chains to `auto`/`self`), `TimesheetsService`
computes per entry, for its local start date: the cost rate in force, rounding to the policy's
`rounding_minutes` (nearest, ties up), the caps — the contract's weekly limit on agreement
sheets and the team member caps, latest entries cut first unless overtime is approved — and
the amount (`round(payable/3600 × rate, 2)`, none for fixed rates). The SQL function checks the
entry set and applies it. A workspace or team policy weekly limit is shown on review but
never cuts payable time. **Approved** = `payable_seconds IS NOT NULL` and not legacy-rejected;
every hours and money total sums `payable_seconds`.

### Policy and plan

Layers, each field remembering its source: platform default → workspace policy
(`time_policies`, created on first need; its timezone comes from the first admin visit's
browser, else the earliest owner's or the member's saved timezone, else UTC; admins confirm it
once) → team override (only with
`time_team_rules`; owner-only for approval, approver, retroactive days and rounding) →
agreement terms in force on the entry's date → member caps. Routes:
`/api/time/policies/workspaces/:id` (managers edit; any workspace member reads it with
`can_edit: false`, and a member's read never creates the row) with its audit history at
`…/history` (managers), and `/api/time/policies/teams/:id`. `PATCH /api/teams/:id`
still accepts `retroactive_log_days` and writes it through to the team override.

| Plan feature | Free | Pro | Business | Enterprise | Checked at |
| --- | --- | --- | --- | --- | --- |
| `time_tracking` (timesheets and approvals) | ✗ | ✓ | ✓ | ✓ | Team/workspace "For" options; turning a team's time on |
| `time_billable_invoices` | ✗ | ✓ | ✓ | ✓ | Hourly contract create and provider sign; pay cut-off editor |
| `time_team_rules` | ✗ | ✗ | ✓ | ✓ | Team overrides; team rates at approval |
| `time_payouts` | ✗ | ✗ | ✓ | ✓ | Payout create and owed; pay cut-off editor |
| `time_reports_export` | ✗ | ✗ | ✓ | ✓ | Workspace reports; every export |
| `time_audit_export` | ✗ | ✗ | ✗ | ✓ | Audit export |

The plan subject is the context's workspace (a team's `workspace_id`); agreement and personal
time are never plan-gated, and nothing that finishes existing work (stop, submit, approve,
reopen, reads) ever is. On Free, editors still log "Just me". `time_approval_chains` is
reserved (`enforced: false`).

### Who sees what

| Viewer | Sees |
| --- | --- |
| The member | All their own time, across workspaces |
| A decider / sheet viewer | The sheets they decide; a team manager also every team-context entry of their team |
| Anyone without `access.time` on a project | Hours, interval and work-item kind only; titles and notes read "A project you can't open" |
| Cost | The member; a team manager when the team has member rates and `time_team_rules`; a talent hirer for their own engagement. Never a client, never through project roles |
| Placed talent identity | The worker and provider-side parties only; everyone else sees "Delivery team" (rosters: "Delivery team member"). A consultant's own client-only time stays named to their client |
| A client hirer | Approved hours only ("Client hours", invoices) at the agreement's detail level; `none` hides them |

Email is selected only in self and team-manager views. Every miss is 404.

### Reports, cron and notifications

- **Reports** (`/api/time/reports/*`): scope `team:`, `project:`, `workspace:` or
  `engagement:<id>`, grouped by day, week (in the scope's policy timezone and week start),
  member, project, task or context; CSV/XLSX export up to 10,000 rows; Enterprise audit
  export of sheet and policy events.
- **Cron** (`POST /api/time/cron/run`, `x-cron-secret`; built to run hourly, but its Cloud
  Scheduler job is created only at [rollout step 9](../../13-proposals/time-management/migrations-and-rollout.md#apply-and-deploy-sequence), so until then nothing auto-stops,
  auto-submits or reminds): auto-stop at 24 h, the 10 h notice, auto-submit of `auto`/`self`
  sheets `max(reminder_days, 1)` days after the period ends, finishing
  `auto`/`self` sheets left submitted, and reminders for manual-route sheets. Each job takes at
  most 200 rows; the run stops at a 20 s budget and reports `truncated`.
- **Notifications**: one per transition per recipient — "Timesheet to review", "Timesheet
  returned", "Timesheet approved", "Timesheet reopened", "Reopen requested", "Time to submit",
  "Timer still running", "Timer stopped", "Payment recorded". No notice carries an amount. See
  [Notifications](../notifications/README.md).

### The `/api/team-time` alias

Older mobile bundles (and any web build from before the time rebuild) still speak the old
per-log API; the current web never calls it. The alias keeps all
30 of its routes with the old request bodies and response shapes, served by the new services:

| Old behaviour | Through the alias |
| --- | --- |
| Per-log `status` | Derived from the entry: paid (payout or paid outside Proyekto), rejected (legacy marker), approved (`payable_seconds` frozen), else pending |
| Per-log review, bulk review | **410** `TIMESHEETS_REPLACED_REVIEW` ("Approvals now happen by timesheet. Reload Proyekto." on the web, "Update the app to approve timesheets." in the app) |
| Starting a timer | The remembered or first "For" option, never a 409; no option → 403 "You can't log time on this project." |
| Editing a submitted week | 409 "This week was sent for approval, so it can't be changed here." |
| Rates and costs | Only where cost is visible; project routes never carry cost or emails |
| `contract-status`, `my-rate`, heal | `{enforcement:'off', engagement_status:'engaged'}`, `null`, `{scanned:0, healed:0}` |

Hits are counted per route and day (`time:alias:hits:<route>:<yyyymmdd>`). The alias retires
once the current bundle's `native_build_min` is past the first native build that calls
`/api/time`, it has had 30 days of zero hits, and no active device runs an older bundle; after
that every `/api/team-time/*` route answers 410 `APP_UPDATE_REQUIRED`.

### Tables

| Table | Holds |
| --- | --- |
| `time_entries` | The ledger (renamed from `task_time_logs`); see above |
| `time_entry_segments`, `time_entry_comments` | Timeline segments; comment threads |
| `timesheets`, `timesheet_events` | Sheets and their append-only history |
| `time_policies`, `time_policy_events` | Workspace policy, team overrides, and the audit log |
| `user_time_preferences`, `time_logging_defaults` | Display timezone; remembered "For" per project |
| `invoice_time_entries` | Which invoice billed which entry (see [Finance](../finance/README.md)) |

All are service-role only (RLS on, no policies, `anon`/`authenticated` revoked). Views named
`task_time_logs`, `task_time_log_segments` and `time_log_comments` exist only so a rolled-back
old backend can still run; the old `status` column on `time_entries` is written only by SQL and
both are removed in a later contract migration (M5).

- **Durability:** deleting a project, task or team, or removing a profile, severs the nullable
  FK instead of deleting the entry; `context_ref`, the label and the member display-name
  snapshot keep attribution. Running timers on a project are stopped before it is deleted; ending
  an assignment stops a timer logging to it. Account deletion submits the person's open sheets
  for approval, and a team or workspace with time still waiting for approval or payment cannot
  be purged ("This team has time waiting for approval or payment. Hand it to another member
  instead of deleting it.").
- Approved team time feeds payouts; approved team and agreement time feeds invoices — see
  [Finance](../finance/README.md).

## On the web

> **One personal page, wherever the time is for.** Logging, submitting and approving all
> happen on the bare `/time` page; a team keeps only a Report with Rates and Payouts, and every
> old team-time link redirects. Routes, search params and the full redirect map:
> [Web → Routing → Time](../../04-web/routing-and-access.md#time). Data layer:
> [Web → the time data layer](../../04-web/state-and-services.md#the-time-data-layer).

| Surface | Path | What it does |
| --- | --- | --- |
| Time page | `/time` | A running-timer bar, the toolbar (Start timer, Add time, For filter, List \| Month) with quick add on wide screens, the week navigator and day strip, one card per timesheet in the view week (Submit or Resubmit, Withdraw, Fix), the entries table (For column, Needs review, Change For), a Month view, and **Waiting for you** for deciders. Someone who approves but logged nothing in 30 days gets **approver mode** (Waiting, Decided in the last 30 days, the policy cards) instead of an empty week. Owners and admins see the one-time policy confirm card |
| Review screen | `/time/timesheets/<id>` | The read-only sheet: project × day grid (hours of projects the reader can't open merge into "Projects you can't open"), flags, the weekly-limit indicator, the over-the-limit panel (only for caps that cut payable time), cost lines for cost viewers, history, and Approve / Return / Reopen for deciders or the member's Submit / Withdraw / Reopen / Ask to reopen |
| Workspace settings › Time | `/w/<slug>/settings/time` | The workspace time policy (period, week start, timezone, approval, manual time, rounding, reminder, weekly limit, presets) with its change history; members read it. `?tab=report` is the workspace report (`time_reports_export`) |
| Team settings › Time | `/w/<slug>/teams/<t>/settings/time` | Time on/off, the Business **team rules** (approvers, approval, period, manual time, retroactive window, rounding, each inheriting the workspace until overridden), and **Money**: member rates, payouts, and "Billing and pay cut-offs" |
| Team › Time | `/w/<slug>/teams/<t>/time` | Team managers only: **Report** · **Rates** · **Payouts**. Members are sent to `/time?for=team:<t>` |
| Project › Time | `/project/<p>/time` | **Everyone** (`time.view_team_logs`; one section per governed context; rows read-only) and **Client hours** (approved hours at the agreement's detail level, never identity, cost or notes). Someone who only logs there is sent to `/time?project=<p>` |
| Project settings › Time | `/project/<p>/settings/time` | "Who can log time here" with each person's default For (managers; from `GET /api/time/projects/:id/loggers`), "Client sees" (read-only), and hour limits |
| Dashboard | `/w/<slug>/dashboard` | "Waiting for your approval" card and the welcome-line nudges ("· 3 timesheets waiting", "· Submit last week (28h 45m)") |

**For on the web.** Starting a timer or adding time resolves the For first: one option is
used without asking (and never sent, so the server re-resolves); two or more open a picker
whose remembered choice is preselected but never applied silently; none shows why ("You're a
viewer on this project. Ask a project admin for editor access to log time."). A timer
already running asks "Stop *X* and start this?" only after the For is settled, so cancelling
never leaves you with no timer. The For chip on your own time opens "Who approves this time";
on someone else's entry it is a plain label.

**In the app.** `/time` and the review screen are `app` surfaces, agreement sheets included;
the team Rates and Payouts pages are `silent`. Native copy carries no amount on an agreement
context and never the words contract, rate, payout or invoice
([Web → What the installed app carries](../../04-web/routing-and-access.md#what-the-installed-app-carries)).

## The delivery loop

```
team ──attach──► project_teams ──curate──► project_team_members ──(trigger)──► project_access
 │                                                                                  │
 └── editors log time "for" a team, agreement or workspace ──► time_entries ◄───────┘
                                                                     │
                                                    timesheets (submit → approve: freeze)
                                                                     │
                                          payouts (team) ◄───────────┴──► invoice_time_entries ──► invoices
```

## Code locations

- **Backend:** [`backend/src/modules/execution/teams/`](../../../backend/src/modules/execution/teams/) (3 controllers), [`backend/src/modules/execution/time/`](../../../backend/src/modules/execution/time/) (6 controllers in `controllers/`, including the `/api/team-time` alias, whose reads and mapping live in `legacy/`)
- **Web:** time in `web/src/components/time/` (page, review, entries, forms, edit, calendar, sheets, approvals, report, timer, for, shared), `web/src/services/time.service.ts` and `web/src/queries/time.ts`, routes `web/src/routes/_execution/time/` and `routes/w/$workspaceSlug/settings/time.tsx`; settings pieces in `components/workspace/settings/time/`, `components/team/settings/time/` and `components/project/time/`. Teams in `web/src/routes/_execution/teams/`, `routes/w/$workspaceSlug/teams/` and `web/src/components/team/`. `web/src/components/team-time/` keeps only the team money pieces (rates, payouts, pay cut-offs, the money gate) and a few shared controls
- **Migrations:** `20261003090100_time_entries_expand.sql` (M1), `20261003100000_time_timesheets_backfill.sql` (M2: legacy logs grouped into timesheets), `20261003110000_rename_time_entries.sql` (M3: renames, transition engine)

## See also

- [Product → project lifecycle](../../01-product/project-lifecycle.md) — where teams fit end to end.
- [Workspaces](../workspaces/README.md) — the container teams now live in, and why it grants nothing.
- [Finance](../finance/README.md) — what billable time becomes.
- [API reference → time](../../03-backend/api-reference.md#time--time-and-team-time) — every route.
- [Time management proposal](../../13-proposals/time-management/README.md) — the design, decisions and the remaining rollout steps.
