# Database Tables Reference

**Generated:** December 29, 2025  
**Source:** Supabase Local Database

This document provides a quick reference for all database tables in the Proyekto application.

---

## Tables Overview

1. [profiles](#profiles) - User profile information
2. [wallets](#wallets) - User wallet balances (available + escrow) **NEW**
3. [transactions](#transactions) - Financial transaction ledger **NEW**
4. [projects](#projects) - Main project records
5. [project_members](#project_members) - Project team membership
6. [milestones](#milestones) - Project milestones
7. [work_items](#work_items) - Tasks and deliverables
8. [payment_checkpoints](#payment_checkpoints) - Payment tracking
9. [files](#files) - File storage and versioning
10. [meetings](#meetings) - Scheduled meetings
11. [chat_messages](#chat_messages) - Project communication
12. [password_resets](#password_resets) - Password reset tokens

---

## profiles

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

**Foreign Keys:**

- `id` â†’ `auth.users.id` (ON DELETE CASCADE)

**Notes:**

- `settings` JSONB structure: `{"onboarding": {"intent": {"freelancer": bool, "client": bool}, "completed_at": timestamp}}`
- Has an update trigger for `updated_at`

---

## wallets

User wallet balances for escrow system.

| Column              | Type                        | Description                                           |
| ------------------- | --------------------------- | ----------------------------------------------------- |
| `id`                | uuid (PK)                   | Wallet ID                                             |
| `user_id`           | uuid (FK, unique, not null) | References `profiles.id`                              |
| `available_balance` | numeric(12,2)               | Funds available for withdrawal or escrow (CHECK >= 0) |
| `escrow_balance`    | numeric(12,2)               | Funds locked in active projects (CHECK >= 0)          |
| `currency`          | text                        | ISO 4217 currency code (default: USD)                 |
| `created_at`        | timestamptz                 | Wallet creation timestamp                             |
| `updated_at`        | timestamptz                 | Last update timestamp                                 |

**Foreign Keys:**

- `user_id` â†’ `profiles.id` (ON DELETE CASCADE)

**Notes:**

- One wallet per user (enforced by UNIQUE constraint)
- CHECK constraints prevent negative balances
- Auto-created when user signs up
- Has an update trigger for `updated_at`

---

## transactions

Double-entry ledger for all fund movements (immutable audit trail).

| Column          | Type                | Description                                                           |
| --------------- | ------------------- | --------------------------------------------------------------------- |
| `id`            | uuid (PK)           | Transaction ID                                                        |
| `wallet_id`     | uuid (FK, not null) | References `wallets.id`                                               |
| `project_id`    | uuid (FK)           | References `projects.id`                                              |
| `checkpoint_id` | uuid (FK)           | References `payment_checkpoints.id`                                   |
| `amount`        | numeric(12,2)       | Transaction amount (positive = credit, negative = debit)              |
| `type`          | transaction_type    | Type of transaction                                                   |
| `description`   | text                | Human-readable description                                            |
| `metadata`      | jsonb               | Extensible field for gateway IDs, payment methods, etc. (default: {}) |
| `created_at`    | timestamptz         | Transaction timestamp                                                 |

**Foreign Keys:**

- `wallet_id` â†’ `wallets.id` (ON DELETE CASCADE)
- `project_id` â†’ `projects.id` (ON DELETE SET NULL)
- `checkpoint_id` â†’ `payment_checkpoints.id` (ON DELETE SET NULL)

**Transaction Types:**

- `deposit` - Funds added to platform (future: Stripe/PayPal)
- `withdrawal` - Funds removed from platform (future: Stripe/PayPal)
- `escrow_lock` - Client funds locked for a milestone
- `escrow_release` - Funds released from escrow
- `escrow_refund` - Escrowed funds returned to client
- `platform_fee` - Platform fee deduction
- `consultant_fee` - Consultant management fee
- `freelancer_payout` - Payment to freelancer

**Notes:**

- Immutable records (no UPDATE/DELETE for users)
- Positive amounts = credits to wallet
- Negative amounts = debits from wallet
- `metadata` JSONB prepared for Stripe/PayPal: `{"stripe_payment_intent_id": "pi_xxx", "payment_method": "card"}`

---

## projects

Main project records.

| Column                   | Type                | Description                                |
| ------------------------ | ------------------- | ------------------------------------------ |
| `id`                     | uuid (PK)           | Project ID                                 |
| `title`                  | text (not null)     | Project title                              |
| `brief`                  | text                | Project description/brief                  |
| `status`                 | project_status      | Current status (default: draft)            |
| `client_id`              | uuid (FK, not null) | References `profiles.id`                   |
| `consultant_id`          | uuid (FK)           | References `profiles.id`                   |
| `platform_fee_percent`   | numeric(5,2)        | Platform fee percentage (default: 10.00)   |
| `consultant_fee_percent` | numeric(5,2)        | Consultant fee percentage (default: 15.00) |
| `created_at`             | timestamptz         | Creation timestamp                         |
| `updated_at`             | timestamptz         | Last update timestamp                      |

**Foreign Keys:**

- `client_id` â†’ `profiles.id` (ON DELETE CASCADE)
- `consultant_id` â†’ `profiles.id` (ON DELETE SET NULL)

**Status Values:**

- `draft` - Initial creation
- `active` - Currently in progress
- `paused` - Temporarily halted
- `completed` - Finished
- `archived` - Archived for reference

---

## project_members

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

## milestones

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

**Status Values:**

- `pending`
- `in_progress`
- `completed`

---

## work_items

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

**Type Values:**

- `deliverable`, `task`, `asset`, `issue`, `bug`, `setup`, `integration`, `design`, `development`

**Status Values:**

- `not_started`, `in_progress`, `in_review`, `completed`, `blocked`

---

## payment_checkpoints

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

**Status Values:**

- `pending`
- `completed`

---

## files

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

## meetings

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

**Type Values:**

- `kickoff`, `status_sync`, `design_review`, `qa`, `scope_clarification`, `retainer_sync`, `client_consultant`, `consultant_freelancer`

---

## chat_messages

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

**Channel Types:**

- `all-hands` - All project members
- `dev-team` - Development team only
- `direct` - Direct messages between two users

---

## password_resets

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

## Entity Relationships

```
auth.users (Supabase Auth)
    â†“
profiles (1:1)
    â†“
    â”œâ”€â”€ wallets (1:1) â† NEW
    â”‚   â””â”€â”€ transactions (1:many) â† NEW
    â””â”€â”€ projects (1:many) as client or consultant
        â†“
        â”œâ”€â”€ project_members (many:many with profiles)
        â”œâ”€â”€ milestones (1:many)
        â”‚   â””â”€â”€ payment_checkpoints (1:many)
        â”‚       â””â”€â”€ transactions (1:many) â† NEW
        â”œâ”€â”€ work_items (1:many)
        â”œâ”€â”€ files (1:many)
        â”œâ”€â”€ meetings (1:many)
        â””â”€â”€ chat_messages (1:many)
```

---

**For complete schema details including RLS policies, indexes, and functions, see:** [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)

