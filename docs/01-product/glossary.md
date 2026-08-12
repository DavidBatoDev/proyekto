# Glossary

> **Last updated:** 2026-08-11 · **Status:** current

Product-wide vocabulary. Domain-specific terms live in their own sections' glossaries
(e.g. [Meetings](../11-domains/README.md), [Architecture](../02-architecture/README.md)).

| Term | Meaning |
| --- | --- |
| **Account role** | **Removed** (2026-08-10). Accounts have no stored role — `profiles.role` and the `account_role` enum were dropped. Client/talent/consultant are per-contract positions; see [Proposals → identity and enrollment](../13-proposals/identity-and-enrollment.md). |
| **Talent** | The market position of people doing scoped delivery work; legacy code may still call this “freelancer.” Not an account attribute. |
| **Consultant layer** | Proyekto's defining idea: a vetted project lead between Client and Talent who owns delivery. |
| **Active consultant** | An account that passed vetting: `profiles.is_consultant_verified = true` — the only account-level capability. |
| **Project** | The delivery container: roadmap + team + chat + meetings + billing. |
| **Brief** | A project's structured intent (mission/vision, summary, custom fields) — `project_briefs`. |
| **Roadmap** | The plan for a project — a tree of epics, features, and tasks. One per project (`roadmaps.project_id` is `UNIQUE`); [a proposal](../13-proposals/organizations-and-services.md#resolving-1-roadmap--1-service) would relax this to one per service. |
| **Epic** | A value-based initiative (e.g. "User Authentication"), not a tech layer. |
| **Feature** | A time-bound deliverable within an epic; carries the timeline dates. Status is derived from its tasks. |
| **Task** | The smallest execution unit; has status, assignees, comments, dependencies. |
| **Milestone** | A timeline checkpoint linked to a set of features (`milestone_features`). |
| **Canvas view mode** | The four projections of one roadmap — roadmap tree, epic, Gantt/milestones, and kanban. Views are projections, not separate entities. |
| **Team** | A reusable group of people; attached to projects and curated per project. |
| **`project_access`** | The authorization row — exactly one per (project, user) since `20260507000130` — carrying a `share_role` (`owner > admin > editor > commenter > viewer`), an `origin` label, and a capabilities delta. |
| **Origin** | The *source* of an access grant, not a rank: `client`, `consultant`, `invited`, `personal_workspace`, `legacy`, or `team:<id>`. Patches permissions via `ORIGIN_DELTAS`. |
| **Client** | The market position of people commissioning work — not an account attribute. Project participation and the legal payer come from `project_access` and contract snapshots. See [Clients](../11-domains/clients/README.md). |
| **Project owner** | The profile referenced by `projects.owner_id`. Any account may own a project; ownership implies nothing else about the account. |
| **External client** | A contract counterparty with no account, existing only as `contracts.client_*` strings, who signs via a tokenized link. |
| **Contract** | The service agreement for a project (`contracts`) — parties, commercial terms, term dates, clause set, and a jsonb services catalog. |
| **Activation** | The gated `draft → active` flip, guarded by a seven-item derived checklist so billing never starts without a price and a rate. |
| **Personal workspace** | A `projects` row with `is_personal_workspace = true`, auto-provisioned per user; `owner_id` references that user and their access row has `origin='personal_workspace'`. |
| **Time log** | A billable record of work against a task (`task_time_logs`), rolled into invoices/payouts. |
| **Payout / Invoice** | The live money paths — manual payouts of approved time, and generated project invoices. |
| **Guest** | An anonymous user (a `profiles` row with `is_guest`) who can build a roadmap before signing up. |
| **AI assistant** | The roadmap copilot — a conversational agent that plans and commits roadmap edits. |

For the technical vocabulary (deployable units, service role, lean diff, room keys),
see the [Architecture glossary](../02-architecture/README.md#glossary) and the
[Backend glossary](../03-backend/README.md#glossary).
