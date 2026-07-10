# JSON Dev-Mode Editing

> **Last updated:** 2026-07-09 · **Status:** current

Besides the AI assistant and the canvas, a roadmap can be edited **directly as JSON**
— useful for bulk changes, scripting, and debugging. The roadmap top bar's `JSON`
button opens `JSONRoadmapSidePanel`, and there are two HTTP paths: a **full atomic
upsert** and an **RFC 6902 JSON Patch**. Both converge on the same
`upsert_full_roadmap` RPC that the AI commit path uses.

> All three edit paths — AI, optimistic canvas, and this JSON mode — land in Postgres
> through `upsert_full_roadmap`, so persistence semantics are identical.

## The roadmap document

A roadmap is one hierarchical JSON document: `roadmap → roadmap_epics[] →
roadmap_features[] → roadmap_tasks[]`.

```jsonc
{
  "id": "roadmap-uuid",           // must match the current roadmap when editing
  "name": "Q2 Product Launch",
  "project_id": "project-uuid",
  "status": "draft",
  "start_date": "2026-04-01T00:00:00Z",
  "end_date": "2026-06-30T00:00:00Z",
  "roadmap_epics": [{
    "id": "epic-uuid", "title": "Platform Foundation",
    "status": "planned", "priority": "high", "position": 0,
    "roadmap_features": [{
      "id": "feature-uuid", "title": "Auth Hardening",
      "position": 0, "is_deliverable": true,   // note: no feature "status" — it's derived
      "roadmap_tasks": [{
        "id": "task-uuid", "title": "Rotate signing keys",
        "status": "todo", "priority": "high", "position": 0
      }]
    }]
  }]
}
```

> **⚠️ Feature status is derived, not stored.** Unlike epics and tasks, a feature has
> **no** status column — its status is computed in app code from its child tasks
> (the `feature_status` enum was dropped). Older guides showed a feature `status`
> field; ignore it. See [Data → schema overview](../07-data-and-db/schema-overview.md).

## The two endpoints

| Endpoint | Use |
| --- | --- |
| `POST /api/roadmaps/full` | Create or full-upsert the entire tree (what the JSON panel's Save calls, with the current `roadmapId` as `id`) |
| `PATCH /api/roadmaps/:id/json-patch` | Programmatic partial edits via RFC 6902 |

```jsonc
// PATCH /api/roadmaps/:id/json-patch
[
  { "op": "replace", "path": "/name", "value": "Updated Roadmap Name" },
  { "op": "replace", "path": "/roadmap_epics/0/title", "value": "New Epic Title" }
]
```

## Atomic + idempotent behavior

`POST /roadmaps/full` runs through the transactional `upsert_full_roadmap` RPC:

- Existing `id`s are **updated**; missing `id`s are **created**; nodes removed from the
  JSON are **deleted**.
- Re-saving the same JSON does not create duplicates.
- `owner_id` is enforced server-side (a non-owner gets "Not the owner").

## Safe editing rules

1. Keep `id` stable for nodes you want to update; remove a node only to delete it.
2. Use deterministic `position` values (`0..n`) for ordering.
3. Required fields: roadmap `name`; epic/feature/task `title`.
4. Top-level `id` must equal the current roadmap route id when editing an existing one.
5. Use valid enums (roadmap/epic/task status, epic/task priority — see
   [schema-overview.md](../07-data-and-db/schema-overview.md)). Feature has no status.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Invalid JSON" | Syntax error — double quotes, no trailing commas, no comments |
| "Roadmap JSON id must match current roadmap page" | Set top-level `id` to the route's `:roadmapId` |
| "Not the owner" | Authenticated but not the roadmap owner — the backend blocks the write |
| Duplicate items after save | You changed/removed existing `id` values — keep ids stable for updates |

## Code locations

- **Web:** `web/src/components/roadmap/panels/JSONRoadmapSidePanel.tsx`, `RoadmapTopBar.tsx`, `web/src/services/roadmap.service.ts`
- **Backend:** [`roadmap-patch.controller.ts`](../../backend/src/modules/roadmaps/controllers/roadmap-patch.controller.ts), `roadmap-patch.service.ts`, `roadmap-patch.repository.supabase.ts`
- **RPC:** `upsert_full_roadmap` (see [migrations-workflow.md](../07-data-and-db/migrations-workflow.md))
