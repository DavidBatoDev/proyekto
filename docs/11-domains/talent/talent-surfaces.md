# Talent Surfaces

> **Last updated:** 2026-08-10 · **Status:** current

Talent uses shared account, team, and project routes. Only two route files retain the legacy
`freelancer` namespace: the go-live wizard and an invite redirect. There is no Talent-only
dashboard subtree.

## Talent-specific routes

| Route | Purpose | Gate |
| --- | --- | --- |
| `/freelancer/go-live` | Complete professional data and set the profile public | Authentication; no account-role gate |
| `/freelancer/invites` | Legacy URL forwarding to `/invites` | Redirect |
| `/invites` | Review and respond to project invites | Authentication and invite ownership |

## Shared top-level routes

| Route | Talent access |
| --- | --- |
| `/dashboard` | Yes; personal workspace and accessible projects |
| `/profile/$profileId` | Yes; profile editing follows ownership checks |
| `/teams`, `/teams/$teamId/*` | Yes according to team membership and team role |
| `/work-items`, `/meetings`, `/inbox`, `/notifications` | Yes; authenticated shared surfaces |
| `/settings/*` | Yes; account settings |
| `/project-posting` | Yes; can create in client mode because Client/Talent action separation is deferred |
| `/consultant/apply` | Yes; authenticated application flow |
| `/consultant/browse`, `/consultant/$profileId` | Public consultant discovery |

## Project routes

Talent project visibility is controlled by `project_access`, not account role.

| Project surface | Typical marketplace `editor` access |
| --- | --- |
| Overview, roadmap, work items | View and edit delivery work |
| Resources | View and upload; deletion requires `admin` |
| Chat | View, send, mention, DM, and share files |
| Time | View and manage own eligible logs; team-wide review requires elevated permission |
| Logs | View normal logs; sensitive logs require `admin` |
| Team and settings | UI may render, but backend mutations still enforce role or permission |

## Active-consultant-only surfaces

Talent is blocked from these even if an old verification flag were accidentally true, because
the shared predicate also requires `role='consultant'`:

| Route or API | Gate |
| --- | --- |
| `/consultant/marketplace` | Web active-consultant check plus guarded API |
| `/consultant/templates` authoring actions | Web check and `ConsultantOnlyGuard` |
| `/finance/*` data | Entire backend finance controller uses `ConsultantOnlyGuard` |
| Consultant-mode project creation | Backend verifies the active predicate |

## Navigation behavior

The sidebar hides Finance unless `isActiveConsultant(profile)` is true. Shared project
navigation is permission-driven. A hidden item is only UX; backend authorization remains the
security boundary.

## See also

- [access-and-permissions.md](./access-and-permissions.md)
- [Web routing and personas](../../04-web/routing-and-personas.md)
