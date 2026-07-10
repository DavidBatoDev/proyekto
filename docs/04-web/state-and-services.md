# State & Services

> **Last updated:** 2026-07-09 · **Status:** current

Two kinds of state: **server state** (cached by TanStack Query, fetched through
per-domain service clients) and a small amount of **client state** (four Zustand
stores). API calls go through two axios instances — one for the backend, one for the
agent.

## Zustand stores (`web/src/stores/`)

Exactly four:

| Store | Holds |
| --- | --- |
| `authStore` | `user`, `session`, `profile`, `isAuthenticated`, `isLoading` + `initialize`/`signIn`/`signUp`/`signOut`. The single source of truth every route guard reads via `.getState()`. Subscribes to Supabase `onAuthStateChange`. |
| `roadmapStore` | The roadmap (`roadmap`, `epics`, `milestones`) plus all optimistic bookkeeping and canvas UI state (`canvasViewMode`, open epic tabs, board filters). See [roadmap-canvas.md](./roadmap-canvas.md). |
| `roadmapAiThreadsStore` | Persisted (localStorage) AI thread picker state — active thread per roadmap + draft input. The threads/messages themselves are server state. |
| `projectSettingsStore` | Persisted UI prefs (sidebar expanded, toggles); migrates the legacy `prdigy-*` key. |

Everything else is server state — don't add a store for data that lives on the backend.

## API clients (`web/src/api/`)

| Client | Base | Notes |
| --- | --- | --- |
| `apiClient` ([`axios.ts`](../../web/src/api/axios.ts)) | `VITE_API_URL` | 30 s timeout; injects `Authorization: Bearer <supabase jwt>` or the `X-Guest-User-Id` header; logs by status |
| `agentApiClient` ([`agent-axios.ts`](../../web/src/api/agent-axios.ts)) | `VITE_AGENT_API_URL` | **180 s** timeout (long reasoning turns); same auth injection |

The `{ data }` envelope is **unwrapped at the call site** (`response.data.data`), not
in the interceptor. The interceptor downgrades a few *expected* non-200s to debug
logs (e.g. 404 on `/api/roadmaps/project/…` = "no roadmap yet", agent trace cold-start
races) and surfaces structured `missing_permission` 403s via a toast handler.

## Service clients (`web/src/services/`)

One per domain — thin wrappers over the axios clients:
`roadmap.service.ts` (with nested `epic/feature/task/milestone` services),
`roadmap-agent.service.ts`, `roadmap-ai-sessions.service.ts`, `roadmap-shares.service.ts`,
`project.service.ts`, `teams.service.ts`, `team-time.service.ts`, `payouts.service.ts`,
`invoice.service.ts`, `chat.service.ts`, `meetings.service.ts`,
`notifications.service.ts`, `profile.service.ts`, `admin.service.ts`,
`upload.service.ts`, `deviceTokens.service.ts`, `pushNotifications.ts`,
`migration.service.ts`.

## TanStack Query

- **Query-key factories** live in [`web/src/queries/`](../../web/src/queries/)
  (`project.ts`, `chat.ts`, `meetings.ts`, `profile.ts`, `wallet.ts`, …) — e.g.
  `projectKeys.detail(id)`, `projectKeys.roadmapFull(roadmapId)`, `chatKeys.rooms(projectId)`.
- **Hooks** in [`web/src/hooks/`](../../web/src/hooks/) wrap `useQuery`/`useMutation`
  (`useProfileQuery` syncs the profile into `authStore`, `useProjectQueries`,
  `useRoadmapAiSessions`, `useMeetings`, …) plus the realtime/live hooks
  (`useRoadmapDataSync`, `useRoadmapCollaboration`, `useChatRealtime`,
  `useNotificationsRealtime`) that invalidate queries on realtime events. See
  [Realtime](../06-realtime/transport-and-events.md).

## See also

- [architecture.md](./architecture.md) — where the clients are wired.
- [roadmap-canvas.md](./roadmap-canvas.md) — `roadmapStore`'s optimistic model in depth.
