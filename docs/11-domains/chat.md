# Chat

> **Last updated:** 2026-07-09 · **Status:** current

Project-scoped chat: flexible **channels**, **direct messages**, reactions, stars,
and a per-project **activity feed**. It's Slack-style — channels are created per
project, some are system rooms, and access is derived from project membership.
Message events push live to connected clients via the realtime Worker.

## What it does

- **Channels** — create/rename channels within a project; manage members; leave.
  Some are **system rooms** (persona-scoped, lazily joined); others are ad-hoc.
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
[Data → schema overview](../07-data-and-db/schema-overview.md).

## Authorization

Chat access derives from project membership — you don't join a project channel
unless you have access to the project. This is enforced by SQL helpers
(`project_chat_is_member`, `project_chat_role`, `project_chat_can_dm`,
`project_chat_users_share_any_project`) and in the `ChatService`. See
[Data → RLS & security](../07-data-and-db/rls-and-security.md).

## HTTP surface

Four controllers ([Backend → api reference](../03-backend/api-reference.md#chat--projectsprojectidchat--chat--chatdm--projectsprojectidactivity)):

- `chat` (base `projects/:projectId/chat`) — rooms, channel CRUD + members, messages.
- `chat-rooms` (base `chat`) — room-agnostic messages, search, library, star, edit.
- `chat-dm` (base `chat/dm`) — DM rooms, eligible members, resolve, send.
- `activity` (base `projects/:projectId/activity`) — the activity timeline.

## Realtime

The backend publishes chat events (message/reaction/read) to the realtime Worker via
the global `RealtimePublisher` — to a per-recipient `user:{userId}` inbox room. The
web subscribes that one inbox room and invalidates the relevant React Query caches.
This transport is **shipped but dormant** until configured; it falls back to Supabase
Realtime otherwise. See [Realtime](../06-realtime/README.md) and
[Architecture → cross-service flows](../02-architecture/cross-service-flows.md#flow-3--realtime--chat).

## Code locations

- **Backend:** [`backend/src/modules/chat/`](../../backend/src/modules/chat/)
- **Web:** `web/src/components/chat/`, `web/src/services/chat.service.ts`, `web/src/hooks/useChatRealtime.ts`
