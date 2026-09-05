# AI Assistant

> **Last updated:** 2026-09-05 · **Status:** current

The assistant is one shared kit under `web/src/components/ai/`, mounted on two
surfaces: the roadmap page's side panel (scope = one roadmap) and the workspace
dashboard's rail / full-screen overlay (scope = the open workspace). The web talks to
the Python agent **directly** (`agentApiClient`, never through the backend), and every
message is a **run** the agent advances in legs: the kit calls `POST .../messages`,
then `POST .../runs/{run_id}/continue` while `run.next === "continue"`, rendering the
trace, the per-roadmap commit cards, and the checkpoints (clarifier / proposal) in
between. Thread history is server state (`roadmap_ai_sessions` / `roadmap_ai_messages`
behind the scope's backend route family); only the active thread, composer drafts, and
in-flight run state live on the client.

> **Boundary rule.** Nothing under `components/ai/` imports `@/stores/roadmapStore` or
> `@/components/roadmap/` — `importBoundary.test.ts` fails `npm test` otherwise. The
> dashboard mounts the kit beside grids that render many roadmaps, and `roadmapStore` is
> a singleton holding exactly one. Roadmap-only behaviour reaches the kit through props
> from the thin wrapper `components/roadmap/ai/RoadmapAiAssistantPanel.tsx`.

> **Deployment state (2026-09-05).** The two migrations behind this
> (`20260904090000_ai_sessions_scope_and_context_rpcs.sql`,
> `20260904090100_search_knowledge_chunks_projects.sql`) are applied on hosted dev and
> production. The web, backend, and agent code ships on branch `feat/ai-revamp`; check
> `git log` before assuming a given environment serves it. No feature flag gates any of it.

## Surfaces

| Surface | Mount | Scope | `ariaLabel` | Placeholder |
| --- | --- | --- | --- | --- |
| Roadmap side panel | `components/roadmap/ai/RoadmapAiAssistantPanel.tsx`, mounted by `views/roadmap/components/RoadmapViewContent.tsx` and `MobileRoadmapView.tsx` | `{kind:"roadmap", roadmapId, projectId}` (`projectId` may be the `"n"` sentinel) | `AI Assistant Panel` | `Chat or request roadmap edits...` |
| Dashboard rail | `components/home/DashboardAiPanel.tsx` | `{kind:"workspace", workspaceId, slug}` from `useCurrentWorkspace()` | `Proyekto assistant` | `Ask Proyekto...` |
| Dashboard full screen | same file; open while the dashboard URL carries `?assistant=full` | same | `Proyekto assistant, full screen` | `Ask Proyekto...` |

The rail and the full-screen overlay are mounted **at the same time** on the same
thread; while the overlay is open the rail is `inert` + `aria-hidden`, so there is one
interactive panel per accessible name (Playwright strict mode). Both surfaces render the
same run because run state lives in a store, not in a component.

## The kit

```text
AiAssistantPanel  (variant: panel | rail | fullscreen)
  |
  +-- useAiThreads(scope) -----------> aiSessionsService  list/create/update/delete
  |                                      /api/roadmaps/:id/ai-sessions   or
  |                                      /api/workspaces/:id/ai-sessions
  +-- useAiThreadMessages(scope, id) -> messages query, persistTurn, rehydrate
  |                                      (useThreadMessagesStore = in-memory bubbles)
  +-- useAiAssistantRun -------------> aiRunController.send / cancel / resume
  |       reads useAiRunState()          (singleton; writes aiRunStore)
  |                                        |
  |                                        +--> aiAgentService
  |                                             POST /agent/sessions
  |                                             POST .../messages
  |                                             POST .../runs/{id}/continue | /cancel
  |                                             GET  .../traces/{id}/events
  +-- AiThreadView -> AiMessage -> AiCommitCard | AiClarifierCard | AiPlanProposalCard
  |                              -> AiActivityTimeline (trace rows)
  +-- AiRunBanner   (phase label + Stop / Resume)
  +-- AiComposer + AiMentionPicker   (useAiMentionCandidates)
  `-- AiThreadMenuButton -> AiThreadList   ("AI thread picker")
```

| File | Role |
| --- | --- |
| `AiAssistantPanel.tsx` | Composes threads -> messages -> run state for the three variants; owns the one-shot `initialMessage` send |
| `scope.ts` | `AiSessionScope`, `aiScopeKey`, `aiSessionsBasePath`, `toAgentScope`, `focusRoadmapId`, `toRouteProjectId`; pure module |
| `runController.ts` | The singleton run machine (below); never touches React or `roadmapStore` |
| `useAiAssistantRun.ts` | React binding: `send` / `cancel` / `resume` over the controller, `useAiRunState` for the slice |
| `useAiThreads.ts`, `useAiThreadMessages.ts` | Thread list + active thread; row hydration (`dbRowToClientMessage`), `persistTurnForScope`, `rehydrateAgentSessionForScope`, the exported `useThreadMessagesStore` |
| `aiMentions.ts`, `AiComposer.tsx`, `AiMentionPicker.tsx`, `useAiMentionCandidates.ts` | Entity @-mentions (below) |
| `aiProgress.ts` | Trace -> timeline normalizers, poll constants, `SHARED_HIDDEN_ACTIVITY_EVENTS`, commit-row describers |
| `aiToolMessaging.ts` | Human copy for tool calls in the timeline |
| `AiCommitCard.tsx` | One card per `RunCommitView` (roadmap title, status label, grouped impacted chips that deep-link with the `"n"` project sentinel) |
| `AiClarifierCard(.logic)`, `AiPlanProposalCard`, `AiPlanQuestionCard`, `AiPlanProposalGraph` | Checkpoint cards; answers travel back as the sentinel messages (`__clarifier_answer__`, `__plan_answers__`, `__plan_decision__`) |
| `AiRunBanner.tsx` | "Investigating...", "Drafting a proposal...", "Applying changes (n/m roadmaps)...", "Verifying...", plus Stop / Resume |
| `AiThreadList.tsx`, `AiThreadMenuButton.tsx`, `AiThreadView.tsx`, `AiMessage.tsx`, `AiMarkdown.tsx` | Presentation, on theme tokens |
| `types.ts` | `AiChatMessage` (`refs?`, `commits?`, `runId?`; `attachments?` is a read-only legacy field), `AiMentionKind` / `AiMentionPick` / `AiMentionSpan` |
| `index.ts` | Barrel |
| `importBoundary.test.ts` | The boundary guard: no `@/stores/roadmapStore`, `@/components/roadmap/`, or `../roadmap/` imports; also asserts it found more than 20 source files so a broken traversal cannot pass vacuously |

### `AiAssistantPanel` props

| Prop | Purpose |
| --- | --- |
| `scope: AiSessionScope \| null` | `null` renders the shell with a disabled composer and `unavailableHint` |
| `variant` | `panel` (roadmap side panel), `rail`, `fullscreen` — class sets only, one code path |
| `ariaLabel`, `title`, `headerActions?` | Accessible name, header-left slot, expand / collapse buttons |
| `emptyState`, `placeholder`, `unavailableHint?`, `composerAriaLabel?` | Copy. `emptyState` may be a function of `AiEmptyStateContext` (`{ send, disabled }`) so a surface can render quick-question cards that send through the panel with the composer's guards and auto refs |
| `isVisible?` | Gates the one-shot `initialMessage` |
| `initialMessage?`, `onInitialMessageConsumed?` | Hero handoff: auto-sent exactly once when visible and the sessions list has loaded (`shouldAutoSendInitialMessage`) |
| `baseRevision?` | Forwarded to the agent session create |
| `primaryMentionCandidates?` | Rows the picker offers first, under the "This roadmap" header |
| `commitLinkView?` | `roadmapView` / `timelineView` for commit-card deep links |
| `onCommits?`, `onTraceEvents?` | Run hooks (see the roadmap wrapper) |

## Scope

`scope.ts` is the one shape that drives the query keys, the persisted threads store,
the run store's scope index, the backend base path, and the agent create body.

| Helper | Result |
| --- | --- |
| `aiScopeKey(scope)` | `roadmap:{id}` or `workspace:{id}` — the key for `activeThreadIdByScope`, `startingByScope`, and `aiSessionKeys` |
| `aiSessionsBasePath(scope)` | `/api/roadmaps/{id}/ai-sessions` or `/api/workspaces/{id}/ai-sessions` |
| `toAgentScope(scope)` | `{kind:"roadmap", roadmap_id}` or `{kind:"workspace", workspace_id}` for `POST /agent/sessions` |
| `focusRoadmapId(scope)` | The roadmap bare handles refer to; `null` in workspace scope |
| `toRouteProjectId(id)` | `id`, or the `"n"` sentinel for a roadmap without a project |

## The run controller

`aiRunController` (`runController.ts`) is a module singleton keyed by thread id. It
writes only `aiRunStore` and the thread's in-memory messages; a run keeps advancing
after the user switches threads or navigates away.

1. **`send()`** refuses if `startingByScope[scopeKey]` is set or the thread is busy,
   then sets `startingByScope` **before** awaiting `ensureThread()` so the first send in
   a scope — which creates the backend session — cannot double-fire (`useAiRunState`
   folds the flag into `isSending`).
2. Appends the optimistic user bubble (with its mention `refs`), persists the user
   turn to the backend **before** calling the agent (`metadata.refs`), keeps the
   returned `seed_messages`, and ensures the agent session exists.
3. Mints a client trace id, starts trace polling, and calls
   `POST /agent/sessions/{id}/messages` with
   `{message, refs: toAgentRefs(spans), capabilities: ["continue"]}` and the trace id
   in `X-Trace-Id`.
4. Adopts `response.run.trace_id` (fallbacks: `debug_trace_id`, then the client id) and
   enters `advance()`.
5. **`advance()`** applies each leg (run fields, `commitsProgress`, new commits ->
   `hooks.onCommits`), then: `run.next !== "continue"` or a cancel request -> `settle()`;
   past `RUN_WALL_CLOCK_CAP_MS` -> resumable; otherwise
   `POST .../runs/{run_id}/continue` (the agent reuses `run.trace_id`).
6. **`settle()`** appends **one** assistant message carrying `assistant_message` (or a
   status fallback), `clarifier`, `planProposal`, `commits`, `runId`; persists the
   assistant turn fire-and-forget with `metadata.{plan_proposal?, clarifier?, run:{run_id,
   phase, status, commits}}` (commits stripped of `operations`); marks the live timeline
   complete and drains trailing trace events (`SETTLE_DRAIN_DONE_MS`); calls
   `hooks.onSettled`.

Checkpoints (clarifier, proposal) resume through the sentinel messages, which go
through the same `send()`; the agent answers on a new segment trace.

| Call | Error | The controller |
| --- | --- | --- |
| `/messages` | `SESSION_NOT_FOUND` (or a bare 404 from a pre-code agent) | Rehydrates the agent session from the persisted `agent_state` + seeds, retries once |
| `/messages` | `RUN_IN_PROGRESS` with `run` | Adopts that run's trace, drives it to settle, then re-sends the queued message once (`resendDepth`) |
| `/continue` | `SESSION_NOT_FOUND` | Rehydrates + retries once; a second miss settles as expired |
| `/continue` | `RUN_NOT_FOUND` | Settles as expired (`RUN_EXPIRED_MESSAGE`) |
| `/continue` | `RUN_NOT_CONTINUABLE` with `run` | Settles from that body, no retry |
| `/continue` | `RUN_IN_PROGRESS` | Applies the run view, polls every 3 s for up to 150 s, then **resumable** |
| `/continue` | other 4xx that is not a timeout | Settles as failed with the message |
| `/continue` | timeout / network / 5xx | Retries once after 1.5 s, then **resumable** (Resume / Stop in the banner, no assistant message) |

| Constant | Value | Meaning |
| --- | --- | --- |
| `TRACE_POLL_LEG_TIMEOUT_MS` | 190 000 | Per-leg trace-poll deadline, reset on send / continue / resume |
| `RUN_WALL_CLOCK_CAP_MS` | 30 min | Hard cap per run (the agent bounds a run at `AGENT_RUN_MAX_STEPS=8` legs, ~24 min) |
| `TRACE_POLL_HIDDEN_INTERVAL_MS` | 2 500 | Poll interval while `document.hidden` |
| `CONTINUE_BUSY_POLL_INTERVAL_MS` / `CONTINUE_BUSY_MAX_WAIT_MS` | 3 000 / 150 000 | The `RUN_IN_PROGRESS` wait on continue |
| `CONTINUE_TRANSPORT_RETRY_DELAY_MS` | 1 500 | The single transport retry |
| `SETTLE_DRAIN_DONE_MS` | 8 000 | Trailing trace drain at a terminal settle |

**Cancel / resume.** `cancel()` posts `.../runs/{run_id}/cancel` and marks
`cancelRequested`; the in-flight leg finishes and `settle()` records `cancelled`. With no
leg in flight (resumable state) the controller finalizes synchronously. `resume()` picks
up from the stored `{runId, traceId}` by calling `continue` again.

**Trace stream.** Polling (`GET .../traces/{trace_id}/events`) plus optional push:
`attachPush(userId)` only when `featureFlags.realtimeAiTracePush && isRealtimeConfigured()`
and the user is signed in (guests poll), refcounted per user so the two dashboard mounts
share one socket. Poll cursors are kept per trace id across sends, so a checkpoint answer
never replays from `seq 0`; `beforeunload` tears every loop down. Run bookkeeping events
(`run_started`, `phase_entered`, `phase_completed`, `run_step_completed`, `run_checkpoint`,
`refs_resolved`) are hidden from the timeline — the banner reads `phase_entered` details
live — while `commit_started` / `commit_completed` / `commit_failed` / `verify_completed`
render as curated rows. The retired `auto_commit_async_*` events are no longer emitted.

**Legacy responses.** A reply with `commit_summary` but no `commits` is folded into one
synthesized commit (`batch_id: "legacy-commit-summary"`); an `edit_plan` reply with staged
operations and neither is shown with the old "committing" lifecycle card that the trace
resolves. Old persisted rows keep rendering through `toCommitCards`.

## @-mentions

The composer lifts the project chat's mention mechanics and generalizes them from people
to entities. On the wire a mention is a **ref** `{kind, id, label}`; the agent renders
refs as a per-turn "Referenced items" block described to the model as a hint about what
the user means, **never a limit on what it may look at**.

| Fact | Value |
| --- | --- |
| Kinds | `project`, `roadmap`, `epic`, `feature`, `task`, `milestone`, `team` |
| Trigger | `@` at the start or after whitespace; the query runs to the caret with no whitespace inside |
| Picker | Grouped listbox (`AiMentionPicker`), group headers "This roadmap", "Projects", "Roadmaps", "Epics", "Features", "Tasks", "Milestones", "Teams"; loading row "Searching other roadmaps..." |
| Group order | `primary` -> roadmap -> project -> epic -> feature -> task -> milestone -> team |
| Caps | Per group 6 / 4 / 4 / 4 / 4 / 4 / 3 / 3 (bare `@` preview: primary 4, roadmap 3, project 3); `AI_MENTION_TOTAL_CAP = 16`; deduped on `kind:id`, primary rows win |
| Workspace ordering | Roadmaps and projects sort `current -> shared -> other_workspace`, computed by the kit from `project.workspace_id` (not `groupByWorkspace`, which drops other-workspace items the agent can act on); flat when no workspace is selected; unlinked roadmaps are `shared` |
| Candidate sources | Enabled only while the picker is open: `useDashboardProjectsQuery`, `roadmapsPreviewQueryOptions(userId)`, `["teams","mine",uid]`; plus the `primary` list the roadmap wrapper builds from the loaded tree (`roadmapMentionCandidates.ts`) |
| Keyboard | Enter sends, Shift+Enter newline; with the picker open ArrowUp / ArrowDown move, Enter / Tab insert, Escape closes; the textarea auto-grows to `AI_COMPOSER_MAX_HEIGHT_PX = 160` |
| Wire cap | `MAX_AGENT_REFS = 20` (the agent's `AGENT_MAX_REFS_PER_MESSAGE`); `toAgentRefs` dedupes by `kind:id`, first label wins |
| Persistence | Spans are stored as `roadmap_ai_messages.metadata.refs` (written by the web, read back untrusted); chips render through `renderEntityMentionContent` and deep-link via `resolveAiEntityDestination` (project -> `/project/$projectId/roadmap`, roadmap / nodes -> `/project/$projectId/roadmap/$roadmapId`, team -> the workspace teams page) |

Drafts (`draftInputByThread`, `draftPicksByThread`) live in `aiThreadsStore`, the single
source of truth, because the rail and the full-screen overlay share a thread; only the
interactive panel writes.

## Stores

| Store | Persisted | Holds |
| --- | --- | --- |
| `aiThreadsStore` | `localStorage`, key `ai.threads.v1` | `activeThreadIdByScope` (keyed by `aiScopeKey`), `draftInputByThread`, `draftPicksByThread`. On first load it migrates the pre-kit `roadmap.ai.threads.v1` document once (`activeThreadIdByRoadmap[id]` -> `activeThreadIdByScope["roadmap:<id>"]`, drafts carried over, picks start empty) and removes the legacy key |
| `aiRunStore` | no | `runsByThread` — per thread: `isSending`, `runId`, `traceId`, `phase`, `status`, `next`, `legIndex`, `commitsProgress`, live timeline + streaming preview, `errorMessage`, `resumable`, `cancelRequested`; plus `startingByScope` |

Both are among the seven stores listed in [state-and-services.md](./state-and-services.md).

## Services and hooks

| Module | Surface |
| --- | --- |
| `services/ai-agent.service.ts` | The canonical agent client and every `Agent*` wire type (`RunView`, `RunCommitView`, `AgentRunResponse`, `AgentPlanProposal` with `kind` / `targets`, ...). Methods: `createSession`, `sendMessage`, `continueRun`, `cancelRun`, `getTraceEvents`. Errors are `AiAgentServiceError` with `code` and, for 409s, the `run` body; the codes the kit switches on are `AUTH_REQUIRED`, `SESSION_NOT_FOUND`, `SESSION_SCOPE_NOT_FOUND`, `RUN_NOT_FOUND`, `RUN_NOT_CONTINUABLE`, `RUN_IN_PROGRESS`, `TRACE_EVENTS_NOT_FOUND`. Responses are **not** enveloped |
| `services/ai-sessions.service.ts` | Scope-first backend client over `aiSessionsBasePath(scope)`: `list`, `create`, `getById`, `update`, `delete`, `listMessages`, `appendMessage` (message `metadata` is capped at 64 KB server-side; the eighth backend route, `PUT .../agent-state`, is written by the agent). `AiSession` carries `scope`, `roadmap_id \| null`, `workspace_id \| null` |
| `hooks/useAiSessions.ts` | `aiSessionKeys` keyed by the **scope key** (a roadmap thread and a workspace thread can never share a cache entry); `useAiSessionsList`, `useAiMessages`, `useCreateAiSession`, `useUpdateAiSession`, `useDeleteAiSession`, `useAppendAiMessage` |
| `hooks/useRoadmapsPreviewQuery.ts` | `roadmapsPreviewQueryOptions(userId)` — the one definition of the `["dashboard","roadmaps-preview",uid]` query the picker and the dashboard grid share |
| `services/roadmap-agent.service.ts` | **Type-only re-export shim** over `ai-agent.service.ts`, kept for `stores/roadmapStore.ts`, `components/roadmap/RoadmapBuilder.tsx`, and `roadmapIntakeTurns.ts`; scheduled for deletion once they are repointed. New code imports `@/services/ai-agent.service` |

`roadmap-ai-sessions.service.ts`, `useRoadmapAiSessions.ts`, `roadmapAiThreadsStore.ts`,
and `roadmap/ai/useRoadmapAiAssistantSession.ts` no longer exist.

## The roadmap wrapper

`components/roadmap/ai/RoadmapAiAssistantPanel.tsx` (about 200 lines) is the **only**
place the assistant touches `roadmapStore`:

- Scope `{kind:"roadmap", roadmapId, projectId}`; primitive selectors or `useShallow`
  (Zustand 5) for the tree.
- `primaryMentionCandidates` from the loaded tree via `roadmapMentionCandidates.ts`
  (the roadmap, then epics -> features -> tasks, then milestones, position-sorted; empty
  when the store holds a different roadmap).
- `onCommits`: for a committed focus-roadmap commit, `applyAiCommitImpactedItems(
  operations, impacted_items)` for the instant canvas update **only while the store still
  holds this roadmap** (a run may outlive the page), then a forced `loadRoadmap`; a commit
  to another roadmap only invalidates `projectKeys.roadmapFull(thatId)`.
- `onTraceEvents`: refreshes on `commit_completed` whose `details.roadmap_id` is absent
  or equals this roadmap, deduplicated per trace by `seq`.
- `commitLinkView` follows `canvasViewMode` (`milestones` -> `timelineView`).
- The hero handoff (`web/src/lib/roadmapPageHandoff.ts`, sessionStorage prefix
  `proyekto_pending_ai_prompt:`) arrives as `initialMessage`.
- The intake flow (`RoadmapBuilder.tsx`) reuses the kit's clarifier card and
  `buildClarifierDisplayLabel`; `AgentClarifierAnswerEntry` / `AgentClarifierQuestion` /
  `ClarifierCardLike` keep their names and shapes.

## The dashboard assistant

`components/home/DashboardAiPanel.tsx`:

- `useDashboardAiScope()` maps `useCurrentWorkspace()` to
  `{kind:"workspace", workspaceId, slug}`; the composer is disabled with
  `unavailableHint` "Choose a workspace to start" only once loading has finished.
- The rail and the full-screen overlay are both `AiAssistantPanel`s (`variant="rail"`
  / `"fullscreen"`); the overlay follows `?assistant=full` on `/w/<slug>/dashboard`,
  which is owned by the route so it survives a refresh.
- `invalidateAfterDashboardCommits(queryClient, commits)` runs `invalidateDashboardRoadmaps`,
  `invalidateDashboardProjects`, `projectKeys.allRoadmapsFull`, and
  `projectKeys.roadmapFull(roadmap_id)` per commit. `roadmapStore` is never imported.
- Empty state is the assistant intro ("Ask Proyekto about your projects and roadmaps") followed by four quick-question cards (assigned tasks, what to work on today, what is overdue, summarize projects and roadmaps). A card sends its label verbatim as the first turn; the cards are disabled whenever the composer is.

What the agent may do from here — and what it asks confirmation for — is a product rule,
not a web one: see [Workspaces -> AI assistant](../11-domains/workspaces/README.md#ai-assistant)
and [Agent & Roadmap AI](../05-agent-ai/README.md).

## Frozen strings (Playwright)

These are byte-identical across the migration; the specs under `web/playwright/tests/`
(`dashboard-ai-assistant`, `roadmap-ai-agent`, `roadmap-ai-agent-sweep`,
`roadmap-ai-chat-ui`, `roadmap-ai-cleanup`, `roadmap-ai-edge-cases`,
`roadmap-ai-fix-validation`, `roadmap-ai-ops-coverage`, `roadmap-ai-ui-adaptive`,
`roadmap-ai-ui-sweep`, plus `roadmap-canvas-mobile`) depend on them.

| String | Where |
| --- | --- |
| `AI Assistant Panel` | roadmap wrapper `ariaLabel` |
| `AI thread picker` | `AiThreadList.tsx` dialog `aria-label` |
| `New thread` | `useAiThreads.ts` (`NEW_THREAD_LABEL`), `AiThreadList.tsx`, `AiThreadMenuButton.tsx` |
| `Ask questions or request roadmap edits` | roadmap wrapper empty state |
| `Chat or request roadmap edits...` | roadmap wrapper placeholder |
| `Committed changes` (greps `/Committed changes/i`) | `AiCommitCard.tsx`, `aiProgress.ts` |
| `Submit answer` | `AiClarifierCard.tsx`, `AiPlanQuestionCard.tsx` |
| `Toggle AI chat panel` | `roadmap/views/RoadmapTopBar.tsx` |
| `Proyekto assistant`, `Proyekto assistant, full screen`, `Ask Proyekto...`, `Applying changes` | `DashboardAiPanel.tsx`, `AiRunBanner.tsx` |

## Tests

Vitest, co-located: 15 files under `components/ai/` (`aiMentions`, `AiComposer`,
`runController`, `scope`, `AiAssistantPanel`, `AiCommitCard`, `aiProgress`, the
clarifier / proposal / timeline logic, `useAiThreadMessages`, `importBoundary`, ...) plus
`stores/aiThreadsStore.test.ts` (legacy-key migration), `services/ai-agent.service.test.ts`,
and `components/home/DashboardAiPanel.test.tsx`. Drive the Playwright specs adaptively —
answer the clarifier the assistant asks before the next prompt.

## See also

- [state-and-services.md](./state-and-services.md) — the stores and clients in the wider app.
- [roadmap-canvas.md](./roadmap-canvas.md) — what `applyAiCommitImpactedItems` does to the canvas.
- [Agent & Roadmap AI](../05-agent-ai/README.md) — the run machine on the agent side.
- [Workspaces](../11-domains/workspaces/README.md#ai-assistant) — workspace-scope threads and lanes.
