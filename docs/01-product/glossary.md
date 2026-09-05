# Glossary

> **Last updated:** 2026-09-05 · **Status:** current

Product-wide vocabulary. Domain-specific terms live in their own sections' glossaries
(e.g. [Meetings](../11-domains/README.md), [Architecture](../02-architecture/README.md)).

| Term | Meaning |
| --- | --- |
| **Account role** | **Removed** (2026-08-10). Accounts have no stored role — `profiles.role` and the `account_role` enum were dropped. Client/talent/consultant are per-contract positions; see [Proposals → identity and enrollment](../13-proposals/identity-and-enrollment.md). |
| **Talent** | The market position of people doing scoped delivery work; legacy code may still call this “talent.” Not an account attribute. |
| **Consultant layer** | Proyekto's defining idea: a vetted project lead between Client and Talent who owns delivery. |
| **Active consultant** | An account with `consultant_profiles.status='verified'`. Suspension and revocation remove marketplace capability without changing execution access. |
| **Active talent** | An account with `talent_profiles.status='active'`; this controls public-pool discovery and can be paused or resumed by the owner. |
| **Project** | The delivery container: roadmap + team + chat + meetings + billing. |
| **Brief** | A project's structured intent (mission/vision, summary, custom fields) — `project_briefs`. |
| **Roadmap** | The plan for a project — a tree of epics, features, and tasks. One per project (unique when `roadmaps.project_id` is set, via the partial index `uq_roadmaps_project_id_linked`); [a proposal](../13-proposals/services-and-multi-roadmap.md#resolving-1-roadmap--1-service) would relax this to one per service. |
| **Epic** | A value-based initiative (e.g. "User Authentication"), not a tech layer. |
| **Feature** | A time-bound deliverable within an epic; carries the timeline dates. Status is derived from its tasks. |
| **Task** | The smallest execution unit; has status, assignees, comments, dependencies. |
| **Milestone** | A timeline checkpoint linked to a set of features (`milestone_features`). |
| **Canvas view mode** | The four projections of one roadmap — roadmap tree, epic, Gantt/milestones, and kanban. Views are projections, not separate entities. |
| **Workspace** | The top-level organizational and billing container (`workspaces`). It owns teams and projects, and `workspace_members` is the billable seat pool. It is **never** an authorization source — a workspace seat grants nothing inside a project. Required at signup. Built 2026-09-01; not yet in production. See [Domains → Workspaces](../11-domains/workspaces/README.md). |
| **Team** | A reusable group of people; attached to projects and curated per project. Lives in a workspace (`teams.workspace_id`, nullable) but is owned by a user. |
| **`project_access`** | The authorization row — exactly one per (project, user) since `20260507000130` — carrying a `share_role` (`owner > admin > editor > commenter > viewer`), an `origin` label, and a capabilities delta. |
| **Team tag** | A freeform descriptive label on a team (`teams.tags text[]`) — cohort, source, intent. Normalized on write (trimmed, deduped, max 20 × 40 chars). Like **Origin** below, it is descriptive only and takes no part in permission resolution. |
| **Origin** | Provenance of an access grant — *how* someone joined, never what they can do: `direct`, `invited`, `personal_workspace`, `legacy`, or `team:<id>`. It takes no part in permission resolution. The former `client` and `consultant` values were folded into `direct` on 2026-08-18. |
| **Client** | The market position of people commissioning work — not an account attribute. Project participation and the legal payer come from `project_access` and contract snapshots. See [Finance → contract parties](../11-domains/finance/README.md#contract-parties). |
| **Project owner** | The profile referenced by `projects.owner_id`. Any account may own a project; ownership implies nothing else about the account. |
| **External client** | A contract counterparty with no account, existing only as `contracts.client_*` strings, who signs via a tokenized link. Valid for legacy contracts, but can never activate an engagement — positions require a resolved account. |
| **Contract** | The service agreement for a project (`contracts`) — parties, commercial terms, term dates, clause set, and a jsonb services catalog. |
| **Activation** | The gated `draft → active` flip, guarded by a seven-item derived checklist so billing never starts without a price and a rate. |
| **Contract position** | One of the two seats on a contract (`contract_positions`) — hirer or provider, each resolved to an existing account by exact email. Two signed positions are what activate an engagement; contracts predating positions stay valid but activate nothing. |
| **Engagement** | The durable record of who hired whom (`engagements` + `engagement_parties`), created only by the final signature on a two-position contract. It organizes commercial effects (project links, time policy, rates) and is never a source of project authorization. Read at `/engagements`. The term may be renamed "deals" / "deals center" — see the naming note in [Engagements](../14-engagement/README.md). |
| **Engagement activation** | The `SECURITY DEFINER` RPC (`sign_contract_position_and_activate`) run by the final signature, writing the engagement, its parties, project links, time settings, and rates in one idempotent transaction. Distinct from **Activation** above, which is the project checklist flip. |
| **Personal project** | A project linked one-to-one to its user through `personal_projects` (renamed from `personal_workspaces` on 2026-09-01, when "workspace" became the organization tier). The owner's `project_access` row still has `origin='personal_workspace'` — the literal was deliberately not renamed. Titled `"<name>'s Space"`. |
| **Time log** | A billable record of work against a task (`task_time_logs`), rolled into invoices/payouts. |
| **Payout / Invoice** | The live money paths — manual payouts of approved time, and generated project invoices. |
| **Guest** | An anonymous user (a `profiles` row with `is_guest`) who can build a roadmap before signing up. |
| **AI assistant** | The Proyekto assistant — a conversational agent that reads and edits roadmaps. It lives in two places: inside a roadmap, where it edits that roadmap directly, and on the workspace dashboard, where it works across every project, roadmap, and team you can access. Every message is a **run** (investigate -> propose -> execute -> verify). Edits that reach beyond the open roadmap, touch several roadmaps, or — from the dashboard — delete anything or exceed 15 operations come back as a **proposal** to confirm first, then commit one change per roadmap. `@`-mentions (projects, roadmaps, epics, features, tasks, milestones, teams) tell it what you mean without limiting what it may look at. |

For the technical vocabulary (deployable units, service role, lean diff, room keys),
see the [Architecture glossary](../02-architecture/README.md#glossary) and the
[Backend glossary](../03-backend/README.md#glossary).
