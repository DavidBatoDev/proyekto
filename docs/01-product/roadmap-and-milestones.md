# Roadmap & Milestones

> **Last updated:** 2026-07-09 · **Status:** current

The roadmap is Proyekto's planning core. It's **one data model with multiple
views**: a structural hierarchy (Epic → Feature → Task) that you can look at as a
tree (the *Roadmap view*) or as a timeline (the *Milestone / Gantt view*). Views are
projections of the same data — there is no separate roadmap system.

> **One model, many views.** Epics are business value, Features are timeline units,
> Tasks are execution. Nothing is mapped twice.

## The hierarchy

```
Roadmap
 └── Epic        value-based initiative   (e.g. "Booking & Payment Flow")
      └── Feature    time-bound deliverable  (e.g. "Payment gateway integration")
           └── Task     execution step         (e.g. "Integrate Stripe SDK")
```

- **Epics are value-based**, not layers. "User Authentication" is an epic;
  "Frontend" / "Backend" are not — frontend and backend work live as *tasks inside
  features*. `epic_status` ∈ backlog, planned, in_progress, in_review, completed,
  on_hold.
- **Features** are the deliverable unit and carry the timeline. Feature **status is
  derived** from its child tasks in application code (there is no `feature_status`
  column — it was dropped).
- **Tasks** are the smallest unit (`task_status` ∈ todo, in_progress, in_review,
  done, blocked); they carry checklists, comments, attachments, dependencies, and
  multiple assignees.

Backed by `roadmaps`, `roadmap_epics`, `roadmap_features`, `roadmap_tasks` — see
[Data → schema overview](../07-data-and-db/schema-overview.md).

## Two views of the same tree

| View | Shows | For |
| --- | --- | --- |
| **Roadmap view** (hierarchy) | Epics → Features → Tasks, with status + progress | Structure, ownership, decomposition |
| **Milestone view** (Gantt) | Features by default (optionally Epics; never Tasks) | Timeline of deliverables |

Tasks are deliberately excluded from the Gantt — too granular, too volatile, too
noisy for a timeline. Milestones link to features via the `milestone_features` M:N
junction, so a milestone tracks the delivery of a set of features.

## Date rules

- **Features** carry the real dates (`start_date`, `end_date`) — they draw the
  timeline bars.
- **Epic dates are auto-derived**: `start = MIN(child feature starts)`,
  `end = MAX(child feature ends)`. An epic spans its initiative's lifespan, so
  internal gaps (a quiet month between two features) are accepted on purpose. An
  optional "lock dates" override can pin an epic manually.
- **Tasks** may have an optional due date used only for execution tracking — it does
  not affect Gantt rendering.

## Progress rollup

```
Feature.progress = completed_tasks / total_tasks
Epic.progress    = average(feature.progress)     (optionally duration-weighted)
```

Progress rolls further up to milestones and the roadmap; Postgres progress functions
(`get_feature_progress`, `get_epic_progress`, …) compute these.

## How it's built and edited

- The web canvas renders the tree with **XYFlow + dagre** and supports optimistic
  epic/feature/task edits. See [Web → roadmap canvas](../04-web/README.md).
- The **AI assistant** can plan and apply edits conversationally; every AI commit is
  persisted atomically through the `upsert_full_roadmap` RPC. See
  [Agent & Roadmap AI](../05-agent-ai/README.md).
- A roadmap can be **shared** read-only/commentable via a token, and used as a
  **template** to clone from. See [Feature Domains → roadmap sharing](../11-domains/README.md).

## Principles

1. One data model. 2. Multiple visualizations. 3. No duplicate mapping.
4. No separate roadmap system. 5. Views are projections, not separate entities.
