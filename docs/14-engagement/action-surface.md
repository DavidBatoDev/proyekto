# Engagement Action Surface

> **Last updated:** 2026-08-28 · **Status:** draft

> **⚠️ This page specifies intent, not shipped behaviour.** The read surface described in
> [Integration surface](./integration.md) is live. The action rail, seat-neutral agreement
> view, and assignment flow below are **designs**; each row says which. Nothing here
> changes a locked decision — it decides where the already-agreed model surfaces as
> something a person can *do*.

Every other page in this section answers *what the model stores*. This one answers **what
each seat's next action is, and where it lives** — the question a person actually has when
they open `/engagements` and find a list they cannot act on.

## The problem this page exists to fix

`/engagements` reads correctly and acts on nothing. The list page is fully wired to three
live queries, and the detail page renders seats, project links, effective rates and the
signed time policy. But no surface in the product writes `engagement_assignments`, and
`invoices.engagement_id`, `payouts.engagement_id` and `task_time_logs.engagement_assignment_id`
are never populated by any code path. A signed agreement is therefore a terminus: you can
read who hired whom and on what terms, and then you must leave and redo all of it by hand
through the legacy team surfaces.

```text
 today                                    intended

 contract signed                          contract signed
       |                                        |
       v                                        v
   engagement  --> (nothing)              engagement --> assign a worker
       |                                        |            |
   read seats                                   |            +--> attributed time
   read rates                                   |            +--> submit / approve
   read policy                                  |            +--> payout
       |                                        +--> place on a project
      dead end                                  +--> raise an invoice
```

## One primary action per seat and state

The rule this table encodes: **at any point, each seat has exactly one obvious next
action.** Where a cell has none today, it names the build-order step that supplies it
rather than inventing a stand-in.

| Engagement state | Client | Consultant | Talent |
| --- | --- | --- | --- |
| **No contract yet** | Nothing — a client never authors. Waits for a link. | **Draft a contract** (`/engagements`, "New contract") — *live* | Nothing — waits for a link. Marketplace go-live is a separate track. |
| **Draft** | Invisible by design. `draft` means "not visible to the other party". | **Complete terms, name the counterparty, send** (`/engagements/finance/$contractId`) — *live* | Invisible. |
| **Sent, awaiting signature** | **Sign** — via the token link at `/contract/sign/$token`, no account needed — *live* | **Withdraw or amend** while waiting — *live* | **Sign** — same token path — *live* |
| **Signed, engagement active** | **Read the agreement and its invoices.** Cannot see talent identity, cost, or margin. | **Assign a worker to project work** — *build-order step 2, unbuilt* | **Read own terms**, then log attributed time — *step 3, unbuilt* |
| **Active, work under way** | **Receive and pay invoices** — *live (manual issue)* | **Review submitted time; invoice the client** — approval is *step 4, unbuilt*; invoicing is *live* | **Submit time for the period** — *step 4, unbuilt* |
| **Ended / cancelled** | Read-only history; invoices survive. | Read-only history; amend is not available on a terminal engagement. | Read-only history; unpaid obligations are preserved. |

Two facts that make this table smaller than it looks:

- **Steps 4 and 5 of the consultant swimlane commute with steps 3 and 4 of the talent
  swimlane.** An invite needs no contract, and a contract needs no prior invite. Do not
  build a wizard that forces an order the model does not require.
- **A client may hold an engagement and no project access, permanently.** That is the design
  ([Scenario 9](./scenarios.md#scenario-9-access-and-commercial-assignment-disagree)), not a
  gap to close by granting access from a contract.

## The engagement detail action rail

*Design.* The fix for the dead end: `$engagementId.tsx` gains a single action region whose
contents are chosen by the viewer's seat, never by capability.

| Action | Shown to | Guard | Writes | Status |
| --- | --- | --- | --- | --- |
| Open the agreement | Any party | Party membership | — | *live read, wrongly gated — see below* |
| Assign a worker | The hirer seat | Party membership + hirer position | `engagement_assignments` | unbuilt (step 2) |
| Place on a project | The hirer seat, `flexible` scope only | Same | `engagement_project_links` (`operational_assignment`) | unbuilt (step 2) |
| Raise an invoice | Consultant provider on a `client_services` engagement | Existing finance authorization | `invoices` (with `engagement_id`) | invoicing live; the link is not written |
| View time under this engagement | Hirer and provider, redacted per seat | Party membership | — | unbuilt (step 3) |
| End the engagement | The hirer seat | Party membership + hirer | `engagements.status` | unbuilt |

Rules for the rail:

- **Seat, not capability.** Every entry is decided by which seat the viewer holds. The
  moment one of them consults `isActiveConsultant`, a client or talent seat loses access to
  its own agreement — the exact failure the API's guard choice was made to avoid.
- **Absent, not disabled.** An action a seat can never take is not rendered. A disabled
  control invites a support question about a rule that will never change.
- **Unbuilt actions are not rendered at all** — no "coming soon" affordance. The empty
  state names the structural reason instead, per the pattern below.

## Seat-neutral agreement viewing

*Design, and the smallest of the four fixes.*

The detail page hides "Open contract" behind `isActiveConsultant` today, with an accurate
comment explaining why: the contract document renders inside the consultant-gated finance
area, so for a client or talent the button would lead to a wall. The result is that the
seats who most need to re-read what they signed are the ones who cannot.

This is a **routing** problem, not a permission one. Direct contract reads are already
position-based, and both stored parties retain read-only access even after project
severance. The fix is a party-scoped agreement view that lives outside the finance wall —
alongside `/engagements/$engagementId`, not under `/engagements/finance` — reusing the
existing contract read authorization unchanged. Nothing about who may read what changes.

Until it exists, the page correctly shows the signing date instead of a link into a wall.
Do not "fix" this by relaxing the finance guard.

## The handoff into execution

*Design — build-order step 2, written so it can be implemented without re-deciding
anything.*

All the invariants already exist in the database as trigger-enforced rules with typed error
tokens (`tg_engagement_assignments_guard`): at least one engagement context is required; a
talent engagement's provider must be the worker; each referenced engagement must link to the
project; assignment identity is immutable; ending is blocked while a timer runs. The build
does not restate them — it surfaces them.

What has to be added:

1. **Assignment create and end endpoints** in `modules/marketplace/engagements/`, the only
   module permitted to touch these tables. Party-scoped like the reads: the caller must hold
   the hirer seat on every engagement referenced.
2. **Flexible placement in the same transaction.** Creating an assignment on a `flexible`
   engagement writes its `operational_assignment` project link atomically. Placement UI
   ships *with* assignments, not after — otherwise flexible engagements remain unmatchable
   by the project filter, which is the current state and reads as a broken filter.
3. **An advisory access check, never a coupling.** Assignment creation looks for a
   `project_access` row for the worker and, when absent, offers to send the invite in the
   same flow. It is a prompt. The invariant "an assignment never grants access" is
   unchanged, and the assignment must still be creatable without it.
4. **Coverage on the team surface.** Once assignments exist, the project team list marks
   each member *engagement-backed* or *internal*. Never infer that correlation from matching
   account ids — inference is
   [explicitly rejected](./lifecycle-and-edge-cases.md#legacy-boundary).
5. **One log, one payable truth.** When attributed time arrives (step 3), a log carrying
   `engagement_assignment_id` is decided **only** through engagement submission and
   approval; a null-assignment log stays on the legacy per-log path. The two approval
   systems must be mutually exclusive per log, not merely coexistent.

## Making the two surfaces one product

`/engagements` and `/engagements/finance` are one section and must read as one.

- **One status vocabulary.** Labels and tones come only from
  [`web/src/lib/finance-status.ts`](../../web/src/lib/finance-status.ts), which exists
  precisely because six files once hand-rolled their own colour maps and collapsed `void`,
  `cancelled`, `rejected` and `ended` into the same grey as `draft`. Never add a second
  local status map.
- **One empty-state pattern.** State the *structural* reason and offer an escape. "No
  match" is never the right copy when the real answer is "a flexible agreement carries no
  project, so a project filter cannot match it" — with a "Show all" way out. This pattern is
  already used for the project facet; extend it rather than inventing a second.
- **Sections are destinations; filters are not.** The sidebar names sections. The
  engagement list's seat tabs and status dropdown filter one collection and stay on the
  page. Folding them into the sidebar would mix filters into a sitemap; listing finance's
  own tabs there would give each of them two places to be selected from.
- **Seat-truthful labels.** The list slices by the *viewer's seat*, not by `kind`, because a
  `client_services` engagement means "you were hired" to its consultant and "you hired" to
  its client. A kind-based label lies to one of them.
- **Breadcrumbs are the way back.** Finance nests three levels deep (hub, book, project
  book); the engagement list does not. Both use the same crumb component.

## Redaction, restated as UI rules

The model's whole purpose is that the two commercial sides never merge. Stated as things a
page may not do:

- A Client surface must never render talent identity, talent cost rates, payouts, or
  consultant margin. `engagement_time_rates.rate_kind` is `billing` on client engagements
  and `cost` on talent engagements; leaking a `cost` row to a client is the exact failure
  this model exists to prevent.
- Client revenue (`client_services`) and talent cost (`talent_services`) are separate
  engagements and must never be summed into one figure.
- Redaction is enforced in `EngagementsService`, which hand-builds the counterparty
  projection field by field so a new column cannot silently leak. Keep it that way: do not
  spread a row.
- The browser cannot enforce any of this — all nine engagement tables have RLS enabled with
  zero policies, so a client-side query returns empty rather than erroring. Every engagement
  read goes through the backend route.

## Open questions

| Question | Why it is not decided here |
| --- | --- |
| Does "engagement" become "deals"? | A user-facing rename is a full-stack sweep, undecided — see [README](./README.md) |
| Can a **team** hold a seat? | `engagement_parties.user_id` is a profile FK; team parties need the P4c organization work |
| Do adopted (off-platform) agreements appear in this rail? | Yes, identically — see [off-platform adoption](../13-proposals/off-platform-engagement-adoption.md) |

## Related documentation

- [End-to-end flow](./end-to-end-flow.md) — the swimlanes this page turns into actions
- [Integration surface](./integration.md) — what the API exposes today, and the build order
- [Lifecycle and edge cases](./lifecycle-and-edge-cases.md) — the rules the rail must respect
- [Test matrix](./test-matrix.md) — how to walk these paths per seat
- [Authorization axes](../03-backend/authorization-axes.md) — seat vs capability vs role
