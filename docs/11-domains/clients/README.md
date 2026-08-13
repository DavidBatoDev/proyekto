# Clients

> **Last updated:** 2026-08-13 · **Status:** current

The Client is the person paying for the work — a **position on a contract, not an
account attribute**. There is no `clients` table and no account role (`profiles.role`
was dropped 2026-08-10): project participation is an access-row origin, and the legal
payer is snapshotted on the contract. Project ownership is deliberately separate:
`projects.owner_id` may point to any account.

This folder is the source of truth for how the client position works end to end. If you
only read one page, read [client-structure.md](./client-structure.md).

> **⚠️ Diagram exception.** [STYLE.md](../../STYLE.md) mandates ASCII diagrams. This folder
> and [13-proposals](../../13-proposals/README.md) use **Mermaid** instead — the flows here
> are state machines and multi-actor sequences that ASCII renders badly. GitHub renders
> Mermaid natively. The rest of `docs/` stays ASCII.

## The client facts

| Fact | Answers | Nullable |
| --- | --- | --- |
| `project_access.origin = 'client'` | "What may this person do here?" | Yes — no row means no access |
| `contracts.client_name` / `client_email` / `client_user_id` | "Who is on the hook to pay?" | Yes — all of them |

They are set at different times by different code paths and **are not kept in sync**.
There is no account-level client fact: `projects.owner_id` answers only who owns the
project container, and a project's contract may name a different legal entity from
its owner.

## What a client can do

- **See the delivery** — roadmap, work items, resources, logs, and the team roster, read-only
  by default.
- **Talk to the consultant**, not to the delivery team. `ORIGIN_DELTAS.client` sets
  `chat.message_freelancers: false` so the consultant mediates. This is the *soft isolation*
  design — see [consultant-interaction.md](./consultant-interaction.md).
- **See the money** — the billing surfaces stay open to the client because they fund the
  work. Time logs do **not**: those are the delivery team's cost side.
- **Sign a contract without an account** — a tokenized link at `/contract/sign/$token`, valid
  14 days, single-use, revocable.

## How the pieces fit (one-liner)

> The **web** app gates every project route on a resolved permission set fetched from the
> **NestJS backend**, which unions every `project_access` row the caller holds and layers
> `ROLE_DEFAULTS → ORIGIN_DELTAS → capabilities` in TypeScript; **Supabase Postgres** stores
> the access rows and enforces a second, coarser RLS check; an external client who has no
> account at all reaches exactly one surface — the token-signing page — through a
> service-role read that bypasses RLS entirely.

## Documentation index

| Doc | What's in it |
| --- | --- |
| [client-structure.md](./client-structure.md) | The three kinds of client, the tables that touch them, and why there is no `clients` table |
| [access-and-permissions.md](./access-and-permissions.md) | How a client's 45 permissions resolve; the union across multiple access rows; the full client default matrix |
| [user-flows.md](./user-flows.md) | Invite → accept → access; external tokenized signing; guest → project; leaving a project |
| [client-surfaces.md](./client-surfaces.md) | Every route a client reaches and the gate on each |
| [consultant-interaction.md](./consultant-interaction.md) | Soft isolation, the billing chain, activation, and the direct-contractor question |

## Glossary

| Term | Meaning |
| --- | --- |
| **Client** | The paying position on a project/contract. Not an account attribute — there is no account role. |
| **Origin** | `project_access.origin` — the *source* of a grant, not a role. Direct values: `client`, `consultant`, `invited`, `personal_workspace`, `legacy`. Team-derived: `team:<team_id>`. |
| **Origin delta** | A permission patch applied by origin regardless of role. `client` loses `chat.message_freelancers`; `consultant` gains the operator toolkit. |
| **External client** | A contract counterparty with no `profiles` row. Exists only as `contracts.client_*` strings. |
| **Signing link** | A 256-bit single-use bearer token (`contract_signature_links`) letting an external client sign without an account. |
| **Soft isolation** | The rule that a client and the freelance pool cannot DM each other; the consultant mediates. |
| **Project owner** | The profile referenced by `projects.owner_id`. Ownership is contextual and implies nothing else about the account. |
| **Personal workspace** | A project linked to its user through `personal_workspaces`; the owner access has `origin='personal_workspace'`. |

## Known gaps

- **No profile-completeness gate.** Nothing checks `user_portfolios`, identity verification,
  or profile completeness before a person joins a team or accepts a project invite. The one
  marketplace hard gate is active-consultant status
  (`consultant_profiles.status='verified'`); it
  gates consultant-only surfaces, not ordinary participation.
- **No client-side onboarding.** When a consultant adds a client, the client must grant access
  to external systems (analytics, domain, social accounts). That happens in chat today and is
  not tracked. Designed in
  [13-proposals/client-access-handover.md](../../13-proposals/client-access-handover.md).
- **No client parent entity.** Projects cannot be grouped under a client organization.
  Designed in
  [13-proposals/organizations-and-services.md](../../13-proposals/organizations-and-services.md).

## Code locations

- **Authorization:** [`backend/src/modules/execution/projects/authorization/project-authorization.service.ts`](../../../backend/src/modules/execution/projects/authorization/project-authorization.service.ts),
  [`backend/src/modules/execution/projects/permissions/project-permissions.ts`](../../../backend/src/modules/execution/projects/permissions/project-permissions.ts)
- **Contracts & signing:** [`backend/src/modules/marketplace/contracts/`](../../../backend/src/modules/marketplace/contracts/)
  (`contract-signature-links.service.ts`, `project-activation.service.ts`)
- **Web gate:** [`web/src/components/common/RequireProjectAccess.tsx`](../../../web/src/components/common/RequireProjectAccess.tsx)
- **Web permission mirrors:** [`web/src/components/project/permissions/`](../../../web/src/components/project/permissions/)
  (`permissionCatalog.ts`, `roleTemplates.ts`) — hand-maintained, must track the backend
- **Public signing route:** [`web/src/routes/_marketplace/contract/sign/$token.tsx`](../../../web/src/routes/_marketplace/contract/sign/$token.tsx)
- **DB:** `supabase/migrations/20260507000020_rename_project_shares_to_project_access.sql`,
  `20260724100000_create_contracts.sql`, `20260730093000_contract_signature_links.sql`
