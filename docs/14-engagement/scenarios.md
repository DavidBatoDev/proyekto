# Engagement Scenarios

> **Last updated:** 2026-08-14 · **Status:** draft

> **⚠️ Designed, not active.** The rows below are illustrative identifiers showing how the
> authored schema behaves. They are not production records or a migration backfill.

These scenarios use the same people throughout so the relationship between tables stays
visible.

| Identifier | Person or object |
| --- | --- |
| `U1` | Client Acme |
| `U2` | Verified Consultant Maria |
| `U3` | Talent Juan |
| `P1` | Website project |
| `P2` | Mobile app project |

## Scenario 1: a Client hires a Consultant for one project

U1 accepts a project-specific contract authored by U2. The engagement appears only when
both contract positions have signed.

```text
U1 (Client / hirer) ---- C1 ----> U2 (Consultant / provider)
                              |
                              v
                        E1 client_services
                              |
                              v
                         P1 Website
```

### Rows after final signing

`contracts`

| id | relationship_kind | scope_mode | project | family | engagement |
| --- | --- | --- | --- | --- | --- |
| `C1` | `client_services` | `project_specific` | `P1` | `F1` | `E1` |

`contract_positions`

| contract | position | user | capacity | signed |
| --- | --- | --- | --- | --- |
| `C1` | `hirer` | `U1` | `client` | yes |
| `C1` | `provider` | `U2` | `consultant` | yes |

`engagements`

| id | kind | scope | status | activated by |
| --- | --- | --- | --- | --- |
| `E1` | `client_services` | `project_specific` | `active` | `C1` |

`engagement_parties`

| engagement | position | user | capacity |
| --- | --- | --- | --- |
| `E1` | `hirer` | `U1` | `client` |
| `E1` | `provider` | `U2` | `consultant` |

`engagement_project_links`

| engagement | project | basis | status |
| --- | --- | --- | --- |
| `E1` | `P1` | `contract_scope` | `active` |

If U2 performs the work personally, an assignment identifies U2 as the worker:

| assignment | worker | project | client engagement | Talent engagement |
| --- | --- | --- | --- | --- |
| `A1` | `U2` | `P1` | `E1` | null |

U2 must still have an appropriate `project_access` row. `A1` does not grant it.

## Scenario 2: the Consultant privately hires Talent for that project

U2 separately contracts U3. U3 does not need an active freelancer marketplace profile;
private acceptance is enough. U2 remains the only contract author.

```text
Client side:  U1 ---- E1 ----> U2       revenue
Talent side:  U2 ---- E2 ----> U3       cost

Work:                    U3 ---- A2 ---- P1
                              E1 + E2
```

### New rows

| Record | Key values |
| --- | --- |
| Contract `C2` | `talent_services`, `project_specific`, project `P1`, engagement `E2` |
| C2 hirer position | U2 as `consultant` |
| C2 provider position | U3 as `talent` |
| Engagement `E2` | U2 hires U3; activated by C2 |
| E2 project link | P1 with `contract_scope` basis |
| Assignment `A2` | worker U3, project P1, client engagement E1, Talent engagement E2 |

The assignment is the bridge, not a merger:

| Ledger | Engagement | Visible economic meaning |
| --- | --- | --- |
| Client invoice | `E1` | What U1 owes U2 |
| Talent payout | `E2` | What U2 owes U3 |
| U3 time log | assignment `A2` | Work attributable to both sides under their separate terms |

U1 can never read E2, U3's rate, U3's payout, or U2's margin.

## Scenario 3: fixed-price Client work with hourly Talent cost

The two contracts do not need matching compensation structures.

| Side | Contract term | Effective rate row | Result |
| --- | --- | --- | --- |
| E1 Client services | Fixed ₱120,000 | `billing`, `fixed`, ₱120,000 | Client invoice follows milestones/fixed terms |
| E2 Talent services | ₱500/hour | `cost`, `hour`, ₱500 | Approved U3 hours determine U2's Talent cost |

If U3 logs 80 approved hours, the Talent-side snapshot can total ₱40,000. The Client still
owes the fixed ₱120,000. Proyekto must not reprice the Client contract from Talent hours.

## Scenario 4: a flexible Talent agreement spans projects

U2 signs a general hourly agreement with U3 before deciding where U3 will work.

### Immediately after signing

| Table | Row |
| --- | --- |
| `engagements` | E3 = `talent_services`, `flexible`, active |
| `engagement_parties` | U2 hirer/Consultant; U3 provider/Talent |
| `engagement_project_links` | none |
| `engagement_assignments` | none |

### U3 is later placed on two projects

| Link | Engagement | Project | Basis |
| --- | --- | --- | --- |
| `L31` | `E3` | `P1` | `operational_assignment` |
| `L32` | `E3` | `P2` | `operational_assignment` |

| Assignment | Worker | Project | Client side | Talent side |
| --- | --- | --- | --- | --- |
| `A31` | `U3` | `P1` | `E1` | `E3` |
| `A32` | `U3` | `P2` | another Client engagement | `E3` |

One flexible agreement can support several projects. Each timer or manual log selects the
correct assignment so billing and payout attribution is unambiguous.

## Scenario 5: the same parties have overlapping agreements

U2 and U3 may have E3 for general delivery and E4 for specialist security work on P1.

| Engagement | Scope | Rate | Work |
| --- | --- | --- | --- |
| `E3` | Flexible | ₱500/hour | General development |
| `E4` | P1-specific | ₱900/hour | Security review |

The people and project are identical, so Proyekto cannot infer the right commercial row.
The log flow must ask for or otherwise resolve an explicit assignment:

| Assignment | Talent engagement | Role title |
| --- | --- | --- |
| `A31` | `E3` | Developer |
| `A41` | `E4` | Security reviewer |

Choosing `A41` prices the payable work under E4. A unique constraint prevents duplicate
active copies of the exact same assignment context, not legitimate parallel agreements.

## Scenario 6: Talent submits time and the Consultant approves it

U3 records two logs under A2 during 1–7 September. The raw logs remain in
`task_time_logs`; the approval item table freezes the payable interpretation.

```text
U3 logs work -> U3 submits period -> U2 approves -> payout may consume approval
```

`engagement_time_approvals`

| id | engagement | worker | period | status | submitter | reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| `AP1` | `E2` | `U3` | Sep 1–7 | `approved` | `U3` | `U2` |

`engagement_time_approval_items`

| approval | log | payable seconds | rate snapshot | amount snapshot |
| --- | --- | --- | --- | --- |
| `AP1` | `T1` | 14,400 | ₱500/hour | ₱2,000 |
| `AP1` | `T2` | 10,800 | ₱500/hour | ₱1,500 |

The Client does not approve these rows. Client invoice acceptance and Talent payable-time
approval are independent decisions.

## Scenario 7: U3 receives a raise

U2 and U3 keep E2 because the parties and relationship are unchanged. They sign an
amendment in the same contract family.

| Contract version | Family | Engagement | Term | Effective date |
| --- | --- | --- | --- | --- |
| `C2-v1` | `F2` | `E2` | ₱500/hour | Jan 1 |
| `C2-v2` | `F2` | `E2` | ₱650/hour | Oct 1 |

`engagement_time_rates`

| source contract | rate | effective from | effective until |
| --- | --- | --- | --- |
| `C2-v1` | ₱500/hour | Jan 1 | Sep 30 |
| `C2-v2` | ₱650/hour | Oct 1 | null |

September approval items retain their ₱500 snapshots. October work uses ₱650. An informal
database update is not a raise: contractual price changes require the signed amendment.

If U3 is replaced by another provider, that is not an amendment to E2. It creates a new
root contract and a new engagement because the party changed.

## Scenario 8: the project is deleted

Deleting P1 severs nullable project FKs but does not erase the commercial record.

| Record | Before deletion | After deletion |
| --- | --- | --- |
| Project link | `project_id=P1`, title `Website` | `project_id=null`, title still `Website` |
| Assignment | `project_id=P1`, title `Website` | `project_id=null`, title still `Website` |
| Contract/invoice | Project-linked | Existing durability snapshots remain |
| Time log | Project-linked | Existing assignment and member snapshots remain |

The engagement can be read as history but the removed project cannot receive new work.
Project deletion never changes who hired whom, historical rates, approvals, invoices, or
payouts.

## Scenario 9: access and commercial assignment disagree

These are intentionally separate controls.

| State | Allowed behavior |
| --- | --- |
| U3 has project access but no assignment | May perform internal execution work; engagement billing/payout cannot consume it |
| U3 has an assignment but no project access | Cannot enter the project or log work until access is granted separately |
| U3 has both | May create commercially attributed logs within the assignment window |
| Assignment ended but access remains | May continue ordinary permitted project activity, but not attribute new commercial time to the ended assignment |
