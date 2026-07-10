# Schema Overview

> **Last updated:** 2026-07-09 · **Status:** current

The database is **Supabase Postgres 15**, and its source of truth is
[`supabase/migrations/`](../../supabase/migrations/) — **165 migrations** spanning
2025-12-11 → 2026-07-08. This page is the current-state map: the domains, the main
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
| `profiles` | Core user record (1:1 `auth.users`); `active_persona`, verification flags, guest fields |
| `admin_profiles` | Staff authority layer (`admin_access_level`) |
| `consultant_applications` | Applications to become a verified consultant |
| `user_verifications`, `user_identity_documents` | KYC / trust records |
| `user_skills`, `user_languages`, `user_educations`, `user_certifications`, `user_licenses`, `user_experiences`, `user_portfolios`, `user_specializations`, `user_rate_settings`, `user_stats` | Profile sub-entities |
| `skills`, `languages` | Reference catalogs |

Full detail in [identity-vetting-model.md](./identity-vetting-model.md).

### Projects

| Table | Purpose |
| --- | --- |
| `projects` | Top-level project (`project_status`) |
| `project_access` | **Authorization source of truth** (renamed from `project_shares`); one row per (project, user) → `share_role` + capabilities jsonb |
| `project_invites` | Email invite flow |
| `project_briefs` | Structured brief (mission/vision, summary) |
| `project_resource_folders`, `project_resource_links` | Resource hyperlinks |
| `project_activity_log` | Project audit trail (service-role writes) |

### Roadmaps

| Table | Purpose |
| --- | --- |
| `roadmaps` | One per project (`roadmap_status`) |
| `roadmap_milestones`, `roadmap_epics`, `roadmap_features`, `roadmap_tasks` | The graph (feature status is **derived in app code**, not a column) |
| `milestone_features` | M:N milestones ↔ features (delivery tracking) |
| `roadmap_task_assignees`, `roadmap_feature_assignees` | Multi-assignee joins |
| `task_comments`, `epic_comments`, `feature_comments`, `task_attachments`, `task_dependencies`, `task_activity_log` | Task/epic/feature extras |
| `roadmap_shares` | Tokenized share config (`share_token`, `invited_emails` jsonb) |
| `roadmap_ai_sessions`, `roadmap_ai_messages`, `roadmap_ai_memories` | AI copilot state |

### Teams & time

| Table | Purpose |
| --- | --- |
| `teams`, `team_members`, `team_invites` | Reusable teams + roster + invites |
| `project_teams`, `project_team_members` | Attach a team to a project; curation fans out to `project_access` via trigger |
| `team_member_rates` | Per-member (per-project) rate cards |
| `task_time_logs`, `time_log_comments` | Billable time logs + threads |

### Money

| Table | Purpose |
| --- | --- |
| `wallets` | User balances (available + escrow) |
| `payout_methods`, `payouts` | The **active** money path — manual payouts grouping approved time logs |
| `invoices`, `invoice_line_items`, `invoice_documents` | Invoice generation + PDFs |

> **⚠️ Dead tables:** `payment_checkpoints` (initial schema) and `transactions`
> (escrow migration) were **dropped** on 2026-01-11 (`20260111000000_drop_old_project_tables.sql`)
> and never recreated. The `payments` module's checkpoint/escrow code still queries
> them and would fail at runtime — it's vestigial. The live financial flow is
> **payouts + invoices** (with `wallets` for balances). See
> [Backend → modules](../03-backend/modules.md).

### Collaboration

| Table | Purpose |
| --- | --- |
| `chat_rooms`, `chat_room_participants`, `chat_room_messages`, `chat_room_message_reactions`, `chat_room_stars` | Channels + DMs + reactions + stars |
| `notifications`, `notification_types` | In-app notifications + catalog |
| `device_tokens` | Push tokens per user |
| `meetings`, `meeting_series`, `meeting_participants` | Meetings + RRULE series + RSVP |

### Platform

| Table | Purpose |
| --- | --- |
| `mobile_app_bundles` | OTA bundle registry (`mobile_bundle_platform`, `mobile_bundle_status`) |
| Guests | No table — guests are `profiles` rows (`is_guest`), managed by RPCs |

## Enum vocabulary

The status/type language of the app is Postgres enums. The load-bearing ones:

| Enum | Values |
| --- | --- |
| `persona_type` | client, freelancer, consultant, admin |
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
derived from child task statuses in application code. Invoice/payout statuses are
text CHECK constraints, not enums (`invoices.status`: draft/issued/sent/paid/void;
`payouts.status`: recorded/void).

## Foreign-key spine

```
auth.users.id ─1:1─► profiles.id
profiles.id ◄─ projects.client_id / consultant_id
projects.id ◄─ project_access.project_id ─► profiles.id     (authorization)
projects.id ─1:1─► roadmaps.project_id
roadmaps.id ◄─ roadmap_epics ◄─ roadmap_features ◄─ roadmap_tasks
roadmap_milestones ◄─ milestone_features ─► roadmap_features   (M:N)
roadmap_tasks ◄─ task_time_logs ─► payouts (payout_id)
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
| `create_guest_user`, `get_guest_user_id`, `cleanup_old_guest_users` | Guest sessions |
| `chat_latest_messages_by_room`, `chat_search_room_messages` | Chat reads |
| `handle_new_user()` | Trigger — creates a `profiles` row on signup |
| `get_user_project_role`, `can_view_roadmap`, `can_edit_roadmap` | Authorization helpers (see [rls-and-security.md](./rls-and-security.md)) |
| `fund_escrow`, `release_milestone`, `refund_escrow` | **Legacy/dead** — reference the dropped `payment_checkpoints` |

## See also

- [migrations-workflow.md](./migrations-workflow.md) · [identity-vetting-model.md](./identity-vetting-model.md) · [rls-and-security.md](./rls-and-security.md)
- [Backend → modules](../03-backend/modules.md) for which module owns which tables.
