from __future__ import annotations

from typing import Any

from app.core.contracts.sessions import AgentSession, CommitImpactedItem, RoadmapCommitArtifact


_VALID_NODE_TYPES = {'roadmap', 'epic', 'feature', 'task'}
_IMPACT_PRIORITY = {'modified': 1, 'created': 2, 'deleted': 3}


def _normalize_change_type(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    return normalized or None


def _impact_for_change_type(change_type: str | None) -> str:
    if change_type == 'NODE_ADDED':
        return 'created'
    if change_type == 'NODE_REMOVED':
        return 'deleted'
    return 'modified'


def _extract_title(*sources: Any) -> str | None:
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in ('title', 'name', 'node_title'):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _extract_impacted_items(commit_result: dict[str, Any]) -> list[CommitImpactedItem]:
    semantic_diff = commit_result.get('semantic_diff')
    changes = semantic_diff.get('changes') if isinstance(semantic_diff, dict) else None
    if not isinstance(changes, list):
        return []

    deduped: dict[tuple[str, str], CommitImpactedItem] = {}
    for change in changes:
        if not isinstance(change, dict):
            continue
        node = change.get('node')
        if not isinstance(node, dict):
            continue

        node_id = node.get('id')
        node_type_raw = node.get('type')
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        if not isinstance(node_type_raw, str):
            continue
        node_type = node_type_raw.strip().lower()
        if node_type not in _VALID_NODE_TYPES:
            continue

        normalized_change_type = _normalize_change_type(change.get('type'))
        impact = _impact_for_change_type(normalized_change_type)
        item = CommitImpactedItem(
            node_id=node_id.strip(),
            node_type=node_type,
            title=_extract_title(change.get('to'), change.get('from')),
            change_type=normalized_change_type,
            impact=impact,
        )
        key = (item.node_type, item.node_id)
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = item
            continue

        if _IMPACT_PRIORITY[item.impact] > _IMPACT_PRIORITY[existing.impact]:
            if not item.title and existing.title:
                item.title = existing.title
            deduped[key] = item
            continue

        if existing.title is None and item.title is not None:
            existing.title = item.title

    return list(deduped.values())


def build_commit_artifact(
    session: AgentSession,
    commit_result: dict[str, Any],
    *,
    change_id: str | None = None,
    status: str = 'applied',
) -> RoadmapCommitArtifact:
    effective_change_id = change_id
    if effective_change_id is None:
        change_id_raw = commit_result.get('change_id')
        if isinstance(change_id_raw, str) and change_id_raw.strip():
            effective_change_id = change_id_raw.strip()

    semantic_diff = commit_result.get('semantic_diff')
    summary_payload = semantic_diff.get('summary') if isinstance(semantic_diff, dict) else {}
    semantic_diff_summary = summary_payload if isinstance(summary_payload, dict) else {}
    total_changes = sum(
        value for value in semantic_diff_summary.values() if isinstance(value, int)
    )
    validation_issues = commit_result.get('validation_issues')
    validation_issue_count = (
        len(validation_issues) if isinstance(validation_issues, list) else 0
    )
    impacted_items = _extract_impacted_items(commit_result)

    return RoadmapCommitArtifact(
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        change_id=effective_change_id,
        title='Roadmap Commit Artifact',
        summary=f'Applied {total_changes} semantic change(s).',
        semantic_diff_summary=semantic_diff_summary,
        validation_issue_count=validation_issue_count,
        validation_issues=[],
        impacted_items=impacted_items,
        has_validation_errors=False,
        status=status if status in {'draft', 'applied', 'discarded'} else 'applied',
    )
