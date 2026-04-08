from __future__ import annotations

import re
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.orchestration.shared.common_text import extract_rename_labels, normalize_label_for_matching


def has_rename_shape_operation(operations: list[RoadmapOperation]) -> bool:
    for operation in operations:
        op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
        if op_name != 'update_node':
            continue
        if not operation.node_id:
            continue
        if isinstance(operation.patch, dict):
            title = operation.patch.get('title')
            if isinstance(title, str) and title.strip():
                return True
    return False


def recover_rename_shape_operations(
    *,
    user_message: str,
    react_tool_observation_summary: list[dict[str, Any]] | None,
    uuid_pattern: re.Pattern[str],
) -> list[RoadmapOperation] | None:
    labels = extract_rename_labels(user_message)
    if labels is None:
        return None
    from_label, to_title = labels
    normalized_from_label = normalize_label_for_matching(from_label)
    if not normalized_from_label or not to_title:
        return None
    if not isinstance(react_tool_observation_summary, list):
        return None

    for observation in reversed(react_tool_observation_summary):
        if not isinstance(observation, dict):
            continue
        if str(observation.get('tool_name') or '').strip() != 'resolve_node_reference':
            continue

        status = str(observation.get('status') or '').strip().lower()
        if status and status != 'unique':
            continue

        requested_label = str(observation.get('label') or '').strip()
        normalized_requested_label = normalize_label_for_matching(requested_label)
        if normalized_requested_label:
            if (
                normalized_from_label != normalized_requested_label
                and normalized_from_label not in normalized_requested_label
                and normalized_requested_label not in normalized_from_label
            ):
                continue

        node_id = str(
            observation.get('selected_id')
            or observation.get('node_id')
            or ''
        ).strip()
        if not uuid_pattern.fullmatch(node_id):
            continue

        return [
            RoadmapOperation(
                op='update_node',
                node_id=node_id,
                patch={'title': to_title},
            )
        ]

    return None
