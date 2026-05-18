# Roadmap Canvas Database Schema

**Version:** 2.0  
**Created:** January 11, 2026  
**Updated:** January 21, 2026  
**Author:** Proyekto Development Team

## Changelog

### v2.0 (January 21, 2026)

**Breaking Change:** Milestones now link to **Features**, not Epics.

- âŒ Removed `milestone_epics` junction table
- âœ… Added `milestone_features` junction table
- âœ… Added `roadmap_id` to `roadmap_features` (denormalized for performance)
- âœ… Added `is_deliverable` flag to `roadmap_features`
- âœ… Updated `get_milestone_progress()` to calculate from features
- âœ… Updated core principle and documentation

**Rationale:** Epics are too large to track meaningful delivery at milestones. Features are the smallest deliverable unit, enabling partial epic delivery and accurate progress tracking.

---

## Overview

This document describes the database schema for the **Roadmap Canvas** feature - a linear, vertical progress map system that enables clients to create and manage project roadmaps. The roadmap functions as a project management tool similar to Trello, where users can track progress through a hierarchical structure of milestones, epics, features, and tasks.

### Key Concepts

| Concept       | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| **Roadmap**   | The top-level container representing a project's complete plan      |
| **Milestone** | Timeline checkpoints that define success criteria at specific dates |
| **Epic**      | Large work units that represent major deliverables or features      |
| **Feature**   | Smaller components within an epic that group related tasks          |
| **Task**      | The smallest unit of work - assignable, trackable, completable      |

### Core Principle

> **"Milestones define delivered value in time. Features deliver that value. Epics organize the work."**

Milestones and Features have a **many-to-many** relationship - the same Feature can contribute to multiple Milestones, and a Milestone can require multiple Features. Epics serve as **structural containers** that organize related Features, but they are not directly tied to Milestones.

---

## Table of Contents

1. [Custom Types](#custom-types)
2. [Entity Relationship Diagram](#entity-relationship-diagram)
3. [Tables](#tables)
   - [roadmaps](#roadmaps)
   - [roadmap_milestones](#roadmap_milestones)
   - [roadmap_epics](#roadmap_epics)
   - [roadmap_features](#roadmap_features)
   - [milestone_features](#milestone_features)
   - [roadmap_tasks](#roadmap_tasks)
   - [task_comments](#task_comments)
   - [task_attachments](#task_attachments)
4. [Progress Calculation](#progress-calculation)
5. [Row Level Security Policies](#row-level-security-policies)
6. [Indexes](#indexes)
7. [Example Usage](#example-usage)

---

## Custom Types

### `roadmap_status`

Status of the overall roadmap.

```sql
CREATE TYPE roadmap_status AS ENUM (
  'draft',        -- Initial creation, not yet active
  'active',       -- Currently in progress
  'paused',       -- Temporarily halted
  'completed',    -- All milestones achieved
  'archived'      -- Archived for reference
);
```

### `roadmap_milestone_status`

Status of individual milestones.

```sql
CREATE TYPE roadmap_milestone_status AS ENUM (
  'not_started',  -- Milestone work hasn't begun
  'in_progress',  -- Currently working towards this milestone
  'at_risk',      -- Behind schedule or facing issues
  'completed',    -- Milestone achieved
  'missed'        -- Target date passed without completion
);
```

### `epic_status`

Status of epics.

```sql
CREATE TYPE epic_status AS ENUM (
  'backlog',      -- Not yet prioritized
  'planned',      -- Scheduled for work
  'in_progress',  -- Currently being worked on
  'in_review',    -- Work completed, under review
  'completed',    -- Epic fully delivered
  'on_hold'       -- Temporarily paused
);
```

### `epic_priority`

Priority levels for epics.

```sql
CREATE TYPE epic_priority AS ENUM (
  'critical',     -- Must be done immediately
  'high',         -- Important, should be prioritized
  'medium',       -- Normal priority
  'low',          -- Can be deferred
  'nice_to_have'  -- Optional enhancement
);
```

### `feature_status`

Status of features within epics.

```sql
CREATE TYPE feature_status AS ENUM (
  'not_started',
  'in_progress',
  'in_review',
  'completed',
  'blocked'
);
```

### `task_status`

Status of individual tasks.

```sql
CREATE TYPE task_status AS ENUM (
  'todo',         -- Not started
  'in_progress',  -- Currently working
  'in_review',    -- Awaiting review
  'done',         -- Completed
  'blocked'       -- Cannot proceed
);
```

### `task_priority`

Priority levels for tasks.

```sql
CREATE TYPE task_priority AS ENUM (
  'urgent',
  'high',
  'medium',
  'low'
);
```

---

## Entity Relationship Diagram

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                              ROADMAP CANVAS ERD                              â”‚
â”‚                                                                             â”‚
â”‚  Conceptual Model: Epic â†’ Feature â†” Milestone                               â”‚
â”‚  Epics are structural containers. Features are the smallest deliverable.    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

                                 â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                 â”‚   projects   â”‚
                                 â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
                                 â”‚ id (PK)      â”‚
                                 â”‚ title        â”‚
                                 â”‚ client_id    â”‚
                                 â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                        â”‚ 1:1
                                        â–¼
                                 â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                 â”‚   roadmaps   â”‚
                                 â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
                                 â”‚ id (PK)      â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                 â”‚ project_id   â”‚                       â”‚
                                 â”‚ name         â”‚                       â”‚
                                 â”‚ owner_id     â”‚                       â”‚
                                 â”‚ status       â”‚                       â”‚
                                 â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜                       â”‚
                                        â”‚                               â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”           â”‚
                    â”‚ 1:N               â”‚ 1:N               â”‚           â”‚
                    â–¼                   â–¼                   â”‚           â”‚
         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”        â”‚           â”‚
         â”‚roadmap_milestonesâ”‚   â”‚  roadmap_epics   â”‚        â”‚           â”‚
         â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚   â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚        â”‚           â”‚
         â”‚ id (PK)          â”‚   â”‚ id (PK)          â”‚        â”‚           â”‚
         â”‚ roadmap_id (FK)  â”‚   â”‚ roadmap_id (FK)  â”‚        â”‚           â”‚
         â”‚ title            â”‚   â”‚ title            â”‚        â”‚           â”‚
         â”‚ target_date      â”‚   â”‚ priority         â”‚        â”‚           â”‚
         â”‚ position         â”‚   â”‚ status           â”‚        â”‚           â”‚
         â”‚ status           â”‚   â”‚ position         â”‚        â”‚           â”‚
         â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜        â”‚           â”‚
                  â”‚                      â”‚                  â”‚           â”‚
                  â”‚                      â”‚ 1:N              â”‚           â”‚
                  â”‚                      â–¼                  â”‚           â”‚
                  â”‚             â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”        â”‚           â”‚
                  â”‚             â”‚ roadmap_features â”‚        â”‚           â”‚
                  â”‚             â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚        â”‚           â”‚
                  â”‚             â”‚ id (PK)          â”‚        â”‚           â”‚
                  â”‚             â”‚ roadmap_id (FK)  â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”˜           â”‚
                  â”‚             â”‚ epic_id (FK)     â”‚                    â”‚
                  â”‚             â”‚ title            â”‚                    â”‚
                  â”‚             â”‚ status           â”‚                    â”‚
                  â”‚             â”‚ position         â”‚                    â”‚
                  â”‚             â”‚ is_deliverable   â”‚                    â”‚
                  â”‚             â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                    â”‚
                  â”‚                      â”‚                              â”‚
                  â”‚      N:M             â”‚                              â”‚
                  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                              â”‚
                  â”‚  â”‚                                                  â”‚
                  â–¼  â–¼                                                  â”‚
         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                                         â”‚
         â”‚ milestone_features â”‚ (Junction Table)                        â”‚
         â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                                         â”‚
         â”‚ id (PK)            â”‚                                         â”‚
         â”‚ milestone_id (FK)  â”‚                                         â”‚
         â”‚ feature_id (FK)    â”‚                                         â”‚
         â”‚ position           â”‚                                         â”‚
         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                         â”‚
                                                                        â”‚
                               â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â”‚ 1:N
                               â–¼
                      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                      â”‚  roadmap_tasks   â”‚
                      â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
                      â”‚ id (PK)          â”‚
                      â”‚ feature_id (FK)  â”‚
                      â”‚ title            â”‚
                      â”‚ assignee_id (FK) â”‚â”€â”€â”€â”€â”€â–º profiles
                      â”‚ status           â”‚
                      â”‚ position         â”‚
                      â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â”‚
           â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
           â”‚ 1:N               â”‚ 1:N               â”‚
           â–¼                   â–¼                   â”‚
  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”‚
  â”‚  task_comments   â”‚   â”‚ task_attachments â”‚      â”‚
  â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚   â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚      â”‚
  â”‚ id (PK)          â”‚   â”‚ id (PK)          â”‚      â”‚
  â”‚ task_id (FK)     â”‚   â”‚ task_id (FK)     â”‚      â”‚
  â”‚ author_id (FK)   â”‚   â”‚ file_url         â”‚      â”‚
  â”‚ content          â”‚   â”‚ uploaded_by (FK) â”‚      â”‚
  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â”‚
                                                   â”‚
                                                   â”‚
                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                         â”‚
                         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


LEGEND:
  â”€â”€â”€â”€â”€â–º  Foreign Key Reference
  1:N     One-to-Many Relationship
  N:M     Many-to-Many Relationship (via Junction Table)
  1:1     One-to-One Relationship
```

---

## Tables

### `roadmaps`

The top-level container for a project's roadmap.

| Column        | Type           | Constraints                   | Description                              |
| ------------- | -------------- | ----------------------------- | ---------------------------------------- |
| `id`          | uuid           | PK, DEFAULT gen_random_uuid() | Unique roadmap identifier                |
| `project_id`  | uuid           | FK, UNIQUE, NOT NULL          | References `projects.id`                 |
| `name`        | text           | NOT NULL                      | Roadmap name (e.g., "MVP Launch Plan")   |
| `description` | text           |                               | Detailed roadmap description             |
| `owner_id`    | uuid           | FK, NOT NULL                  | References `profiles.id` - roadmap owner |
| `status`      | roadmap_status | DEFAULT 'draft'               | Current roadmap status                   |
| `start_date`  | timestamptz    |                               | Planned start date                       |
| `end_date`    | timestamptz    |                               | Target completion date                   |
| `settings`    | jsonb          | DEFAULT '{}'                  | Custom settings (colors, views, etc.)    |
| `created_at`  | timestamptz    | DEFAULT now()                 | Creation timestamp                       |
| `updated_at`  | timestamptz    | DEFAULT now()                 | Last update timestamp                    |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `owner_id` â†’ `profiles.id` (ON DELETE CASCADE)

**Notes:**

- One roadmap per project (enforced by UNIQUE constraint on `project_id`)
- `settings` JSONB can store: `{"theme": "default", "view_mode": "timeline", "show_progress": true}`

```sql
CREATE TABLE roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status roadmap_status DEFAULT 'draft',
  start_date timestamptz,
  end_date timestamptz,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

---

### `roadmap_milestones`

Timeline checkpoints that define success criteria at specific dates.

| Column           | Type                     | Constraints                   | Description                            |
| ---------------- | ------------------------ | ----------------------------- | -------------------------------------- |
| `id`             | uuid                     | PK, DEFAULT gen_random_uuid() | Unique milestone identifier            |
| `roadmap_id`     | uuid                     | FK, NOT NULL                  | References `roadmaps.id`               |
| `title`          | text                     | NOT NULL                      | Milestone title (e.g., "Design Ready") |
| `description`    | text                     |                               | Goal description                       |
| `target_date`    | timestamptz              | NOT NULL                      | Target completion date                 |
| `completed_date` | timestamptz              |                               | Actual completion date                 |
| `status`         | roadmap_milestone_status | DEFAULT 'not_started'         | Current status                         |
| `position`       | integer                  | NOT NULL                      | Order in the timeline (0-indexed)      |
| `color`          | text                     |                               | Display color (hex code)               |
| `created_at`     | timestamptz              | DEFAULT now()                 | Creation timestamp                     |
| `updated_at`     | timestamptz              | DEFAULT now()                 | Last update timestamp                  |

**Foreign Keys:**

- `roadmap_id` â†’ `roadmaps.id` (ON DELETE CASCADE)

**Unique Constraint:**

- `(roadmap_id, position)` - Ensures unique ordering within a roadmap

```sql
CREATE TABLE roadmap_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  target_date timestamptz NOT NULL,
  completed_date timestamptz,
  status roadmap_milestone_status DEFAULT 'not_started',
  position integer NOT NULL,
  color text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(roadmap_id, position)
);
```

---

### `roadmap_epics`

Large work units representing major deliverables. Epics exist independently of milestones.

| Column            | Type          | Constraints                   | Description                                |
| ----------------- | ------------- | ----------------------------- | ------------------------------------------ |
| `id`              | uuid          | PK, DEFAULT gen_random_uuid() | Unique epic identifier                     |
| `roadmap_id`      | uuid          | FK, NOT NULL                  | References `roadmaps.id`                   |
| `title`           | text          | NOT NULL                      | Epic title (e.g., "Authentication System") |
| `description`     | text          |                               | Detailed epic description                  |
| `priority`        | epic_priority | DEFAULT 'medium'              | Priority level                             |
| `status`          | epic_status   | DEFAULT 'backlog'             | Current status                             |
| `position`        | integer       | NOT NULL                      | Display order (0-indexed)                  |
| `color`           | text          |                               | Display color for visual grouping          |
| `estimated_hours` | numeric(8,2)  |                               | Estimated effort in hours                  |
| `actual_hours`    | numeric(8,2)  |                               | Actual hours spent                         |
| `start_date`      | timestamptz   |                               | Planned start date                         |
| `due_date`        | timestamptz   |                               | Target completion date                     |
| `completed_date`  | timestamptz   |                               | Actual completion date                     |
| `tags`            | text[]        | DEFAULT '{}'                  | Category tags (e.g., ['frontend', 'ui'])   |
| `created_at`      | timestamptz   | DEFAULT now()                 | Creation timestamp                         |
| `updated_at`      | timestamptz   | DEFAULT now()                 | Last update timestamp                      |

**Foreign Keys:**

- `roadmap_id` â†’ `roadmaps.id` (ON DELETE CASCADE)

**Unique Constraint:**

- `(roadmap_id, position)` - Ensures unique ordering within a roadmap

```sql
CREATE TABLE roadmap_epics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority epic_priority DEFAULT 'medium',
  status epic_status DEFAULT 'backlog',
  position integer NOT NULL,
  color text,
  estimated_hours numeric(8,2),
  actual_hours numeric(8,2),
  start_date timestamptz,
  due_date timestamptz,
  completed_date timestamptz,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(roadmap_id, position)
);
```

---

### `roadmap_features`

The smallest deliverable unit within an epic. Features are **the key unit for milestone tracking** - they represent concrete value that can be delivered at specific milestones.

| Column            | Type           | Constraints                   | Description                                           |
| ----------------- | -------------- | ----------------------------- | ----------------------------------------------------- |
| `id`              | uuid           | PK, DEFAULT gen_random_uuid() | Unique feature identifier                             |
| `roadmap_id`      | uuid           | FK, NOT NULL                  | References `roadmaps.id` (denormalized for perf)      |
| `epic_id`         | uuid           | FK, NOT NULL                  | References `roadmap_epics.id`                         |
| `title`           | text           | NOT NULL                      | Feature title (e.g., "Define app structure")          |
| `description`     | text           |                               | Feature description                                   |
| `status`          | feature_status | DEFAULT 'not_started'         | Current status                                        |
| `position`        | integer        | NOT NULL                      | Order within epic (0-indexed)                         |
| `is_deliverable`  | boolean        | DEFAULT true                  | Whether this feature counts toward milestone progress |
| `estimated_hours` | numeric(8,2)   |                               | Estimated effort                                      |
| `actual_hours`    | numeric(8,2)   |                               | Actual hours spent                                    |
| `created_at`      | timestamptz    | DEFAULT now()                 | Creation timestamp                                    |
| `updated_at`      | timestamptz    | DEFAULT now()                 | Last update timestamp                                 |

**Foreign Keys:**

- `roadmap_id` â†’ `roadmaps.id` (ON DELETE CASCADE)
- `epic_id` â†’ `roadmap_epics.id` (ON DELETE CASCADE)

**Unique Constraint:**

- `(epic_id, position)` - Ensures unique ordering within an epic

**Notes:**

- `roadmap_id` is intentionally denormalized to avoid deep joins in queries and RLS policies
- `is_deliverable` allows excluding non-delivery features (refactors, infra work) from milestone progress

```sql
CREATE TABLE roadmap_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  epic_id uuid NOT NULL REFERENCES roadmap_epics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status feature_status DEFAULT 'not_started',
  position integer NOT NULL,
  is_deliverable boolean DEFAULT true,
  estimated_hours numeric(8,2),
  actual_hours numeric(8,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(epic_id, position)
);
```

---

### `milestone_features`

Junction table linking milestones to features (many-to-many relationship). This is the **key table for delivery tracking** - it defines which features contribute to which milestones.

| Column         | Type        | Constraints                   | Description                        |
| -------------- | ----------- | ----------------------------- | ---------------------------------- |
| `id`           | uuid        | PK, DEFAULT gen_random_uuid() | Unique link identifier             |
| `milestone_id` | uuid        | FK, NOT NULL                  | References `roadmap_milestones.id` |
| `feature_id`   | uuid        | FK, NOT NULL                  | References `roadmap_features.id`   |
| `position`     | integer     | NOT NULL DEFAULT 0            | Order of feature within milestone  |
| `created_at`   | timestamptz | DEFAULT now()                 | Link creation timestamp            |

**Foreign Keys:**

- `milestone_id` â†’ `roadmap_milestones.id` (ON DELETE CASCADE)
- `feature_id` â†’ `roadmap_features.id` (ON DELETE CASCADE)

**Unique Constraint:**

- `(milestone_id, feature_id)` - Prevents duplicate links

**Why Features, Not Epics:**

- Epics are too large to be meaningfully "done" at a milestone
- Epics often span multiple milestones
- Features are the smallest deliverable unit
- This enables partial epic delivery across milestones

```sql
CREATE TABLE milestone_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES roadmap_milestones(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES roadmap_features(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(milestone_id, feature_id)
);
```

---

### `roadmap_tasks`

The smallest unit of work - assignable, trackable, completable items.

| Column            | Type          | Constraints                   | Description                                 |
| ----------------- | ------------- | ----------------------------- | ------------------------------------------- |
| `id`              | uuid          | PK, DEFAULT gen_random_uuid() | Unique task identifier                      |
| `feature_id`      | uuid          | FK, NOT NULL                  | References `roadmap_features.id`            |
| `title`           | text          | NOT NULL                      | Task title (e.g., "Create login wireframe") |
| `description`     | text          |                               | Detailed task description                   |
| `assignee_id`     | uuid          | FK                            | References `profiles.id` - assigned user    |
| `reporter_id`     | uuid          | FK                            | References `profiles.id` - task creator     |
| `status`          | task_status   | DEFAULT 'todo'                | Current status                              |
| `priority`        | task_priority | DEFAULT 'medium'              | Task priority                               |
| `position`        | integer       | NOT NULL                      | Order within feature (0-indexed)            |
| `estimated_hours` | numeric(8,2)  |                               | Estimated effort                            |
| `actual_hours`    | numeric(8,2)  |                               | Actual hours spent                          |
| `due_date`        | timestamptz   |                               | Task due date                               |
| `completed_at`    | timestamptz   |                               | When task was completed                     |
| `labels`          | text[]        | DEFAULT '{}'                  | Task labels (e.g., ['bug', 'frontend'])     |
| `checklist`       | jsonb         | DEFAULT '[]'                  | Subtask checklist                           |
| `created_at`      | timestamptz   | DEFAULT now()                 | Creation timestamp                          |
| `updated_at`      | timestamptz   | DEFAULT now()                 | Last update timestamp                       |

**Foreign Keys:**

- `feature_id` â†’ `roadmap_features.id` (ON DELETE CASCADE)
- `assignee_id` â†’ `profiles.id` (ON DELETE SET NULL)
- `reporter_id` â†’ `profiles.id` (ON DELETE SET NULL)

**Unique Constraint:**

- `(feature_id, position)` - Ensures unique ordering within a feature

**Notes:**

- `checklist` JSONB structure: `[{"id": "uuid", "text": "Subtask 1", "completed": false}, ...]`

```sql
CREATE TABLE roadmap_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id uuid NOT NULL REFERENCES roadmap_features(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reporter_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status task_status DEFAULT 'todo',
  priority task_priority DEFAULT 'medium',
  position integer NOT NULL,
  estimated_hours numeric(8,2),
  actual_hours numeric(8,2),
  due_date timestamptz,
  completed_at timestamptz,
  labels text[] DEFAULT '{}',
  checklist jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(feature_id, position)
);
```

---

### `task_comments`

Comments and discussions on tasks (similar to Trello card comments).

| Column       | Type        | Constraints                   | Description                      |
| ------------ | ----------- | ----------------------------- | -------------------------------- |
| `id`         | uuid        | PK, DEFAULT gen_random_uuid() | Unique comment identifier        |
| `task_id`    | uuid        | FK, NOT NULL                  | References `roadmap_tasks.id`    |
| `author_id`  | uuid        | FK, NOT NULL                  | References `profiles.id`         |
| `content`    | text        | NOT NULL                      | Comment text (supports markdown) |
| `edited_at`  | timestamptz |                               | Last edit timestamp              |
| `created_at` | timestamptz | DEFAULT now()                 | Creation timestamp               |

**Foreign Keys:**

- `task_id` â†’ `roadmap_tasks.id` (ON DELETE CASCADE)
- `author_id` â†’ `profiles.id` (ON DELETE CASCADE)

```sql
CREATE TABLE task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  edited_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

### `task_attachments`

File attachments for tasks.

| Column        | Type        | Constraints                   | Description                   |
| ------------- | ----------- | ----------------------------- | ----------------------------- |
| `id`          | uuid        | PK, DEFAULT gen_random_uuid() | Unique attachment identifier  |
| `task_id`     | uuid        | FK, NOT NULL                  | References `roadmap_tasks.id` |
| `uploaded_by` | uuid        | FK, NOT NULL                  | References `profiles.id`      |
| `file_name`   | text        | NOT NULL                      | Original file name            |
| `file_url`    | text        | NOT NULL                      | Storage URL                   |
| `file_size`   | bigint      |                               | File size in bytes            |
| `mime_type`   | text        |                               | MIME type (e.g., 'image/png') |
| `created_at`  | timestamptz | DEFAULT now()                 | Upload timestamp              |

**Foreign Keys:**

- `task_id` â†’ `roadmap_tasks.id` (ON DELETE CASCADE)
- `uploaded_by` â†’ `profiles.id` (ON DELETE CASCADE)

```sql
CREATE TABLE task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  mime_type text,
  created_at timestamptz DEFAULT now()
);
```

---

## Progress Calculation

Progress is calculated automatically from the bottom up using database functions.

### Calculation Formula

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    PROGRESS CALCULATION                          â”‚
â”‚                                                                 â”‚
â”‚  Key Change: Milestone progress is calculated from FEATURES,    â”‚
â”‚  not from Epics. This ensures accurate delivery tracking.       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

Task Progress:
  â”œâ”€â”€ todo         = 0%
  â”œâ”€â”€ in_progress  = 25%
  â”œâ”€â”€ in_review    = 75%
  â”œâ”€â”€ done         = 100%
  â””â”€â”€ blocked      = 0%

Feature Progress:
  â””â”€â”€ AVG(task progress for all tasks in feature)

Epic Progress:
  â””â”€â”€ AVG(feature progress for all features in epic)

Milestone Progress:  â­ KEY CHANGE
  â””â”€â”€ AVG(feature progress for all linked features via milestone_features)

Roadmap Progress:
  â””â”€â”€ AVG(milestone progress for all milestones)
```

### Progress Calculation Functions

```sql
-- Calculate task progress percentage
CREATE OR REPLACE FUNCTION get_task_progress(p_status task_status)
RETURNS numeric AS $$
BEGIN
  RETURN CASE p_status
    WHEN 'todo' THEN 0
    WHEN 'in_progress' THEN 25
    WHEN 'in_review' THEN 75
    WHEN 'done' THEN 100
    WHEN 'blocked' THEN 0
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate feature progress
CREATE OR REPLACE FUNCTION get_feature_progress(p_feature_id uuid)
RETURNS numeric AS $$
BEGIN
  RETURN COALESCE(
    (SELECT AVG(get_task_progress(status))
     FROM roadmap_tasks
     WHERE feature_id = p_feature_id),
    0
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Calculate epic progress
CREATE OR REPLACE FUNCTION get_epic_progress(p_epic_id uuid)
RETURNS numeric AS $$
BEGIN
  RETURN COALESCE(
    (SELECT AVG(get_feature_progress(id))
     FROM roadmap_features
     WHERE epic_id = p_epic_id),
    0
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Calculate milestone progress (from linked FEATURES, not epics)
CREATE OR REPLACE FUNCTION get_milestone_progress(p_milestone_id uuid)
RETURNS numeric AS $$
BEGIN
  RETURN COALESCE(
    (SELECT AVG(get_feature_progress(feature_id))
     FROM milestone_features
     WHERE milestone_id = p_milestone_id),
    0
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Calculate roadmap progress
CREATE OR REPLACE FUNCTION get_roadmap_progress(p_roadmap_id uuid)
RETURNS numeric AS $$
BEGIN
  RETURN COALESCE(
    (SELECT AVG(get_milestone_progress(id))
     FROM roadmap_milestones
     WHERE roadmap_id = p_roadmap_id),
    0
  );
END;
$$ LANGUAGE plpgsql STABLE;
```

### Progress View (Materialized for Performance)

```sql
-- Create a view for easy progress queries
CREATE VIEW roadmap_progress_view AS
SELECT
  r.id AS roadmap_id,
  r.name AS roadmap_name,
  r.status AS roadmap_status,
  get_roadmap_progress(r.id) AS overall_progress,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'target_date', m.target_date,
        'status', m.status,
        'progress', get_milestone_progress(m.id)
      ) ORDER BY m.position
    )
    FROM roadmap_milestones m
    WHERE m.roadmap_id = r.id
  ) AS milestones,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'status', e.status,
        'priority', e.priority,
        'progress', get_epic_progress(e.id)
      ) ORDER BY e.position
    )
    FROM roadmap_epics e
    WHERE e.roadmap_id = r.id
  ) AS epics
FROM roadmaps r;
```

---

## Row Level Security Policies

### Policy Overview

| Table              | Policy Type | Access Rule                          |
| ------------------ | ----------- | ------------------------------------ |
| roadmaps           | SELECT      | Project members can view             |
| roadmaps           | INSERT      | Project owner/consultant only        |
| roadmaps           | UPDATE      | Owner or project consultant          |
| roadmaps           | DELETE      | Owner only                           |
| roadmap_milestones | ALL         | Via roadmap access                   |
| roadmap_epics      | ALL         | Via roadmap access                   |
| roadmap_features   | ALL         | Via roadmap access (has roadmap_id)  |
| milestone_features | ALL         | Via roadmap access                   |
| roadmap_tasks      | SELECT      | Project members                      |
| roadmap_tasks      | INSERT      | Project members                      |
| roadmap_tasks      | UPDATE      | Assignee, reporter, or project admin |
| roadmap_tasks      | DELETE      | Reporter or project admin            |
| task_comments      | SELECT      | Project members                      |
| task_comments      | INSERT      | Project members                      |
| task_comments      | UPDATE      | Author only                          |
| task_comments      | DELETE      | Author or project admin              |
| task_attachments   | SELECT      | Project members                      |
| task_attachments   | INSERT      | Project members                      |
| task_attachments   | DELETE      | Uploader or project admin            |

### Example RLS Policies

```sql
-- Enable RLS on all roadmap tables
ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_epics ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- Helper function: Check if user is a project member
CREATE OR REPLACE FUNCTION is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id AND (client_id = p_user_id OR consultant_id = p_user_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Helper function: Check if user can access roadmap
CREATE OR REPLACE FUNCTION can_access_roadmap(p_roadmap_id uuid, p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id FROM roadmaps WHERE id = p_roadmap_id;
  RETURN is_project_member(v_project_id, p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Roadmaps: SELECT policy
CREATE POLICY roadmaps_select ON roadmaps
  FOR SELECT USING (
    is_project_member(project_id, auth.uid())
  );

-- Roadmaps: INSERT policy (owner/consultant only)
CREATE POLICY roadmaps_insert ON roadmaps
  FOR INSERT WITH CHECK (
    owner_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id
      AND (client_id = auth.uid() OR consultant_id = auth.uid())
    )
  );

-- Roadmaps: UPDATE policy
CREATE POLICY roadmaps_update ON roadmaps
  FOR UPDATE USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- Roadmaps: DELETE policy
CREATE POLICY roadmaps_delete ON roadmaps
  FOR DELETE USING (owner_id = auth.uid());

-- Milestones: All operations via roadmap access
CREATE POLICY roadmap_milestones_all ON roadmap_milestones
  FOR ALL USING (can_access_roadmap(roadmap_id, auth.uid()));

-- Epics: All operations via roadmap access
CREATE POLICY roadmap_epics_all ON roadmap_epics
  FOR ALL USING (can_access_roadmap(roadmap_id, auth.uid()));

-- Tasks: SELECT policy
CREATE POLICY roadmap_tasks_select ON roadmap_tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM roadmap_features f
      JOIN roadmap_epics e ON f.epic_id = e.id
      WHERE f.id = feature_id
      AND can_access_roadmap(e.roadmap_id, auth.uid())
    )
  );

-- Tasks: INSERT policy
CREATE POLICY roadmap_tasks_insert ON roadmap_tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM roadmap_features f
      JOIN roadmap_epics e ON f.epic_id = e.id
      WHERE f.id = feature_id
      AND can_access_roadmap(e.roadmap_id, auth.uid())
    )
  );

-- Tasks: UPDATE policy (assignee, reporter, or admin)
CREATE POLICY roadmap_tasks_update ON roadmap_tasks
  FOR UPDATE USING (
    assignee_id = auth.uid() OR
    reporter_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM roadmap_features f
      JOIN roadmap_epics e ON f.epic_id = e.id
      JOIN roadmaps r ON e.roadmap_id = r.id
      WHERE f.id = feature_id AND r.owner_id = auth.uid()
    )
  );

-- Comments: Author can edit their own
CREATE POLICY task_comments_update ON task_comments
  FOR UPDATE USING (author_id = auth.uid());
```

---

## Indexes

Performance indexes for common query patterns.

```sql
-- Roadmaps
CREATE INDEX idx_roadmaps_project_id ON roadmaps(project_id);
CREATE INDEX idx_roadmaps_owner_id ON roadmaps(owner_id);
CREATE INDEX idx_roadmaps_status ON roadmaps(status);

-- Milestones
CREATE INDEX idx_roadmap_milestones_roadmap_id ON roadmap_milestones(roadmap_id);
CREATE INDEX idx_roadmap_milestones_status ON roadmap_milestones(status);
CREATE INDEX idx_roadmap_milestones_target_date ON roadmap_milestones(target_date);
CREATE INDEX idx_roadmap_milestones_position ON roadmap_milestones(roadmap_id, position);

-- Epics
CREATE INDEX idx_roadmap_epics_roadmap_id ON roadmap_epics(roadmap_id);
CREATE INDEX idx_roadmap_epics_status ON roadmap_epics(status);
CREATE INDEX idx_roadmap_epics_priority ON roadmap_epics(priority);
CREATE INDEX idx_roadmap_epics_position ON roadmap_epics(roadmap_id, position);
CREATE INDEX idx_roadmap_epics_tags ON roadmap_epics USING GIN(tags);

-- Milestone-Feature Links
CREATE INDEX idx_milestone_features_milestone_id ON milestone_features(milestone_id);
CREATE INDEX idx_milestone_features_feature_id ON milestone_features(feature_id);

-- Features
CREATE INDEX idx_roadmap_features_roadmap_id ON roadmap_features(roadmap_id);
CREATE INDEX idx_roadmap_features_epic_id ON roadmap_features(epic_id);
CREATE INDEX idx_roadmap_features_status ON roadmap_features(status);
CREATE INDEX idx_roadmap_features_position ON roadmap_features(epic_id, position);
CREATE INDEX idx_roadmap_features_is_deliverable ON roadmap_features(is_deliverable) WHERE is_deliverable = true;

-- Tasks
CREATE INDEX idx_roadmap_tasks_feature_id ON roadmap_tasks(feature_id);
CREATE INDEX idx_roadmap_tasks_assignee_id ON roadmap_tasks(assignee_id);
CREATE INDEX idx_roadmap_tasks_reporter_id ON roadmap_tasks(reporter_id);
CREATE INDEX idx_roadmap_tasks_status ON roadmap_tasks(status);
CREATE INDEX idx_roadmap_tasks_priority ON roadmap_tasks(priority);
CREATE INDEX idx_roadmap_tasks_due_date ON roadmap_tasks(due_date);
CREATE INDEX idx_roadmap_tasks_labels ON roadmap_tasks USING GIN(labels);
CREATE INDEX idx_roadmap_tasks_position ON roadmap_tasks(feature_id, position);

-- Comments
CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_task_comments_author_id ON task_comments(author_id);

-- Attachments
CREATE INDEX idx_task_attachments_task_id ON task_attachments(task_id);
```

---

## Example Usage

### Creating a Fitness Web App Roadmap

```sql
-- 1. Create the roadmap
INSERT INTO roadmaps (project_id, name, description, owner_id, start_date, end_date)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000', -- project_id
  'Fitness Web App â€“ MVP',
  'Complete roadmap for launching the MVP of our fitness tracking application',
  '550e8400-e29b-41d4-a716-446655440001', -- owner_id
  '2026-02-01',
  '2026-04-01'
)
RETURNING id;
-- Returns: roadmap_id = 'abc123...'

-- 2. Create Milestones
INSERT INTO roadmap_milestones (roadmap_id, title, description, target_date, position) VALUES
('abc123...', 'Design Ready', 'All core screens designed and approved', '2026-02-15', 0),
('abc123...', 'Backend Ready', 'APIs stable and tested', '2026-03-10', 1),
('abc123...', 'Frontend Ready', 'UI connected to backend', '2026-03-25', 2),
('abc123...', 'MVP Launch', 'App usable by real users', '2026-04-01', 3);

-- 3. Create Epics
-- UI/UX Epics
INSERT INTO roadmap_epics (roadmap_id, title, description, priority, position, tags) VALUES
('abc123...', 'Low-Fidelity Design', 'Wireframes and basic layouts', 'high', 0, ARRAY['design', 'ui']),
('abc123...', 'High-Fidelity Design', 'Final polished designs', 'high', 1, ARRAY['design', 'ui']);

-- Backend Epics
INSERT INTO roadmap_epics (roadmap_id, title, description, priority, position, tags) VALUES
('abc123...', 'Authentication System', 'User signup, login, and session management', 'critical', 2, ARRAY['backend', 'security']),
('abc123...', 'Workout Management API', 'CRUD APIs for workout plans', 'high', 3, ARRAY['backend', 'api']),
('abc123...', 'Progress Tracking API', 'APIs for logging and retrieving progress data', 'medium', 4, ARRAY['backend', 'api']);

-- Frontend Epics
INSERT INTO roadmap_epics (roadmap_id, title, description, priority, position, tags) VALUES
('abc123...', 'Auth Screens', 'Login, signup, password reset UI', 'high', 5, ARRAY['frontend', 'auth']),
('abc123...', 'Workout Logging UI', 'Interface for logging workouts', 'high', 6, ARRAY['frontend', 'ui']),
('abc123...', 'Dashboard UI', 'Main dashboard with progress overview', 'medium', 7, ARRAY['frontend', 'ui']);

-- 4. Link Features to Milestones (instead of Epics)
-- This is the key change: Features are linked to Milestones for delivery tracking

-- First, create Features for the Epics (with roadmap_id)
INSERT INTO roadmap_features (roadmap_id, epic_id, title, description, position)
SELECT r.id, e.id, f.title, f.description, f.position
FROM roadmaps r
JOIN roadmap_epics e ON e.roadmap_id = r.id
CROSS JOIN (VALUES
  ('Define app structure', 'Create basic app structure and navigation', 0),
  ('Organize design assets', 'Set up design system and asset library', 1),
  ('Map user flows', 'Document all user journeys', 2)
) AS f(title, description, position)
WHERE r.name = 'Fitness Web App â€“ MVP'
AND e.title = 'Low-Fidelity Design';

INSERT INTO roadmap_features (roadmap_id, epic_id, title, description, position)
SELECT r.id, e.id, f.title, f.description, f.position
FROM roadmaps r
JOIN roadmap_epics e ON e.roadmap_id = r.id
CROSS JOIN (VALUES
  ('Polish login screens', 'Final login and signup designs', 0),
  ('Polish dashboard', 'Final dashboard visual design', 1)
) AS f(title, description, position)
WHERE r.name = 'Fitness Web App â€“ MVP'
AND e.title = 'High-Fidelity Design';

-- Now link Features to the Design Ready milestone
INSERT INTO milestone_features (milestone_id, feature_id, position)
SELECT m.id, f.id, f.position
FROM roadmap_milestones m
JOIN roadmap_features f ON f.roadmap_id = m.roadmap_id
WHERE m.title = 'Design Ready'
AND f.title IN (
  'Define app structure',
  'Organize design assets',
  'Map user flows',
  'Polish login screens',
  'Polish dashboard'
);

-- 5. Create Tasks for a Feature
INSERT INTO roadmap_tasks (feature_id, title, description, assignee_id, priority, position)
SELECT f.id, t.title, t.description, t.assignee_id, t.priority::task_priority, t.position
FROM roadmap_features f
CROSS JOIN (VALUES
  ('Create login screen wireframe', 'Design the login page layout', '550e8400-e29b-41d4-a716-446655440002', 'high', 0),
  ('Create dashboard wireframe', 'Design the main dashboard layout', '550e8400-e29b-41d4-a716-446655440002', 'high', 1),
  ('Create workout logging wireframe', 'Design the workout input interface', '550e8400-e29b-41d4-a716-446655440002', 'medium', 2)
) AS t(title, description, assignee_id, priority, position)
WHERE f.title = 'Define app structure';

-- 6. Query roadmap with progress
SELECT
  r.name,
  r.status,
  get_roadmap_progress(r.id) AS overall_progress,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'title', m.title,
        'target_date', m.target_date,
        'progress', get_milestone_progress(m.id)
      ) ORDER BY m.position
    )
    FROM roadmap_milestones m WHERE m.roadmap_id = r.id
  ) AS milestones
FROM roadmaps r
WHERE r.id = 'abc123...';
```

### Sample Query Results

**Roadmap Overview:**

```json
{
  "name": "Fitness Web App â€“ MVP",
  "status": "active",
  "overall_progress": 35.5,
  "milestones": [
    { "title": "Design Ready", "target_date": "2026-02-15", "progress": 80.0 },
    { "title": "Backend Ready", "target_date": "2026-03-10", "progress": 30.0 },
    {
      "title": "Frontend Ready",
      "target_date": "2026-03-25",
      "progress": 10.0
    },
    { "title": "MVP Launch", "target_date": "2026-04-01", "progress": 5.0 }
  ]
}
```

---

## UI Visualization

### Correct Mental Model

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    UI MENTAL MODEL                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

âœ— WRONG (Old Model):
  Milestone
   â””â”€â”€ Epic
       â””â”€â”€ Feature
           â””â”€â”€ Task

âœ“ CORRECT (New Model):
  Milestone
   â”œâ”€â”€ Feature (from Epic A)
   â”œâ”€â”€ Feature (from Epic B)
   â””â”€â”€ Feature (from Epic C)

  Epics appear as:
   â€¢ Swimlanes
   â€¢ Group headers / Color coding
   â€¢ Filters
   â€¢ Sidebar navigation
```

### Milestone View (Delivery-focused)

```
ðŸ“ Roadmap: Fitness Web App â€“ MVP
â”‚
â”œâ”€â”€ ðŸ” Milestone: Design Ready (Feb 15) â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘ 80%
â”‚   â”œâ”€â”€ ðŸ“‘ Define app structure (Epic: Low-Fi Design) â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ 100%
â”‚   â”‚   â”œâ”€â”€ âœ… Create login screen wireframe
â”‚   â”‚   â”œâ”€â”€ âœ… Create dashboard wireframe
â”‚   â”‚   â””â”€â”€ âœ… Create workout logging wireframe
â”‚   â”œâ”€â”€ ðŸ“‘ Map user flows (Epic: Low-Fi Design) â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ 100%
â”‚   â”‚   â”œâ”€â”€ âœ… Document signup flow
â”‚   â”‚   â””â”€â”€ âœ… Document workout logging flow
â”‚   â”œâ”€â”€ ðŸ“‘ Polish login screens (Epic: Hi-Fi Design) â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘ 60%
â”‚   â”‚   â”œâ”€â”€ âœ… Final login design
â”‚   â”‚   â””â”€â”€ â³ Final signup design
â”‚   â””â”€â”€ ðŸ“‘ Polish dashboard (Epic: Hi-Fi Design) â–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘ 25%
â”‚       â””â”€â”€ â³ Dashboard visual design
â”‚
â”œâ”€â”€ ðŸ” Milestone: Backend Ready (Mar 10) â–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘ 30%
â”‚   â”œâ”€â”€ ðŸ“‘ User registration API (Epic: Auth System)
â”‚   â”œâ”€â”€ ðŸ“‘ Login/logout API (Epic: Auth System)
â”‚   â”œâ”€â”€ ðŸ“‘ Create workout endpoint (Epic: Workout API)
â”‚   â””â”€â”€ ...
â”‚
â””â”€â”€ ðŸ” Milestone: MVP Launch (Apr 1) â–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘ 5%
    â””â”€â”€ ...
```

### Epic View (Work Organization)

```
ðŸ“¦ Epic: Low-Fidelity Design â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ 100%
â”‚  Tags: [design] [ui]
â”‚  Contributes to: Design Ready
â”‚
â”œâ”€â”€ ðŸ“‘ Feature: Define app structure
â”‚   â”œâ”€â”€ âœ… Create login screen wireframe
â”‚   â”œâ”€â”€ âœ… Create dashboard wireframe
â”‚   â””â”€â”€ âœ… Create workout logging wireframe
â”‚
â”œâ”€â”€ ðŸ“‘ Feature: Organize design assets
â”‚   â””â”€â”€ âœ… Set up design system
â”‚
â””â”€â”€ ðŸ“‘ Feature: Map user flows
    â”œâ”€â”€ âœ… Document signup flow
    â””â”€â”€ âœ… Document workout logging flow

ðŸ“¦ Epic: High-Fidelity Design â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘ 60%
â”‚  Tags: [design] [ui]
â”‚  Contributes to: Design Ready
â”‚
â”œâ”€â”€ ðŸ“‘ Feature: Polish login screens
â”‚   â”œâ”€â”€ âœ… Final login design
â”‚   â””â”€â”€ â³ Final signup design
â”‚
â””â”€â”€ ðŸ“‘ Feature: Polish dashboard
    â””â”€â”€ â³ Dashboard visual design
```

### Timeline View

```
Feb 1                Feb 15              Mar 10              Mar 25              Apr 1
  â”‚                    â”‚                   â”‚                   â”‚                   â”‚
  â”‚â”€â”€â”€â”€ Low-Fi Design â”€â”¼                   â”‚                   â”‚                   â”‚
  â”‚â”€â”€â”€â”€â”€â”€ High-Fi Design â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                   â”‚                   â”‚
  â”‚                    â”‚â”€â”€ Auth System â”€â”€â”€â”€â”¼                   â”‚                   â”‚
  â”‚                    â”‚â”€â”€ Workout API â”€â”€â”€â”€â”¼                   â”‚                   â”‚
  â”‚                    â”‚                   â”‚â”€â”€ Auth Screens â”€â”€â”€â”¼                   â”‚
  â”‚                    â”‚                   â”‚â”€â”€ Dashboard UI â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
  â”‚                    â”‚                   â”‚                   â”‚                   â”‚
  â”‚                    â–²                   â–²                   â–²                   â–²
  â”‚               Design Ready       Backend Ready      Frontend Ready       MVP Launch
  â”‚                   80%                30%                10%                  5%
```

---

## Why This Schema Works

| âœ… Benefit                      | Description                                                 |
| ------------------------------- | ----------------------------------------------------------- |
| **Feature-based delivery**      | Milestones track features (smallest deliverable), not epics |
| **Partial epic delivery**       | Features from one epic can span multiple milestones         |
| **Accurate progress**           | Milestone progress reflects actual delivered value          |
| **Clear ownership**             | Every item has an owner, assignee, or reporter              |
| **Clean data model**            | Normalized structure prevents data duplication              |
| **Denormalized where needed**   | `roadmap_id` in features avoids deep joins                  |
| **Timeline-compatible**         | Milestones with target dates enable Gantt-style views       |
| **Works for solo devs & teams** | Flexible assignment and collaboration                       |
| **Scales to real PM use**       | Supports enterprise-level project management                |
| **Progress tracking**           | Automatic calculation from bottom-up                        |
| **Trello-like cards**           | Tasks with comments, attachments, and checklists            |

### Key Design Decision: Features Linked to Milestones

The critical insight is that **milestones should track delivered features, not epics**:

| âŒ Old Model (Problematic)        | âœ… New Model (Correct)                   |
| --------------------------------- | ---------------------------------------- |
| `Milestone â†” Epic`                | `Milestone â†” Feature`                    |
| Epics are too large to be "done"  | Features are smallest deliverable unit   |
| Epic progress inflates milestones | Feature progress is accurate             |
| Can't do partial epic delivery    | Features from one epic â†’ many milestones |
| UI implies epics "belong" to MS   | Epics are structural containers only     |

---

## Migration Order

When implementing, create tables in this order to respect foreign key dependencies:

1. Custom types (enums)
2. `roadmaps`
3. `roadmap_milestones`
4. `roadmap_epics`
5. `roadmap_features` (requires roadmaps and roadmap_epics)
6. `milestone_features` (requires roadmap_milestones and roadmap_features)
7. `roadmap_tasks`
8. `task_comments`
9. `task_attachments`
10. Progress calculation functions
11. Views
12. RLS policies
13. Indexes
14. Triggers for `updated_at`

