"""Persist a compact log of committed semantic-diff changes on the session.

After every successful auto-commit we walk the backend's `semantic_diff.changes`
and store up to `MAX_APPLIED_CHANGES` entries on `session.metadata.recent_applied_changes`,
most recent first. A prose rendering of this log is injected into the
planner's system prompt so the LLM can handle undo/revert requests without
having to re-resolve by (possibly stale) titles from earlier assistant
messages.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.core.contracts.sessions import AgentSession, AppliedChange, ChangeGroup

# Matches the " (id: <node_id>)" suffix the shared line formatter appends.
_ID_SUFFIX_RE = re.compile(r'\s*\(id:[^)]*\)\s*$')

MAX_APPLIED_CHANGES = 10
# How many per-commit change groups to retain for point-in-time revert. The
# rolling `recent_applied_changes` log above stays capped/flattened for the
# prompt; this keeps each commit's FULL change set so a large delete is fully
# reversible back to any of the last MAX_CHANGE_GROUPS commits.
MAX_CHANGE_GROUPS = 20


def record_applied_changes_from_commit(
    session: AgentSession,
    commit_result: dict[str, Any],
    max_entries: int = MAX_APPLIED_CHANGES,
    *,
    summary: str | None = None,
) -> int:
    """Append entries from `semantic_diff.changes` onto the session, capped
    at `max_entries`, most recent first. Also appends one ChangeGroup holding
    the commit's FULL change set to `change_history` for point-in-time revert.
    Returns the number of entries added.
    """
    semantic_diff = commit_result.get('semantic_diff')
    if not isinstance(semantic_diff, dict):
        return 0
    changes_raw = semantic_diff.get('changes')
    if not isinstance(changes_raw, list):
        return 0

    change_id_raw = commit_result.get('change_id')
    change_id = (
        change_id_raw.strip()
        if isinstance(change_id_raw, str) and change_id_raw.strip()
        else None
    )

    committed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    new_entries: list[AppliedChange] = []
    for change in changes_raw:
        entry = _parse_change_entry(change, committed_at, change_id=change_id)
        if entry is not None:
            new_entries.append(entry)

    if not new_entries:
        return 0

    existing = session.metadata.recent_applied_changes or []
    combined = new_entries + list(existing)
    session.metadata.recent_applied_changes = combined[: max(0, int(max_entries))]

    _append_change_group(
        session,
        change_id=change_id,
        committed_at=committed_at,
        changes=new_entries,
        summary=summary,
    )
    return len(new_entries)


def _append_change_group(
    session: AgentSession,
    *,
    change_id: str | None,
    committed_at: datetime,
    changes: list[AppliedChange],
    summary: str | None,
) -> None:
    """Prepend a ChangeGroup for this commit, most recent first, capped."""
    group = ChangeGroup(
        change_id=change_id,
        committed_at=committed_at,
        summary=(summary or '').strip() or summarize_change_group(changes),
        # Copy so later mutation of the rolling log can't alias these.
        changes=[change.model_copy(deep=True) for change in changes],
    )
    history = session.metadata.change_history or []
    session.metadata.change_history = [group, *history][:MAX_CHANGE_GROUPS]


# Verbs for the change-group synopsis, keyed by change_type. Field-level edits
# collapse to a generic "Edited" since the group line is a one-liner; the
# per-node breakdown in the prompt block carries the detail.
_CHANGE_VERBS: dict[str, str] = {
    'NODE_ADDED': 'Created',
    'NODE_REMOVED': 'Deleted',
    'NODE_MOVED': 'Moved',
}


def summarize_change_group(changes: list[AppliedChange]) -> str:
    """One-line, deterministic synopsis of a commit's changes so the model can
    map a natural-language reference ("before I did X") to a change_id.

    Single change → "Renamed epic 'Foo' → 'Bar'". Multiple → grouped counts:
    "Deleted 2 epics, 3 features, 4 tasks; created 1 epic".
    """
    if not changes:
        return 'No changes'
    if len(changes) == 1:
        line = _format_change_line(1, changes[0]).split('. ', 1)[-1]
        # The shared formatter appends "(id: <uuid>)"; the synopsis is shown to
        # the user (revert confirmations), so strip the id — titles only.
        return _ID_SUFFIX_RE.sub('', line).strip()

    # verb -> {node_type -> count}, preserving first-seen verb order.
    buckets: dict[str, dict[str, int]] = {}
    for change in changes:
        verb = _CHANGE_VERBS.get((change.change_type or '').upper(), 'Edited')
        node_type = change.node_type or 'item'
        buckets.setdefault(verb, {}).setdefault(node_type, 0)
        buckets[verb][node_type] += 1

    clauses: list[str] = []
    for verb, by_type in buckets.items():
        parts = [
            f'{count} {node_type}{"s" if count != 1 else ""}'
            for node_type, count in by_type.items()
        ]
        clauses.append(f'{verb} {", ".join(parts)}')
    # Capitalize only the first clause's verb; the rest read as lowercase joins.
    head, *tail = clauses
    if tail:
        return head + '; ' + '; '.join(c[0].lower() + c[1:] for c in tail)
    return head


def _parse_change_entry(
    change: Any, committed_at: datetime, *, change_id: str | None = None,
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
        change_id=change_id,
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
