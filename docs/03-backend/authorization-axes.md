# Authorization Axes

> **Last updated:** 2026-10-06 · **Status:** current

Proyekto answers seven *different* authorization questions with seven *different* pieces of
state. They are independent by design. This page names all seven in one place, states which
question each one answers, and fixes the rule that keeps them from collapsing into each
other.

The rule, in one line: **each axis answers exactly one question, and no guard, policy, or
`beforeLoad` may consult another axis's values to answer its own.**

That rule is not decorative. Proyekto has already paid for breaking it twice — once with
`profiles.role` and the `account_role` enum (deleted 2026-08-10), and once with
`project_access.origin`, which carried `'client'` and `'consultant'` values until
2026-08-18 and let a *how you joined* field masquerade as a permission input. Both were
removed rather than fixed. See [Personas](../01-product/personas.md).

## The seven axes

| # | Axis | State | Values | Answers |
| --- | --- | --- | --- | --- |
| 1 | Project role | `project_access.role` | `owner > admin > editor > commenter > viewer` | What may I do **inside a project**? |
| 2 | Finance-book role | `finance_book_members.role` | `owner`, `manager`, `accountant`, `viewer_client`, `viewer` | What may I do **inside a finance book**? |
| 3 | Commercial position | `engagement_parties` (and `contract_positions`) | `hirer`/`provider` × `client`/`consultant`/`talent` | **Who hired whom**, on this agreement? |
| 4 | Marketplace capability | `consultant_profiles.status`, `talent_profiles.status`, `admin_profiles` | `verified`/`pending`/`suspended`/`revoked`; `active`; present/absent | May I **author contracts** / be **discovered** / **govern the platform**? |
| 5 | Engagement eligibility | derived | `engaged`, `grandfathered`, `ineligible` | Is this person's work on this project **contract-backed**? (no caller since the time rebuild) |
| 6 | Entitlement | plan features of the context's workspace (`plan_limits`), plus `teams.time_tracking_enabled` | feature on / off; team on / off | Does the **plan** include this, and has the **team** turned time on? |
| 7 | Timesheet decision | `timesheets.approver_scope`, frozen at submit | `team`, `workspace`, `hirer`, `auto`, `self` | Who may **approve this timesheet**? |

### 1. Project role — execution authorization

`project_access` is the **only** source of execution authorization. Nothing else grants
entry to a project: not a contract, not an engagement, not an assignment, not a finance
book. Resolution lives in
[`project-permissions.ts`](../../backend/src/modules/execution/projects/permissions/project-permissions.ts)
with per-member capability overrides over the ladder default.

Logging time is the `time.log` capability: editor and above by default, and it requires
`access.time`. Viewers and commenters (so clients in those roles) read their own past entries
but cannot log. Turning `access.time` off for a member turns `time.log` off in the same write.

### 2. Finance-book role — money-surface authorization

Books are a separate membership space, resolved by
[`finance-book-permissions.ts`](../../backend/src/modules/marketplace/finance/books/finance-book-permissions.ts)
— a pure `(role, overrides) → capabilities` function with no I/O, so it is snapshot-tested
and mirrorable on the web without drift. Because every finance service runs on
`SUPABASE_ADMIN`, whatever that function returns **is** the security boundary.

The load-bearing consequence: **a book member with every capability still has zero
execution access**, because books never write `project_access`. That is what lets an
external accountant or HR administrator see money without seeing the work. See
[Finance books](../11-domains/finance/finance-books.md).

### 3. Commercial position — who hired whom

Client, Consultant and Talent are **positions on a contract**, never account attributes.
The same account may pay for one project and deliver another. The database enforces the
matrix (`client_services`: hirer=client, provider=consultant; `talent_services`:
hirer=consultant, provider=talent) and forbids one user holding both seats.

Engagement reads are authorized by **party membership and nothing else** — a non-party
receives 404 rather than 403, so ids cannot be probed. See
[Engagement integration surface](../14-engagement/integration.md).

> **Constraint worth knowing before you design against this.**
> `engagement_parties.user_id` and `contract_positions.user_id` are **profile FKs**. A
> *team* or organization therefore cannot occupy a position today, even though the product
> intent is that any party — solo or team — may take any position. Expressing that requires
> the organization work in
> [organizations-and-services](../13-proposals/organizations-and-services.md); until it
> lands, a team's agreement is held by an individual account.
>
> What a seat *can* carry since 2026-09-23 is the team its user **signs on behalf of**
> (`contract_positions.team_id` / `team_name_snapshot`, copied to `engagement_parties` at
> activation). That is identity on the paper — the agency a consultant bills as, the
> company a client contracts as, the team a talent is engaged into — not party-ship: the
> seat is still the person. Only the seat's own user may set it, only to a team they own
> (`teams.owner_id`), only before that seat signs. A signed talent contract whose hirer
> seat names a team adds the talent to that team as a `member` in the same transaction.

### 4. Marketplace capability — what you are allowed to become

Capability is stateful enrollment, not identity:

- `consultant_profiles.status = 'verified'` → may author contracts and reach consultant-only
  surfaces. Shared predicate: `is_active_consultant()` in SQL,
  [`consultant-capability.ts`](../../backend/src/common/auth/consultant-capability.ts) in
  TypeScript, behind `ConsultantOnlyGuard`.
- `talent_profiles.status = 'active'` → discoverable in the talent directory. It controls
  **public discovery only**; a consultant may privately contract any account.
- An active `admin_profiles` row → platform administration, behind `AdminGuard`.

Signup is lane-free and there is no account role. See
[auth-and-guards.md](./auth-and-guards.md).

### 5. Engagement eligibility — is this work contract-backed?

Derived, not stored, by
[`EngagementEligibilityService.getEngagementStatus(userId, projectId)`](../../backend/src/modules/marketplace/finance/eligibility/engagement-eligibility.service.ts):

| Value | Means |
| --- | --- |
| `engaged` | The user holds a **signed** `contract_positions` seat on a `signed`/`active` contract linked to the project — directly via `contracts.project_id`, or through `engagement_project_links` for flexible-scope contracts |
| `grandfathered` | No live seat, but the user predates enforcement: pre-cutoff time logs on the project, or a verified consultant with a pre-cutoff `project_access` row |
| `ineligible` | Neither |

The cutoff is the hardcoded constant `ENFORCEMENT_CUTOFF = '2026-08-27T00:00:00Z'`.
Results are cached in-process for 60 s per user+project.

**Nothing calls it since the time rebuild.** Its only consumer was the old timer gate behind
`teams.contract_enforcement`; that column is still accepted by `PATCH /api/teams/:id`, has no
effect, and is dropped in M5. Contract-backed time is now expressed by logging **for an
agreement** (an engagement assignment option in the time module's "For" resolver), not by a
gate. The service keeps its table rename and is a removal candidate.

### 6. Entitlement — does the plan include it, and is the team on?

Two switches, neither of them a permission. Permissions answer "may this role do this here";
entitlement answers "is this feature on for the workspace that pays for it".

| Switch | State | Checked where |
| --- | --- | --- |
| Plan features | `plan_limits` keys for the **plan subject**: a team's `workspace_id` (resolved through `EntitlementsService.resolveScopeForTeam` when it is null, never passed as a raw null); a workspace itself. Assignment (contract) and personal time have no subject and are never plan-gated | `time_tracking`: the "For" resolver lists team and workspace options as `unavailable: 'plan'` (there is no separate gate on entry writes), and `TeamsService.assertTimeTrackingAllowed` when a team turns time on. `time_team_rules`: team policy writes, override application, team rates at approval. `time_payouts`: payout create and owed. `time_billable_invoices`: hourly contract create and provider sign, and the pay cut-off editor (or `time_payouts`). `time_reports_export` / `time_audit_export`: workspace reports and exports. Refusals are the ordinary `PlanLimitException` (403) |
| Team toggle | `teams.time_tracking_enabled` | The resolver lists the team as `unavailable: 'team_time_off'`; payouts also require it |

The old `EntitlementGuard` / `@RequiresEntitlement('time_tracking')` was deleted with the old
time module. Stop, pause, resume, delete, submit, withdraw, approve, return, reopen, payout
void and every read are never plan-gated: after a downgrade new governed time stops, and
existing timesheets still finish.

### 7. Timesheet decision — who may approve this sheet?

`can_decide_timesheet` (SQL, called by RPC, never re-implemented) reads the sheet's
**frozen** `approver_scope`, never the current plan:

| `approver_scope` | Deciders |
| --- | --- |
| `team` | `can_manage_team(team_id)`: the team owner, or a `team_members` row with role `owner`/`admin` |
| `workspace` | `can_manage_workspace(policy_workspace_id)`: owners and admins of the workspace whose time policy governs the sheet |
| `hirer` | the hirer party of the sheet's talent engagement |
| `auto`, `self` | nobody (the system approves; `self` = the member approved their own sheet because no cost money was involved and nobody else could) |

The member never decides their own sheet except as `self`, and cost money (team member rates
under `time_team_rules`, or a talent engagement) rules `self` and `auto` out.

Here workspace administration authorizes a **decision**, never project entry. A workspace
admin deciding a sheet that holds time on a project they cannot open sees the person,
interval, duration and work-item kind; project and task titles and notes need `access.time`
on that project and otherwise read "A project you can't open". No `project_access` row is
created. Reading follows `can_view_timesheet`: the member, a decider, or a team manager on a
team-scope sheet; a team manager also reads every team-context entry of their team.

## How the axes compose

Two worked examples, because the combinations are where testing goes wrong.

**A talent member starting a timer** is checked in this order:

```text
one timer        one running entry per person          ── checked first: else 409
                                                         TIMER_ALREADY_RUNNING (alias 400), even
                                                         before the 404 below
project role     project_access row, or the owner     ── else 404 (no project entry at all)
capability       time.log (editor and above)          ── else no options; a write is 403
                                                         NO_LOGGING_CONTEXT
"For" resolver   their assignment (inside its window, governing engagement active,
                   agreement settings in force)        ── commercial position, as an option
                 a team curated for them on the project
                   (team toggle on, plan has time_tracking)
                 the workspace (seat, policy on, plan) only when no team is curated for them
                 "Just me" only when nothing governed is available
                 unavailable options are listed with a reason, never silently dropped
DB floor         trg_time_entries_10_context           ── project_access / team membership
                                                         backstop
```

Commercial position enters only as the assignment option the worker may log for, never as a
permission. Eligibility (axis 5) is not consulted. An agreement ending mid-timer never
refuses: ending the assignment stops the running timer at the end time
(`flagged_reason='stopped_by_assignment_end'`).

**A client opening their own agreement** is checked on exactly one axis — commercial
position. Not consultant capability, not project role, not book membership. This is the
axis confusion most likely to produce a wrong gate, because the surface *looks* like
finance: `GET /api/engagements` carries `SupabaseAuthGuard` alone, and adding
`ConsultantOnlyGuard` there would lock Clients and Talent out of reading their own
agreements.

## Anti-patterns

| Do not | Because |
| --- | --- |
| Gate on a declared identity or stated intent | `marketplace_survey_responses.intents` is personalization; `scripts/check_survey_is_not_authz.mjs` fails the build if it is referenced from an authorization path |
| Infer a billing counterparty from `projects.owner_id` or a `project_access` row | A project is the execution layer and does not model the two sides of a commercial arrangement — the parties live on the contract |
| Let an engagement, assignment, or finance book grant project access | `project_access` is the sole execution authorization source; no engagement table is consulted by any authorization path. Creating an assignment writes a `project_access` row only on behalf of a caller who holds `members.manage` on the project at that moment (the same rule as adding a member); otherwise it reports `access_needed` |
| Read `project_access.origin` as a role | Origin records *how* someone joined and takes no part in permission resolution |
| Add a second module that touches engagement tables | All of them have RLS enabled with **zero** policies; `EngagementsService` owns redaction so the party-scoping rule has exactly one implementation. Existing direct readers (contracts, finance books, eligibility, two read-only probes in the time module) are debt, not precedent |
| Re-derive a status label locally | One vocabulary, in [`web/src/lib/finance-status.ts`](../../web/src/lib/finance-status.ts) |

## Related documentation

- [auth-and-guards.md](./auth-and-guards.md) — the guards themselves
- [Personas](../01-product/personas.md) — why there is no account role
- [Engagement integration surface](../14-engagement/integration.md) — party-scoped reads
- [Engagement action surface](../14-engagement/action-surface.md) — which seat may do what
- [Finance books](../11-domains/finance/finance-books.md) — axis 2 in full
- [Teams & Time](../11-domains/teams-and-time/README.md) — axes 6 and 7 as the time module applies them
- [RLS and security](../07-data-and-db/rls-and-security.md)
