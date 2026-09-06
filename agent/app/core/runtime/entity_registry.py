"""Bounded, typed grounding facts from authorized context and tool results.

No network reads live here. The dispatcher supplies results before the engine
truncates them; durable snapshots deliberately exclude this per-run cache.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Iterable
from typing import Any

from app.core.contracts.runs import EntitySeen, RunState
from app.core.runtime.handles import merged_handle_map
from app.core.uuid_utils import is_uuid_like, normalize_uuid

ENTITY_KINDS = frozenset({'workspace', 'project', 'roadmap', 'epic', 'feature', 'task', 'milestone', 'team'})
MAX_ENTITIES_SEEN = 600

# Known result containers are typed by the wire contract. None means the
# item must supply its own type/kind; no type is inferred for ambiguous lists.
ENTITY_SHAPES: dict[str, str | None] = {
    'tasks': 'task', 'epics': 'epic', 'features': 'feature', 'milestones': 'milestone',
    'items': 'roadmap', 'roadmaps': 'roadmap', 'projects': 'project', 'teams': 'team',
    'workspace': 'workspace', 'project': 'project', 'roadmap': 'roadmap',
    'children': None, 'matches': None, 'results': None, 'candidates': None,
    'node': None, 'parent': None, 'selected': None,
}
_KNOWN_TOOLS = frozenset({
    'get_workspace_overview', 'list_roadmaps', 'search_everything', 'list_my_tasks',
    'get_roadmap_overview', 'get_roadmap_summary', 'get_epics_by_roadmap',
    'get_features_by_epic', 'get_epic_progress', 'get_feature_details',
    'get_tasks_by_parent', 'get_tasks_by_feature', 'get_tasks_by_epic',
    'get_tasks_by_status', 'get_overdue_tasks', 'get_blocked_items',
    'get_tasks_assigned_to_me', 'search_nodes', 'search_tasks', 'get_node_details',
    'resolve_node_reference', 'get_children', 'get_children_from_resolution',
    'get_project_brief', 'list_project_resources', 'list_project_meetings',
    'create_roadmap', 'attach_roadmap_to_project',
})
_SKIP_KEYS = frozenset({'members', 'assignees', 'profiles', 'owner'})
_SIDE_FIELDS = {
    'roadmap': ('roadmap_name', 'roadmap_title'),
    'project': ('project_title',),
    'epic': ('epic_title',),
    'feature': ('feature_title',),
}


def normalize_title(value: str) -> str:
    normalized = unicodedata.normalize('NFKC', value).casefold()
    normalized = re.sub(r'^\s*\([^)]*\)\s*', '', normalized, count=1)
    return ''.join(char for char in normalized if char.isalnum())


def titles_match(left: str, right: str) -> bool:
    a, b = normalize_title(left), normalize_title(right)
    if not a or not b:
        return False
    return a == b or (min(len(a), len(b)) >= 12 and (a in b or b in a))


def _entity(kind: Any, entity_id: Any, title: Any) -> EntitySeen | None:
    # Local import shares the prompt's canonical string cleanup without a
    # module cycle: prompt -> entity_links -> entity_registry -> prompt.
    from app.core.runtime.prompt import _clean

    clean_title = _clean(title)
    if not isinstance(kind, str) or kind not in ENTITY_KINDS or not is_uuid_like(entity_id) or not clean_title:
        return None
    return EntitySeen(kind=kind, id=normalize_uuid(entity_id), title=clean_title)


def register(run: RunState, kind: str | EntitySeen, entity_id: str | None = None, title: str | None = None) -> None:
    """Add one UUID-backed fact; a later title updates its original FIFO slot."""
    entry = _entity(kind.kind, kind.id, kind.title) if isinstance(kind, EntitySeen) else _entity(kind, entity_id, title)
    if entry is None:
        return
    for index, current in enumerate(run.entities_seen):
        if (current.kind, current.id) == (entry.kind, entry.id):
            run.entities_seen[index] = entry
            return
    run.entities_seen.append(entry)
    if len(run.entities_seen) > MAX_ENTITIES_SEEN:
        del run.entities_seen[:-MAX_ENTITIES_SEEN]


def register_many(run: RunState, entries: Iterable[EntitySeen]) -> None:
    for entry in entries:
        register(run, entry)


def harvest_tool_result(tool_name: str, result: dict[str, Any]) -> list[EntitySeen]:
    """Recognize declared result shapes, conservatively walking unknown tools.

    Explicitly typed dictionaries work for future tools without accidentally
    treating profiles or arbitrary `items` as roadmap nodes. Traversal is
    bounded even for malformed or recursively linked result dictionaries.
    """
    if not isinstance(result, dict) or result.get('error'):
        return []
    known = tool_name in _KNOWN_TOOLS
    found: dict[tuple[str, str], EntitySeen] = {}
    visited = 0
    max_entries = 4000 if known else 200
    max_depth = 8 if known else 4

    def add(kind: Any, entity_id: Any, title: Any) -> None:
        entry = _entity(kind, entity_id, title)
        if entry is not None:
            found[(entry.kind, entry.id)] = entry

    def walk(value: Any, depth: int, implied_kind: str | None = None) -> None:
        nonlocal visited
        if depth > max_depth or visited >= max_entries:
            return
        if isinstance(value, list):
            for item in value:
                if visited >= max_entries:
                    break
                walk(item, depth, implied_kind)
            return
        if not isinstance(value, dict):
            return
        visited += 1
        if value.get('accessible') is False or value.get('error'):
            return
        kind = value.get('type') or value.get('kind') or implied_kind
        add(kind, value.get('id'), value.get('title') or value.get('name'))
        if known:
            # resolve_node_reference also exposes its selection at the root.
            add(value.get('node_type'), value.get('node_id'), value.get('title'))
            for side_kind, title_keys in _SIDE_FIELDS.items():
                side_title = next((value.get(key) for key in title_keys if value.get(key)), None)
                if side_kind == 'roadmap' and not side_title:
                    # Summary roots have roadmap_id+title and no id. A task's
                    # own title must NEVER be attached to its roadmap_id.
                    if kind == 'roadmap' or (
                        not value.get('id') and not value.get('node_id') and not kind
                    ):
                        side_title = value.get('title') or value.get('name')
                add(side_kind, value.get(f'{side_kind}_id'), side_title)
        for key, nested in value.items():
            if key in _SKIP_KEYS or not isinstance(nested, (dict, list)):
                continue
            walk(nested, depth + 1, ENTITY_SHAPES.get(key) if known else None)

    walk(result, 0)
    return list(found.values())


def register_workspace_overview(
    run: RunState, payload: dict[str, Any] | None, *, replace_existing: bool = True,
) -> None:
    """Seed an overview; a reused cache must not overwrite newer tool facts.

    A freshly fetched payload remains a new observation and replaces titles
    normally. Callers mark a reused cached payload with replace_existing=False.
    """
    entries = harvest_tool_result('get_workspace_overview', payload or {})
    if not replace_existing:
        known = {(entry.kind, entry.id) for entry in run.entities_seen}
        entries = [entry for entry in entries if (entry.kind, entry.id) not in known]
    register_many(run, entries)


def make_entity_sink(run: RunState) -> Callable[[str, dict[str, Any]], None]:
    def sink(tool_name: str, result: dict[str, Any]) -> None:
        register_many(run, harvest_tool_result(tool_name, result))

    return sink


def build_lookup(session: Any, run: RunState) -> dict[tuple[str, str], EntitySeen]:
    """Merge existing authorized state without copying facts into the run.

    Cached/older context precedes fresh tool observations, and committed
    titles win last so a rename in this run does not reject its final report.
    """
    lookup: dict[tuple[str, str], EntitySeen] = {}

    def add(kind: Any, entity_id: Any, title: Any) -> None:
        entry = _entity(kind, entity_id, title)
        if entry is not None:
            lookup[(entry.kind, entry.id)] = entry

    metadata = session.metadata
    for entry in harvest_tool_result('get_workspace_overview', metadata.workspace_context or {}):
        add(entry.kind, entry.id, entry.title)
    for target in metadata.recent_resolved_targets or []:
        add(target.node_type, target.node_id, target.title)
    for roadmap_id, context in metadata.roadmaps.items():
        add('roadmap', roadmap_id, context.title)
        project = context.project_context.get('project') if isinstance(context.project_context, dict) else None
        if isinstance(project, dict):
            add('project', project.get('id'), project.get('title'))
            workspace = project.get('workspace')
            if isinstance(workspace, dict):
                add('workspace', workspace.get('id'), workspace.get('name'))
    for entry in merged_handle_map(session, run).values():
        add(entry.get('type'), entry.get('id'), entry.get('title'))
    for ref in run.resolved_refs:
        if ref.accessible:
            add(ref.kind, ref.id, ref.title)
            for parent in ref.parent_chain:
                add(parent.kind, parent.id, parent.title)
    for entry in run.entities_seen:
        add(entry.kind, entry.id, entry.title)
    for batch in run.batches:
        add('roadmap', batch.roadmap_id, batch.roadmap_title)
    for commit in run.commits:
        for item in commit.impacted_items:
            add(item.node_type, item.node_id, item.title)
    return lookup
