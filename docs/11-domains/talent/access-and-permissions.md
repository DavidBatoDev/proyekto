# Talent Access and Permissions

> **Last updated:** 2026-08-10 · **Status:** current

Talent account identity does not grant project capabilities. A Talent participant receives a
project role through a direct invite or team curation, then the shared permission resolver
combines that role with an origin delta and explicit capability overrides.

## Resolution

```text
ROLE_DEFAULTS[project role]
  + ORIGIN_DELTAS[access origin]
  + project_access.capabilities
  = resolved project permissions
```

There is no `ORIGIN_DELTAS.talent` or `ORIGIN_DELTAS.freelancer`. Talent normally arrives
with either `origin='invited'` or a team-derived `origin='team:<id>'`.

| Entry path | Project role | Origin behavior |
| --- | --- | --- |
| Marketplace invite accepted | `editor` | `invited`, which adds no permissions |
| General project invite accepted | Invite's `viewer` or `editor` default; fallback `editor` | `invited` |
| Team member curated onto project | Selected role; fallback `editor` | Team origin is normalized to no delta during resolution |
| Explicit admin change | Any project role | Existing origin plus stored capability delta |

## Project-role ladder

| Project role | Important defaults for Talent |
| --- | --- |
| `viewer` | Read roadmap, work items, team, chat, resources, logs, and own time |
| `commenter` | Viewer plus comments, messages, mentions, and DMs |
| `editor` | Commenter plus roadmap/task edits, sharing, uploads, and work delivery |
| `admin` | Editor plus members, teams, settings, channels, team time, and sensitive logs |
| `owner` | Every permission path |

The common marketplace path deliberately grants `editor`: Talent can perform delivery work
without receiving member-management or project-settings authority.

## Messaging boundaries

The baseline allows all project members to message clients and consultants. Direct messaging
and message sending begin at `commenter`. `chat.message_freelancers` is not granted below
`owner`, but consultant-origin access adds it regardless of project role. The model is a
managed-delivery default, not a confidentiality boundary; explicit capabilities can override
individual paths.

## Team curation and access lifetime

Adding a Talent member through `project_team_members` creates or elevates the single
`project_access` row for that `(project, user)` pair. Direct and team support are tracked
independently. Removing one team curation does not revoke a direct grant, and removing a
direct grant does not revoke access still supported by project-team membership.

## Payment is not a project permission

Project access allows work; paid participation requires more:

```text
team membership
  -> project_team_members curation
  -> team_member_rates
  -> task_time_logs.rate_snapshot
  -> approved logs
  -> payout
```

A direct `invited` access row has no `project_team_members` marker. It is valid for
collaboration but is not enough for activation rate checks or payout generation.

## Enforcement

- Web route gates hide or deny project tabs using resolved `access.*` flags.
- Backend mutations call project authorization and recheck the exact permission or role.
- Postgres RLS remains a coarser second layer; backend service-role queries make TypeScript
  authorization the primary application boundary.

## See also

- [user-flows.md](./user-flows.md)
- [Clients: access and permissions](../clients/access-and-permissions.md)
- [Teams and time](../teams-and-time/README.md)
