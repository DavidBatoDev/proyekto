# Consultant Access and Permissions

> **Last updated:** 2026-08-10 · **Status:** current

Active-consultant status unlocks consultant-only product capabilities, but it does not itself
grant access to every project. Project authority still requires `project_access`. When the
person is the named consultant, Proyekto grants owner access with a consultant-origin delta.

## Project creation and assignment

| Path | Result |
| --- | --- |
| Active consultant creates in consultant mode | Draft project, creator becomes `consultant_id`, project `owner`, origin `consultant` |
| Consultant assigned to client-created project | Named consultant receives `owner` + origin `consultant` |
| Consultant reassigned | Replacement must already be a member and active; receives `owner` + consultant origin |
| Consultant joins only by invite/team | Receives the ordinary invited/team project role; not automatically the named consultant |

`projects.consultant_id` is a relationship pointer. The owner access grant is the
authorization record.

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

Consultant account identity does not make the person owner of every team. Their personal team
does make them its owner, while other teams require an explicit `team_members` role. Project
team management requires resolved project permissions in addition to team-level checks.

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
