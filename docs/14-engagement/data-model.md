# Engagement Data Model

> **Last updated:** 2026-08-16 · **Status:** implementation pending deployment

> **⚠️ Core schema applied; runtime migration authored but not applied.**
> `20260816090000_contract_positions_runtime.sql` activates the P4b contract path after
> deployment. Until then, existing runtime behavior continues to use the legacy contract,
> project, team-rate, and time-log paths.

The schema separates four facts that are easy to conflate: the legal relationship, its
parties, the projects where it is used, and the workers whose activity has commercial
meaning. Nullable links make adoption additive rather than reinterpreting historical rows.

## Core tables

### `engagements`

One durable bilateral commercial relationship. A signed root contract activates it;
amendments with unchanged parties remain in the same engagement.

| Column | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID PK | Engagement identity |
| `kind` | `client_services` or `talent_services` | Commercial direction |
| `scope_mode` | `project_specific` or `flexible` | Whether one contractual project is required |
| `status` | `active`, `ended`, or `cancelled` | Monotonic lifecycle state |
| `origin` | `contract` or `legacy` | How the relationship was established |
| `activated_by_contract_id` | Contract FK | Fully signed root contract that created it |
| `started_at` | Timestamp | Commercial start |
| `ended_at` | Nullable timestamp | Normal termination evidence |
| `cancelled_at` | Nullable timestamp | Cancellation evidence |
| `status_reason` | Nullable text | Human-readable lifecycle reason |
| `status_changed_by` | Nullable profile FK | Actor that ended or cancelled it |
| `created_by` | Nullable profile FK | Creation actor |
| `created_at`, `updated_at` | Timestamps | Audit timestamps |

`kind`, scope, origin, activating contract, creator, and start time are immutable. Active
engagements may only move to `ended` or `cancelled`; terminal rows are never reopened or
deleted.

### `engagement_parties`

Exactly two immutable seats per engagement.

| Column | Shape | Meaning |
| --- | --- | --- |
| `engagement_id` | Engagement FK, composite PK | Relationship |
| `position` | `hirer` or `provider`, composite PK | Commercial side |
| `user_id` | Profile FK | Account occupying the seat |
| `capacity` | `client`, `consultant`, or `talent` | Contextual capacity in this engagement |
| `display_name_snapshot` | Text | Durable signed identity label |
| `email_snapshot` | Nullable text | Durable signed contact snapshot |
| `created_at` | Timestamp | Seat creation time |

The database allows only these matrices:

| Engagement kind | Hirer | Provider |
| --- | --- | --- |
| `client_services` | Client | Consultant |
| `talent_services` | Consultant | Talent |

The same user cannot occupy both seats. Capacity is contextual and does not become an
account role.

### `engagement_project_links`

Records a contractual or operational association with a project and survives project
deletion through a title snapshot.

| Column | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID PK | Link identity |
| `engagement_id` | Engagement FK | Relationship being used |
| `project_id` | Nullable project FK | Live project; null after deletion |
| `project_title_snapshot` | Text | Durable display label |
| `basis` | `contract_scope` or `operational_assignment` | Why the link exists |
| `status` | `active` or `ended` | Link lifecycle |
| `linked_at`, `ended_at` | Timestamps | Active window |
| `status_reason` | Nullable text | End reason |
| `linked_by` | Nullable profile FK | Actor that created the link |
| `created_at`, `updated_at` | Timestamps | Audit timestamps |

A live `project_specific` engagement has exactly one active `contract_scope` link. A
`flexible` engagement has none; it gains `operational_assignment` links as work is placed.

### `engagement_assignments`

Attributes one worker's project work to the revenue side, the cost side, or both. It does
not grant access.

| Column | Shape | Meaning |
| --- | --- | --- |
| `id` | UUID PK | Assignment identity |
| `project_id` | Nullable project FK | Live project; null after deletion |
| `project_title_snapshot` | Text | Durable project label |
| `worker_user_id` | Profile FK | Person performing the work |
| `client_engagement_id` | Nullable engagement FK | Client revenue context |
| `talent_engagement_id` | Nullable engagement FK | Talent cost context |
| `team_id` | Nullable team FK | Execution team context |
| `team_name_snapshot` | Nullable text | Durable team label |
| `role_title` | Nullable text | Assignment-specific work label |
| `status` | `active`, `ended`, or `cancelled` | Assignment lifecycle |
| `started_at`, `ended_at` | Timestamps | Permitted work window |
| `status_reason` | Nullable text | Terminal reason |
| `assigned_by` | Nullable profile FK | Assignment actor |
| `created_at`, `updated_at` | Timestamps | Audit timestamps |

At least one engagement context is required. When `talent_engagement_id` is set, the
worker must be its Talent provider. Without a Talent engagement, the worker must be the
Consultant provider of the client engagement.

### `contract_positions`

Generic hirer/provider seats for each contract version. This is the target replacement for
contract columns tied to Client/Consultant terminology.

| Column | Shape | Meaning |
| --- | --- | --- |
| `contract_id` | Contract FK, composite PK | Contract version |
| `position` | `hirer` or `provider`, composite PK | Signing side |
| `user_id` | Profile FK | Seat occupant |
| `capacity` | `client`, `consultant`, or `talent` | Contextual capacity |
| identity snapshots | Name and email | Signed identity evidence |
| signature fields | Name, URL, scale, offsets, `signed_at` | Signature evidence and placement |
| `created_at`, `updated_at` | Timestamps | Audit timestamps |

The allowed position matrix mirrors `engagement_parties`. Existing contracts receive no
position backfill. The P4b runtime writes both generic seat evidence and the legacy
compatibility signature fields; it does not infer positions for historical contracts.

## Commercial time tables

### `engagement_time_settings`

Effective-dated projection of time rules from a signed contract.

| Column group | Columns | Meaning |
| --- | --- | --- |
| Source | `engagement_id`, `source_contract_id` | Relationship and signed version authorizing the rules |
| Tracking | `tracking_mode`, `allow_manual_entries` | Disabled, optional, or required tracking and manual-entry permission |
| Approval | `approval_mode` | None, or Talent submits and Consultant approves |
| Calculation | `rounding_minutes`, `weekly_limit_minutes` | Contractual time constraints |
| Client evidence | `client_hours_detail_level` | None, summary, or detailed; never exposes Talent cost |
| Window | `effective_from`, `effective_until` | Non-overlapping effective dates |
| Audit | `created_by`, timestamps | Creation evidence |

Talent engagements require `provider_submit_hirer_approve` and expose no Client detail.
Client engagements do not use the Talent approval workflow.

### `engagement_time_rates`

Effective-dated billing or cost terms projected from a signed contract.

| Column | Shape | Meaning |
| --- | --- | --- |
| `engagement_id` | Engagement FK | Priced relationship |
| `source_contract_id` | Contract FK | Signed version authorizing the rate |
| `worker_user_id` | Nullable profile FK | Optional provider-specific rate |
| `rate_kind` | `billing` or `cost` | Revenue-side or Talent-side rate |
| `unit` | `hour`, `month`, or `fixed` | Compensation unit |
| `work_type` | Nullable `real_work` or `training` | Optional rate category |
| `amount`, `currency` | Numeric + text | Contractual amount |
| `effective_from`, `effective_until` | Dates | Non-overlapping effective window |
| timestamps | Timestamps | Audit timestamps |

Client-services engagements contain billing rates. Talent-services engagements contain
cost rates. A new signed amendment closes an old effective row and creates a new one; it
never rewrites historical snapshots.

### `engagement_time_approvals`

One Talent submission for a date period.

| Column group | Columns | Meaning |
| --- | --- | --- |
| Identity | `id`, `engagement_id`, `worker_user_id`, period | Unique Talent period submission |
| State | `status` | Draft, submitted, approved, rejected, or reopened |
| Submission | `submitted_by`, `submitted_at` | Must be the Talent provider |
| Review | `reviewed_by`, `reviewed_at`, `review_note` | Must be the Consultant hirer |
| Audit | `created_by`, timestamps | Creation evidence |

### `engagement_time_approval_items`

Freezes exactly which logs and monetary snapshots a decision covers.

| Column | Meaning |
| --- | --- |
| `approval_id`, `time_log_id` | Composite identity linking a submission to a raw log |
| `payable_duration_seconds` | Approved duration after contractual rounding/limits |
| `rate_amount_snapshot`, `rate_unit_snapshot` | Rate used for this decision |
| `currency_snapshot`, `amount_snapshot` | Durable payable value |
| `created_at` | Item creation time |

Items can change only while the approval is draft or reopened. Submitted and decided
evidence is locked.

## Additions to existing tables

| Existing table | New nullable/additive fields | Purpose |
| --- | --- | --- |
| `contracts` | `relationship_kind`, `scope_mode`, `contract_family_id`, `engagement_id`, `fixed_fee`, time-policy fields | Direction, scope, amendment family, governed relationship, commercial price, and the time policy projected at final signing |
| `invoices` | `engagement_id` | Client-services revenue side |
| `payouts` | `engagement_id` | Talent-services cost side |
| `task_time_logs` | `engagement_assignment_id` | Exact worker/project commercial attribution |

Existing contracts receive deterministic `client_services` and `project_specific`
defaults, but no engagement, party, position, invoice, payout, or time-log relationship is
fabricated. Null link columns are an explicit compatibility state: the record follows the
existing legacy or internal path and must not be assigned an engagement by inference.

## Security and deletion behavior

| Rule | Enforcement |
| --- | --- |
| Direct browser access | RLS enabled with no `anon` or `authenticated` policies |
| Backend access | Service-role only until redacted APIs exist |
| Execution authorization | Always `project_access`; commercial tables grant nothing |
| Engagement deletion | Forbidden |
| Party deletion or mutation | Forbidden |
| Project deletion | Project FKs become null; snapshots and financial history survive |
| Account deletion | Restrictive legal-party/worker FKs preserve attribution; identity snapshots remain |
