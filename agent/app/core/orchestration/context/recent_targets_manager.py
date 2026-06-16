from __future__ import annotations

from datetime import datetime, timedelta
import re
import string
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, RecentResolvedTarget


def normalize_recent_target_node_type(value: Any) -> str | None:
    normalized = str(value or '').strip().lower()
    if normalized in {'epic', 'feature', 'task'}:
        return normalized
    return None


def normalize_recent_target_label(value: str | None) -> str:
    lowered = str(value or '').strip().lower()
    lowered = lowered.translate(str.maketrans('', '', string.punctuation.replace('-', '')))
    lowered = re.sub(r'\s+', ' ', lowered).strip()
    return lowered


def is_recent_target_fresh(
    target: RecentResolvedTarget,
    *,
    utcnow: Callable[[], datetime],
    max_age_hours: int,
) -> bool:
    created_at = target.created_at
    if not isinstance(created_at, datetime):
        return False
    cutoff = utcnow() - timedelta(hours=max_age_hours)
    return created_at >= cutoff


def recent_target_rank(
    target: RecentResolvedTarget,
    *,
    source_priority: dict[str, int],
) -> tuple[datetime, float, int]:
    confidence = float(target.confidence) if isinstance(target.confidence, (int, float)) else 0.0
    source_rank = int(source_priority.get(str(target.source), 0))
    return (target.created_at, confidence, source_rank)


def prune_recent_resolved_targets(
    targets: list[RecentResolvedTarget],
    *,
    is_recent_target_fresh: Callable[[RecentResolvedTarget], bool],
    max_items: int,
) -> list[RecentResolvedTarget]:
    fresh_targets = [target for target in targets if is_recent_target_fresh(target)]
    if len(fresh_targets) <= max_items:
        return fresh_targets
    return fresh_targets[-max_items:]


def get_recent_resolved_targets(
    session: AgentSession,
    *,
    prune_recent_resolved_targets: Callable[[list[RecentResolvedTarget]], list[RecentResolvedTarget]],
) -> list[RecentResolvedTarget]:
    raw_targets = session.metadata.recent_resolved_targets
    if not isinstance(raw_targets, list):
        return []

    normalized_targets: list[RecentResolvedTarget] = []
    for item in raw_targets:
        if isinstance(item, RecentResolvedTarget):
            normalized_targets.append(item)
            continue
        if isinstance(item, dict):
            try:
                normalized_targets.append(RecentResolvedTarget.model_validate(item))
            except Exception:
                continue

    pruned_targets = prune_recent_resolved_targets(normalized_targets)
    if len(pruned_targets) != len(normalized_targets):
        session.metadata.recent_resolved_targets = pruned_targets
    return pruned_targets


def append_recent_resolved_target(
    *,
    session: AgentSession,
    node_id: Any,
    node_type: Any,
    title: Any = None,
    label: Any = None,
    source: str = 'context_tool',
    confidence: float | None = None,
    normalize_recent_target_node_type: Callable[[Any], str | None],
    is_uuid: Callable[[str | None], bool],
    get_recent_resolved_targets: Callable[[AgentSession], list[RecentResolvedTarget]],
    prune_recent_resolved_targets: Callable[[list[RecentResolvedTarget]], list[RecentResolvedTarget]],
    utcnow: Callable[[], datetime],
) -> None:
    normalized_node_id = str(node_id or '').strip()
    normalized_node_type = normalize_recent_target_node_type(node_type)
    if not is_uuid(normalized_node_id) or normalized_node_type is None:
        return

    normalized_title = str(title or '').strip() or None
    normalized_label = str(label or '').strip() or None
    targets = get_recent_resolved_targets(session)
    deduped_targets = [
        target
        for target in targets
        if not (
            target.node_id == normalized_node_id
            and target.node_type == normalized_node_type
        )
    ]
    deduped_targets.append(
        RecentResolvedTarget(
            node_id=normalized_node_id,
            node_type=normalized_node_type,
            title=normalized_title,
            label=normalized_label,
            source=source,
            confidence=confidence,
            created_at=utcnow(),
        )
    )
    session.metadata.recent_resolved_targets = prune_recent_resolved_targets(
        deduped_targets
    )


def record_recent_targets_from_operations(
    *,
    session: AgentSession,
    operations: list[RoadmapOperation],
    source: str,
    read_operation_title: Callable[[RoadmapOperation], str | None],
    is_uuid: Callable[[str | None], bool],
    append_recent_resolved_target: Callable[..., None],
) -> None:
    for operation in operations:
        op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
        title = read_operation_title(operation)
        if op_name == 'add_epic' and is_uuid(operation.node_id):
            append_recent_resolved_target(
                session=session,
                node_id=operation.node_id,
                node_type='epic',
                title=title,
                label=title,
                source=source,
            )
        if op_name == 'add_feature':
            if is_uuid(operation.node_id):
                append_recent_resolved_target(
                    session=session,
                    node_id=operation.node_id,
                    node_type='feature',
                    title=title,
                    label=title,
                    source=source,
                )
            if is_uuid(operation.parent_id):
                append_recent_resolved_target(
                    session=session,
                    node_id=operation.parent_id,
                    node_type='epic',
                    source=source,
                )
        if op_name == 'add_task':
            if is_uuid(operation.node_id):
                append_recent_resolved_target(
                    session=session,
                    node_id=operation.node_id,
                    node_type='task',
                    title=title,
                    label=title,
                    source=source,
                )
            if is_uuid(operation.parent_id):
                append_recent_resolved_target(
                    session=session,
                    node_id=operation.parent_id,
                    node_type='feature',
                    source=source,
                )


def record_recent_targets_from_observation_summary(
    *,
    session: AgentSession,
    observation_summary: list[dict[str, Any]] | None,
    normalize_recent_target_node_type: Callable[[Any], str | None],
    is_uuid: Callable[[str | None], bool],
    append_recent_resolved_target: Callable[..., None],
) -> None:
    if not isinstance(observation_summary, list):
        return

    for item in observation_summary:
        if not isinstance(item, dict):
            continue
        label = item.get('label')
        selected_id = item.get('selected_id')
        node_type = normalize_recent_target_node_type(item.get('node_type'))
        node_title = item.get('node_title')

        if is_uuid(selected_id):
            match_items = item.get('match_items')
            if node_type is None and isinstance(match_items, list):
                for match_item in match_items:
                    if not isinstance(match_item, dict):
                        continue
                    if str(match_item.get('id') or '').strip() != str(selected_id).strip():
                        continue
                    node_type = normalize_recent_target_node_type(match_item.get('type'))
                    node_title = node_title or match_item.get('title')
                    break
            append_recent_resolved_target(
                session=session,
                node_id=selected_id,
                node_type=node_type,
                title=node_title,
                label=label,
                source='context_tool',
            )

        node_id = item.get('node_id')
        if is_uuid(node_id) and node_type is not None:
            append_recent_resolved_target(
                session=session,
                node_id=node_id,
                node_type=node_type,
                title=node_title,
                label=label,
                source='context_tool',
            )

        match_items = item.get('match_items')
        if (
            isinstance(match_items, list)
            and int(item.get('match_count') or 0) == 1
            and len(match_items) >= 1
            and isinstance(match_items[0], dict)
        ):
            only_match = match_items[0]
            append_recent_resolved_target(
                session=session,
                node_id=only_match.get('id'),
                node_type=only_match.get('type'),
                title=only_match.get('title'),
                label=label,
                source='context_tool',
            )


def record_recent_targets_from_preview(
    *,
    session: AgentSession,
    preview_result: dict[str, Any],
    source: str,
    append_recent_resolved_target: Callable[..., None],
) -> None:
    semantic_diff = preview_result.get('semantic_diff')
    changes = semantic_diff.get('changes') if isinstance(semantic_diff, dict) else None
    if not isinstance(changes, list):
        return

    removed_ids: set[str] = set()
    for change in changes[:80]:
        if not isinstance(change, dict):
            continue
        node_payload = change.get('node') if isinstance(change.get('node'), dict) else {}
        to_payload = change.get('to') if isinstance(change.get('to'), dict) else {}

        node_id = (
            node_payload.get('id')
            or node_payload.get('node_id')
            or to_payload.get('id')
            or to_payload.get('node_id')
        )
        # A removed node's id is now dead — never seed it as a recent target,
        # and remember it so any existing cache entry can be pruned below.
        # Otherwise a later turn can bind a title/deictic reference to the
        # stale id and the commit fails with "Target node was not found".
        if str(change.get('type') or '').upper() == 'NODE_REMOVED':
            normalized_removed = str(node_id or '').strip()
            if normalized_removed:
                removed_ids.add(normalized_removed)
            continue

        node_type = (
            node_payload.get('type')
            or node_payload.get('node_type')
            or to_payload.get('type')
            or to_payload.get('node_type')
        )
        title = (
            node_payload.get('title')
            or to_payload.get('title')
            or node_payload.get('name')
            or to_payload.get('name')
        )
        append_recent_resolved_target(
            session=session,
            node_id=node_id,
            node_type=node_type,
            title=title,
            label=title,
            source=source,
        )

    if removed_ids:
        prune_recent_targets_by_node_ids(session, removed_ids)


def prune_recent_targets_by_node_ids(
    session: AgentSession, node_ids: set[str]
) -> None:
    """Drop recent-resolved-target entries whose node_id was removed, so a
    deleted node's stale id can never be served deictically on a later turn."""
    if not node_ids:
        return
    targets = session.metadata.recent_resolved_targets
    if not isinstance(targets, list) or not targets:
        return
    kept = [
        target
        for target in targets
        if str(getattr(target, 'node_id', '') or '').strip() not in node_ids
    ]
    if len(kept) != len(targets):
        session.metadata.recent_resolved_targets = kept
