# Engagement Lifecycle and Edge Cases

> **Last updated:** 2026-08-18 · **Status:** current

> **⚠️ The activation rules are enforced; the later-stage rules are not yet reachable.**
> `20260816090000_contract_positions_runtime.sql` was applied 2026-08-18 and its backend
> is deployed, so everything on this page about signing, activation, amendment rollover,
> and party immutability is enforced today — in the database, inside
> `sign_contract_position_and_activate`. Rules covering assignments, time submission, and
> approval describe intended behavior with no runtime behind them yet.

Engagement records are durable financial and legal history. Most corrections therefore
append, end, reopen, or supersede records instead of mutating the facts that explain an
already signed agreement or approved payment.

## Contract-first lifecycle

```text
draft contract
     |
     v
positions completed and contract sent
     |
     v
both positions sign
     |
     +-- lock contract row
     +-- re-check Consultant enrollment
     +-- create engagement + two parties
     +-- create project scope when project-specific
     +-- project signed time settings and rates
     +-- attach contract to engagement
     |
     v
active engagement
     |
     +-- signed amendment -> same engagement, new effective terms
     +-- party change ----- > new contract family + new engagement
     |
     v
ended or cancelled (terminal)
```

The final-sign operation must be one database transaction. Duplicate requests lock the
same contract and create at most one engagement.

## State transitions

| Record | Allowed forward path | Never allowed |
| --- | --- | --- |
| Engagement | active → ended/cancelled | Reopen, delete, change parties/kind/scope |
| Project link | active → ended | Delete or retarget to another project |
| Assignment | active → ended/cancelled | Reassign worker/project/engagement in place |
| Time approval | draft → submitted → approved/rejected; decided → reopened → submitted | Silent edit of submitted evidence |
| Effective rate/settings | Close with `effective_until`, then insert successor | Overlapping windows or rewriting historical source terms |

## Assignment rules

| Rule | Reason |
| --- | --- |
| At least one of client or Talent engagement is required | An assignment must have commercial meaning |
| Talent engagement provider must equal the worker | Prevents charging one provider's contract for another person's work |
| Each referenced engagement must link to the project | Prevents cross-project misuse |
| Client-only assignment worker must be its Consultant provider | Additional workers require their own Talent relationship |
| Assignment identity is immutable | Historical logs must retain their original commercial context |
| End is blocked while a timer runs | Prevents an open timer crossing an undefined commercial boundary |
| Assignment never grants access | Commercial and execution authorization remain separate |

## Time precedence

For attributed commercial work, engagement time policy wins over team defaults:

```text
commercial log with assignment
        |
        +-- applicable engagement setting? -- yes --> contract-projected rule
        |                                      no
        +---------------------------------------> team/default rule

legacy or internal log without assignment ----------> team/default rule
```

The signed contract remains the source. `engagement_time_settings` and
`engagement_time_rates` are effective-dated projections for execution, not independent
ways to invent terms.

## Approval rules

| Actor | Action |
| --- | --- |
| Talent provider | Creates/reopens a draft and submits the period |
| Consultant hirer | Approves or rejects with an optional review note |
| Client | No access to Talent submissions or approvals |
| Payout workflow | Consumes approved Talent-side snapshots |
| Invoice workflow | Uses Client-side contract rules independently |

Approval items freeze the log set, payable duration, rate, unit, currency, and amount.
When a correction is necessary, the approval is reopened and resubmitted rather than
editing approved evidence invisibly.

## Edge-case decisions

| Edge case | Required behavior |
| --- | --- |
| Draft never signed | No engagement exists |
| Duplicate final-sign request | Row lock makes activation idempotent |
| Same parties and project have multiple contracts | Multiple Talent contracts are allowed. One signed Client-services contract governs project billing until finance supports parallel Client agreements. |
| Consultant hires a non-public account | Allowed through a private Talent contract |
| Talent pauses marketplace listing | Existing/private engagements continue |
| Consultant is suspended or revoked | New marketplace/signing actions stop; history and in-flight execution are preserved |
| Party receives a raise | Signed prospective amendment effective today or later; same engagement if parties are unchanged |
| Executed engagement needs a signature correction | Do not unsign it: amend or end the engagement so its effective-dated settings and rates remain legally coherent. |
| Party changes | New root contract and engagement |
| Fixed Client price, hourly Talent price | Each side follows its own contract; fixed Client agreements are manually invoiced until milestone billing ships, and Talent hours never reprice Client terms |
| Different currencies | Each side snapshots its own currency; future margin reporting needs a separately snapshotted FX basis |
| Late time entry | Allowed only when its work timestamp lies inside the original assignment window |
| Timer crosses assignment end | Stop/split first or reject the end transition |
| Access exists without assignment | Internal work only; no engagement billing or payout attribution |
| Assignment exists without access | No project entry or logging until `project_access` is granted |
| Project is deleted | Null live FK, keep titles, parties, contracts, logs, approvals, invoices, and payouts |
| Engagement ends with unpaid work | Preserve obligations and snapshots; do not delete them |
| Account is soft-deleted/anonymized | Legal snapshots preserve historical attribution |

## Visibility boundary

| Viewer | May eventually receive |
| --- | --- |
| Client | Their Client engagement, contracts, invoices, and contract-permitted evidence |
| Consultant | Client revenue and Talent cost relationships they occupy |
| Talent | Their Talent contract, assignments, submissions, decisions, and payable terms |
| Ordinary project member | No commercial relationship data from membership alone |

New tables enable RLS but grant no direct `anon` or `authenticated` policy. Future backend
APIs must return position-specific projections so a Client cannot infer Talent identities,
rates, payouts, or Consultant margin.

## Legacy boundary

Ending an engagement must first stop running timers and explicitly end its active
assignments. Unpaid work and already approved evidence remain durable after termination.

Existing contracts receive deterministic relationship/scope defaults, but no engagement,
party, position, invoice, payout, or time-log link is backfilled. Null `engagement_id` and
`engagement_assignment_id` values explicitly mean the legacy/internal path. Runtime
adoption must not guess relationships from project membership, team membership, or
matching account IDs.

## Deferred work

| Item | Why deferred |
| --- | --- |
| Assignment/time-log APIs | Activation now creates the commercial records; explicit assignment, logging, submission, and approval workflows still need their own operational API design. |
| Redacted Client/Consultant/Talent APIs | Position-based signing is live in the P4b runtime cutover, but broader role-specific projections still need design around the visibility boundary. Compatibility fields remain accepted for rolling clients. |
| Organization-backed parties | Belongs to P4c/organizations design; user parties are additive now |
| Historical backfill | Explicitly rejected; inference could fabricate legal relationships |
