# Schema Overview

> **Last updated:** 2026-08-28 · **Status:** current

The database is **Supabase Postgres 15**, and its source of truth is
[`supabase/migrations/`](../../supabase/migrations/) — **308 migration files** spanning
2025-12-11 → 2026-08-27 (recounted 2026-08-28; not every file is applied — see the note under
Money). This page is the current-state map: the domains, the main
tables, the enum vocabulary, and the foreign-key spine. It reflects the schema
*after* later drops/renames, not what any single migration created. For how
migrations are authored and applied, see [migrations-workflow.md](./migrations-workflow.md).

> **Reading the schema:** every user is a row in `profiles` (1:1 with Supabase
> `auth.users`); a `project` has one `roadmap`; a roadmap is a tree of
> `epics → features → tasks` with `milestones` linked to features. Authorization
> hangs off `project_access`.

## Tables by domain

### Identity & profile

| Table | Purpose |
| --- | --- |
| `profiles` | Core 24-column user record (1:1 `auth.users`); **no role or marketplace-capability flags**; carries identity, onboarding settings (`completed_at` only; `lane` is optional legacy data on historical rows), and guest fields |
| `admin_profiles` | Staff authority layer (`admin_access_level`) |
| `consultant_applications` | Applications to become a verified consultant |
| `consultant_profiles` | Stateful consultant enrollment (`pending`, `verified`, `suspended`, `revoked`), linked to the approving application when one exists; rows are retained as vetting history |
| `talent_profiles` | Stateful marketplace availability (`active`, `paused`); only active rows appear in the talent pool |
| `user_verifications`, `user_identity_documents` | KYC / trust records |
| `user_skills`, `user_languages`, `user_educations`, `user_certifications`, `user_licenses`, `user_experiences`, `user_portfolios`, `user_specializations`, `user_rate_settings`, `user_stats` | Profile sub-entities |
| `skills`, `languages` | Reference catalogs |

Full detail in [identity-vetting-model.md](./identity-vetting-model.md).

### Projects

| Table | Purpose |
| --- | --- |
| `projects` | Lean execution container (`project_status`). Key columns: `owner_id` (**NOT NULL** → `profiles`), `primary_team_id`, `currency`, and `duration`; marketplace/listing metadata does not live here |
| `personal_workspaces` | One-to-one identity link from a user to the project provisioned as their personal workspace; authorization still comes only from `project_access` |
| `project_access` | **Authorization source of truth** (renamed from `project_shares`); **exactly one row per (project, user)** since `20260507000130` → `share_role` + authorization-relevant `origin` + capabilities jsonb + `has_direct_grant` |
| `project_invites` | Email invite flow |
| `project_briefs` | Versioned structured brief; the project-creation description is stored as version 1 |
| `project_resource_folders`, `project_resource_links` | Resource hyperlinks |
| `project_activity_log` | Project audit trail (service-role writes) |

### Roadmaps

| Table | Purpose |
| --- | --- |
| `roadmaps` | One per project — `project_id` is `UNIQUE` (nullable since `20260210000001` for guest roadmaps) (`roadmap_status`) |
| `roadmap_milestones`, `roadmap_epics`, `roadmap_features`, `roadmap_tasks` | The graph (feature status is **derived in app code**, not a column) |
| `milestone_features` | M:N milestones ↔ features (delivery tracking) |
| `roadmap_task_assignees`, `roadmap_feature_assignees` | Multi-assignee joins |
| `task_comments`, `epic_comments`, `feature_comments`, `task_attachments`, `task_dependencies`, `task_activity_log` | Task/epic/feature extras |
| `feature_dependencies` | Finish→Start (schema-ready SS/FF) edges between features — the Timeline's arrows. `roadmap_id` is denormalised; a trigger enforces acyclicity and same-roadmap endpoints |
| `roadmap_shares` | Tokenized share config (`share_token`, `invited_emails` jsonb) |
| `roadmap_ai_sessions`, `roadmap_ai_messages`, `roadmap_ai_memories` | AI copilot state |

### Teams & time

| Table | Purpose |
| --- | --- |
| `teams`, `team_members`, `team_invites` | Reusable teams (incl. freeform `tags text[]` labels) + roster + invites |
| `project_teams`, `project_team_members` | Attach a team to a project; curation fans out to `project_access` via trigger |
| `team_member_rates` | Per-member (per-project) rate cards |
| `task_time_logs`, `time_log_comments` | Billable time logs + threads; project/task/member FKs sever with `SET NULL`, while member name and rates remain snapshotted |

### Money

| Table | Purpose |
| --- | --- |
| `wallets` | User balances (available + escrow) |
| `payout_methods`, `payouts` | The **active** money path — manual payouts grouping approved time logs |
| `invoices`, `invoice_line_items`, `invoice_documents` | Invoice generation + PDFs; terminal invoices survive project deletion with a project-title snapshot |
| `invoice_payments`, `invoice_events` | Payment recording/reversal and the invoice audit trail |
| `contracts` | The service agreement — one live row per project (partial unique index on `status ∈ (signed, active)`). `consultant_user_id` is a durable nullable FK to `consultant_profiles`; a null-safe check prevents a contract's client and consultant seats from matching. Terminal party columns are trigger-locked, terminal rows survive project deletion, and the row carries project/party snapshots plus `client_hourly_rate` (**client-facing**, never the internal cost rate), clauses, and services |
| `contract_signature_links` | Tokenized account-free client signing — 32 random bytes hex, single-use, 14-day expiry, at most one live link per contract |
| `finance_project_settings` | Company % vs team % revenue split and allocation mode per project (CHECK sums to 100) |
| `finance_member_allocations` | Each member's slice of a project's team pool — **internal, never reaches a client** |
| `finance_books` | Personal / team / project finance books; one `finance_books_shape_check` enforces the whole per-kind shape (`20260827100000_finance_books.sql`) |
| `finance_book_members` | Book membership: `finance_role` (`owner`/`manager`/`accountant`/`viewer_client`/`viewer`) plus a `capabilities` jsonb override; grants **no** execution access |
| `finance_invites` | Token invites into a book; `finance_role` excludes `owner` because ownership is implicit |
| `finance_documents`, `finance_document_snips` | Externally-created invoices/payments and the page regions evidencing each figure — **migration not applied to production** |

`teams.contract_enforcement` (`off`/`warn`/`enforce`, `20260827110000_timer_contract_enforcement.sql`)
gates timers on contract eligibility; `teams.time_tracking_enabled` is the add-on entitlement.

> **⚠️ Not everything in `supabase/migrations/` is applied.**
> `20260826090000_finance_document_imports.sql` appears in no applied version (verified
> 2026-08-28; newest applied are `20260827103415 finance_books` and
> `20260827104156 timer_contract_enforcement`), so `finance_documents`,
> `finance_document_snips`, `invoices.source_document_id`, `origin='imported'`, and the
> `invoice_payments` settlement columns **do not exist in production**. Separately,
> `20260724100000_create_contracts.sql` still declares `'active'` in `contracts_status_check`
> and in two partial indexes, which production no longer has — the checked-in file no longer
> reproduces the live contracts table.

### Engagements

Who hired whom: the commercial layer created by two-position contract signing
(`sign_contract_position_and_activate`). Every table has RLS enabled with **zero
policies** — deny-all; only the backend's `service_role` path reaches them, via
`EngagementsService`. No engagement table participates in authorization. Full
detail in [../14-engagement/data-model.md](../14-engagement/data-model.md).

| Table | Purpose |
| --- | --- |
| `contract_positions` | The two party seats on a contract (`hirer`/`provider`), identity snapshots, and per-seat signatures |
| `engagements` | The relationship record: `kind` (`client_services`/`talent_services`), `scope_mode`, `status` (`active`/`ended`/`cancelled`), activating contract |
| `engagement_parties` | Two rows per engagement — position, user, capacity, name/email snapshots |
| `engagement_project_links` | Which projects the relationship covers (`contract_scope` or `operational_assignment`); commercial attribution, never access |
| `engagement_time_settings` | Effective-dated time policy (tracking mode, approval mode, rounding, weekly cap) |
| `engagement_time_rates` | Effective-dated signed terms; `rate_kind` is `billing` on client engagements, `cost` on talent engagements — the two must never merge |
| `engagement_assignments` | Which worker performs which project work — **no writer yet** |
| `engagement_time_approvals`, `engagement_time_approval_items` | Talent submits, Consultant decides — **no writer yet** |

> **⚠️ Dead tables:** `payment_checkpoints` (initial schema) and `transactions`
> (escrow migration) were **dropped** on 2026-01-11 (`20260111000000_drop_old_project_tables.sql`)
> and never recreated. The dead backend surface and its remaining escrow RPCs were
> removed in Phase 3. The live financial flow is **payouts + invoices**; `wallets`
> remains because `create_wallet_for_user` is part of new-user provisioning. See
> [Backend → modules](../03-backend/modules.md).

### Collaboration

| Table | Purpose |
| --- | --- |
| `chat_rooms`, `chat_room_participants`, `chat_room_messages`, `chat_room_message_reactions`, `chat_room_stars` | Channels + DMs + reactions + stars |
| `notifications`, `notification_types` | In-app notifications + catalog. The `type_id` FK is **`ON DELETE RESTRICT`** — a new notification type needs a seed migration or `createNotification` 500s |
| `notification_preferences`, `notification_email_settings`, `notification_email_outbox`, `email_suppressions` | Email fan-out preferences, queue, and suppression list |
| `pending_mention_invites` | Pre-signup `@email` mention invites, reconciled on account creation |
| `device_tokens` | Push tokens per user |
| `meetings`, `meeting_series`, `meeting_participants` | Meetings + RRULE series + RSVP |

### Platform

| Table | Purpose |
| --- | --- |
| `mobile_app_bundles` | OTA bundle registry (`mobile_bundle_platform`, `mobile_bundle_status`) |
| `mcp_personal_access_tokens` | MCP PATs — sha256 hash + display prefix, scopes, `revoked_at` |
| `mcp_oauth_clients` | OAuth clients registered via RFC 7591 DCR (CIMD clients have no row) |
| `mcp_oauth_grants` | One row per (user, client) MCP connection — scopes, hashed rotating refresh token, `revoked_at` |
| Guests | No table — guests are `profiles` rows (`is_guest`), managed by RPCs |

## Enum vocabulary

The status/type language of the app is Postgres enums. The load-bearing ones:

| Enum | Values |
| --- | --- |
| `project_status` | draft, active, paused, completed, archived, bidding |
| `roadmap_status` | draft, active, paused, completed, archived |
| `epic_status` | backlog, planned, in_progress, in_review, completed, on_hold |
| `task_status` | todo, in_progress, in_review, done, blocked |
| `share_role` | viewer, commenter, editor, admin, owner |
| `meeting_status` | scheduled, cancelled, completed, rescheduled, no_show |
| `meeting_video_provider` | none, external_link, jitsi, google_meet |
| `application_status` | draft, submitted, under_review, approved, rejected |
| `admin_access_level` | support, moderator, super_admin |

Note `feature_status` was **dropped** (`20260514120000`) — feature status is now
derived from child task statuses in application code — and `account_role` was
**dropped with `profiles.role`** (`20260810160000`): there is no account-role enum.
Invoice/payout statuses are
text CHECK constraints, not enums (`invoices.status`: draft/issued/sent/paid/void;
`payouts.status`: recorded/void).

## Foreign-key spine

```
auth.users.id ─1:1─► profiles.id
profiles.id ─1:0..1─► consultant_profiles.user_id
profiles.id ─1:0..1─► talent_profiles.user_id
consultant_profiles.user_id ◄── contracts.consultant_user_id  (durable party seat, RESTRICT)
profiles.id ◄─ projects.owner_id
projects.id ◄─ project_access.project_id ─► profiles.id     (authorization)
projects.id ─1:1─► roadmaps.project_id
roadmaps.id ◄─ roadmap_epics ◄─ roadmap_features ◄─ roadmap_tasks
roadmap_milestones ◄─ milestone_features ─► roadmap_features   (M:N)
roadmap_tasks ◄─ task_time_logs ─► payouts (payout_id)       (severable task/project/member FKs)
teams.id ◄─ team_members ─► profiles ;  project_teams ─► projects
                └─ project_team_members ──(trigger)──► project_access
meetings ─► meeting_series ;  meetings ◄─ meeting_participants
```

## Key RPCs

Business logic that must be atomic lives in Postgres functions (SECURITY DEFINER):

| RPC | Role |
| --- | --- |
| `upsert_full_roadmap(id, owner, full_state jsonb, create_if_missing)` | Atomically persists an entire roadmap tree from a JSON candidate — the **AI-commit write path** |
| `create_payout_and_mark_paid`, `void_payout_and_revert` | Payout lifecycle |
| `sign_contract_and_flip` | Locks a contract, re-checks consultant enrollment, stamps a party, supersedes the prior live version, and derives signing status atomically; executable only by `service_role` |
| `create_guest_user`, `get_guest_user_id`, `cleanup_old_guest_users` | Guest sessions |
| `chat_latest_messages_by_room`, `chat_search_room_messages` | Chat reads |
| `handle_new_user()` | Trigger — creates a `profiles` row on signup |
| `get_user_project_role`, `can_view_roadmap`, `can_edit_roadmap` | Authorization helpers (see [rls-and-security.md](./rls-and-security.md)) |
| `is_active_consultant`, `is_active_talent` | RLS-safe marketplace enrollment predicates; both are `SECURITY DEFINER` and never query `profiles` |

## See also

- [migrations-workflow.md](./migrations-workflow.md) · [identity-vetting-model.md](./identity-vetting-model.md) · [rls-and-security.md](./rls-and-security.md)
- [Backend → modules](../03-backend/modules.md) for which module owns which tables.
