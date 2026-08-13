# Consultant Access and Permissions

> **Last updated:** 2026-08-13 · **Status:** current

Active-consultant status unlocks consultant-only product capabilities, but it does not itself
grant access to every project. Project authority still requires `project_access`. When the
person is consultant-of-record, Proyekto grants owner access with a consultant-origin delta.

## Project creation and assignment

| Path | Result |
| --- | --- |
| Active consultant creates in consultant mode | Draft project, creator receives project `owner`, origin `consultant` |
| Consultant assigned to client-created project | Named consultant receives `owner` + origin `consultant` |
| Consultant reassigned | Replacement must already be a member and active; receives `owner` + consultant origin |
| Consultant joins only by invite/team | Receives the ordinary invited/team project role; not automatically the named consultant |

The consultant-origin owner access grant is both the relationship pointer and the
authorization record. Reassignment promotes an existing invited/team access row to
`origin=consultant` while preserving the stronger of its stored and incoming roles. Finance
requires the resulting exact `owner` + `consultant` access pair as well as active consultant
capability; a client-origin admin or owner is not admitted.

## Consultant origin delta

The project permission resolver applies these paths additively, regardless of stored project
role:

| Permission | Consultant-origin value |
| --- | --- |
| `chat.message_freelancers` | `true` |
| `members.manage` | `true` |
| `teams.manage` | `true` |
| `time.view_team_logs` | `true` |

This means an editor-role access row carrying consultant origin gets the operator toolkit.
It does not get every owner permission: settings, permission editing, sensitive logs, and
other owner/admin paths still depend on project role unless explicitly overridden.

## Typical owner outcome

Consultant-mode creation and assignment grant `owner`, whose baseline is all permission paths.
The consultant delta is therefore redundant in that common case but remains important if an
admin later demotes the stored project role while keeping the origin.

## Removal and reassignment guards

- The named consultant cannot be casually revoked by project authorization.
- Reassignment validates active-consultant status for the replacement.
- The replacement is granted owner access before the previous consultant is revoked.
- Last-owner protection may leave the previous consultant as a co-owner instead of orphaning
  the project; an admin can demote them later.

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

- [Clients: consultant interaction](../clients/consultant-interaction.md)
- [Talent: access and permissions](../talent/access-and-permissions.md)
- [Project lifecycle](../../01-product/project-lifecycle.md)
