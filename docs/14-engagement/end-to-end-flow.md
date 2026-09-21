# End-to-End Flow

> **Last updated:** 2026-08-26 · **Status:** draft

This page walks each market position — Client, Consultant, Talent — from first
marketplace contact, through contracting and engagement activation, to the execution
platform. No other page spans that whole distance: the
[persona flow docs](../11-domains/consultants/user-flows.md) describe the invite path
into execution, and the [engagement docs](./README.md) describe the commercial model,
but the two are **parallel paths that do not join today**. This page states where each
step lives, which steps are live, and where the seams are.

> **⚠️ Two paths, no bridge.** Execution entry is `project_access`, granted by invites,
> assignment, or team curation — never by an engagement. Engagement activation is live,
> but `engagement_assignments` (the record that would tie a worker's execution time to
> the signed agreement) is written by nothing. Until the
> [build order](./integration.md#build-order-for-the-next-slice) step 2 ships, a person
> can be fully inside execution with zero connection to the contract that pays for them.

## The whole system in one picture

```text
 MARKETPLACE                    CONTRACTING                    EXECUTION
 (discovery)                    (commercial truth)             (delivery)

 browse / directory ──┐
                      │   draft contract (2 positions)
 talent invite ───────┼──▶ send ──▶ both parties sign
      │               │                  │
      │               │                  ▼
      │               │   sign_contract_position_and_activate
      │               │                  │
      │               │                  ▼
      │               │       ENGAGEMENT + parties + links
      │               │         + time settings + rates
      │               │                  │
      │               │                  ▼
      │               │        /engagements  (read-only)
      │               │                  ┆
      │               │                  ┆  engagement_assignments   ✗ unbuilt
      │               │                  ┆  attributed time logs     ✗ unbuilt
      │               │                  ┆  submission / approval    ✗ unbuilt
      │               │                  ┆  payout consumption       ✗ unbuilt
      ▼               │                  ┆
 invite accepted ─────┴──▶ project_access ──▶ deliver, log time, approve,
                           (the ONLY door)      invoice, payout (legacy path)
```

Solid lines are live; the dotted column is the unbuilt bridge. Time logged today flows
through the **legacy path** (internal rate snapshots, per-log approval, manual payouts —
see [Teams and Time](../11-domains/teams-and-time/README.md)) even when a signed
engagement covers the same people.

## Consultant swimlane

The Consultant is the only position that traverses every stage.

| # | Step | Where | Status |
| --- | --- | --- | --- |
| 1 | Sign up (lane-free) and apply for vetting | `/marketplace/consultant/apply` | live |
| 2 | Admin approves → `consultant_profiles.status='verified'` | admin console | live |
| 3 | Create or join a project; become consultant-of-record | `/project/new`, assignment | live |
| 4 | Browse and invite Talent | `/marketplace/talent`, `POST /marketplace/invite` | live |
| 5 | Draft a contract with two positions; resolve counterparty by exact email | `/engagements/finance` | live |
| 6 | Send; both parties sign; engagement activates | `/engagements/finance/$contractId`, sign token | live |
| 7 | Review the engagement — seats, links, effective rates and time policy | `/engagements/$engagementId` | live |
| 8 | Assign a worker to project work under the engagement | — | **unbuilt** |
| 9 | Review submitted Talent time; approve or reject | — | **unbuilt** |
| 10 | Approvals drive payouts; milestones drive fixed-fee invoices | — | **unbuilt** |

Steps 4 and 5–7 are independent: an invite needs no contract, and a contract needs no
prior invite. Today step 7 is a dead end; the consultant returns to the legacy team
surfaces for steps 8–10's stand-ins (per-log approval, manual payouts, manual invoices).

## Talent swimlane

| # | Step | Where | Status |
| --- | --- | --- | --- |
| 1 | Sign up; build profile, rates, skills | `/profile`, go-live checklist | live |
| 2 | Go live (`talent_profiles.status='active'`) — optional; private contracting skips it | `/marketplace/talent/go-live` | live |
| 3 | Receive and accept a project invite → `project_access.role='editor'` | `/invites` | live |
| 4 | Sign a talent-services contract (provider position) | sign token or in-app | live |
| 5 | Read own engagement — counterparty, cost rates, time policy | `/engagements` | live |
| 6 | Be assigned under the engagement | — | **unbuilt** |
| 7 | Log attributed time (`task_time_logs.engagement_assignment_id`) | — | **unbuilt** |
| 8 | Submit time for the period; see decisions | — | **unbuilt** |
| 9 | Get paid from approved submissions | — | **unbuilt** (legacy manual payouts stand in) |

Steps 3 and 4 commute — a Talent can be delivering long before any contract is signed,
or hold a signed engagement while still waiting for the invite that actually opens the
project (see [Scenario 9](./scenarios.md#scenario-9-access-and-commercial-assignment-disagree)).

## Client swimlane

The Client has the shortest documented journey and the biggest gaps — there is no
`docs/11-domains/clients/` and no built client execution surface.

| # | Step | Where | Status |
| --- | --- | --- | --- |
| 1 | Exist as a Proyekto account (consultant resolves them by exact email) | — | live |
| 2 | Receive a signing link; sign without logging in | `/contract/sign/$token` | live |
| 3 | Read own engagement — billing rates only, never Talent cost | `/engagements` (after signing in) | live |
| 4 | See delivery progress on the funded project | — | **proposal** ([client-access-handover](../13-proposals/client-access-handover.md)) |
| 5 | Receive invoices composed from contract terms | invoice lifecycle | live (manual issue) |
| 6 | Milestone-based billing checkpoints | — | **unbuilt** |

The token-signing page is deliberately account-free and namespace-free; the account the
consultant resolved may never have logged in, so nothing guarantees the Client ever sees
step 3.

## Flow-level edge cases and recommended solutions

These are the seams **between** stages — the within-model edge cases (idempotent
activation, amendments, deletion, currency) are already locked in
[Lifecycle → edge-case decisions](./lifecycle-and-edge-cases.md#edge-case-decisions).

> **⚠️ Recommendations are proposals, not locked decisions.** Current behavior in the
> second column is verified; the third column needs product sign-off before build.

| Edge case | Behavior today | Recommended solution |
| --- | --- | --- |
| **Signed contract, empty engagements page.** Contracts signed before positions existed activate nothing. | Valid but inert; amending mints positions (`cloneOrCreateAmendmentPositions`). Empty state explains. | An "amend to activate" CTA on the contract detail for signed two-party contracts lacking positions; never backfill. |
| **Client signs but never signs in.** Token signing needs no session, so the engagement may be invisible to its own hirer. | Engagement exists; Client sees it only if they later log in and find `/engagements`. | Post-signature confirmation screen linking to sign-in + `/engagements`; longer term, the [client-access-handover](../13-proposals/client-access-handover.md) proposal. |
| **Client holds an engagement but no project access.** They fund work they cannot watch. | `project_access` is never granted by signing, by design. | Keep the separation; have the engagement detail say explicitly what the Client can and cannot see, and route "watch progress" through the handover proposal, not through access-by-engagement. |
| **Delivery with no assignment.** Talent invited and working, engagement signed, nothing links them. | All time lands on the legacy path: `engagement_assignment_id IS NULL`, internal rate snapshot, per-log approval. | Ship assignments (build-order step 2) with a team-roster indicator per member: *engagement-backed* vs *internal*. Never infer the link — inference is [explicitly rejected](./lifecycle-and-edge-cases.md#legacy-boundary). |
| **Two approval systems for one hour of work.** Legacy per-log approve/reject is live; `engagement_time_approvals` will arrive beside it. | Only the legacy path exists, so no conflict yet — but nothing prevents one later. | Make the paths mutually exclusive per log: an attributed log (`engagement_assignment_id` set) is decided **only** through engagement submission/approval; a null-assignment log stays on the legacy path. One log, one payable truth. |
| **Flexible engagement is unplaceable.** `operational_assignment` project links are written by nothing, so project filters can never match it. | Empty states say so and offer "Show all". | Placement UI ships **with** assignments, not after: creating an assignment on a flexible engagement writes the `operational_assignment` link in the same transaction. |
| **Overlapping engagements between the same parties.** Multiple talent contracts are allowed; a timer must know which agreement it bills. | Nothing attributes time, so the ambiguity is latent. | Timer and manual-log UI offer an assignment picker scoped to the caller's active assignments covering the task's project; auto-select when exactly one matches; refuse silently defaulting when several do. |
| **Assignment exists, access doesn't (and vice versa).** The two controls are independent by design. | Documented in [Scenario 9](./scenarios.md#scenario-9-access-and-commercial-assignment-disagree); no UI surfaces the mismatch. | Assignment creation checks `project_access` and offers to send the invite in the same flow — prompt, not coupling. The check is advisory; the invariant stays "assignment never grants access". |
| **Consultant suspended mid-delivery.** Vetting capability gates new signing, not existing seats. | Signing and new invites stop; execution and history continue. | Keep future approval rights keyed to the **hirer seat**, mirroring the read guard — a suspended consultant can still decide time on engagements they already hold, or the Talent's payable path freezes with them. |
| **Invite path and engagement path stay invisible to each other.** A consultant cannot tell which project members are covered by a signed agreement. | No surface correlates them. | Once assignments exist, the team surface shows engagement coverage per member; until then, do not fake the correlation from matching account ids. |

## What this page does not cover

- Row-level writes at activation — [Integration surface](./integration.md).
- Table shapes and invariants — [Data model](./data-model.md).
- Worked row-by-row examples — [Scenarios](./scenarios.md).
- Legacy time, approval, and payout mechanics — [Teams and Time](../11-domains/teams-and-time/README.md).

## Related documentation

- [Engagements hub](./README.md)
- [Lifecycle and edge cases](./lifecycle-and-edge-cases.md)
- [Consultant user flows](../11-domains/consultants/user-flows.md)
- [Talent user flows](../11-domains/talent/user-flows.md)
- [Personas](../01-product/personas.md)
- [Project lifecycle](../01-product/project-lifecycle.md)
