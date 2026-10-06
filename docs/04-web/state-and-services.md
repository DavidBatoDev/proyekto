# State & Services

> **Last updated:** 2026-10-06 · **Status:** current

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
see [ai-assistant.md](./ai-assistant.md#the-run-controller). The time API gets two rules of
its own (matched on `/api/time`, never the `/api/team-time` alias): the five 403s the time UI
answers in place (`NO_LOGGING_CONTEXT`, `MANUAL_ENTRIES_DISABLED`,
`TIME_ENTRY_NO_PROJECT_ACCESS`, `TIME_ENTRY_NOT_ON_PROJECT_TEAM`,
`TIME_ENTRY_NOT_WORKSPACE_MEMBER`) never toast or log, and the three 409s that are a step in a
flow (`LOGGING_FOR_REQUIRED`, `STALE_REVISION`, `TIMER_ALREADY_RUNNING`) are not logged as
errors. A time plan limit still raises the upgrade prompt.

## Service clients (`web/src/services/`)

Thin wrappers over the axios clients, roughly one per domain — 53 non-test files as of
2026-10-06 (`ls web/src/services` is the source of truth):

| Area | Files |
| --- | --- |
| Roadmap | `roadmap.service.ts` (with nested `epic/feature/task/milestone` services), `roadmap-shares.service.ts`, `migration.service.ts` (guest -> user) |
| AI assistant | `ai-agent.service.ts` (the agent client + every `Agent*` wire type), `ai-sessions.service.ts` (scope-aware threads), `ai-context.service.ts`, `roadmap-agent.service.ts` (**type-only re-export shim**, pending deletion) |
| Projects, teams, workspaces | `project.service.ts`, `teams.service.ts`, `team-resources.service.ts`, `workspaces.service.ts`, `postings.service.ts`, `activity.service.ts`, `delivery.service.ts`, `intake.service.ts` |
| Time | `time.service.ts` (the only `/api/time` client; see [below](#the-time-data-layer)), `time.types.ts` (the wire types, mirroring the backend's `time.types.ts`) |
| Contracts and money | `contract.service.ts`, `contract-history.service.ts`, `contract-signing.service.ts`, `engagement.service.ts`, `engagementAssignments.service.ts`, `finance.service.ts`, `financeBooks.service.ts`, `financeExpenses.service.ts`, `financeImports.service.ts`, `financials.service.ts`, `teamFinance.service.ts`, `invoice.service.ts`, `payouts.service.ts` |
| Plans and billing | `billing.service.ts`, `entitlements.service.ts` |
| Chat, meetings, notifications | `chat.service.ts`, `meetings.service.ts`, `notifications.service.ts` |
| Identity, profile and account | `profile.service.ts`, `memberProfile.ts`, `profileImport.service.ts`, `googleAuth.ts`, `appleAuth.ts`, `appearance.service.ts`, `admin.service.ts`, `accountDeletion.service.ts`, `safety.service.ts`, `contact.service.ts` (the public contact form; a bare axios instance) |
| MCP | `mcp-oauth.service.ts`, `mcp-tokens.service.ts` |
| Mobile and push | `deviceTokens.service.ts`, `pushNotifications.ts`, `pushRegistration.ts`, `pushStatus.ts`, `appUpdate.service.ts`, `upload.service.ts` |

`team-time.service.ts`, the old `/api/team-time` client, was deleted with the time rebuild;
only older app bundles still call that alias.

## TanStack Query

- **Query-key factories** live in [`web/src/queries/`](../../web/src/queries/)
  (`project.ts`, `chat.ts`, `meetings.ts`, `profile.ts`, `teams.ts`, `time.ts`, … — 18
  files) — e.g. `projectKeys.detail(id)`, `projectKeys.roadmapFull(roadmapId)`,
  `chatKeys.rooms(projectId)`, `timeKeys.timesheet(id)`.
- **Hooks** in [`web/src/hooks/`](../../web/src/hooks/) wrap `useQuery`/`useMutation`
  (`useProfileQuery` syncs the profile into `authStore`, `useProjectQueries`,
  `useAiSessions` — keyed by the AI *scope key*, never a raw id —, `useMeetings`, …)
  plus the realtime/live hooks
  (`useRoadmapDataSync`, `useRoadmapCollaboration`, `useChatRealtime`,
  `useNotificationsRealtime`) that invalidate queries on realtime events.
  `useNotificationsRealtime` also refreshes the time overview and approval queue when a
  time notification row changes, and runs the matching `invalidateTime` event. See
  [Realtime](../06-realtime/transport-and-events.md).

## The time data layer

Time has one client, one key tree and one invalidation map, and new code never reaches
around them:

| Module | Holds |
| --- | --- |
| [`services/time.service.ts`](../../web/src/services/time.service.ts) | `timeService`: 45 functions, one per `/api/time` endpoint (entries, `me/*`, logging-for, policies, timesheets and their actions, approvals, reports and exports), all on the shared `apiClient`. Errors become `TimeApiError {status, code, message, extras}` (`isTimeApiError(err, code)` narrows the extras); a body without a code is `HTTP_<status>`, no response is `NETWORK_ERROR`. Write bodies are whitelisted per DTO, so spreading a view into a PUT is safe. Exports come back as `{blob, filename}` from `Content-Disposition` |
| [`services/time.types.ts`](../../web/src/services/time.types.ts) | The wire types, mirroring the backend's `time.types.ts` |
| [`queries/time.ts`](../../web/src/queries/time.ts) | `timeKeys`, `timeQueries` (option factories), `invalidateTime`, `useTimeOverview` (sends the browser timezone), `useTimeApprovalsCount` |
| `lib/timeErrors.ts`, `lib/timeFormat.ts`, `lib/timePeriods.ts`, `lib/timeSearch.ts` | Every time string (with its native variant), formats (`h:mm`, "38h 15m", "Sep 22–28"), period maths (parity-tested against the backend's `time-periods.ts`), and the search-param validators |

Every key starts with `"time"`; the person's own keys carry the user id, so a second account
in the same tab never sees the first one's timer:

```ts
["time", "me", "running" | "overview" | "entries" | "summary" | "preferences" | "timesheets" | "projects", userId, …]
["time", "logging-for" | "project-policy" | "work-items" | "loggers", projectId, …]
["time", "entry", entryId(, "segments" | "comments")]
["time", "timesheet", timesheetId]
["time", "approvals", "list" | "count", userId, …]
["time", "reports", "entries" | "summary", params]
["time", "policy", "workspace" | "team", id(, "history", …)]
```

The running timer polls every 3 s while one runs and every 30 s otherwise; the overview and
the approval count are 30 s and refetch on focus; the For options and loggable projects are
30 s (the server caches them for 30 s too). Every time query refetches on mount (the app
default does not) and retries only a network error or a 5xx, at most twice — a 4xx is an
answer. The running poll alone keeps a plain single retry.

After a write, call `invalidateTime(queryClient, event)` rather than naming keys:

| Event | After | Invalidates |
| --- | --- | --- |
| `entry` | start, stop, pause, resume, add, edit, delete, Change For | running, own entries, summary, overview, own timesheets, For options, loggable projects, entry and timesheet details, reports |
| `sheet` | submit, withdraw, approve, return, reopen, ask to reopen, bulk approve | timesheet details and lists, the approval queue and count, overview, own entries and summary, entry details, reports, `["payouts"]` |
| `policy` | a workspace or team policy write, and anything that changes who can log (attaching a team, project permissions) | policy views and history, per-option policy, For options, work items, loggable projects, loggers, overview, timesheets, own entries, reports |
| `preferences` | timezone or week start | preferences, overview, own entries and summary |
| `payout` | record or void a payment | `["payouts"]`, entry and timesheet details, own entries, reports |
| `comment` | a new comment | entry details |

The old `["team-time", …]` keys, `services/team-time.service.ts` and the old
`components/team-time/useActiveTimer.ts` are gone; a guard test
(`lib/noLegacyTimeImports.test.ts`) walks `web/src` and fails on any import, mock,
`vi.importActual` or `require` of the two retired modules; on `"team-time"` as a whole quoted
string anywhere (a key head, a namespace constant, a predicate), except in `queries/time.test.ts`'s
negative assertion; and on the `/api/team-time` path outside `api/axios.ts` and its test, which
keep the alias's 403 silence for older app bundles.

## See also

- [architecture.md](./architecture.md) — where the clients are wired.
- [roadmap-canvas.md](./roadmap-canvas.md) — `roadmapStore`'s optimistic model in depth.
- [ai-assistant.md](./ai-assistant.md) — the shared AI kit, its two stores, and the agent client.
- [routing-and-access.md › Time](./routing-and-access.md#time) — the time routes and the old team-time redirects.
