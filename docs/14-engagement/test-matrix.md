# Engagement Test Matrix

> **Last updated:** 2026-08-28 · **Status:** draft

The repeatable form of the three-window walkthrough: one browser profile per seat, driven
through the whole marketplace → contract → engagement → execution path.

Its purpose is not coverage. It is to make **a real regression distinguishable from a known
gap**. Half of these steps currently dead-end by design, and without a written expectation
every session re-discovers the same dead ends and re-argues whether they are bugs.

> **⚠️ Expected results describe 2026-08-28 behaviour.** Rows marked **gap** are unbuilt by
> design and must stay dead until the [action surface](./action-surface.md) ships. A row
> marked gap that suddenly *works* is as much a finding as one that breaks.

## Setup

Three signed-in profiles in separate browser profiles (not tabs — session storage is shared
across tabs and `signup_redirect` has no TTL):

| Window | Account | Preconditions |
| --- | --- | --- |
| **C** | Consultant | `consultant_profiles.status = 'verified'`; owns at least one project |
| **K** | Client | An ordinary account; no consultant enrollment, no project access |
| **T** | Talent | An ordinary account; `talent_profiles.status = 'active'` for the discovery steps only |

`scripts/seed_finance_demo.mjs` builds a scenario through the real API, so the signing RPC
actually opens the engagements. Read its notes before hand-rolling data — it encodes several
rules each learned from a rejection (consultant-mode project create only accepts `draft`;
`POST /api/projects` nests under `data.project`; `/sign` needs an explicit `position`;
client contracts reject any `time_approval_mode` other than `none`; the hourly billing mode
is `time_based`, not `hourly`; and `profiles` rows are not trigger-created from
`auth.users`).

> **Teardown does not fully work, by design.** The engagement tables are append-only at the
> database level — `trg_engagements_guard` and friends raise on DELETE — and PostgREST
> cannot disable a trigger. Plan on accumulating engagement rows, or use a scratch project.

## M1 — Consultant path

| # | Step | Surface | Expected |
| --- | --- | --- | --- |
| 1.1 | Open Engagements | `/engagements` | Loads. "New contract" button visible. |
| 1.2 | Create a draft contract | "New contract" dialog | Lands on `/engagements/finance/$contractId?section=parties`. Counterparty is always collected. |
| 1.3 | Resolve the counterparty by exact email | Parties section | Exact match only; a near-miss must not resolve. |
| 1.4 | Complete terms and send | Contract editor | Status → `sent`. Parties, `relationship_kind`, `scope_mode` and `contract_family_id` are now **frozen** — attempting to change one must fail with a `*_LOCKED` token. |
| 1.5 | Watch the pipeline | `/engagements` | The contract appears under **In signing**, not as an engagement. |
| 1.6 | Sign the consultant position | Contract editor | Still no engagement — one signature is not activation. |
| 1.7 | After the counterparty signs | `/engagements` | Engagement appears; contract leaves the pipeline; status `signed`. |
| 1.8 | Open the engagement | `/engagements/$engagementId` | Both seats, project links, rates effective today, time policy in plain English. |
| 1.9 | **Act on the engagement** | Engagement detail | **gap** — no assign, no place, no invoice. Only "Open contract". |
| 1.10 | Try to unsign an activated contract | Contract editor | Refused: "An activated engagement cannot be unsigned." |
| 1.11 | Amend for a rate change | Contract editor → Amend | Same engagement; a new effective-dated rate row; the old row gains `effective_until`. A past effective date is refused. |

## M2 — Client path

| # | Step | Surface | Expected |
| --- | --- | --- | --- |
| 2.1 | Open the signing link **while logged out** | `/contract/sign/$token` | Renders and is signable with no account and no login. This is the single most important row in the matrix — a regression here silently blocks every client. |
| 2.2 | Sign | Same | Activation fires if this is the second signature. |
| 2.3 | Sign in, open Engagements | `/engagements` | The engagement is listed. Seat tab reads **"People you hired"**. No "New contract" button. |
| 2.4 | Open the engagement | `/engagements/$engagementId` | Billing rates only. **No talent identity, no cost rates, no payouts, no margin.** |
| 2.5 | "Open contract" | Engagement detail | **gap** — hidden, because the contract document lives behind the finance wall. The signing date shows instead. Do not "fix" by relaxing the finance guard. |
| 2.6 | Guess another engagement's id | `/engagements/<other-uuid>` | **404**, never 403. A 403 here is a security finding — ids become probeable. |
| 2.7 | Open the funded project | any project URL | No access. An engagement never grants `project_access`. Correct, not a bug. |
| 2.8 | Finance | `/engagements/finance` | Routed to the personal book path, not the consultant portfolio. Book creation is never blocked. |

## M3 — Talent path

| # | Step | Surface | Expected |
| --- | --- | --- | --- |
| 3.1 | Accept a project invite | `/invites` | `project_access.role = 'editor'`. No engagement involved. |
| 3.2 | Sign a talent contract | token or in-app | Engagement opens on the second signature. |
| 3.3 | Open Engagements | `/engagements` | Seat tab reads **"You were hired"**. |
| 3.4 | Open the engagement | `/engagements/$engagementId` | Own cost rates and time policy. |
| 3.5 | Check the client price | Agreements section | **Absent.** `client_hourly_rate` is returned only for `client`/`consultant` capacity. Talent seeing the client price is a redaction failure. |
| 3.6 | Log time under the engagement | Time surfaces | **gap** — time goes to the legacy path; `engagement_assignment_id` stays NULL. |
| 3.7 | Submit time for a period | — | **gap** — no surface exists. |

## M4 — Ordering and independence

The steps that are *not* ordered, which a wizard-shaped implementation would wrongly couple:

| # | Check | Expected |
| --- | --- | --- |
| 4.1 | Invite talent to a project with no contract anywhere | Allowed. |
| 4.2 | Sign a talent contract before any project invite | Allowed. Engagement exists; talent still cannot enter the project. |
| 4.3 | Talent has project access but no assignment | Allowed — internal work. No engagement billing attribution. |
| 4.4 | Two active engagements between the same consultant and talent | Allowed. The uniqueness constraint blocks duplicate *identical* contexts, not legitimate parallel agreements. |

## M5 — Contract-gated time (per-team dial)

Set `teams.contract_enforcement` explicitly for each pass — the default is `off`, so a run
that never sets it tests nothing.

| # | Dial | Actor | Expected |
| --- | --- | --- | --- |
| 5.1 | `off` | Anyone | Timer starts. No eligibility check applies. |
| 5.2 | `warn` | `ineligible` member | Log succeeds, `contract_warning` returned; a manual log is stamped `flagged_reason='no_active_contract'`. |
| 5.3 | `enforce` | `ineligible` member | `startLog` refused with typed `NO_ACTIVE_CONTRACT`. |
| 5.4 | `enforce` | `engaged` member | Timer starts. |
| 5.5 | `enforce` | `grandfathered` member | Timer starts — pre-cutoff users must not be stranded. |
| 5.6 | Contract ends **mid-timer** | Running timer | Timer is **not** killed. `stopLog` stamps `flagged_reason='contract_lapsed'`. |
| 5.7 | Sign a contract, retry immediately | `enforce` | May still refuse for up to 60 s — the eligibility cache TTL. Expected, not a bug. |
| 5.8 | Team without the Time add-on | any | `ADDON_NOT_ENABLED`, from the entitlement guard, not the permission layer. |

## M6 — Finance books and redaction

| # | Step | Actor | Expected |
| --- | --- | --- | --- |
| 6.1 | Create a personal book with zero contracts | any | Succeeds; renders empty states. Creation is never gated. |
| 6.2 | Create a team book | non-owner | Refused. Team owner only. |
| 6.3 | Create a project book for a project with no live client contract | team owner | Refused. |
| 6.4 | Invite an external accountant | book owner | Accepts by token at `/engagements/finance/invite/$token`; gains book access and **zero** project access. |
| 6.5 | Accountant opens the book | accountant | Time and payouts visible; **costs and contracts are not**. |
| 6.6 | Accountant exports | accountant | The file contains no cost columns. Check the file, not the screen. |
| 6.7 | `viewer_client` with a `view_costs` override applied | client seat | Still cannot see costs. The override must be ignored. |
| 6.8 | Request a book the caller cannot reach | any | **404**, never 403. |
| 6.9 | Client-side Supabase query against `engagements` or `finance_books` | browser console | Returns **empty**, not an error — RLS is on with zero policies. A non-empty result is a serious finding. |

## M7 — Known structural empties

Not bugs. Each has a documented structural cause, and the empty state must **name** it and
offer a way out rather than saying "no match".

| Observation | Cause |
| --- | --- |
| A signed contract produces no engagement | It predates `contract_positions`. Amending mints them. There is no backfill. |
| Project filter matches no flexible engagement | A flexible engagement has no project link until `operational_assignment` is written, and nothing writes it. |
| Engagements tab empty for a long-standing consultant | Same as above; not a load failure. |
| The Imports tab errors in production | `20260826090000_finance_document_imports` is not applied. See [document imports](../11-domains/finance/document-imports.md). |

## Automating this

The Playwright harness already exists (`web/playwright/`, base URL `http://localhost:3000`,
`npm run pw:auth` for stored sessions). M1–M4 lift almost directly into specs; M5 and M6
need per-team and per-book fixtures.

Two rules when automating: drive the app **adaptively**, observing each response before the
next action rather than firing scripted batteries; and assert the **dead ends** as
explicitly as the happy paths, or the matrix loses the property that makes it worth keeping.

## Related documentation

- [Action surface](./action-surface.md) — what each gap becomes
- [Scenarios](./scenarios.md) — the row-level expectations behind these walkthroughs
- [Lifecycle and edge cases](./lifecycle-and-edge-cases.md)
- [Finance books](../11-domains/finance/finance-books.md) — M6's model
- [Authorization axes](../03-backend/authorization-axes.md) — why M5 and M6 check different things
