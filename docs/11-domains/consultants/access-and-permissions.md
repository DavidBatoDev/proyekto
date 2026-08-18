# Consultant Access and Permissions

> **Last updated:** 2026-08-18 · **Status:** current

Active-consultant status unlocks consultant-only product capabilities, but it does not itself
grant access to any project. Project authority comes from `project_access` — a `role` on the
share_role ladder plus per-member `capabilities`, and nothing else.

> **⚠️ The execution layer no longer designates a consultant.** A project has MEMBERS with a
> permissions catalog; it does not assume it has a client and a consultant. Those are
> positions on a **contract**. Everything on this page that used to describe a
> "consultant-of-record" designation stored on the project was removed between 2026-08-17 and
> 2026-08-18 — see the note below for exactly what is gone.

## Project creation and assignment

| Path | Result |
| --- | --- |
| Active consultant creates in consultant mode | Draft project, creator receives project `owner` |
| Admin match-assign | Named consultant receives `owner` on the project |
| Joins by invite or team | Receives the ordinary invited/team project role |

Every one of these writes `origin = 'direct'` (or `invited` / `team:<id>`), because origin is
provenance and never authority. **`role = 'owner'` is what carries the authority**, and it is
also what finance scopes on: `/marketplace/finance` returns projects where the caller has active
consultant capability *and* a `role=owner` access row.

## What was removed

The designation used to be carried by `project_access.origin = 'consultant'`, which four
things read as a role. All four are gone:

| Mechanism | Status |
| --- | --- |
| `ORIGIN_DELTAS` — additively granted `chat.message_freelancers`, `members.manage`, `teams.manage`, `time.view_team_logs` on origin, regardless of stored role | Deleted. Permissions resolve from `role` + `capabilities` only. |
| A chat bypass letting the "consultant" read every private channel without being a participant | Deleted; private-channel membership is granted, never conferred by identity. |
| `origin='consultant'` in the finance project scope | Dropped; the predicate is `role=owner`. |
| `getProjectConsultantId` — a "who is the consultant of record" lookup, plus `assign-consultant` / `reassign-consultant` endpoints and a guard refusing to remove the consultant | Deleted. **Transfer project** covers the same ground and also logs member activity. |

The `client` and `consultant` origin values were then folded into `direct`
(`20260818090000_neutralise_project_access_persona_origins.sql`). Effective permissions were
unchanged for every affected row — `effective-permissions.spec.ts` snapshots all eight
production role/capability tuples and pins that.

## Removal guards

Last-owner protection is the only guard now: a project cannot be left without an owner. There
is no separate rule shielding a particular person from removal, and someone leading a project
can leave it or be removed like any other owner.

## Team authority is separate

The consultant capability does not make the person owner of every team. Their personal team
does make them its owner, while other teams require an explicit `team_members` role. Project
team management requires resolved project permissions in addition to team-level checks.

## Contract position and signing

`contracts.consultant_user_id` is the durable consultant party to an agreement. It points to
`consultant_profiles`, survives project deletion, and falls back to `created_by` only for
records created during the expand/deploy window. Once a contract reaches signed, active,
ended, or cancelled, neither party column can change—even through service-role code.

| Operation | Consultant rule |
| --- | --- |
| Create a contract | The caller becomes `consultant_user_id` |
| Read contract history | The stored consultant seat may read live or severed rows at any enrollment status |
| Sign, including by token | The seat must currently be verified; TypeScript checks first and the locking SQL transaction checks again |
| Amend | The new draft inherits the original consultant seat |
| Unsign or change signature placement | Consultant seat only; still project-scoped |
| Severed contract | Read-only; no signing or other writes |

Suspension or revocation does not erase history or terminate an agreement. It blocks new
signature stamps with HTTP 409 until the enrollment is reinstated or re-approved.

## Enforcement layers

```text
active consultant predicate       consultant-only product capability
project_access                    one-project authority
team_members                      one-team authority
service permission checks         mutation enforcement
RLS and SQL triggers              database invariants
```

## See also

- [Finance: contract parties](../finance/README.md#contract-parties)
- [Talent: access and permissions](../talent/access-and-permissions.md)
- [Project lifecycle](../../01-product/project-lifecycle.md)
