"""Persist a compact log of committed semantic-diff changes on the session.

After every successful auto-commit we walk the backend's `semantic_diff.changes`
and store up to `MAX_APPLIED_CHANGES` entries on `session.metadata.recent_applied_changes`,
most recent first. A prose rendering of this log is injected into the
planner's system prompt so the LLM can handle undo/revert requests without
having to re-resolve by (possibly stale) titles from earlier assistant
messages.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.contracts.sessions import AgentSession, AppliedChange

MAX_APPLIED_CHANGES = 10


def record_applied_changes_from_commit(
    session: AgentSession,
    commit_result: dict[str, Any],
    max_entries: int = MAX_APPLIED_CHANGES,
) -> int:
    """Append entries from `semantic_diff.changes` onto the session, capped
    at `max_entries`, most recent first. Returns the number of entries added.
    """
    semantic_diff = commit_result.get('semantic_diff')
    if not isinstance(semantic_diff, dict):
        return 0
    changes_raw = semantic_diff.get('changes')
    if not isinstance(changes_raw, list):
        return 0

    committed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    new_entries: list[AppliedChange] = []
    for change in changes_raw:
        entry = _parse_change_entry(change, committed_at)
        if entry is not None:
            new_entries.append(entry)

    if not new_entries:
        return 0

    existing = session.metadata.recent_applied_changes or []
    combined = new_entries + list(existing)
    session.metadata.recent_applied_changes = combined[: max(0, int(max_entries))]
    return len(new_entries)


def _parse_change_entry(
    change: Any, committed_at: datetime,
) -> AppliedChange | None:
    if not isinstance(change, dict):
        return None
    node = change.get('node')
    if not isinstance(node, dict):
        return None
    node_id = node.get('id')
    node_type = node.get('type')
    change_type = change.get('type')
    if not isinstance(node_id, str) or not node_id.strip():
        return None
    if not isinstance(node_type, str) or not node_type.strip():
        return None
    if not isinstance(change_type, str) or not change_type.strip():
        return None
    change_from_raw = change.get('from')
    change_to_raw = change.get('to')
    change_from = change_from_raw if isinstance(change_from_raw, dict) else {}
    change_to = change_to_raw if isinstance(change_to_raw, dict) else {}

    # Best-effort title extraction for prose rendering — we prefer the
    # post-change title so a TITLE_CHANGED reads as the current name.
    title: str | None = None
    for source in (change_to, change_from):
        for key in ('title', 'name'):
            candidate = source.get(key)
            if isinstance(candidate, str) and candidate.strip():
                title = candidate.strip()
                break
        if title:
            break

    return AppliedChange(
        node_id=node_id.strip(),
        node_type=node_type.strip().lower(),
        change_type=change_type.strip().upper(),
        change_from=dict(change_from),
        change_to=dict(change_to),
        title=title,
        committed_at=committed_at,
    )


def format_recent_applied_changes(
    changes: list[AppliedChange] | None,
    *,
    max_entries: int = MAX_APPLIED_CHANGES,
) -> str | None:
    if not changes:
        return None
    lines: list[str] = []
    for idx, change in enumerate(changes[: max_entries], start=1):
        lines.append(_format_change_line(idx, change))
    if not lines:
        return None
    return '\n'.join(lines)


def _format_change_line(index: int, change: AppliedChange) -> str:
    node_label = change.node_type or 'item'
    change_type = (change.change_type or '').upper()
    id_suffix = f'(id: {change.node_id})'
    title_hint = change.title or '(untitled)'

    if change_type == 'TITLE_CHANGED':
        old = _pick_str(change.change_from, 'title') or '(unknown)'
        new = _pick_str(change.change_to, 'title') or '(unknown)'
        return f'{index}. Renamed {node_label} "{old}" → "{new}" {id_suffix}'
    if change_type == 'NODE_ADDED':
        return f'{index}. Created {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'NODE_REMOVED':
        return f'{index}. Deleted {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'NODE_MOVED':
        return f'{index}. Moved {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'STATUS_CHANGED':
        old = _pick_str(change.change_from, 'status') or '?'
        new = _pick_str(change.change_to, 'status') or '?'
        return f'{index}. Updated {node_label} "{title_hint}" status: {old} → {new} {id_suffix}'
    if change_type == 'PRIORITY_CHANGED':
        old = _pick_str(change.change_from, 'priority') or '?'
        new = _pick_str(change.change_to, 'priority') or '?'
        return f'{index}. Updated {node_label} "{title_hint}" priority: {old} → {new} {id_suffix}'
    if change_type == 'ASSIGNEE_CHANGED':
        old = _pick_str(change.change_from, 'assignee_id') or 'none'
        new = _pick_str(change.change_to, 'assignee_id') or 'none'
        return f'{index}. Updated {node_label} "{title_hint}" assignee: {old} → {new} {id_suffix}'
    if change_type == 'TAGS_CHANGED':
        return f'{index}. Updated tags on {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'DATE_CHANGED':
        return f'{index}. Updated dates on {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'DESCRIPTION_CHANGED':
        return f'{index}. Updated description on {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'DEPENDENCY_CHANGED':
        return f'{index}. Updated dependencies on {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'COLOR_CHANGED':
        return f'{index}. Updated color on {node_label} "{title_hint}" {id_suffix}'
    if change_type == 'DELIVERABLE_CHANGED':
        return f'{index}. Updated deliverable flag on {node_label} "{title_hint}" {id_suffix}'
    # Unknown / future change types — still surface them so the LLM at least knows something changed.
    return f'{index}. {change_type} on {node_label} "{title_hint}" {id_suffix}'


def _pick_str(source: dict[str, Any], key: str) -> str | None:
    value = source.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    if value is None:
        return None
    return str(value)
