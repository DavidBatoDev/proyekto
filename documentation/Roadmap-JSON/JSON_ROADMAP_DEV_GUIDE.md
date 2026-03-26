# JSON Roadmap Developer Guide

## Purpose

This guide explains how developers can create and modify a full roadmap structure using JSON in PRDigy.

It covers:

- Creating a complete roadmap hierarchy
- Modifying an existing roadmap hierarchy
- Using the JSON editor panel in the roadmap page
- API payload examples

This guide is practical and workflow-focused. For deeper schema details, see `../ROADMAP_JSON_STRUCTURE.md`.

---

## Where This Is Used

Roadmap route example:

`/project/:projectId/roadmap/:roadmapId`

Example:

`/project/c8ec4e1f-4d66-4e72-830f-b5f1af562f29/roadmap/8aa6df6f-f02f-4937-9d0a-9e3f8bd881b9`

In the roadmap top bar, use the `JSON` button to open the `JSONRoadmapSidePanel`.

---

## Core Concept

A roadmap is edited as one hierarchical JSON document:

- `roadmap`
- `roadmap_epics[]`
- `roadmap_features[]`
- `roadmap_tasks[]`

When saved, the backend upserts this full structure atomically.

### Atomic + Idempotent Behavior

- Save uses a transactional upsert in Postgres (`upsert_full_roadmap`)
- Existing IDs are updated
- Missing IDs are created
- Removed nested nodes are deleted from the hierarchy
- Re-saving the same JSON should not create duplicates

---

## JSON Shape (Expected)

```json
{
  "id": "roadmap-uuid",
  "name": "Roadmap Name",
  "description": "Optional description",
  "project_id": "project-uuid",
  "status": "draft",
  "start_date": "2026-03-01T00:00:00Z",
  "end_date": "2026-06-30T00:00:00Z",
  "settings": {},
  "roadmap_epics": [
    {
      "id": "epic-uuid",
      "title": "Epic title",
      "description": "Optional",
      "status": "planned",
      "priority": "high",
      "position": 0,
      "roadmap_features": [
        {
          "id": "feature-uuid",
          "title": "Feature title",
          "description": "Optional",
          "status": "not_started",
          "position": 0,
          "is_deliverable": true,
          "roadmap_tasks": [
            {
              "id": "task-uuid",
              "title": "Task title",
              "description": "Optional",
              "status": "todo",
              "priority": "medium",
              "position": 0,
              "assignee_id": "user-uuid",
              "due_date": "2026-03-15T00:00:00Z"
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Create Full Roadmap (Developer Flow)

Use endpoint:

- `POST /api/roadmaps/full`

Notes:

- If `id` is provided and exists, data is upserted to that roadmap.
- If `id` is missing, server can generate IDs for nested nodes.
- `owner_id` is set/enforced server-side from authenticated user context and DB function owner checks.

### Example Request

```json
{
  "name": "Q2 Product Launch Roadmap",
  "description": "Roadmap for Q2 platform delivery",
  "project_id": "c8ec4e1f-4d66-4e72-830f-b5f1af562f29",
  "status": "draft",
  "start_date": "2026-04-01T00:00:00Z",
  "end_date": "2026-06-30T00:00:00Z",
  "settings": {
    "view_mode": "roadmap"
  },
  "roadmap_epics": [
    {
      "title": "Platform Foundation",
      "status": "planned",
      "priority": "high",
      "position": 0,
      "roadmap_features": [
        {
          "title": "Auth Hardening",
          "status": "not_started",
          "position": 0,
          "is_deliverable": true,
          "roadmap_tasks": [
            {
              "title": "Rotate signing keys",
              "status": "todo",
              "priority": "high",
              "position": 0
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Modify Existing Roadmap (Developer Flow)

### Option A: Full JSON Upsert (recommended for JSON panel)

1. Open roadmap page
2. Click `JSON` in top bar
3. Edit full JSON
4. Click `Save`

Under the hood, frontend sends:

- `POST /api/roadmaps/full`

with current `roadmapId` as `id`.

### Option B: JSON Patch (RFC 6902)

For programmatic partial operations, use:

- `PATCH /api/roadmaps/:id/json-patch`

Example:

```json
[
  { "op": "replace", "path": "/name", "value": "Updated Roadmap Name" },
  {
    "op": "replace",
    "path": "/roadmap_epics/0/title",
    "value": "New Epic Title"
  }
]
```

---

## Safe Editing Rules

1. Keep `id` stable for nodes you want to update.
2. Remove a node from JSON only when you want it deleted.
3. Keep `position` values deterministic (`0..n`) for ordering.
4. Ensure required fields exist:
   - roadmap: `name`
   - epic: `title`
   - feature: `title`
   - task: `title`
5. Ensure top-level `id` matches current roadmap route ID when editing existing roadmap.
6. Use valid enums for statuses/priorities.

---

## Enum Reference

- roadmap `status`: `draft | active | paused | completed | archived`
- epic `status`: `backlog | planned | in_progress | in_review | completed | on_hold`
- epic `priority`: `critical | high | medium | low | nice_to_have`
- feature `status`: `not_started | in_progress | in_review | completed | blocked`
- task `status`: `todo | in_progress | in_review | done | blocked`
- task `priority`: `urgent | high | medium | low`

---

## Troubleshooting

### "Invalid JSON"

- Ensure valid JSON syntax (double quotes, no trailing commas, no comments).

### "Roadmap JSON id must match current roadmap page"

- Set top-level `id` to the same `:roadmapId` in route.

### "Not the owner"

- You are authenticated but not the owner for this roadmap. Backend blocks update.

### Duplicate items after save

- Usually caused by changing/removing existing `id` values. Keep IDs stable for updates.

---

## Planned AI Editing Architecture

The AI-assisted roadmap editing architecture is documented in:

- `../Backend-Docs/08-AI-ROADMAP-EDITOR-ARCHITECTURE.md`

Important:

- This JSON guide describes the **current implemented Dev Mode workflow**.
- The AI architecture document describes the **planned preview/diff/commit AI flow**.
- Until implementation is complete, `POST /api/roadmaps/full` and `PATCH /api/roadmaps/:id/json-patch` remain the active JSON edit mechanisms.

---

## Related Files

Frontend:

- `web/src/components/roadmap/panels/JSONRoadmapSidePanel.tsx`
- `web/src/components/roadmap/views/RoadmapTopBar.tsx`
- `web/src/components/roadmap/views/RoadmapViewContent.tsx`
- `web/src/services/roadmap.service.ts`

Backend:

- `backend/src/modules/roadmaps/controllers/roadmap-patch.controller.ts`
- `backend/src/modules/roadmaps/services/roadmap-patch.service.ts`
- `backend/src/modules/roadmaps/repositories/roadmap-patch.repository.supabase.ts`

Database migration function:

- `supabase/migrations/20260306133000_enforce_owner_id_in_upsert_full_roadmap.sql`
