# Chat

> **Last updated:** 2026-08-18 · **Status:** current

Project-scoped chat: flexible **channels**, **direct messages**, reactions, stars,
and a per-project **activity feed**. It's Slack-style — channels are created per
project, some are system rooms, and access is derived from project membership.
Message events push live to connected clients via the realtime Worker.

## What it does

- **Channels** — create/rename channels within a project; manage members; leave.
  Some are **system rooms** (identified by `system_key`, lazily joined); others are ad-hoc.
- **Direct messages** — 1:1 DMs resolved on demand between eligible members.
- **Messages** — send, edit, unsend, react (emoji), reply, attachments, mentions;
  mark-read; search; a media/library view; star a room.
- **Activity feed** — a per-project timeline of events (backed by the audit log).

## Data model

| Table | Holds |
| --- | --- |
| `chat_rooms` | A channel or DM (`chat_room_type` = `channel \| dm`) |
| `chat_room_participants` | Room membership |
| `chat_room_messages` | Messages (edit/delete/reply, attachments, mentions) |
| `chat_room_message_reactions` | Emoji reactions |
| `chat_room_stars` | Per-user starred rooms |

Reads use RPCs (`chat_latest_messages_by_room`, `chat_search_room_messages`,
`chat_room_attachments`, `chat_room_links`). The activity feed writes to
`project_activity_log` via the global `AuditService`. See
  [Data → schema overview](../../07-data-and-db/schema-overview.md).

## Authorization

Chat access derives only from `project_access` membership; `projects.owner_id` is not an
authorization fallback.

There is **no chat persona**. Access origin used to be mapped to one — `consultant` was the
consultant; `client`, `personal_workspace` and `legacy` were the client; everything else was
a freelancer — and that persona then let the "consultant" read every private channel without
being a participant. Both the mapping and the bypass were removed on 2026-08-17, along with
the `project_chat_role()` SQL helper. Membership of a private channel is now something a
person is granted, not something an identity confers. The remaining helpers
(`project_chat_is_member`, `project_chat_can_dm`, `project_chat_users_share_any_project`)
and the `ChatService` enforce it. See
[Data → RLS & security](../../07-data-and-db/rls-and-security.md).

## HTTP surface

Four controllers ([Backend → api reference](../../03-backend/api-reference.md#chat--projectsprojectidchat--chat--chatdm--projectsprojectidactivity)):

- `chat` (base `projects/:projectId/chat`) — rooms, channel CRUD + members, messages.
- `chat-rooms` (base `chat`) — room-agnostic messages, search, library, star, edit.
- `chat-dm` (base `chat/dm`) — DM rooms, eligible members, resolve, send.

The activity timeline (`projects/:projectId/activity`) used to be served from
this module; it now lives in its own `activity` module. See
[API Reference → activity](../../03-backend/api-reference.md).

## Realtime

The backend publishes chat events (message/reaction/read) to the realtime Worker via
the global `RealtimePublisher` — to a per-recipient `user:{userId}` inbox room. The
web subscribes that one inbox room and invalidates the relevant React Query caches.
This transport is **shipped but dormant** until configured; it falls back to Supabase
Realtime otherwise. See [Realtime](../../06-realtime/README.md) and
[Architecture → cross-service flows](../../02-architecture/cross-service-flows.md#flow-3--realtime--chat).

## Code locations

- **Backend:** [`backend/src/modules/execution/chat/`](../../../backend/src/modules/execution/chat/)
- **Web:** `web/src/components/chat/`, `web/src/services/chat.service.ts`, `web/src/hooks/useChatRealtime.ts`
