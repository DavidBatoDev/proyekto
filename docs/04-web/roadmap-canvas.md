# Roadmap Canvas

> **Last updated:** 2026-07-09 · **Status:** current

The roadmap canvas is the most complex surface in the web app: an **XYFlow (React
Flow)** graph of epics → features → tasks, an AI assistant panel, a JSON editor, and
several view modes — all driven by `roadmapStore` with **optimistic UI** so edits feel
instant and reconcile (or roll back) against the server.

> **Not dagre.** `dagre` is a declared dependency but is **not imported** anywhere —
> layout is a hand-written `getLayoutedElements` that columns epics on the left with
> their features offset right. (The CLAUDE.md "XYFlow/dagre" shorthand is inaccurate.)

## Composition

`views/roadmap/components/RoadmapViewContent.tsx` orchestrates everything: it mounts
the top bar, the canvas, the AI assistant panel, and the JSON side panel, pulls live
data via `useRoadmapFullLiveQuery`, and drives `useRoadmapStore`. The route
`project/$projectId/roadmap/$roadmapId.tsx` renders it.

| Piece | File |
| --- | --- |
| Orchestrator | `views/roadmap/components/RoadmapViewContent.tsx` |
| View switcher | `views/roadmap/components/RoadmapCanvas.tsx` (`canvasViewMode`) |
| Hierarchy view | `views/roadmap/RoadmapView.tsx` (XYFlow) |
| Nodes | `widgets/EpicWidget.tsx`, `widgets/FeatureWidget.tsx`, `widgets/{SortableTaskList,TaskWidget}.tsx` |
| Top bar | `views/RoadmapTopBar.tsx` (view toggle + sortable epic tabs) |
| AI panel | `ai/RoadmapAiAssistantPanel.tsx` + `ai/useRoadmapAiAssistantSession.ts` |
| JSON panel | `panels/JSONRoadmapSidePanel.tsx` (Monaco) |
| Milestones / Gantt | `views/milestones/MilestonesView.tsx` |
| Kanban | `views/kanban/*` (driven by `boardFilters`) |

## Views

`canvasViewMode` (`"roadmap" | "epic" | "milestones"`) switches between:

- **Roadmap hierarchy** — the XYFlow epic→feature→task graph; custom node types
  `epicWidget` / `featureWidget`, tasks rendered inside feature widgets; edges are
  epic→feature (colored by derived feature status) plus a dashed epic chain.
- **Milestones / timeline (Gantt)** — features on a timeline (`views/milestones/`),
  matching the [product model](../01-product/roadmap-and-milestones.md).
- **Kanban** — status boards (`views/kanban/`).

Mobile falls back to `MobileRoadmapView.tsx`. The layout only recomputes on
structural/position changes (a memoized `layoutKey`), not on task-content edits.

## Optimistic UI

`roadmapStore` applies every mutation locally first, then reconciles:

- **Create** — inserts a node with a `temp-<type>-<ts>-<rand>` id and optimistic
  `position` (shifting siblings), calls the service, then maps the real id via
  `tempToRealNodeId` and swaps it; on error it removes the temp node and un-shifts.
  `resolveCanonicalNodeId` keeps `?nodeId=` URLs from leaking `temp-` ids.
- **Update** — snapshots the node, applies the patch, sets `pending<Type>ById`, and
  restores the snapshot on failure. Task status uses a queued-intent model
  (`queuedTaskStatusIntentById` / `activeTaskStatusSyncById` / `taskStatusRollbackById`).
- **Reorder / move** — optimistically renumber, try the batch reorder endpoint, fall
  back to sequential position updates on constraint errors.
- **Server-data merge** — `applyRoadmapSnapshot(full)` replaces roadmap/epics/milestones
  **without** clearing in-flight optimistic flags (so a collaborator's refetch doesn't
  flash away your in-progress drag). `applyAiCommitImpactedItems(...)` merges a
  just-committed AI edit locally so the canvas updates instantly instead of waiting
  for a full reload.

## AI & JSON editing

- The **AI panel** talks to the agent via `roadmap-agent.service.ts` (plan-mode
  operations + trace events), with thread state in `roadmapAiThreadsStore`. See
  [Agent & Roadmap AI](../05-agent-ai/README.md).
- The **JSON panel** is a Monaco editor over the full roadmap; Save validates and
  upserts through `POST /roadmaps/full`. See
  [Agent → JSON dev-mode editing](../05-agent-ai/json-editing.md).

All three edit paths — canvas, AI, JSON — converge on the backend's
`upsert_full_roadmap` RPC.

## Collaboration

`useRoadmapCollaboration` + `RoadmapCanvas` broadcast a `data_changed` event when
mutation activity settles, so peers refetch; peer cursors/typing/drag are relayed via
the realtime Worker. See [Realtime](../06-realtime/README.md).
