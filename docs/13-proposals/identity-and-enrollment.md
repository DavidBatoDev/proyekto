# Identity and Enrollment

> **⚠️ Proposed — not built.** Phase 1 (dropping `profiles.role`, simplified signup) is landing
> now; the enrollment tables and the marketplace/execution split they serve are not built.

> **Last updated:** 2026-08-10 · **Status:** draft

Proyekto has tried to answer "what kind of user is this?" twice — first with a switchable
`persona_type` (removed in `20260804170019_remove_active_persona.sql`), then with a durable
`account_role` enum (`20260809130000_account_role_foundation.sql`, one day before this
proposal). Both failed the same way for opposite reasons, because both asked the wrong
question: client, freelancer, and consultant are not kinds of *people* — they are positions
in a *transaction*. This proposal removes account-level roles for good and replaces them with
three explicit, opt-in, concurrent **enrollment** tables on the marketplace side, while the
execution side (projects, roadmaps, kanban, chat, teams) becomes role-free and universal.
It is the identity foundation for the wider marketplace/execution platform split.

## The wall we kept hitting

Every account-level role model generated the same family of unanswerable questions:

| Question forced by `profiles.role` | Why it has no good answer |
| --- | --- |
| "Why would a freelancer create a project?" | It's their workspace. They're the *owner*. Whether they are anyone's freelancer is a fact about a contract that may not exist yet |
| "A consultant creates a project — who is the client?" | Nobody, and that's fine. A client only comes into existence when a contract attaches. The schema demanded an answer anyway |
| "Can a consultant hire another consultant?" | Under exclusive roles: second account or dead end. In reality: two contracts, same person on opposite party columns |
| "The user signed up as a client but now wants to find work" | Under a durable enum: support ticket or misdeclared account. The stored identity diverges from actual behaviour and every gate built on it starts lying |

The root defect is the same in both prior models: **role stored as global account state**.
The switchable persona made that state mutable (mode ambiguity, UI/permission flip-flops);
the durable enum made it immutable (dead ends, second accounts). Mutability was never the
problem — the *location* was.

## What we considered

| # | Model | Verdict |
| --- | --- | --- |
| 1 | Switchable persona (`persona_type` / `active_persona`) | **Rejected & already removed.** Global mutable state every feature had to consult; mode ambiguity; persona-keyed chat rooms |
| 2 | Durable `account_role` enum + 3-lane signup (current `main`) | **Rejected by this proposal.** Exclusive and permanent, so it generates the wall above; declared at signup — the moment of lowest information and highest drop-off — so it can be wrong forever |
| 3 | Pure derivation, no declaration ("a client is whoever has a posting") | **Rejected.** Incidental behaviour is too noisy for feature targeting — a mistaken posting shouldn't classify an account; roster membership doesn't prove someone sells their labour |
| 4 | One polymorphic `marketplace_profiles` table with a `type` column | **Rejected.** The three enrollments share almost no columns, run different state machines with different owners (admin-granted vs self-service vs system-triggered), and a typed table cannot carry a clean FK meaning "must be a consultant" |
| 5 | **Three separate enrollment tables + role-free execution** | **Chosen.** Explicit like #2, behavioural like #3, and each table gets its own shape, lifecycle, RLS, and FK enforcement |

## The model: five tables

Identity is one universal `profiles` row per human, plus capability-by-table-membership —
the pattern `admin_profiles` already uses for platform administration.

```mermaid
erDiagram
    profiles ||--o| admin_profiles : "platform admin"
    profiles ||--o| consultant_profiles : "vetted seller"
    profiles ||--o| freelancer_profiles : "available for work"
    profiles ||--o| client_profiles : "billing entity (deferred)"
    consultant_profiles ||--o{ contracts : "consultant seat (FK-enforced)"
    profiles ||--o{ contracts : "client seat"

    profiles {
        uuid id PK
        bool is_consultant_verified "absorbed by consultant_profiles later"
    }
    consultant_profiles {
        uuid user_id PK-FK
        text status "pending | verified | suspended | revoked"
    }
    freelancer_profiles {
        uuid user_id PK-FK
        text status "active | paused"
    }
    client_profiles {
        uuid user_id PK-FK
        text status "deferred - build when billing needs it"
    }
    contracts {
        uuid client_user_id FK
        uuid consultant_user_id FK "-> consultant_profiles"
    }
```

| Table | What it is | Created by | Lifecycle owner |
| --- | --- | --- | --- |
| `profiles` | The human: identity, avatar, settings. Universal — every user, no role column | Signup (`handle_new_user()`) | User |
| `admin_profiles` | Platform administration capability. **Already exists**; the pattern the others copy | Manual grant | Platform |
| `consultant_profiles` | Vetted seller capability + storefront (absorbs `is_consultant_verified`, application/vetting output, `user_rate_settings`) | Submitting the consultant application → `pending`; vetting → `verified` | **Admin-granted**: `pending → verified → suspended/revoked` |
| `freelancer_profiles` | Public availability declaration — gates the *public pool only*; roster membership never requires it | Completing the go-live flow | **Self-service**: `active ⇄ paused` |
| `client_profiles` | Billing entity (company, address, tax) | *Deferred* — system-creates on first published posting or funded contract, when an invoice actually needs it | System; lapses |

An **enrollment** is a deliberate act (apply, go live, publish) that creates one of these
rows. Enrollments are **non-exclusive** (one user may hold all three), **stateful**
(pausable, revocable — never a permanent declaration), and **never created silently** (no
signup checkbox, no auto-enrollment during backfill). They are marketplace-side tables;
execution code never joins against them.

## The rule that replaces `profiles.role`

> **⚠️ Gate features on capabilities and positions, never on declared identity.**

- *Execution* authorization: `share_role` on `project_access` — nothing else. Anyone
  creates projects and roadmaps, invites anyone, with or without any contract.
- *Marketplace* authorization: enrollment status (`is_active_consultant()`) and contract
  **positions** — `contracts.client_user_id` / `contracts.consultant_user_id`, which are
  immutable facts about an engagement, not about a person.
- Litmus test: "**is** this user a client?" is a malformed question. "Is this user **the
  client of** this contract?" and "**can** this user sign as a consultant?" are the only
  two valid forms.

The no-bypass rules survive intact because they were never identity checks: the freelancer
pool is visible **only** to verified consultants (the strictest gate in the system),
proposals come only from consultants, and no contract path exists whose consultant seat an
unverified user can fill — enforced at the database by the FK from
`contracts.consultant_user_id` into `consultant_profiles` plus a verified-status check
inside the signing transaction.

## Signup and enrollment moments

Signup creates the `profiles` row and nothing else. New users land directly in the
execution platform. Enrollment happens inline at the first marketplace act — never as a
separate ceremony, never at signup.

| Surface | Viewing | Acting |
| --- | --- | --- |
| Execution (projects, roadmaps, kanban, chat, teams) | Any user | Any user, per `share_role` |
| Marketplace landing / consultant storefront directory | Anyone | — |
| Post a project | Anyone can draft | **Publishing** = client-enrollment moment |
| Freelancer pool + postings board | **Verified consultants only** | Proposing, roster invites — consultants only |
| Go live / find work | Anyone sees the pitch | **Completing go-live** creates `freelancer_profiles` |
| Become a consultant | Anyone | **Submitting the application** creates `consultant_profiles` (`pending`) |

## Edge-case policies (decided, not open)

| Case | Policy |
| --- | --- |
| Consultant suspended mid-engagement | Verification gates *new* actions only (browse, propose, sign). In-flight contracts are untouched and go to admin review — never auto-terminated |
| Deleting enrollments | Never. `ON DELETE RESTRICT` on every FK into enrollment tables; status transitions only. Vetting history is dispute evidence |
| Account deletion | `profiles` soft-deletes/anonymizes; contracts and invoices retain party references (legal retention) |
| Self-dealing | `CHECK (client_user_id <> consultant_user_id)` on `contracts` |
| Parties share a roster relationship (fee-circumvention vector) | Flag for admin review at contract creation — not a hard block; legitimate cases exist |
| Legacy `projects.consultant_id` backfill | Into engagement links with `status='legacy'` — **never** fabricated as signed contracts |
| Legacy `role='talent'` users | Get a one-time go-live prompt. No silent `freelancer_profiles` seeding |
| Verification revoked between proposal and signing | `is_active_consultant()` re-checked inside the signing transaction |

## Phase 1 — what lands now

The immediate, in-flight slice: delete `profiles.role` and simplify signup. Everything the
column touches (verified against source and against the production database 2026-08-10):

| Touch point | Change |
| --- | --- |
| `supabase/migrations/20260809130000_account_role_foundation.sql` (+`_retry`) | Superseded — a new migration drops `profiles.role` and the `account_role` enum |
| `public.is_active_consultant()` (`20260809131000_consultant_capability_predicate.sql`) | Rewritten to check `is_consultant_verified` alone (latest-body rule) |
| `tg_profiles_protect_privileged_columns` (`20260809163000_restrict_profile_privileged_trigger.sql`) | Rewritten to protect only `is_consultant_verified` |
| `backend/src/common/auth/consultant-capability.ts` | Predicate drops the `role === 'consultant'` clause |
| `backend/src/modules/auth/auth.service.ts` | Signup/onboarding stops accepting or writing a role/lane |
| `web/src/lib/auth-utils.ts` | `isClient`/`isTalent` deleted; `isActiveConsultant` keeps only the boolean |
| Web signup + `/welcome` | Lane selection removed; single-lane signup → redirect to execution |
| `ConsultantOnlyGuard` call sites | Unchanged in phase 1 (the guard reads the predicate). Retargeting to marketplace-only boundaries is phase 3 |

Deploy ordering is load-bearing: the drop migration is applied to production **after** the
role-free code deploys. New code works with or without the column; old code breaks without
it.

## Later phases (context: the platform split)

| Phase | Lands | Notes |
| --- | --- | --- |
| **P1** | Role deletion + simplified signup | In flight now |
| **P2** | Durability fixes | Flip `contracts.project_id` CASCADE (a signed contract must outlive its project — `20260724100000_create_contracts.sql:19`), fix `task_time_logs` deletion semantics, remove the chat marketplace-role fallback (`chat.service.ts:432`) after backfilling `project_access` |
| **P3** | Marketplace/execution reorganization | Routes and modules into `execution/*` / `marketplace/*` / shared; drop `projects.consultant_id` + fee columns (values snapshotted first); `consultant_profiles` + `freelancer_profiles` created here, absorbing `is_consultant_verified` behind the unchanged predicate |
| **P4** | Link layer | `engagements` (project ↔ contract, severable, the only legal cross-domain FK), team connections, time-log → contract billing mapping, client read-only projection |

Phases 1–3 are justified as standalone correctness work; only P4 is new product surface.

## Blast radius

This proposal contradicts, and will require rewriting when it ships, the current-state
docs built on the `account_role` model — chiefly
[01-product/personas.md](../01-product/personas.md) ("`profiles.role` is the identity
source of truth"), [04-web/routing-and-personas.md](../04-web/routing-and-personas.md)
(the three signup lanes), [03-backend/auth-and-guards.md](../03-backend/auth-and-guards.md)
(lane payloads and role guards),
[07-data-and-db/schema-overview.md](../07-data-and-db/schema-overview.md) (the
`account_role` enum row), the role-identity claims across
[11-domains](../11-domains/README.md) (clients, talent, consultants hubs), and the
[glossary](../01-product/glossary.md) "Account role" entry. Phase 1's doc sweep updates
the pages made false by the deletion; the enrollment-model pages move to their owning
sections when each phase ships, per this section's rules.

## Decisions to review

> **2026-08-10 reconciliation with
> [organizations-and-services.md](./organizations-and-services.md):** that proposal's
> 2026-08-09 callout noted `account_role` was compatible with progressive organizations.
> Removing `account_role` does not disturb any of its seven decisions — none depend on
> account identity — and enrollment shares its core philosophy: progressive, never
> required, no auto-provisioning. The two proposals compose.

| # | Decision | Rejected alternative |
| --- | --- | --- |
| 1 | Delete `profiles.role` outright | Renaming it to a `signup_intent` personalization column — considered at length; deferred because simplified signup asks no intent question yet. May return as a nullable, switchable, never-authz column if onboarding personalization needs it |
| 2 | Three separate enrollment tables | One polymorphic `marketplace_profiles` with `type` — sparse columns, mixed state machines, no clean consultant-seat FK |
| 3 | Enrollment at first marketplace act, inline | Enrollment at signup — recreates the lane problem one screen later, at peak drop-off |
| 4 | Roster membership independent of `freelancer_profiles` | Auto-enrolling roster invitees — silent enrollment, the failure mode the model exists to prevent |
| 5 | `client_profiles` deferred until billing needs it | Building it now — `contracts.client_user_id` covers every current need |
| 6 | Contract positions immutable after signing | Editable party columns — a historical record must not be rewritable |
| 7 | Vetting stays the one account-level capability | Deriving consultant-ness from contract history — vetting is genuinely a fact about the person, and it is the platform's differentiator |

## See also

- [organizations-and-services.md](./organizations-and-services.md) — the org tier this
  composes with.
- [01-product/personas.md](../01-product/personas.md) — the current-state role model this
  replaces.
- [07-data-and-db/identity-vetting-model.md](../07-data-and-db/identity-vetting-model.md) —
  today's identity/vetting mechanics; the natural landing place when enrollment ships.
- [11-domains/marketplace/README.md](../11-domains/marketplace/README.md) — the
  active-consultant gate this proposal re-founds.
