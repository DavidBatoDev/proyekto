# Modules

> **Last updated:** 2026-07-09 · **Status:** current

The backend is **24 feature modules** under
[`backend/src/modules/`](../../backend/src/modules/), each self-contained
(controller → service → repository). This page is the inventory: purpose, the
tables each owns, and notable dependencies. Table names are verified from the
actual `.from('…')` calls — the identity domain uses **`user_*`** tables (the only
`consultant_*` table is `consultant_applications`), and file storage is **Cloudflare
R2**, not Supabase Storage.

## At a glance

| Module | Purpose | Key tables |
| --- | --- | --- |
| `auth` | Auth + first-login bootstrap (profile, workspace, teams) | `profiles` |
| `users` | Own-account read/update | `profiles` |
| `profile` | Full consultant/freelancer profile + all sub-entities | `profiles`, `user_*` |
| `projects` | Projects, access/membership, invites, resources | `projects`, `project_access`, `project_invites`, `project_resource_*` |
| `roadmaps` | Roadmap graph engine **+** roadmap AI | `roadmap_*`, `roadmap_ai_*`, comments/attachments |
| `roadmap-shares` | Public/tokenized share links + shared commenting | `roadmap_shares`, `roadmap_share_access` |
| `teams` | Teams, members, invites, project-team assignment, rates | `teams`, `team_members`, `team_invites`, `project_teams`, `team_member_rates` |
| `team-time` | Billable time logs + comments | `task_time_logs`, `time_log_comments` |
| `consultants` | Public consultant directory | `profiles` |
| `applications` | Consultant/freelancer application submission | `consultant_applications` |
| `marketplace` | Freelancer discovery + hiring invites | `profiles`, `user_*`, `project_invites` |
| `guests` | Anonymous guest sessions | `profiles`, `roadmaps` |
| `admin` | Admin console — vetting, roles, matchmaking | `admin_profiles`, `consultant_applications`, `user_*` |
| `payments` | Milestone/escrow payments + wallet ledger | `payment_checkpoints`, `wallets`, `transactions` |
| `payouts` | Payout methods + payout requests | `payout_methods`, `payouts` |
| `invoices` | Invoice generation with line items | `invoices`, `invoice_line_items`, `invoice_documents` |
| `meetings` | Meetings + recurring series + reminders | `meetings`, `meeting_series`, `meeting_participants` |
| `chat` | Project channels, DMs, reactions, activity feed | `chat_rooms`, `chat_room_*` |
| `notifications` | In-app notifications; fans out to push | `notifications`, `notification_types` |
| `push` | Device-token registration + FCM dispatch | `device_tokens` |
| `mobile-updates` | OTA app-bundle registry / update checks | `mobile_app_bundles` |
| `uploads` | File uploads → Cloudflare R2 (public/private) | *(none — R2 + reads `profiles`/`projects`)* |
| `realtime` | Room-join authorize + event publisher | *(none — HTTP to the Worker)* |
| `audit` | Central project activity/audit log | `project_activity_log` |

## Identity & accounts

**`auth`** — Supabase-backed auth (session + email OTP) and new-user bootstrapping:
on first login it creates the `profiles` row, a personal workspace, and default
teams. Imports `ProjectsModule`, `ProfileModule`, `TeamsModule`. Files:
`auth.service.ts`, `email-otp.service.ts`.

**`users`** — thin own-account CRUD over `profiles` (`GET/PATCH /users/me`, plus a
public `GET /users/:id`).

**`profile`** — the largest identity module. Owns the `profiles` row **and** every
sub-entity, each in its own `user_*` table: `user_skills`, `user_languages`,
`user_educations`, `user_certifications`, `user_licenses`, `user_experiences`,
`user_portfolios`, `user_stats`, `user_specializations`, `user_rate_settings`,
`user_identity_documents` — plus catalog tables `skills`, `languages`.
`freelancer-eligibility.service.ts` gates who can go live.

**`consultants`** — public read-only directory over `profiles` (no repository).

**`applications`** — consultant/freelancer application submit + status; writes
`consultant_applications`. Its `ApplicationsService` is co-located in the controller file.

**`admin`** — the admin console: reviews `consultant_applications`, reads full
identity (all `user_*` tables), manages `admin_profiles`, and runs matchmaking.

**`guests`** — anonymous read access to shared `profiles`/`roadmaps` and guest-user
creation; `GuestsService` is co-located in the controller.

## Projects & roadmaps

**`projects`** — projects, `project_access` (membership/roles), `project_invites`,
and project resource folders/links. Nests two sub-modules: `authorization/`
(`ProjectAuthorizationService` + `MissingPermissionException`) and `access-sync/`.
Imports `NotificationsModule`, `TeamsModule` (forwardRef), `ChatModule`.

**`roadmaps`** — the biggest module: the roadmap graph (roadmaps → epics →
features/milestones → tasks, with comments, assignees, dependencies, attachments)
**and** the AI assistant (sessions, messages, memories, metadata/title generation,
JSON-patch application). 9 controllers, ~15 services. Tables: `roadmap_epics`,
`roadmap_features`, `roadmap_milestones`, `roadmap_tasks`, `roadmap_*_assignees`,
`milestone_features`, `epic_comments`/`feature_comments`/`task_comments`,
`task_attachments`, `task_dependencies`, `task_activity_log`, `roadmap_ai_sessions`,
`roadmap_ai_messages`, `roadmap_ai_memories`. The patch repository persists the
whole graph atomically via the RPC `upsert_full_roadmap` (no `.from()`). See
[Agent & Roadmap AI](../05-agent-ai/README.md).

**`roadmap-shares`** — tokenized public share links (`roadmap_shares`,
`roadmap_share_access`) and commenting on shared epics/features.

## Teams, time & money

**`teams`** — teams, `team_members`, `team_invites`, project-team attachment
(`project_teams`, `project_team_members`), and per-member `team_member_rates`.
3 controllers.

**`team-time`** — task time logs (`task_time_logs`) + `time_log_comments`, with
rate resolution for billing.

**`payments`** — milestone/checkpoint payments plus an internal wallet ledger
(`payment_checkpoints`, `wallets`, `transactions`) — fund/release/refund escrow.

**`payouts`** — freelancer payout methods (`payout_methods`) and payout requests
(`payouts`) aggregating billable time; proof documents go to the **private R2
bucket** via `UploadsModule`.

**`invoices`** — invoice generation with line items and attached documents
(`invoices`, `invoice_line_items`, `invoice_documents`), sourced from `task_time_logs`.

## Collaboration

**`meetings`** — meetings + recurring series + participants/RSVP with server-side
RRULE expansion; imports `NotificationsModule` + `AuthorizationModule`. Full
dedicated docs at [Feature Domains → Meetings](../11-domains/README.md).

**`chat`** — project channels, direct messages, reactions, stars, and an activity
feed (4 controllers). Tables `chat_rooms`, `chat_room_participants`,
`chat_room_messages`, `chat_room_message_reactions`, `chat_room_stars`. Publishes
via the global `RealtimePublisher`.

**`notifications`** — creates/reads in-app notifications (`notifications`,
`notification_types`) and fans out to `push`.

**`push`** — device-token registration (`device_tokens`) and FCM dispatch;
`notification-push.ts` bridges notifications → FCM.

**`realtime`** — two concerns, no tables: `RealtimeController` `POST
/realtime/authorize` (the Worker calls it to gate room joins by reusing REST
authorization), and the `@Global` `RealtimePublisher` that POSTs events to the
Worker's `/publish`. See [Realtime](../06-realtime/README.md).

**`audit`** — a `@Global` `AuditService` writing `project_activity_log`, injected
across modules.

## Platform

**`uploads`** — file uploads and presigned URLs backed by **Cloudflare R2** (S3
SDK), not Supabase Storage. Routes `PRIVATE_BUCKETS` (`identity_documents`,
`payout_proofs`) to the private bucket (presigned GET only); everything else
(e.g. `avatars`) is public over `cdn.proyekto.tech`. `UploadsService` is co-located
in the controller and exported to `payouts`. See [Storage & Media](../08-storage-media/README.md).

**`marketplace`** — freelancer discovery drawing on profile sub-entities
(`user_rate_settings`, `user_stats`, `user_specializations`, `user_skills`) and the
hiring flow (`project_invites`). Consultant-only routes use `ConsultantOnlyGuard`.

**`mobile-updates`** — OTA app-bundle registry (`mobile_app_bundles`) and Capgo-style
update checks; CI registration guarded by `OtaPublishGuard`. See
[Mobile → OTA updates](../09-mobile/README.md).

## Structural notes

- **Co-located services** (no separate `*.service.ts`): `uploads`, `applications`, `guests`.
- **No repository** (service queries Supabase directly): `consultants`, `marketplace`, `notifications`.
- **No tables**: `realtime`, `audit` writes only `project_activity_log`; `uploads` writes no Postgres table.
- **RPC persistence**: `roadmap-patch` uses `upsert_full_roadmap` rather than `.from()`.
- **Global modules**: `SupabaseModule`, `RedisModule`, `R2Module`,
  `RealtimePublisherModule`, `AuditModule`.

For the HTTP routes each module exposes, see [api-reference.md](./api-reference.md).
