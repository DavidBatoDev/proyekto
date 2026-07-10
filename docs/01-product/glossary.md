# Glossary

> **Last updated:** 2026-07-09 · **Status:** current

Product-wide vocabulary. Domain-specific terms live in their own sections' glossaries
(e.g. [Meetings](../11-domains/README.md), [Architecture](../02-architecture/README.md)).

| Term | Meaning |
| --- | --- |
| **Persona** | The role an account is acting in — `client`, `freelancer`, `consultant`, or `admin`. One account, switchable per context. |
| **Consultant layer** | Proyekto's defining idea: a vetted project lead between Client and Freelancers who owns delivery. |
| **Verified consultant** | A user who passed vetting (a capability flag), gating consultant-only surfaces — distinct from the active persona. |
| **Project** | The delivery container: roadmap + team + chat + meetings + billing. |
| **Brief** | A project's structured intent (mission/vision, summary, custom fields) — `project_briefs`. |
| **Roadmap** | The plan for a project — a tree of epics, features, and tasks. One per project. |
| **Epic** | A value-based initiative (e.g. "User Authentication"), not a tech layer. |
| **Feature** | A time-bound deliverable within an epic; carries the timeline dates. Status is derived from its tasks. |
| **Task** | The smallest execution unit; has status, assignees, comments, dependencies. |
| **Milestone** | A timeline checkpoint linked to a set of features (`milestone_features`). |
| **Roadmap view / Milestone view** | The two projections of the roadmap — hierarchy tree vs Gantt timeline. |
| **Team** | A reusable group of people; attached to projects and curated per project. |
| **`project_access`** | The per-(project, user) authorization row with a `share_role` (`owner > admin > editor > commenter > viewer`). |
| **Time log** | A billable record of work against a task (`task_time_logs`), rolled into invoices/payouts. |
| **Payout / Invoice** | The live money paths — manual payouts of approved time, and generated project invoices. |
| **Guest** | An anonymous user (a `profiles` row with `is_guest`) who can build a roadmap before signing up. |
| **AI assistant** | The roadmap copilot — a conversational agent that plans and commits roadmap edits. |

For the technical vocabulary (deployable units, service role, lean diff, room keys),
see the [Architecture glossary](../02-architecture/README.md#glossary) and the
[Backend glossary](../03-backend/README.md#glossary).
