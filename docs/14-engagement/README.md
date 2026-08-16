# Engagements

> **Last updated:** 2026-08-16 · **Status:** draft

> **⚠️ Schema applied; runtime not active.** The additive schema is defined in
> [`20260814020000_engagement_core.sql`](../../supabase/migrations/20260814020000_engagement_core.sql)
> and [`20260814021000_engagement_time.sql`](../../supabase/migrations/20260814021000_engagement_time.sql),
> and is applied in production. No runtime path writes these tables yet.

An engagement is the durable answer to **who hired whom**. It connects a signed
marketplace agreement to the projects and workers that perform the work without making
commercial relationships a source of project authorization. Contracts remain the legal
authority; engagements organize their operational and financial effects.

## Reading order

| Page | What it answers |
| --- | --- |
| [Data model](./data-model.md) | What every engagement table stores and which invariants the database enforces |
| [Scenarios](./scenarios.md) | What rows exist when a client hires a consultant, a consultant hires Talent, work spans projects, rates change, or a project is deleted |
| [Lifecycle and edge cases](./lifecycle-and-edge-cases.md) | When records are created, what can change, who approves time, and how exceptional cases behave |

## The model in one picture

```text
signed contract version
        |
        v
   engagement -------------------- engagement parties
        |                           hirer + provider
        |
        +---- project links ------- where the relationship may be used
        |
        +---- assignments --------- which worker performs which project work
        |          |
        |          +-------------- task time logs
        |
        +---- time settings ------- how work must be recorded
        +---- time rates ---------- signed billing or cost terms
        +---- approvals ----------- Talent submits; Consultant reviews
        |
        +---- invoices / payouts -- revenue side / cost side
```

## Locked decisions

| Question | Decision |
| --- | --- |
| When does an engagement exist? | Only after a root contract is fully signed |
| Who may author a contract? | A verified Consultant |
| Can a private Talent provider be any account? | Yes; freelancer enrollment controls public discovery, not private contracting |
| Must an engagement belong to one project? | No; it may be `project_specific` or `flexible` |
| Can the same parties have several engagements? | Yes; assignments disambiguate commercial time |
| What determines price? | The signed contract version; rate changes require a signed amendment |
| Who approves Talent time? | The Talent provider submits and the Consultant hirer reviews |
| Does an assignment grant project access? | No; `project_access` remains the only execution authorization source |
| Can a Client see Talent cost? | No; Talent identity, rates, payouts, and Consultant margin stay private |
| Are existing engagement/position links backfilled? | No; nullable links preserve the legacy path. Existing contracts only receive deterministic relationship/scope defaults. |

## Two independent commercial sides

One delivery project can have two agreements that must never be collapsed:

```text
Client U1 ---- client-services contract ----> Consultant U2
   pays                  E1                         earns

Consultant U2 -- talent-services contract ---> Talent U3
   pays                  E2                         earns
```

`E1` is the Client revenue relationship. `E2` is the Talent cost relationship. An
assignment may reference both so U3's work is attributable to the Client project, but the
Client never gains visibility into `E2`.

## Source boundaries

| Concern | Authority |
| --- | --- |
| Legal parties, price, and amendments | Signed contract versions |
| Commercial relationship | `engagements` + `engagement_parties` |
| Where the relationship is used | `engagement_project_links` |
| Worker/project commercial attribution | `engagement_assignments` |
| Raw work ledger | `task_time_logs` |
| Talent payable-time decision | `engagement_time_approvals` + items |
| Project authorization | `project_access`, never an engagement table |

## Related documentation

- [Identity and enrollment](../13-proposals/identity-and-enrollment.md)
- [Finance](../11-domains/finance/README.md)
- [Teams and time](../11-domains/teams-and-time/README.md)
- [Data schema overview](../07-data-and-db/schema-overview.md)
