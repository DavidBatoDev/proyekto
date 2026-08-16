# Roadmap Canvas

> **Last updated:** 2026-08-16 · **Status:** current

The roadmap canvas is the most complex surface in the web app: a graph of
epics → features → tasks, an AI assistant panel, a JSON editor, and several view
modes — all driven by `roadmapStore` with **optimistic UI** so edits feel instant and
reconcile (or roll back) against the server.

> **No graph library.** The canvas is drawn by an in-house DOM+SVG engine in
> `src/lib/flow/`. `@xyflow/react` and `dagre` were removed on 2026-08-16; the engine
> replaced the former, and the latter had never been imported at all. Layout is the
> hand-written `getLayoutedElements` in `canvas/model/layout.ts`, which columns epics
> on the left with their features offset right.

## The engine

`src/lib/flow/` may import **only** `react`/`react-dom` — no app modules, no UI
framework — so it can be lifted into its own package for reuse. `importBoundary.test.ts`
enforces that mechanically.

| Piece | File |
| --- | --- |
| Engine root (pane, layers, culling) | `lib/flow/Flow.tsx` |
| Pan / zoom / wheel / touch | `lib/flow/usePanZoom.ts` |
| Node dragging | `lib/flow/useNodeDrag.ts` |
| Edge layer | `lib/flow/FlowEdges.tsx` + `lib/flow/edgePath.ts` |
| Handle registration + geometry | `lib/flow/handles.ts`, `lib/flow/FlowNodeContext.tsx` |
| Viewport maths (fitView, d3 constrain) | `lib/flow/transform.ts` |
| App-side adapter | `canvas/renderers/DomSvgRenderer.tsx` |
| Node-authoring port (widgets use this) | `canvas/ports/node.tsx` |

Three design points worth knowing before changing it:

- **Gestures never re-render React.** The viewport lives in a ref; pointer handlers
  mutate a pending value and one rAF writes `transform` straight to the pane. A drag
  moves its node by writing the element's transform directly and reporting the
  absolute position, so drag frames cost zero renders too.
- **Culling keeps nodes mounted** (`content-visibility`), so task-list scroll
  positions, open menus and drag state survive a pan. That trades a larger DOM for
  interaction smoothness, deliberately.
- **Edges anchor to the rendered card**, not to the declared node height — the layout
  pass's height is spacing metadata that the card does not fill.

Edge paths and `fitView` framing are pinned to goldens recorded from the previous
library before it was removed (`lib/flow/edgePath.test.ts`, `transform.test.ts`); a
diff there means every edge or the framing moved.

## Composition

`views/roadmap/components/RoadmapViewContent.tsx` orchestrates everything: it mounts
the top bar, the canvas, the AI assistant panel, and the JSON side panel, pulls live
data via `useRoadmapFullLiveQuery`, and drives `useRoadmapStore`. The route
`project/$projectId/roadmap/$roadmapId.tsx` renders it.

| Piece | File |
| --- | --- |
| Orchestrator | `views/roadmap/components/RoadmapViewContent.tsx` |
| View switcher | `views/roadmap/components/RoadmapCanvas.tsx` (`canvasViewMode`) |
| Hierarchy view | `views/roadmap/RoadmapView.tsx` (canvas shell) |
| Nodes | `widgets/EpicWidget.tsx`, `widgets/FeatureWidget.tsx`, `widgets/SortableTaskList.tsx` |
| Top bar | `views/RoadmapTopBar.tsx` (view toggle + sortable epic tabs) |
| AI panel | `ai/RoadmapAiAssistantPanel.tsx` + `ai/useRoadmapAiAssistantSession.ts` |
| JSON panel | `panels/JSONRoadmapSidePanel.tsx` (Monaco) |
| Milestones / Gantt | `views/milestones/MilestonesView.tsx` |
| Kanban | `views/kanban/*` (driven by `boardFilters`) |

## Views

`canvasViewMode` (`"roadmap" | "epic" | "milestones"`) switches between:

- **Roadmap hierarchy** — the epic→feature→task graph; node types
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
