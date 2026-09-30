# Two-Way Contract Authoring

> **Built** on `feat/contract-authoring-intake` (2026-09-30). Not merged, not in production. See
> [Implementation notes](#implementation-notes-2026-09-30).

> **Last updated:** 2026-09-30 · **Status:** built

Today a contract has one author. Only the consultant can create, edit, discard or amend it; the
client can read it and sign it, and nothing else. The only lever a client holds is refusing to
sign. This proposal gives the client and the talent the same authoring rights as the
consultant: create a contract, edit its terms while it is being negotiated, and amend it after
it is signed. It also adds a version history per contract and an AI summary of what changed
between versions.

**This reverses a stated decision.** [action-surface.md](../14-engagement/action-surface.md)
says *"a client never authors."* When this ships, that row is rewritten.

## What the code does today

| Action | Who may do it | Source |
| --- | --- | --- |
| Create | A verified consultant who owns the project; any active consultant for a flexible contract | `createContract` → `ConsultantFinanceAccessService.assertProject` |
| Edit (`draft`, `sent`) | The contract's consultant only | `updateContract` → `assertConsultantContractControl` |
| Delete a draft | The contract's consultant only | `deleteContract` |
| Amend a signed contract | The contract's consultant only | `amendContract` → `assertConsultantContractControl` |
| Unsign | The consultant only (for either party's signature) | `unsignContract` → `assertConsultantSignature` |
| Sign | The seat holder: provider or hirer | `assertCanSign` |
| Read | Either party, plus anyone with `finance.view_contracts` on the project | `assertContractRead` |

All in `backend/src/modules/marketplace/contracts/contracts.service.ts`.

### A gap that exists before any of this is built

`updateContract` accepts edits while the contract is `sent`, and **it does not clear signatures
already on it.** A client who has signed a `sent` contract can have its terms changed underneath
that signature by the consultant, and the contract then becomes `signed` as soon as the
consultant signs. With one author this is a trust problem; with two authors it would be a
straightforward exploit. Rule 2 below closes it, and it should ship first even if the rest
waits.

## The rules

1. **Authority follows the seat, not the capacity.** Anyone who holds a position (`hirer` or
   `provider`) on the contract may edit, amend and withdraw it. `assertConsultantContractControl`
   is replaced by `assertPartyControl(callerId, contract)`: the caller holds a seat on this
   contract. The consultant-specific checks that remain (verified enrollment, project finance
   access) move to the *consultant's seat* and are enforced at signing, not at editing.
2. **Any change to terms clears every signature.** An edit to a `sent` contract nulls the
   signature on both seats (`contract_positions.signed_at`, `signer_name`, `signature_url` and the
   legacy `signed_by_*` columns). A signature always covers exactly the terms that were on the
   page when it was made.
3. **You sign a revision, not a contract.** Every term change writes a row to a new
   `contract_revisions` table and increments `contracts.revision`. `POST :id/sign` carries the
   revision the signer was looking at; if it is stale, the server returns `409` and the UI
   reloads with the diff. This makes rule 2 race-proof.
4. **The other party is shown what changed before they can sign.** The agreement view shows
   "Changed by *name* since you last signed or viewed" with a field-by-field diff from
   `contract_revisions`. The sign button stays disabled until that diff has been opened.
5. **Each seat owns its own identity block.** Commercial terms (rates, services, clauses, dates,
   billing mode and timing, time policy) are shared and editable by both. The provider block
   (`provider_kind`, provider team and legal identity) is editable only by the provider seat; the
   hirer billing identity only by the hirer seat. `setSeatTeam` already works this way.
6. **One open amendment per contract family.** A partial unique index on
   `(contract_family_id) WHERE status IN ('draft','sent') AND supersedes_contract_id IS NOT NULL`
   stops both parties proposing competing amendments at once. The second party edits the open
   amendment instead.

## Flows

### Create

Either party may create. The caller becomes the author and takes their own seat; they name the
counterparty by exact email through the existing `POST counterparties/resolve`.

| Author | Scope | Precondition |
| --- | --- | --- |
| Consultant | Project-specific or flexible | Unchanged |
| Client | Flexible | Signed-in account. The counterparty must be a consultant; the contract cannot be signed until that consultant is verified (the check already in `signContract`) |
| Client | Project-specific | The project belongs to the consultant named as counterparty. The caller needs no prior project access: the contract is what gives them their role (see below) |
| Talent | Talent contract (`talent_services`) | Signed-in account; the counterparty (hirer) must be a verified consultant |

All three are subject to the plan gates in [Plan limits](#plan-limits).

**The contract defines who you are.** A person's role on a project comes from the seat they hold
on its contract, not from project membership set up beforehand. A client who drafts a
project-specific contract sees nothing of the project while it is a draft or `sent`; the
consultant's signature is their consent to attach the client, and activation grants the
client-seat view of that project. A client may only name a project owned by the consultant they
name as counterparty, so a draft can never reach a stranger's project.

A contract created by a client or talent starts with an empty provider or hirer block for the
consultant's side. It fills from the consultant's team or profile the first time they open it
(`reseedProvider`), per rule 5.

### Negotiate (`draft` → `sent`)

- `draft` stays private to its author. The other party cannot see it.
- **Send** makes it visible to the counterparty and notifies them.
- While `sent`, either party may edit. Each edit applies rules 2–4 and notifies the other party.
- **Withdraw** (either party) moves a `sent` contract to `cancelled`. Only the author may delete
  a `draft`.

### Amend (`signed` → new version)

Either party may start an amendment. It uses the existing `amendContract` path unchanged apart
from authorization: version + 1 as a `draft`, the current version governing until both parties
sign the new one, and the existing `assertNoIssuedInvoicesFrom` guard still refusing to amend
over an invoice already sent to the client. Engagement-backed contracts still amend only
prospectively. `created_by` on the new version records which party proposed it.

### Unsign

Each party may pull only **their own** signature. Today the consultant can remove the client's;
that goes away.

## Version history

A contract family already has the bones of a history: `contract_family_id`, `version`,
`supersedes_contract_id` and `amendment_effective_date`. What is missing is (a) a way to see it
and (b) a frozen copy of what was actually signed.

**Today nothing freezes a signed agreement.** `pdf/agreement-pdf.renderer.ts` renders the PDF
from the contract row on every request. If the renderer or the default clause text changes, a
contract signed last month re-renders differently today, and there is no record of the exact
document both parties signed.

### Two levels of history

| Level | What it is | Stored in |
| --- | --- | --- |
| **Version** | One signed agreement: v1, v2 (first amendment), v3… Each has its signers, signing dates, effective date and the frozen PDF | `contracts` rows in one family, plus the new snapshot columns below |
| **Revision** | One edit during negotiation of a single version, by either party | `contract_revisions` (rule 3) |

The history view shows versions by default and expands a version to show the negotiation
revisions that led to it.

### Freeze on signing

When a contract reaches `signed`, the server renders the PDF once, stores it in Supabase
Storage, and writes:

| Column | Purpose |
| --- | --- |
| `contracts.signed_pdf_path` | The frozen document. The agreement view serves this for any signed version instead of re-rendering |
| `contracts.signed_pdf_sha256` | Proves the stored file has not changed since signing |
| `contracts.signed_terms jsonb` | The terms that were signed, as data, so versions can be compared field by field without parsing PDFs |

Existing signed contracts are frozen once by a backfill job, which renders them as they stand on
the backfill date and labels them "Snapshot taken on *date*, after signing."

### History view

On the contract page, a **History** tab lists the family newest first:

```text
 v3  Draft amendment   proposed by Client, 2 Oct      [Compare with v2]
 v2  Signed 14 Aug     effective 1 Sep   rate 80→95/h  [PDF] [Compare with v1]
 v1  Signed 2 Jun      effective 2 Jun                  [PDF]
```

**Compare** opens a side-by-side of any two versions: a field-by-field table of changed terms
(from `signed_terms`) and a clause-by-clause text diff. Both are computed without AI. The AI
summary below sits on top of this table; it never replaces it.

## AI change summary

When someone opens a version or a comparison, an **Insights** panel explains in plain language
what changed and what it means for each party — the way Gemini summarizes a PDF in Google Drive.

```text
 Changes in v2 (effective 1 Sep)
 - Hourly rate rises from AUD 80 to AUD 95 (+18.75%).
 - Billing moves from monthly in arrears to monthly in advance.
 - New clause 9.2: either party may end with 30 days' notice (was 60).
 What this means for you (Client): invoices arrive at the start of each month,
 and the notice period you must give is shorter.
```

### Where it runs

On David's agent service (`agent/`), using the same model the execution platform uses
(`OPENAI_MODEL_V2`, currently `gpt-5.6-luna`, through `app/core/engine/llm_client.py`). A new
internal route `POST /contracts/summarize-changes` follows the pattern of
`agent/app/api/routes/briefs.py`: NestJS authorizes the caller (`assertContractRead`), then
forwards with the shared `AGENT_INTERNAL_TOKEN`. The agent route never touches the database.

Running it on the agent also sidesteps the backend's `OPENAI_API_KEY`, which currently returns
401; the agent's key works.

### Guardrails

- **The input is the computed diff, not two PDFs.** NestJS sends the field-level changes and
  the changed clause texts. The model explains changes; it does not discover them. Nothing it
  says can introduce a change the deterministic diff did not find.
- **Every summary cites its rows.** Each bullet links to the diff row it describes. A bullet the
  server cannot match to a row is dropped.
- **Labelled as AI and not legal advice.** The panel says "AI summary — check the comparison
  table for the exact terms."
- **Seat-aware.** The "what this means for you" paragraph is written for the viewer's seat. A
  client's summary never includes consultant-only data (cost, margin, talent identity) because
  that data is never in the client's diff input.
- **Cached per version pair.** Stored in `contract_change_summaries (from_contract_id,
  to_contract_id, seat, model, summary jsonb, created_at)`. Signed versions never change, so a
  summary is generated once per seat. Draft comparisons are regenerated when the revision changes.
- **Metered.** Each generation counts as one message against the workspace's
  `ai_messages_monthly` quota.

### Cost

`gpt-5.6-luna` costs $0.20 per million input tokens and $1.20 per million output tokens
(OpenAI's model page, checked 2026-09-28). A summary sends about 6,000 tokens (diff plus changed
clause texts) and returns about 600:

| | Tokens | Cost |
| --- | --- | --- |
| Input | 6,000 | $0.0012 |
| Output | 600 | $0.0007 |
| **Per summary** | | **about $0.002** |

Summaries of signed versions are cached, so a contract with three amendments viewed by both
parties costs at most 3 comparisons × 2 seats × $0.002 ≈ $0.012, once.

## Accounts and token links

A client who signs through the token link at `/contract/sign/$token` has no account and cannot
author. The signing page gains a **Request changes** action that asks them to sign in or create
an account and then opens the contract editor. Signing by link without an account stays
available.

## Plan limits

Two new keys in the existing entitlements registry (`backend/src/modules/shared/entitlements/
entitlement-keys.ts` on `main`, values in `plan_limits`, editable by an admin without a deploy):

| Key | Kind | Meaning | Estimate (Free / Pro / Business / Enterprise) |
| --- | --- | --- | --- |
| `contract_counterparty_authoring` | feature | A client or talent may create and amend contracts | off / on / on / on |
| `active_contracts` | count | Contracts in `sent` or `signed` status, per workspace | 3 / 25 / 250 / unlimited |

These are estimates for review, set in the admin editor. The reasoning:

- **They track the existing `projects` limit** (Free 2, Pro 10, Business and Enterprise
  unlimited, from `20260922120000_workspace_plan_limits.sql`). A project usually carries one
  client contract plus one or two talent contracts, so the contract cap is about 1.5–2.5× the
  project cap. Business gets a cap only as an abuse ceiling; almost no one should reach it.
- **Counterparty authoring starts at Pro**, not Business. A client who can draft and propose
  terms is a reason for the consultant to upgrade from Free, and Pro at $12 per seat is the
  first paid plan.
- **Contracts cost almost nothing to run.** Storage for a frozen PDF is well under 1 MB. The
  limit exists for pricing, not cost.

- **Whose plan counts:** the plan of the workspace that owns the contract's project. A flexible
  contract has no project, so it counts against the author's own workspace.
- **Consultant authoring is not gated** by the feature key; it stays available on every plan,
  subject only to `active_contracts`.
- **The count is checked on Send** (`draft` → `sent`), not on create, so drafts are free. An
  amendment does not add to the count: it replaces its predecessor.
- **Hitting the limit never breaks a live agreement.** A downgrade over the limit blocks new
  sends only; contracts already `sent` or `signed` keep working.

## Schema

| Change | Kind |
| --- | --- |
| `contracts.revision int not null default 1` | Additive |
| `contract_revisions (id, contract_id, revision, author_user_id, author_position, changes jsonb, created_at)` | New table; `changes` holds `{field: {before, after}}` |
| `contract_positions.last_viewed_revision int` | Additive; drives rule 4 |
| Partial unique index for rule 6 | Additive |
| RLS on `contract_revisions`: readable by seat holders on the contract | New policy |
| `contracts.signed_pdf_path`, `signed_pdf_sha256`, `signed_terms jsonb` | Additive; see [Freeze on signing](#freeze-on-signing) |
| `contract_change_summaries` | New table; cached AI summaries |
| `plan_limit_keys` / `plan_limits` rows for the two new keys | Seed |

No existing column changes meaning. The backfill sets `revision = 1` and writes no revision
rows.

## API

| Route | Change |
| --- | --- |
| `POST /contracts` | Accept a client author (flexible, or project-specific with client access) |
| `PATCH /contracts/:id` | `assertPartyControl`; seat-owned fields per rule 5; clear signatures; write revision; requires `If-Match: <revision>` |
| `POST /contracts/:id/amend` | `assertPartyControl` |
| `POST /contracts/:id/withdraw` | New; either party, `sent` only |
| `POST /contracts/:id/sign` | Body gains `revision`; `409` if stale |
| `POST /contracts/:id/unsign` | Own seat only |
| `GET /contracts/:id/revisions` | New; seat holders only |
| `GET /contracts/:id/history` | New; every version in the family with its snapshot |
| `GET /contracts/:id/compare/:otherId` | New; deterministic field and clause diff |
| `POST /contracts/:id/compare/:otherId/summary` | New; returns the cached AI summary or generates it through the agent |

## Web

- **New contract** becomes available to clients from their engagements list.
- The agreement editor becomes seat-neutral. Fields the caller's seat doesn't own render
  read-only with "Set by *counterparty*".
- A **Changes** panel lists revisions with author and diff, and the sign rail gains the "changed
  since you last signed" banner from rule 4.

## Build order

1. **Rule 2 and rule 3 alone**, for the current single-author model: clearing signatures on edit
   and revision-pinned signing. This fixes the existing gap and is safe to ship on its own.
2. **Freeze on signing** and the backfill. Independent of everything else; worth doing early
   because every day without it is another signed contract with no frozen copy.
3. `contract_revisions`, the History tab, the deterministic compare view and rule 4.
4. Seat-based authorization for edit, amend, withdraw and unsign (rule 1, rule 6).
5. The two plan keys, then client- and talent-created contracts and the token-link **Request
   changes** path.
6. AI change summary on the agent service.
7. Rewrite [action-surface.md](../14-engagement/action-surface.md) and move this page to current
   state under [11-domains](../11-domains/README.md).

## Tests

- A signed seat's signature is cleared when the other party edits; the contract cannot reach
  `signed` on terms one party never saw.
- Signing a stale revision returns `409`.
- A client cannot edit the provider block; a consultant cannot edit the hirer billing identity.
- Two parties cannot open competing amendments on one family.
- A client-authored contract cannot be signed while the named consultant is unverified.
- Unsign removes only the caller's own signature.
- The issued-invoice guard still blocks a client-authored amendment over a sent invoice.
- A signed version serves its frozen PDF, and the stored hash matches.
- Sending past `active_contracts` is refused; an amendment is not counted twice.
- A client's AI summary input contains no consultant-only fields.
- A summary bullet with no matching diff row is dropped.

## Decisions (2026-09-28)

1. Clients may create both flexible and project-specific contracts.
2. Counterparty authoring is limited by plan, and active contracts are capped per plan
   ([Plan limits](#plan-limits)).
3. Talent gets the same rights as clients: create, edit and amend their own contracts.
4. The contract defines a person's role. No prior project access is needed to author a
   project-specific contract.

## Open questions

1. **Plan values:** the numbers in [Plan limits](#plan-limits) are estimates for review.

## Implementation notes (2026-09-30)

Built on `feat/contract-authoring-intake`, on top of the signature-integrity work (rules 2 and 3
were already in `20260928090000_contract_signature_revisions`).

| Piece | Where |
| --- | --- |
| Schema: `contract_revisions` (+ trigger), `last_viewed_revision`, rule-6 index, frozen-snapshot columns, `contract_change_summaries`, `contracts.workspace_id` / `template_key` / `last_edited_by`, the two plan keys | `supabase/migrations/20260930100000_contract_authoring_history.sql` (DEV only) |
| Notification types `contract_sent`, `contract_changed`, `contract_withdrawn`, `contract_attestation_requested` | `20260930100500_contract_authoring_notification_types.sql` (DEV only) |
| Rules 1, 4, 5, 6; send, withdraw, own-seat unsign, client and talent create | `backend/src/modules/marketplace/contracts/contracts.service.ts` |
| Deterministic diff | `contract-diff.ts` |
| Freeze on signing, backfill | `contract-snapshot.service.ts`; `POST /contracts/admin/backfill-snapshots` (platform admin) plus a lazy freeze when the history or the PDF is opened |
| AI summary | `contract-change-summary.service.ts` calls the agent's `POST /contracts/summarize-changes` (`agent/app/core/documents/change_summary.py`) |
| Web | `ContractHistoryPanel.tsx` (Versions, Changes, Compare, Insights), `CounterpartyContractDialog.tsx`, the seat-neutral `ProjectContract.tsx`, "Request changes" on the token page |

Differences from the text above:

- **Revision rows are written by a trigger**, not by the service. `trg_contracts_record_revision`
  fires on the same UPDATE that raises `contracts.revision` and reads the author from
  `contracts.last_edited_by`, so the history can never disagree with the counter.
- **Frozen PDFs live in the private R2 bucket** (`UploadsService.putPrivateObject`), where every
  other rendered document lives, not Supabase Storage. `GET /contracts/:id/signed-pdf` streams the
  file and re-hashes it on every read (`X-Content-SHA256`, `X-Snapshot-Verified`).
- **Plan values are set** by `20261001090000_plan_estimates_authoring_intake` (DEV only):
  counterparty authoring off / on / on / on, active contracts 3 / 25 / 250 / unlimited.
- **`active_contracts` counts contract families**, so an amendment never counts twice.
- **Rule 4 is enforced by the server** as well as the UI: signing over unseen changes by the other
  party is a 409 until the seat records a review (`POST /contracts/:id/viewed`).
- **A client- or talent-authored contract seeds the consultant block from their profile**; the
  consultant switches it to a team with the existing "sign on behalf of" picker.
- **The web entry for clients and talent creates flexible contracts.** The API accepts a
  project-specific client contract (the project must be owned by the named consultant), but a
  client cannot list a consultant's projects, so there is no picker for it yet.
- **Consultant-only diff fields** are just `notes`; every other contract field is printed on the
  agreement and shared by both parties.
- **Metering against `ai_messages_monthly`** is a TODO: that quota is display-only everywhere.
- The page stays in `13-proposals` until the branch is merged; moving it to `11-domains` is the
  last step.
