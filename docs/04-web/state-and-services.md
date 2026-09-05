# State & Services

> **Last updated:** 2026-09-05 · **Status:** current

Two kinds of state: **server state** (cached by TanStack Query, fetched through
per-domain service clients) and a small amount of **client state** (seven Zustand
stores). API calls go through two axios instances — one for the backend, one for the
agent.

## Zustand stores (`web/src/stores/`)

Exactly seven:

| Store | Holds |
| --- | --- |
| `authStore` | `user`, `session`, `profile`, `isAuthenticated`, `isLoading` + `initialize`/`signIn`/`signUp`/`signOut`. The single source of truth every route guard reads via `.getState()`. Subscribes to Supabase `onAuthStateChange`. |
| `roadmapStore` | The roadmap (`roadmap`, `epics`, `milestones`) plus all optimistic bookkeeping and canvas UI state (`canvasViewMode`, open epic tabs, board filters). See [roadmap-canvas.md](./roadmap-canvas.md). |
| `aiThreadsStore` | Persisted (localStorage, key `ai.threads.v1`) AI thread-picker state — the active thread per **scope** (`roadmap:{id}` / `workspace:{id}`) plus the unsent composer draft and mention picks per thread. Migrates the pre-kit `roadmap.ai.threads.v1` key once. The threads/messages themselves are server state. See [ai-assistant.md](./ai-assistant.md). |
| `aiRunStore` | **Not persisted.** Per-thread run state (`isSending`, `runId`, `traceId`, `phase`, `status`, `next`, live timeline, `resumable`, ...) plus `startingByScope`, written only by the singleton `aiRunController`. Lives outside components so the dashboard rail and full-screen overlay see one run and a run survives navigation. Never imports `roadmapStore`. |
| `projectSettingsStore` | Persisted UI prefs (sidebar expanded, toggles); migrates the legacy `prdigy-*` key. |
| `appearanceStore` | Persisted theme/appearance preferences, backing `/settings/appearance` and the theme tokens in `styles.css`. |
| `workspaceStore` | **Only the open-workspace selection** (`currentWorkspaceId` + the user it was hydrated for), persisted to per-user `localStorage` (`proyekto_current_workspace:<userId>`). The workspace list itself stays in TanStack Query. Read outside React via `getCurrentWorkspaceId()`. |

Everything else is server state — don't add a store for data that lives on the backend.
`workspaceStore` is the model of that rule: it holds the *selection* and not the rows.

## API clients (`web/src/api/`)

| Client | Base | Notes |
| --- | --- | --- |
| `apiClient` ([`axios.ts`](../../web/src/api/axios.ts)) | `VITE_API_URL` | 30 s timeout; injects `Authorization: Bearer <supabase jwt>` or the `X-Guest-User-Id` header; logs by status |
| `agentApiClient` ([`agent-axios.ts`](../../web/src/api/agent-axios.ts)) | `VITE_AGENT_API_URL` | **180 s** timeout — one run *leg* (a send or a `continue`), not a whole run; same auth injection on every request, which the agent checks against the session's owner (sessions, runs, and traces 404 on a mismatch) |

The `{ data }` envelope is **unwrapped at the call site** (`response.data.data`), not
in the interceptor; agent responses are not enveloped at all. The interceptor
downgrades a few *expected* non-200s to debug logs (e.g. 404 on
`/api/roadmaps/project/…` = "no roadmap yet", agent trace cold-start races) and
surfaces structured `missing_permission` 403s via a toast handler. Agent 404/409s
(`SESSION_NOT_FOUND`, `RUN_IN_PROGRESS`, ...) are control flow for the run controller,
see [ai-assistant.md](./ai-assistant.md#the-run-controller).

## Service clients (`web/src/services/`)

Thin wrappers over the axios clients, roughly one per domain — 38 non-test files as of
2026-09-05 (`ls web/src/services` is the source of truth):

| Area | Files |
| --- | --- |
| Roadmap | `roadmap.service.ts` (with nested `epic/feature/task/milestone` services), `roadmap-shares.service.ts`, `migration.service.ts` (guest -> user) |
| AI assistant | `ai-agent.service.ts` (the agent client + every `Agent*` wire type), `ai-sessions.service.ts` (scope-aware threads), `roadmap-agent.service.ts` (**type-only re-export shim**, pending deletion) |
| Projects, teams, workspaces | `project.service.ts`, `teams.service.ts`, `team-resources.service.ts`, `team-time.service.ts`, `workspaces.service.ts`, `postings.service.ts`, `activity.service.ts`, `delivery.service.ts` |
| Contracts and money | `contract.service.ts`, `contract-signing.service.ts`, `engagement.service.ts`, `finance.service.ts`, `financials.service.ts`, `invoice.service.ts`, `payouts.service.ts` |
| Chat, meetings, notifications | `chat.service.ts`, `meetings.service.ts`, `notifications.service.ts` |
| Identity and profile | `profile.service.ts`, `memberProfile.ts`, `profileImport.service.ts`, `googleAuth.ts`, `appearance.service.ts`, `admin.service.ts` |
| MCP | `mcp-oauth.service.ts`, `mcp-tokens.service.ts` |
| Mobile and push | `deviceTokens.service.ts`, `pushNotifications.ts`, `pushRegistration.ts`, `pushStatus.ts`, `appUpdate.service.ts`, `upload.service.ts` |

## TanStack Query

- **Query-key factories** live in [`web/src/queries/`](../../web/src/queries/)
  (`project.ts`, `chat.ts`, `meetings.ts`, `profile.ts`, `wallet.ts`, …) — e.g.
  `projectKeys.detail(id)`, `projectKeys.roadmapFull(roadmapId)`, `chatKeys.rooms(projectId)`.
- **Hooks** in [`web/src/hooks/`](../../web/src/hooks/) wrap `useQuery`/`useMutation`
  (`useProfileQuery` syncs the profile into `authStore`, `useProjectQueries`,
  `useAiSessions` — keyed by the AI *scope key*, never a raw id —, `useMeetings`, …)
  plus the realtime/live hooks
  (`useRoadmapDataSync`, `useRoadmapCollaboration`, `useChatRealtime`,
  `useNotificationsRealtime`) that invalidate queries on realtime events. See
  [Realtime](../06-realtime/transport-and-events.md).

## See also

- [architecture.md](./architecture.md) — where the clients are wired.
- [roadmap-canvas.md](./roadmap-canvas.md) — `roadmapStore`'s optimistic model in depth.
- [ai-assistant.md](./ai-assistant.md) — the shared AI kit, its two stores, and the agent client.
