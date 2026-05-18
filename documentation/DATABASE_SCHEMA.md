# Database Schema Documentation

**Generated:** December 29, 2025  
**Source:** Supabase Local Database

## Overview

This document provides a comprehensive overview of the database schema for the Proyekto application. The database is built on PostgreSQL with Supabase and includes Row Level Security (RLS) policies for secure data access.

---

## Table of Contents

1. [Custom Types](#custom-types)
2. [Tables](#tables)
3. [Functions](#functions)
4. [Row Level Security Policies](#row-level-security-policies)
5. [Indexes](#indexes)

---

## Custom Types

### `channel_type`

Communication channel types for project messaging.

- `all-hands` - All project members
- `dev-team` - Development team only
- `direct` - Direct messages between two users

### `meeting_type`

Types of meetings that can be scheduled.

- `kickoff`
- `status_sync`
- `design_review`
- `qa`
- `scope_clarification`
- `retainer_sync`
- `client_consultant`
- `consultant_freelancer`

### `milestone_status`

Status of project milestones.

- `pending`
- `in_progress`
- `completed`

### `payment_status`

Payment checkpoint statuses.

- `pending`
- `completed`

### `persona_type`

User role types in the system.

- `client` - Project clients
- `freelancer` - Independent contractors
- `consultant` - Project consultants/managers
- `admin` - System administrators

### `project_status`

Project lifecycle statuses.

- `draft` - Initial creation
- `active` - Currently in progress
- `paused` - Temporarily halted
- `completed` - Finished
- `archived` - Archived for reference

### `work_item_status`

Status of individual work items.

- `not_started`
- `in_progress`
- `in_review`
- `completed`
- `blocked`

### `work_item_type`

Types of work items.

- `deliverable`
- `task`
- `asset`
- `issue`
- `bug`
- `setup`
- `integration`
- `design`
- `development`

---

## Tables

### `profiles`

User profile information linked to authentication.

| Column                     | Type                    | Description                                            |
| -------------------------- | ----------------------- | ------------------------------------------------------ |
| `id`                       | uuid (PK)               | User ID, references `auth.users.id`                    |
| `email`                    | text (unique, not null) | User email address                                     |
| `display_name`             | text                    | Display name                                           |
| `avatar_url`               | text                    | Profile picture URL                                    |
| `first_name`               | text                    | User's first name                                      |
| `last_name`                | text                    | User's last name                                       |
| `bio`                      | text                    | User biography                                         |
| `gender`                   | text                    | User's gender                                          |
| `phone_number`             | text                    | Contact phone number                                   |
| `country`                  | text                    | Country of residence                                   |
| `city`                     | text                    | City of residence                                      |
| `zip_code`                 | text                    | Postal code                                            |
| `date_of_birth`            | date                    | Date of birth                                          |
| `is_consultant_verified`   | boolean                 | Whether user is a verified consultant (default: false) |
| `is_email_verified`        | boolean                 | Whether email is verified (default: false)             |
| `active_persona`           | persona_type            | Current active role (default: freelancer)              |
| `has_completed_onboarding` | boolean                 | Onboarding completion flag (default: false)            |
| `settings`                 | jsonb                   | User settings including onboarding data (default: {})  |
| `created_at`               | timestamptz             | Profile creation timestamp                             |
| `updated_at`               | timestamptz             | Last update timestamp                                  |

**Notes:**

- `settings` JSONB structure: `{"onboarding": {"intent": {"freelancer": bool, "client": bool}, "completed_at": timestamp}}`
- Has an update trigger for `updated_at`

---

### `projects`

Main project records.

| Column          | Type                | Description                     |
| --------------- | ------------------- | ------------------------------- |
| `id`            | uuid (PK)           | Project ID                      |
| `title`         | text (not null)     | Project title                   |
| `brief`         | text                | Project description/brief       |
| `status`        | project_status      | Current status (default: draft) |
| `client_id`     | uuid (FK, not null) | References `profiles.id`        |
| `consultant_id` | uuid (FK)           | References `profiles.id`        |
| `created_at`    | timestamptz         | Creation timestamp              |
| `updated_at`    | timestamptz         | Last update timestamp           |

**Foreign Keys:**

- `client_id` â†’ `profiles.id` (ON DELETE CASCADE)
- `consultant_id` â†’ `profiles.id` (ON DELETE SET NULL)

---

### `project_members`

Project team membership.

| Column             | Type                | Description                      |
| ------------------ | ------------------- | -------------------------------- |
| `id`               | uuid (PK)           | Membership ID                    |
| `project_id`       | uuid (FK, not null) | References `projects.id`         |
| `user_id`          | uuid (FK, not null) | References `profiles.id`         |
| `role`             | text (not null)     | Member's role in project         |
| `permissions_json` | jsonb               | Custom permissions (default: {}) |
| `joined_at`        | timestamptz         | When member joined               |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `user_id` â†’ `profiles.id` (ON DELETE CASCADE)

**Unique Constraint:**

- `(project_id, user_id)` - One user per project

---

### `milestones`

Project milestones and checkpoints.

| Column        | Type                | Description                       |
| ------------- | ------------------- | --------------------------------- |
| `id`          | uuid (PK)           | Milestone ID                      |
| `project_id`  | uuid (FK, not null) | References `projects.id`          |
| `title`       | text (not null)     | Milestone title                   |
| `description` | text                | Detailed description              |
| `target_date` | timestamptz         | Target completion date            |
| `status`      | milestone_status    | Current status (default: pending) |
| `created_at`  | timestamptz         | Creation timestamp                |
| `updated_at`  | timestamptz         | Last update timestamp             |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)

---

### `work_items`

Individual work items, tasks, and deliverables.

| Column              | Type                      | Description                                |
| ------------------- | ------------------------- | ------------------------------------------ |
| `id`                | uuid (PK)                 | Work item ID                               |
| `project_id`        | uuid (FK, not null)       | References `projects.id`                   |
| `title`             | text (not null)           | Work item title                            |
| `description`       | text                      | Detailed description                       |
| `type`              | work_item_type (not null) | Type of work item                          |
| `status`            | work_item_status          | Current status (default: not_started)      |
| `assignee_id`       | uuid (FK)                 | References `profiles.id`                   |
| `is_client_visible` | boolean                   | Whether visible to client (default: false) |
| `due_date`          | timestamptz               | Due date                                   |
| `created_at`        | timestamptz               | Creation timestamp                         |
| `updated_at`        | timestamptz               | Last update timestamp                      |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `assignee_id` â†’ `profiles.id` (ON DELETE SET NULL)

---

### `payment_checkpoints`

Payment tracking for project milestones.

| Column         | Type                     | Description                       |
| -------------- | ------------------------ | --------------------------------- |
| `id`           | uuid (PK)                | Payment checkpoint ID             |
| `project_id`   | uuid (FK, not null)      | References `projects.id`          |
| `milestone_id` | uuid (FK)                | References `milestones.id`        |
| `amount`       | numeric(10,2) (not null) | Payment amount                    |
| `status`       | payment_status           | Payment status (default: pending) |
| `payer_id`     | uuid (FK, not null)      | References `profiles.id`          |
| `payee_id`     | uuid (FK, not null)      | References `profiles.id`          |
| `description`  | text                     | Payment description               |
| `completed_at` | timestamptz              | When payment was completed        |
| `created_at`   | timestamptz              | Creation timestamp                |
| `updated_at`   | timestamptz              | Last update timestamp             |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `milestone_id` â†’ `milestones.id` (ON DELETE SET NULL)
- `payer_id` â†’ `profiles.id` (ON DELETE CASCADE)
- `payee_id` â†’ `profiles.id` (ON DELETE CASCADE)

---

### `files`

File storage and version tracking.

| Column         | Type                | Description               |
| -------------- | ------------------- | ------------------------- |
| `id`           | uuid (PK)           | File ID                   |
| `project_id`   | uuid (FK, not null) | References `projects.id`  |
| `name`         | text (not null)     | File name                 |
| `storage_path` | text (not null)     | Path in storage           |
| `uploaded_by`  | uuid (FK, not null) | References `profiles.id`  |
| `version`      | integer             | File version (default: 1) |
| `file_size`    | bigint              | Size in bytes             |
| `mime_type`    | text                | MIME type                 |
| `created_at`   | timestamptz         | Upload timestamp          |
| `updated_at`   | timestamptz         | Last update timestamp     |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `uploaded_by` â†’ `profiles.id` (ON DELETE CASCADE)

---

### `meetings`

Scheduled meetings and calls.

| Column         | Type                    | Description               |
| -------------- | ----------------------- | ------------------------- |
| `id`           | uuid (PK)               | Meeting ID                |
| `project_id`   | uuid (FK, not null)     | References `projects.id`  |
| `title`        | text (not null)         | Meeting title             |
| `description`  | text                    | Meeting description       |
| `type`         | meeting_type (not null) | Type of meeting           |
| `scheduled_at` | timestamptz (not null)  | When meeting is scheduled |
| `meeting_url`  | text                    | Video call URL            |
| `created_by`   | uuid (FK, not null)     | References `profiles.id`  |
| `created_at`   | timestamptz             | Creation timestamp        |
| `updated_at`   | timestamptz             | Last update timestamp     |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `created_by` â†’ `profiles.id` (ON DELETE CASCADE)

---

### `chat_messages`

Project communication messages.

| Column         | Type                    | Description                                    |
| -------------- | ----------------------- | ---------------------------------------------- |
| `id`           | uuid (PK)               | Message ID                                     |
| `project_id`   | uuid (FK, not null)     | References `projects.id`                       |
| `channel_type` | channel_type (not null) | Communication channel                          |
| `sender_id`    | uuid (FK, not null)     | References `profiles.id`                       |
| `recipient_id` | uuid (FK)               | References `profiles.id` (for direct messages) |
| `content`      | text (not null)         | Message content                                |
| `created_at`   | timestamptz             | Creation timestamp                             |
| `updated_at`   | timestamptz             | Last update timestamp                          |

**Foreign Keys:**

- `project_id` â†’ `projects.id` (ON DELETE CASCADE)
- `sender_id` â†’ `profiles.id` (ON DELETE CASCADE)
- `recipient_id` â†’ `profiles.id` (ON DELETE CASCADE)

---

### `password_resets`

Secure password reset token storage.

| Column        | Type                   | Description                             |
| ------------- | ---------------------- | --------------------------------------- |
| `id`          | uuid (PK)              | Reset request ID                        |
| `email`       | text (not null)        | User email                              |
| `user_id`     | uuid                   | User ID                                 |
| `code_hash`   | text (not null)        | Hashed reset code                       |
| `salt`        | text (not null)        | Salt for hashing                        |
| `expires_at`  | timestamptz (not null) | Expiration time (default: now + 10 min) |
| `consumed_at` | timestamptz            | When code was used                      |
| `created_at`  | timestamptz (not null) | Creation timestamp                      |

**Notes:**

- Stores hashed password reset codes with expiry and consumption flags
- Codes expire in 10 minutes by default

---

## Functions

### `handle_new_user()`

**Trigger Function:** Executes on new user creation in `auth.users`

**Purpose:**

1. Auto-confirms user email
2. Creates a minimal profile in `public.profiles`

**Behavior:**

- Sets `email_confirmed_at` for new users
- Creates profile with user ID and email
- Uses `ON CONFLICT DO NOTHING` to prevent duplicates
- Logs warnings but doesn't fail signup on errors

---

### `update_updated_at_column()`

**Trigger Function:** Executes before UPDATE on multiple tables

**Purpose:** Automatically updates the `updated_at` timestamp

**Applied to:**

- `chat_messages`
- `files`
- `meetings`
- `milestones`
- `payment_checkpoints`
- `profiles`
- `projects`
- `work_items`

---

## Row Level Security Policies

All tables have RLS enabled. Below are the key policies:

### Profiles

- **Users can view own profile** - SELECT: `auth.uid() = id`
- **Users can insert own profile** - INSERT: `auth.uid() = id`
- **Users can update own profile** - UPDATE: `auth.uid() = id`

### Projects

- **Clients can create projects** - INSERT: `auth.uid() = client_id`
- **Project members can view projects** - SELECT: User is in `project_members`
- **Project owners can update projects** - UPDATE: `auth.uid() = client_id OR consultant_id`
- **Admin can delete projects** - DELETE: User has `admin` persona

### Project Members

- **Consultant can add members** - INSERT: User is project consultant
- **Consultant can remove members** - DELETE: User is project consultant
- **Consultant can update member roles** - UPDATE: User is project consultant
- **Project members can view team** - SELECT: User is project member

### Work Items

- **Consultant can create work items** - INSERT: User is project consultant
- **Project members can view work items** - SELECT: User is project member AND (item is client_visible OR user is not client)
- **Consultant and assignees can update** - UPDATE: User is consultant or assignee
- **Consultant can delete work items** - DELETE: User is project consultant

### Milestones

- **Consultant can create milestones** - INSERT: User is project consultant
- **Project members can view milestones** - SELECT: User is project member
- **Consultant can update milestones** - UPDATE: User is project consultant
- **Consultant can delete milestones** - DELETE: User is project consultant

### Payment Checkpoints

- **Consultant and admin can create payments** - INSERT: User is consultant or admin
- **Project members can view payments** - SELECT: User is project member
- **Consultant and admin can update payments** - UPDATE: User is consultant or admin

### Files

- **Project members can upload files** - INSERT: User is project member AND uploader
- **Project members can view files** - SELECT: User is project member
- **Uploader can update file metadata** - UPDATE: User is uploader
- **Consultant and uploader can delete files** - DELETE: User is consultant or uploader

### Meetings

- **Project members can create meetings** - INSERT: User is project member
- **Project members can view meetings** - SELECT: User is project member
- **Meeting creator can update meetings** - UPDATE: User is creator
- **Creator and consultant can delete meetings** - DELETE: User is creator or consultant

### Chat Messages

- **Project members can send chat by channel** - INSERT: User is project member AND sender, with channel-specific rules
- **Project members can view chat by channel** - SELECT: User is project member, with channel visibility rules
- **Users can update own messages** - UPDATE: User is sender
- **Users can delete own messages** - DELETE: User is sender

---

## Indexes

### Performance Indexes

**Projects:**

- `idx_projects_client` - ON `client_id`
- `idx_projects_consultant` - ON `consultant_id`
- `idx_projects_status` - ON `status`

**Project Members:**

- `idx_project_members_project` - ON `project_id`
- `idx_project_members_user` - ON `user_id`

**Work Items:**

- `idx_work_items_project` - ON `project_id`
- `idx_work_items_assignee` - ON `assignee_id`
- `idx_work_items_status` - ON `status`

**Milestones:**

- `idx_milestones_project` - ON `project_id`

**Payment Checkpoints:**

- `idx_payment_checkpoints_project` - ON `project_id`
- `idx_payment_checkpoints_payer` - ON `payer_id`
- `idx_payment_checkpoints_payee` - ON `payee_id`

**Files:**

- `idx_files_project` - ON `project_id`

**Meetings:**

- `idx_meetings_project` - ON `project_id`

**Chat Messages:**

- `idx_chat_messages_project` - ON `project_id`
- `idx_chat_messages_channel` - ON `channel_type`
- `idx_chat_messages_created` - ON `created_at`

**Password Resets:**

- `password_resets_email_idx` - ON `email`
- `password_resets_created_idx` - ON `created_at DESC`

---

## Entity Relationships

```
auth.users (Supabase Auth)
    â†“
profiles (1:1)
    â†“
projects (1:many) as client or consultant
    â†“
    â”œâ”€â”€ project_members (many:many with profiles)
    â”œâ”€â”€ milestones (1:many)
    â”‚   â””â”€â”€ payment_checkpoints (1:many)
    â”œâ”€â”€ work_items (1:many)
    â”œâ”€â”€ files (1:many)
    â”œâ”€â”€ meetings (1:many)
    â””â”€â”€ chat_messages (1:many)
```

---

## Key Features

1. **Multi-tenant Security:** All tables use Row Level Security policies based on user roles and project membership
2. **Flexible Personas:** Users can switch between client, freelancer, consultant, and admin roles
3. **Channel-based Chat:** Supports all-hands, dev-team only, and direct messaging
4. **Payment Tracking:** Milestone-based payment checkpoints with status tracking
5. **Work Item Visibility:** Granular control over what clients can see vs. internal team
6. **Automatic Timestamps:** Auto-updating `updated_at` fields on all main tables
7. **Onboarding Flow:** Built-in support for user onboarding with settings tracking

---

## Schema File

The complete SQL schema dump is available at: [database-schema.sql](database-schema.sql)

---

**Last Updated:** December 29, 2025

