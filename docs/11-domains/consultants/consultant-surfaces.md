# Consultant Surfaces

> **Last updated:** 2026-08-10 · **Status:** current

Consultant routes fall into three groups: public marketing/discovery, authenticated
application and shared work, and active-consultant operator tools. A `/consultant/*` path is
not automatically protected; each surface has its own gate.

## Public consultant routes

| Route | Purpose | Gate |
| --- | --- | --- |
| `/consultant` | Consultant landing page | Public |
| `/consultant/browse` | Browse active consultant directory | Public API filtered by `is_consultant_verified` |
| `/consultant/$profileId` | View an active consultant profile | Public API filtered by `is_consultant_verified` |

## Application and shared routes

| Route | Purpose | Gate |
| --- | --- | --- |
| `/consultant/apply` | Create and submit a consultant application | Authentication; open to any account |
| `/dashboard` | Shared project and workspace dashboard | Authentication |
| `/teams/*` | Personal/reusable teams, invites, rates, and time | Team membership and operation-specific checks |
| `/project/$projectId/*` | Delivery workspace | Resolved project access and backend permission checks |
| `/project-posting` | Client- or consultant-mode project creation UI | Active status required only for consultant mode |

## Active-consultant routes

| Route | Purpose | Gate |
| --- | --- | --- |
| `/consultant/marketplace` | Search and invite Talent | Web predicate plus guarded marketplace API |
| `/consultant/templates` | Manage consultant-authored roadmap templates | Web predicate plus guarded write endpoints |
| `/finance` | Portfolio summary | Finance controller guard |
| `/finance/contracts` and related views | Contract operations | Finance/controller and project checks |
| `/finance/invoices` and related views | Invoice operations | Finance/controller and project checks |

The sidebar displays Finance only for an active consultant. Direct navigation still reaches a
page shell in some cases, but protected API calls return 403 when the predicate fails.

## Project operator surfaces

The common consultant assignment is project owner, so all project tabs are available:

| Surface | Consultant responsibility |
| --- | --- |
| Roadmap and work items | Plan, assign, edit, promote, and view internal delivery data |
| Team and permissions | Attach teams, curate members, manage roles and capabilities |
| Chat | Communicate with Client and Talent, manage channels |
| Resources and logs | Manage artifacts and inspect sensitive activity |
| Time | Review team logs and prepare payable work |
| Settings | Configure project, content, permissions, teams, and time behavior |

Project owner access, not the consultant capability by itself, makes these tabs available.

## Backend-only protected areas

`ConsultantOnlyGuard` covers the finance controller, marketplace discovery/invite actions,
and consultant template authoring endpoints. Project creation and reassignment use the same
predicate in service-level checks. Database rate triggers call `is_active_consultant` for
invariants that must survive non-HTTP writes.

## See also

- [access-and-permissions.md](./access-and-permissions.md)
- [Backend auth and guards](../../03-backend/auth-and-guards.md)
- [Web routing and personas](../../04-web/routing-and-personas.md)
