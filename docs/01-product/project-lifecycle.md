# Project Lifecycle

> **Last updated:** 2026-07-09 · **Status:** current

A **project** is the structured container for delivery — it holds the roadmap, the
team, the conversations, the meetings, and the money. This page walks a project from
first idea to completion and names the domains that own each step.

```
  idea ─► project ─► roadmap ─► team ─► delivery ─► billing ─► done
   │         │          │         │        │          │
 guest    briefs     epics/     teams/   tasks +     invoices
 roadmap  intent    features/  project_  time logs   + payouts
          bidding    tasks     teams     + chat +
                                         meetings
```

## 1. Idea → project

A project can start several ways:

- **From a roadmap** — a guest or user builds a roadmap first (often via the AI hero
  chat), then converts it into a project (`POST /api/projects/from-roadmap`). Guests
  must sign up first; the guest roadmap migrates to their account.
- **Directly** — `POST /api/projects`, optionally seeded with a **brief**
  (`project_briefs`: mission/vision, summary, custom fields) and an intent.
- **Bidding/incubation** — `project_status` includes a `bidding` state for projects
  posted for pickup. (This flow is partly built; treat it as evolving.)

Each project has an owner and a `personal-workspace` flavor for solo/first use.

## 2. Roadmap planning

The Consultant turns the vision into a **hybrid roadmap** — milestones, epics,
features, and tasks — often with AI assistance. This is the heart of the product and
has its own concept page: [roadmap-and-milestones.md](./roadmap-and-milestones.md).
The roadmap is one-to-one with the project.

## 3. Team assembly

Delivery runs on **teams** (reusable across projects). A team is attached to a
project (`project_teams`), and specific members are **curated** in
(`project_team_members`) — which fans out to `project_access` rows via a DB trigger,
granting them the roadmap/chat access their role implies. Per-member billing rates
live in `team_member_rates`. Members join by invite (`team_invites`,
`project_invites`). See [Feature Domains → teams & time](../11-domains/README.md).

## 4. Delivery & collaboration

The team executes against the roadmap:

- **Work** — features/tasks move through their statuses; assignees are multi-valued
  (`roadmap_task_assignees`). Feature status is **derived** from child tasks.
- **Time** — billable work is captured in `task_time_logs` (start/stop or manual),
  reviewed, and later rolled into payouts/invoices.
- **Talk** — project **chat** (channels + DMs + activity feed) and **meetings**
  (scheduled, recurring, with reminders) keep everyone aligned. Notifications and
  optional push fan out important events.

## 5. Billing

Progress turns into money through the **live** financial path:

- **Invoices** (`invoices` + line items + generated PDFs), sourced from billable time.
- **Payouts** (`payouts` + `payout_methods`) — manual payouts grouping a member's
  approved, single-currency time logs; proofs stored privately on R2.

> The product vision frames money as *milestone-based payment checkpoints*, and
> `wallets` exist for balances — but the original escrow/`payment_checkpoints`
> mechanism was retired (those tables are dropped). The shipped flow is
> **invoices + payouts**. See [Data → schema overview](../07-data-and-db/schema-overview.md).

## 6. Completion

As features complete, progress rolls up (feature → epic → milestone → roadmap), the
client tracks health, and `user_stats` update on completion. The `project_activity_log`
records the audit trail throughout.

## See also

- [personas.md](./personas.md) — who does what at each step.
- [Feature Domains](../11-domains/README.md) — deep dives on chat, meetings, teams, payments.
- [Architecture → cross-service flows](../02-architecture/cross-service-flows.md) — the technical request paths.
