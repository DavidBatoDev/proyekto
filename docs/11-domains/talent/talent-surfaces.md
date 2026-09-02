# Talent Surfaces

> **Last updated:** 2026-09-01 · **Status:** current

Talent uses shared account, team, and project routes. Only two route files retain the legacy
`talent` namespace: the go-live wizard and an invite redirect. There is no Talent-only
dashboard subtree.

## Talent-specific routes

| Route | Purpose | Gate |
| --- | --- | --- |
| `/marketplace/talent/go-live` | Complete professional data and activate marketplace enrollment | Authentication plus server eligibility |
| `/freelancer/invites` | Legacy URL forwarding to `/invites` | Redirect |
| `/invites` | Review and respond to project invites | Authentication and invite ownership |

## Shared top-level routes

| Route | Talent access |
| --- | --- |
| `/dashboard` | Yes; scoped to the open workspace, with a "Shared with you" group for projects reached through `project_access` outside it |
| `/workspace/settings/*` | Yes; general and members follow `workspace_members.role`, billing is a placeholder |
| `/profile/$profileId` | Yes; profile editing follows ownership checks |
| `/teams`, `/teams/$teamId/*` | Yes according to team membership and team role |
| `/work-items` (labelled **Board**), `/meetings`, `/inbox`, `/notifications` | Yes; authenticated shared surfaces |
| `/settings/*` | Yes; account settings |
| `/project/new` | Yes; any account can create in client mode — client is a per-project position, not an account gate |
| `/marketplace/consultant/apply` | Yes; authenticated application flow |
| `/marketplace/consultant/browse`, `/marketplace/consultant/$profileId` | Public consultant discovery |

## Project routes

Talent project visibility is controlled entirely by `project_access`.

| Project surface | Typical marketplace `editor` access |
| --- | --- |
| Overview, roadmap, board | View and edit delivery work |
| Resources | View and upload; deletion requires `admin` |
| Chat | View, send, mention, DM, and share files |
| Time | View and manage own eligible logs; team-wide review requires elevated permission |
| Logs | View normal logs; sensitive logs require `admin` |
| Team and settings | UI may render, but backend mutations still enforce role or permission |

## Active-consultant-only surfaces

Unvetted users are blocked from these by the shared predicate
(`consultant_profiles.status='verified'`, server-managed through enrollment APIs):

| Route or API | Gate |
| --- | --- |
| `/marketplace/talent` | Web active-consultant check plus guarded API |
| `/marketplace/consultant/templates` authoring actions | Web check and `ConsultantOnlyGuard` |
| `/marketplace/finance/*` data | Entire backend finance controller uses `ConsultantOnlyGuard` |
| Consultant-mode project creation | Backend verifies the active predicate |

## Navigation behavior

The sidebar hides Finance unless `isActiveConsultant(profile)` is true. Shared project
navigation is permission-driven. A hidden item is only UX; backend authorization remains the
security boundary.

## See also

- [access-and-permissions.md](./access-and-permissions.md)
- [Web routing and access](../../04-web/routing-and-access.md)
