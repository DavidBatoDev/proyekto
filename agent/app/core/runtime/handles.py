"""Roadmap handle helpers (the ``E1`` / ``E1.F2`` / ``M1`` / ``R2.E1`` tokens).

Each loaded roadmap's outline is rendered by ``runtime.overview`` with a
per-roadmap handle map cached on ``RoadmapContext.handle_map``. The focus
roadmap keeps bare handles; every other loaded roadmap carries an ``R{n}``
prefix, so the union of all maps ("the merged map") is collision-free by
construction. The model addresses nodes by handle and the tool registry
expands them to uuids at parse time (``set_active_handle_map`` /
``_expand_handles_in_op_dict`` in ``app.core.tools.registry``); the merged map
is what gets installed there.

This module hosts the merged map, the per-roadmap readers shared by the loop
engine and the tool executor, and the batch-vs-roadmap guard that rejects an
operation whose target belongs to a different roadmap than the batch.
"""

from __future__ import annotations

from typing import Any, Iterable

# Operation fields that carry a node reference (post handle-expansion these
# hold uuids).
_NODE_ID_FIELDS = ('node_id', 'parent_id', 'new_parent_id')


def node_types_by_id(
    handle_map: dict[str, dict[str, Any]] | None,
) -> dict[str, str]:
    """Invert the handle map into { node_id: node_type }.

    The outline carries epics, features and milestones — exactly the node types
    that have no assignee and a narrower patch surface than tasks. Tasks are not
    in the outline, so an unknown id is treated as unverifiable and left to the
    backend rather than guessed at.
    """
    if not handle_map:
        return {}
    resolved: dict[str, str] = {}
    for entry in handle_map.values():
        if not isinstance(entry, dict):
            continue
        node_id = entry.get('id')
        node_type = entry.get('type')
        if isinstance(node_id, str) and node_id and isinstance(node_type, str):
            resolved[node_id] = node_type
    return resolved


def live_epic_titles(
    handle_map: dict[str, dict[str, Any]] | None,
) -> frozenset[str]:
    """Lower-cased titles of epics already on the live roadmap (from the
    handle-map outline), for duplicate detection. Pass the batch roadmap's
    OWN map, never the merged one."""
    if not handle_map:
        return frozenset()
    titles: set[str] = set()
    for entry in handle_map.values():
        if not isinstance(entry, dict) or entry.get('type') != 'epic':
            continue
        title = entry.get('title')
        if isinstance(title, str) and title.strip():
            titles.add(title.strip().lower())
    return frozenset(titles)


def handle_map_for_roadmap(session: Any, roadmap_id: str | None) -> dict[str, dict[str, Any]]:
    """The cached handle map of one loaded roadmap ({} when not loaded)."""
    if not roadmap_id:
        return {}
    context = session.metadata.roadmaps.get(roadmap_id)
    if context is None:
        return {}
    return dict(context.handle_map or {})


def merged_handle_map(session: Any, run: Any = None) -> dict[str, dict[str, Any]]:
    """Union of every loaded roadmap's handle map, each entry stamped with its
    ``roadmap_id``. ``run`` is accepted for symmetry with the phase helpers
    (its ``focus_roadmap_ids`` are always loaded, so the union already covers
    them); collisions are impossible because non-focus maps are prefixed."""
    _ = run
    merged: dict[str, dict[str, Any]] = {}
    roadmaps = getattr(session.metadata, 'roadmaps', None) or {}
    for roadmap_id, context in roadmaps.items():
        handle_map = getattr(context, 'handle_map', None) or {}
        for handle, entry in handle_map.items():
            if not isinstance(entry, dict):
                continue
            stamped = dict(entry)
            stamped.setdefault('roadmap_id', roadmap_id)
            merged[handle] = stamped
    return merged


def handle_for_node_id(
    handle_map: dict[str, dict[str, Any]] | None, node_id: str | None
) -> str | None:
    """Reverse lookup: the handle whose entry carries ``node_id``."""
    if not handle_map or not node_id:
        return None
    for handle, entry in handle_map.items():
        if isinstance(entry, dict) and entry.get('id') == node_id:
            return handle
    return None


def node_roadmap_index(
    merged_map: dict[str, dict[str, Any]] | None,
    recent_targets: Iterable[Any] | None = None,
) -> dict[str, tuple[str, str | None]]:
    """{ node_id: (roadmap_id, handle) } for every node whose roadmap is
    KNOWN — handle-map entries and recent resolved targets that carry a
    ``roadmap_id``. Targets recorded before roadmaps were tracked (no
    ``roadmap_id``) are left out, so they pass batch validation."""
    index: dict[str, tuple[str, str | None]] = {}
    for handle, entry in (merged_map or {}).items():
        if not isinstance(entry, dict):
            continue
        node_id = entry.get('id')
        roadmap_id = entry.get('roadmap_id')
        if isinstance(node_id, str) and node_id and isinstance(roadmap_id, str) and roadmap_id:
            index[node_id] = (roadmap_id, handle)
    for target in recent_targets or []:
        node_id = getattr(target, 'node_id', None)
        roadmap_id = getattr(target, 'roadmap_id', None)
        if target is not None and isinstance(target, dict):
            node_id = target.get('node_id')
            roadmap_id = target.get('roadmap_id')
        if (
            isinstance(node_id, str)
            and node_id
            and isinstance(roadmap_id, str)
            and roadmap_id
            and node_id not in index
        ):
            index[node_id] = (roadmap_id, None)
    return index


def roadmap_prefix_label(session: Any, roadmap_id: str) -> str:
    """``(R2)`` for a prefixed roadmap, ``(focus)`` for the focus roadmap."""
    context = session.metadata.roadmaps.get(roadmap_id) if session is not None else None
    prefix = getattr(context, 'handle_prefix', None) if context is not None else None
    return f'({prefix})' if prefix else '(focus)'


def validate_batch_roadmap(
    operations: list[Any],
    roadmap_id: str | None,
    merged_map: dict[str, dict[str, Any]] | None,
    *,
    recent_targets: Iterable[Any] | None = None,
    roadmap_titles: dict[str, str | None] | None = None,
    roadmap_prefixes: dict[str, str | None] | None = None,
) -> str | None:
    """Reject a batch that references a node known to live on ANOTHER roadmap.

    Runs after handle expansion, over ``node_id`` / ``parent_id`` /
    ``new_parent_id`` and ``targets[]``. Only ids whose roadmap is known (the
    merged handle map, recent targets with a ``roadmap_id``) are checked;
    unknown uuids (tasks are not in the outline) and pre-migration targets
    pass — the backend rejects cross-roadmap ids at preview/commit. Returns
    the corrective message, or ``None`` when the batch is consistent.
    """
    if not roadmap_id or not operations:
        return None
    index = node_roadmap_index(merged_map, recent_targets)
    if not index:
        return None
    titles = roadmap_titles or {}
    prefixes = roadmap_prefixes or {}
    for operation in operations:
        for node_id in _referenced_node_ids(operation):
            known = index.get(node_id)
            if known is None:
                continue
            owner_id, handle = known
            if owner_id == roadmap_id:
                continue
            owner_title = titles.get(owner_id) or owner_id
            owner_prefix = prefixes.get(owner_id)
            owner_label = f'"{owner_title}" ({owner_prefix})' if owner_prefix else f'"{owner_title}" (focus)'
            batch_title = titles.get(roadmap_id) or roadmap_id
            reference = f'"{handle}"' if handle else f'node {node_id}'
            return (
                f'HANDLE_ROADMAP_MISMATCH: {reference} belongs to roadmap {owner_label}, '
                f'not the batch\'s roadmap "{batch_title}". Use roadmap_id="{owner_id}" '
                'for that operation.'
            )
    return None


def _referenced_node_ids(operation: Any) -> list[str]:
    ids: list[str] = []
    for field in _NODE_ID_FIELDS:
        value = _read_field(operation, field)
        if isinstance(value, str) and value.strip():
            ids.append(value.strip())
    targets = _read_field(operation, 'targets')
    if isinstance(targets, list):
        for entry in targets:
            if isinstance(entry, str) and entry.strip():
                ids.append(entry.strip())
    return ids


def _read_field(operation: Any, field: str) -> Any:
    if isinstance(operation, dict):
        return operation.get(field)
    return getattr(operation, field, None)
