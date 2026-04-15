from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any

from app.core.contracts.operations import NodeType, RoadmapOperation
from app.core.llm.contracts.clarifier_contract import build_clarifier_contract
from app.core.llm.outage import build_outage_clarifier_message
from app.core.llm.providers import ProviderAdapterError
from app.core.logging_utils import log_event
from app.core.tools.registry import (
    CONTEXT_TOOL_NAMES,
    get_edit_helper_tools,
    get_edit_mode_tools,
    get_operation_tools,
    get_planning_tool,
    get_scoped_edit_tools,
    PLANNING_TOOL_NAME,
    parse_plan_tool_args,
)
from app.core.uuid_utils import is_uuid_like, normalize_uuid


def _is_bulk_task_scope_update_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_update_verb = bool(
        re.search(r'\b(mark|update|set|move|change|assign|unassign)\b', normalized)
    )
    return has_bulk_scope and has_update_verb


def _explicit_parent_type_hint(user_message: str) -> str | None:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized:
        return None
    mentions_epic = bool(re.search(r'\bepic\b', normalized))
    mentions_feature = bool(re.search(r'\bfeature\b', normalized))
    if mentions_epic and not mentions_feature:
        return 'epic'
    if mentions_feature and not mentions_epic:
        return 'feature'
    return None


def _has_parent_scope_phrase(normalized_message: str) -> bool:
    return bool(
        re.search(r'\b(under|within|inside|for)\b', normalized_message)
        or re.search(r'\bin\b(?!\s+(review|progress)\b)', normalized_message)
    )


def _is_parent_scoped_bulk_status_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_status_update_verb = bool(re.search(r'\b(mark|update|set|change)\b', normalized))
    has_parent_scope = _has_parent_scope_phrase(normalized)
    has_filter_hint = bool(
        re.search(r'\b(assignee|assigned|owner|priority|keyword|title|name|contains)\b', normalized)
    )
    return has_bulk_scope and has_status_update_verb and has_parent_scope and not has_filter_hint


def _is_parent_scoped_bulk_filter_update_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_update_verb = bool(re.search(r'\b(mark|update|set|change|assign|unassign)\b', normalized))
    has_parent_scope = _has_parent_scope_phrase(normalized)
    has_filter_hint = bool(
        re.search(r'\b(assignee|assigned|owner|priority|status|keyword|title|name|contains)\b', normalized)
    )
    return has_bulk_scope and has_update_verb and has_parent_scope and has_filter_hint


def _is_global_bulk_filter_update_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_update_verb = bool(re.search(r'\b(mark|update|set|change|assign|unassign)\b', normalized))
    has_parent_scope = _has_parent_scope_phrase(normalized)
    if has_parent_scope:
        return False
    has_named_filter_hint = bool(
        re.search(r'\b(assignee|assigned|owner|priority|status|keyword|title|name|contains)\b', normalized)
    )
    has_status_task_filter_hint = bool(
        re.search(
            r'\b["\']?(todo|in[\s_-]*progress|in[\s_-]*review|done|blocked|completed)["\']?\s+tasks?\b',
            normalized,
        )
        or re.search(
            r'\btasks?\s+(?:that|which)\s+are\s+["\']?(todo|in[\s_-]*progress|in[\s_-]*review|done|blocked|completed)["\']?\b',
            normalized,
        )
    )
    return has_bulk_scope and has_update_verb and (has_named_filter_hint or has_status_task_filter_hint)


_RENAME_VERB_PATTERN = re.compile(
    r'\b(rename|renaming|retitle|retitling|relabel|relabeling)\b',
)
_NAME_TO_PATTERN = re.compile(
    r'\b(?:change|set|update|make)\b[^.?!]{0,40}\b(?:name|title|label)\b[^.?!]{0,40}\bto\b',
)
_DELETE_VERB_PATTERN = re.compile(
    r'\b(delete|deleting|remove|removing|drop|dropping)\b',
)


def _classify_edit_sub_intent(user_message: str) -> str | None:
    """Classify a roadmap_edit message into a narrow sub-intent for tool scoping.

    Returns one of: 'rename_only', 'delete_only', or None when the message
    doesn't cleanly match a scoped manifest. Conservative by design: any
    create/move/status verb in the message disqualifies a scoped path.
    """
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized:
        return None
    has_create = bool(re.search(r'\b(add|create|new|insert)\b', normalized))
    has_move = bool(re.search(r'\b(move|reparent|reorder|shift)\b', normalized))
    has_status = bool(
        re.search(
            r'\b(mark|status|done|complete|completed|in[\s_-]*progress|todo|blocked|assign|unassign|priority)\b',
            normalized,
        )
    )
    if has_create or has_move or has_status:
        return None

    has_rename = bool(_RENAME_VERB_PATTERN.search(normalized) or _NAME_TO_PATTERN.search(normalized))
    has_delete = bool(_DELETE_VERB_PATTERN.search(normalized))
    if has_rename and not has_delete:
        return 'rename_only'
    if has_delete and not has_rename:
        return 'delete_only'
    return None


def _is_assign_me_bulk_update_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    return bool(
        re.search(r'\bassign\s+me\s+to\b', normalized)
        or re.search(r'\bassign\s+(all|every)\b.*\bto\s+me\b', normalized)
        or re.search(r'\bset\s+assignee\s+to\s+me\b', normalized)
    )


def _has_resolved_parent_context(
    *,
    deictic_parent_hint: dict[str, Any] | None,
    effective_tool_summary: list[dict[str, Any]],
) -> bool:
    if isinstance(deictic_parent_hint, dict):
        hint_node_type = str(deictic_parent_hint.get('node_type') or '').strip().lower()
        hint_node_id = str(deictic_parent_hint.get('node_id') or '').strip()
        if hint_node_type in {'epic', 'feature'} and hint_node_id:
            return True

    for item in effective_tool_summary:
        if not isinstance(item, dict):
            continue
        node_type = str(item.get('node_type') or '').strip().lower()
        if node_type in {'epic', 'feature'} and str(item.get('node_id') or '').strip():
            return True
        if str(item.get('epic_id') or '').strip() or str(item.get('feature_id') or '').strip():
            return True
        matches = item.get('match_items')
        if not isinstance(matches, list):
            continue
        for match in matches:
            if not isinstance(match, dict):
                continue
            match_type = str(match.get('type') or '').strip().lower()
            match_id = str(match.get('id') or '').strip()
            if match_type in {'epic', 'feature'} and match_id:
                return True
    return False


def _has_bulk_helper_operations(tool_observations: list[dict[str, Any]]) -> bool:
    for observation in reversed(tool_observations):
        if not isinstance(observation, dict):
            continue
        tool_name = str(observation.get('tool_name') or '').strip()
        if tool_name not in {'bulk_update_tasks_by_filter', 'bulk_update_tasks_by_parent'}:
            continue
        result = observation.get('result')
        if not isinstance(result, dict) or isinstance(result.get('error'), dict):
            continue
        operations = result.get('operations')
        if not isinstance(operations, list) or not operations:
            continue
        for item in operations:
            if isinstance(item, dict) and str(item.get('op') or '').strip():
                return True
    return False


def _select_tools_by_name(
    tools: list[dict[str, Any]],
    allowed_names: set[str],
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for tool in tools:
        tool_name = str(tool.get('function', {}).get('name') or '').strip()
        if tool_name in allowed_names:
            selected.append(tool)
    return selected


def _operation_payloads(operations: list[RoadmapOperation]) -> list[dict[str, Any]]:
    return [
        operation.model_dump(mode='json', exclude_none=True)
        for operation in operations
    ]
    
def _build_planner_summary_payload(
    *,
    assistant_message: str,
    operations: list[RoadmapOperation],
) -> tuple[str, str]:
    normalized = ' '.join(str(assistant_message or '').split())
    if normalized:
        if len(normalized) > 280:
            normalized = f'{normalized[:277].rstrip()}...'
        return normalized, 'model_assistant_message'

    operations_count = len(operations)
    if operations_count > 0:
        return (
            f'Prepared {operations_count} roadmap operation(s) for review.',
            'fallback_template',
        )
    return 'Prepared roadmap changes for review.', 'fallback_template'


def _first_semantic_contract_error(
    operations: list[RoadmapOperation],
) -> dict[str, Any] | None:
    for index, operation in enumerate(operations):
        issues = operation.semantic_contract_issues(is_uuid=is_uuid_like)
        if not issues:
            continue
        return {
            'index': index,
            'reason': issues[0],
            'op': operation.op.value,
            'node_type': (
                operation.node_type.value
                if operation.node_type is not None
                else None
            ),
            'operation': operation.model_dump(exclude_none=True),
        }
    return None


def _has_bulk_task_status_semantic_mismatch(
    *,
    user_message: str,
    operations: list[RoadmapOperation],
) -> bool:
    if not _is_parent_scoped_bulk_status_intent(user_message):
        return False
    mark_status_operations = [
        operation
        for operation in operations
        if operation.op.value == 'mark_status'
    ]
    if not mark_status_operations:
        return True
    for operation in mark_status_operations:
        node_type = operation.node_type.value if operation.node_type is not None else ''
        if node_type != 'task':
            return True
    return False


def _normalize_task_status_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = ' '.join(value.strip().lower().split())
    if not normalized:
        return None
    normalized = normalized.replace('-', ' ').replace('_', ' ')
    alias_map = {
        'to do': 'todo',
        'todo': 'todo',
        'in progress': 'in_progress',
        'in review': 'in_review',
        'done': 'done',
        'blocked': 'blocked',
    }
    if normalized in alias_map:
        return alias_map[normalized]
    candidate = normalized.replace(' ', '_')
    if candidate in {'todo', 'in_progress', 'in_review', 'done', 'blocked'}:
        return candidate
    return None


def _coerce_parent_scoped_bulk_task_status_operations(
    *,
    user_message: str,
    operations: list[RoadmapOperation],
) -> list[RoadmapOperation]:
    if not _is_parent_scoped_bulk_status_intent(user_message):
        return operations

    coerced_operations: list[RoadmapOperation] = []
    for operation in operations:
        if operation.op.value != 'mark_status':
            coerced_operations.append(operation)
            continue

        coerced_operation = operation
        if coerced_operation.node_type is None:
            coerced_operation = coerced_operation.model_copy(deep=True)
            coerced_operation.node_type = NodeType.TASK

        if coerced_operation.node_type == NodeType.TASK:
            normalized_status = _normalize_task_status_value(coerced_operation.status)
            if normalized_status is not None and normalized_status != coerced_operation.status:
                if coerced_operation is operation:
                    coerced_operation = coerced_operation.model_copy(deep=True)
                coerced_operation.status = normalized_status

        coerced_operations.append(coerced_operation)
    return coerced_operations


def _extract_tasks_per_feature_count(user_message: str) -> int | None:
    normalized = ' '.join(str(user_message or '').strip().lower().split())
    if not normalized or 'task' not in normalized or 'feature' not in normalized:
        return None
    if 'each' not in normalized and 'per feature' not in normalized:
        return None

    digit_match = re.search(
        r'\b(\d+)\s+tasks?\s+(?:each|per\s+feature)\b',
        normalized,
    )
    if digit_match is not None:
        parsed_count = int(digit_match.group(1))
        return parsed_count if parsed_count > 0 else None

    word_to_number = {
        'one': 1,
        'two': 2,
        'three': 3,
        'tree': 3,
        'four': 4,
        'five': 5,
        'six': 6,
        'seven': 7,
        'eight': 8,
        'nine': 9,
        'ten': 10,
    }
    word_match = re.search(
        r'\b(one|two|three|tree|four|five|six|seven|eight|nine|ten)\s+tasks?\s+(?:each|per\s+feature)\b',
        normalized,
    )
    if word_match is None:
        return None

    return word_to_number.get(word_match.group(1))


def _reserve_temp_id(seed: str, used_temp_ids: set[str]) -> str:
    candidate = seed
    suffix = 1
    while candidate in used_temp_ids:
        suffix += 1
        candidate = f'{seed}_{suffix}'
    used_temp_ids.add(candidate)
    return candidate


def _maybe_complete_hierarchical_create_operations(
    *,
    user_message: str,
    operations: list[RoadmapOperation],
) -> list[RoadmapOperation]:
    task_count_per_feature = _extract_tasks_per_feature_count(user_message)
    if task_count_per_feature is None:
        return operations

    normalized_message = ' '.join(str(user_message or '').strip().lower().split())
    if not re.search(r'\b(add|create)\b', normalized_message):
        return operations

    if not operations:
        return operations

    allowed_ops = {'add_epic', 'add_feature', 'add_task'}
    operation_names = [operation.op.value for operation in operations]
    if any(op_name not in allowed_ops for op_name in operation_names):
        return operations

    epic_indexes = [index for index, op_name in enumerate(operation_names) if op_name == 'add_epic']
    feature_indexes = [
        index for index, op_name in enumerate(operation_names) if op_name == 'add_feature'
    ]
    if len(epic_indexes) != 1 or not feature_indexes:
        return operations

    completed_operations = [operation.model_copy(deep=True) for operation in operations]
    changed = False

    used_temp_ids = {
        str(operation.temp_id).strip()
        for operation in completed_operations
        if isinstance(operation.temp_id, str) and operation.temp_id.strip()
    }

    epic_operation = completed_operations[epic_indexes[0]]
    epic_temp_id = str(epic_operation.temp_id or '').strip()
    if not epic_temp_id:
        epic_temp_id = _reserve_temp_id('tmp_epic_1', used_temp_ids)
        epic_operation.temp_id = epic_temp_id
        changed = True

    feature_temp_ids: list[str] = []
    feature_titles_by_temp_id: dict[str, str] = {}

    for feature_order, feature_index in enumerate(feature_indexes, start=1):
        feature_operation = completed_operations[feature_index]
        feature_temp_id = str(feature_operation.temp_id or '').strip()
        if not feature_temp_id:
            feature_temp_id = _reserve_temp_id(f'tmp_feature_{feature_order}', used_temp_ids)
            feature_operation.temp_id = feature_temp_id
            changed = True

        feature_parent_ref = str(feature_operation.parent_ref or '').strip()
        normalized_feature_parent_id = normalize_uuid(feature_operation.parent_id)
        if (
            normalized_feature_parent_id is not None
            and feature_operation.parent_id != normalized_feature_parent_id
        ):
            feature_operation.parent_id = normalized_feature_parent_id
            changed = True
        if not feature_parent_ref and normalized_feature_parent_id is None:
            feature_operation.parent_ref = epic_temp_id
            feature_operation.parent_id = None
            changed = True

        feature_temp_ids.append(feature_temp_id)
        feature_title = ''
        if isinstance(feature_operation.data, dict):
            feature_title = str(feature_operation.data.get('title') or '').strip()
        if not feature_title:
            feature_title = f'Feature {feature_order}'
        feature_titles_by_temp_id[feature_temp_id] = feature_title

    existing_task_counts = {feature_temp_id: 0 for feature_temp_id in feature_temp_ids}
    existing_task_titles = {feature_temp_id: set() for feature_temp_id in feature_temp_ids}
    for operation in completed_operations:
        if operation.op.value != 'add_task':
            continue
        parent_ref = str(operation.parent_ref or '').strip()
        if parent_ref not in existing_task_counts:
            return operations
        existing_task_counts[parent_ref] += 1
        if isinstance(operation.data, dict):
            task_title = str(operation.data.get('title') or '').strip()
            if task_title:
                existing_task_titles[parent_ref].add(task_title.lower())

    generated_tasks: list[RoadmapOperation] = []
    for feature_order, feature_temp_id in enumerate(feature_temp_ids, start=1):
        current_count = existing_task_counts.get(feature_temp_id, 0)
        if current_count >= task_count_per_feature:
            continue
        feature_title = feature_titles_by_temp_id.get(feature_temp_id, f'Feature {feature_order}')
        used_titles = existing_task_titles.setdefault(feature_temp_id, set())
        for task_number in range(current_count + 1, task_count_per_feature + 1):
            task_title = f'{feature_title} Task {task_number}'
            title_suffix = task_number
            while task_title.lower() in used_titles:
                title_suffix += 1
                task_title = f'{feature_title} Task {title_suffix}'
            used_titles.add(task_title.lower())
            generated_tasks.append(
                RoadmapOperation(
                    op='add_task',
                    parent_ref=feature_temp_id,
                    temp_id=_reserve_temp_id(
                        f'tmp_task_{feature_order}_{task_number}',
                        used_temp_ids,
                    ),
                    data={'title': task_title},
                )
            )

    if generated_tasks:
        changed = True

    if not changed:
        return operations

    return [*completed_operations, *generated_tasks]


def _augment_bulk_task_status_contract_retry_prompt(
    *,
    planner_prompt: str,
    operations: list[RoadmapOperation],
) -> str:
    marker = 'BULK TASK STATUS CONTRACT REPAIR:'
    if marker in planner_prompt:
        return planner_prompt
    payload = json.dumps(
        _operation_payloads(operations)[:5],
        ensure_ascii=True,
        separators=(',', ':'),
    )
    return (
        f'{planner_prompt}\n\n'
        'BULK TASK STATUS CONTRACT REPAIR:\n'
        'User asked to update status for all tasks under a parent scope.\n'
        'Do not mark feature or epic status directly for this intent.\n'
        'Call bulk_update_tasks_by_parent with include_completed=true '
        '(or bulk_update_tasks_by_filter when explicit filters are requested), '
        'then call plan_roadmap_operations with task-level mark_status operations only.\n'
        'Each mark_status operation must include node_type="task" and a canonical '
        'task status value (todo, in_progress, in_review, done, blocked).\n\n'
        f'Invalid operations from previous attempt:\n{payload}'
    )


def _augment_semantic_contract_retry_prompt(
    *,
    planner_prompt: str,
    validation_error: dict[str, Any],
) -> str:
    marker = 'SEMANTIC OPERATION CONTRACT REPAIR:'
    if marker in planner_prompt:
        return planner_prompt

    reason = str(validation_error.get('reason') or '').strip()
    guidance = (
        'Each update_node operation must include an actual mutation payload. '
        'Use a non-empty patch object (for example patch.title, patch.priority, or patch.assignee_id). '
        'For unassign actions, set patch.assignee_id to null.'
        if reason == 'update_node.mutation_missing'
        else 'Fix the invalid operation shape and produce only semantically valid operations.'
    )
    payload = json.dumps(
        validation_error,
        ensure_ascii=True,
        separators=(',', ':'),
    )
    return (
        f'{planner_prompt}\n\n'
        'SEMANTIC OPERATION CONTRACT REPAIR:\n'
        f'Reason: {reason or "invalid_operation_contract"}.\n'
        f'{guidance}\n\n'
        f'Invalid operation snapshot from previous attempt:\n{payload}'
    )


def _safe_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return 0
    return 0


def _clean_compound_title_fragment(value: str) -> str:
    cleaned = str(value or '').strip().strip('"\'`')
    cleaned = re.sub(r'[.?!,;:]+$', '', cleaned)
    return ' '.join(cleaned.split())


def _extract_compound_epic_feature_titles(user_message: str) -> tuple[str, str] | None:
    normalized = ' '.join(str(user_message or '').strip().split())
    if not normalized:
        return None
    if not re.search(r'\b(?:add|create)\b', normalized, re.IGNORECASE):
        return None

    epic_match = re.search(
        r'(?i)\b(?:add|create)\s+(?:a\s+|an\s+)?(?:new\s+)?epic\b(?:\s+(?:called|named|titled)\s+)?(?:"([^"]+)"|\'([^\']+)\'|([^,.!?;]+))',
        normalized,
    )
    feature_match = re.search(
        r'(?i)\b(?:add|create)\s+(?:a\s+|an\s+)?(?:new\s+)?feature\b(?:\s+(?:called|named|titled)\s+)?(?:"([^"]+)"|\'([^\']+)\'|([^,.!?;]+))',
        normalized,
    )
    if epic_match is None or feature_match is None:
        return None

    has_parent_link_phrase = bool(
        re.search(r'(?i)\b(?:inside|under|within|in)\s+(?:that|it|the\s+epic\b)', normalized)
    )
    if not has_parent_link_phrase:
        return None

    epic_title = _clean_compound_title_fragment(
        epic_match.group(1) or epic_match.group(2) or epic_match.group(3) or ''
    )
    feature_title = _clean_compound_title_fragment(
        feature_match.group(1) or feature_match.group(2) or feature_match.group(3) or ''
    )
    if not epic_title or not feature_title:
        return None

    return epic_title, feature_title


def _build_parent_first_compound_create_clarifier_state(
    *,
    epic_title: str,
    feature_title: str,
    provider_error_code: str,
    llm_calls_used: int,
) -> dict[str, Any]:
    assistant_message, clarifier_options = build_clarifier_contract(
        reason='compound_create_parent_first',
        question=(
            f'I can stage this safely in two steps. First I will draft epic "{epic_title}". '
            f'After that epic is applied, I can add feature "{feature_title}" inside it. '
            'Should I stage step 1 now?'
        ),
        options=[
            f'Stage epic "{epic_title}" now',
            'Change epic title',
            'Cancel',
        ],
    )
    return {
        'assistant_message': assistant_message,
        'planned_operations': [],
        'response_mode': 'chat',
        'preview_recommended': False,
        'parse_mode': 'deterministic_compound_create_parent_first_clarifier',
        'provider_used': 'rule_based',
        'fallback_used': False,
        'provider_error_code': provider_error_code,
        'tokens_input': None,
        'tokens_output': None,
        'tokens_total': None,
        'pending_context_resolution': None,
        'clear_pending_context_resolution': False,
        'clarifier_action': 'propose_safe_default',
        'clarifier_reason': 'compound_create_parent_first',
        'clarifier_options': clarifier_options,
        'clarifier_schema_retries': 0,
        'planner_schema_invalid_attempts': 0,
        'planner_repair_attempted': False,
        'draft_action': 'continue',
        'tool_plan': [],
        'needs_more_info': True,
        'stop_reason': 'insufficient_context',
        'llm_calls_used': max(int(llm_calls_used or 0), 0),
    }


def _latest_bulk_parent_helper_result(
    tool_observations: list[dict[str, Any]],
) -> dict[str, Any] | None:
    for observation in reversed(tool_observations):
        if str(observation.get('tool_name') or '').strip() != 'bulk_update_tasks_by_parent':
            continue
        result = observation.get('result')
        if isinstance(result, dict):
            return result
    return None


def _synthesize_bulk_parent_operations_from_result(
    helper_result: dict[str, Any] | None,
) -> list[RoadmapOperation]:
    if not isinstance(helper_result, dict):
        return []
    raw_operations = helper_result.get('operations')
    if not isinstance(raw_operations, list):
        return []

    synthesized: list[RoadmapOperation] = []
    for item in raw_operations:
        if not isinstance(item, dict):
            continue
        try:
            synthesized.append(RoadmapOperation.model_validate(item))
        except Exception:
            continue
    return synthesized


def _build_bulk_status_noop_message(
    *,
    helper_result: dict[str, Any],
    fallback_message: str,
) -> str:
    total_child_count = _safe_int(helper_result.get('total_child_task_count'))
    excluded_completed_count = _safe_int(helper_result.get('excluded_completed_count'))
    eligible_count = _safe_int(helper_result.get('eligible_task_count'))
    already_target_count = _safe_int(helper_result.get('already_target_status_count'))
    target_status = str(helper_result.get('target_status') or '').strip().replace('_', ' ')
    target_suffix = f'"{target_status}"' if target_status else 'the requested status'

    if total_child_count <= 0:
        return (
            'I found the selected parent scope, but it currently has no child tasks to update.'
        )

    if excluded_completed_count > 0 and eligible_count <= 0:
        return (
            f'I found {total_child_count} child task(s), but all were completed and excluded '
            'by the current include_completed policy.'
        )

    if eligible_count > 0 and already_target_count >= eligible_count:
        return (
            f'I found {eligible_count} eligible task(s), and they are already set to {target_suffix}. '
            'No changes were staged.'
        )

    if eligible_count <= 0:
        return (
            f'I found {total_child_count} child task(s), but none were eligible for updates '
            'with the current filters.'
        )

    if fallback_message.strip():
        return fallback_message.strip()

    return (
        f'I found {eligible_count} eligible task(s), but no status changes were needed.'
    )



def plan_operations(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
    user_message = state.get('user_message', '')
    intent_type = state.get('intent_type', 'roadmap_edit')
    existing_operations = state.get('existing_operations', [])
    system_prompt = state.get('system_prompt', '')
    session_context = state.get('session_context', {})
    history_messages = planner._build_history_messages(
        session_context,
        max_messages=planner._settings.max_edit_history_messages,
    )
    trace_id = session_context.get('trace_id')
    if intent_type == 'roadmap_plan':
        tool_definitions = get_operation_tools()
    else:
        edit_sub_intent = _classify_edit_sub_intent(user_message)
        scoped_tools = get_scoped_edit_tools(edit_sub_intent)
        if scoped_tools:
            tool_definitions = scoped_tools
            metrics = session_context.setdefault('_phase_metrics', {})
            if isinstance(metrics, dict):
                metrics['planner_tools_scope'] = edit_sub_intent
                metrics['planner_tools_count'] = len(tool_definitions)
        else:
            tool_definitions = get_edit_mode_tools()
    total_edit_turns = max(1, int(planner._settings.max_edit_tool_turns))
    react_loop_turn_raw = session_context.get('_react_loop_turn')
    react_loop_turn = 1
    if isinstance(react_loop_turn_raw, (int, float, str)):
        try:
            react_loop_turn = max(int(react_loop_turn_raw), 1)
        except (TypeError, ValueError):
            react_loop_turn = 1
    if intent_type == 'roadmap_plan':
        edit_turns = 1
    elif react_loop_turn <= 1:
        edit_turns = total_edit_turns
    else:
        # Follow-up turns should bias toward closure with existing observations.
        edit_turns = max(1, min(total_edit_turns, 3))
    max_attempts = max(1, planner._settings.agent_react_max_attempts)
    max_repair_retries = max(0, planner._settings.agent_react_repair_retries)
    max_attempts = min(max_attempts, max_repair_retries + 1)
    remaining_llm_budget_raw = session_context.get('_llm_calls_budget_remaining')
    remaining_llm_budget: int | None = None
    if isinstance(remaining_llm_budget_raw, (int, float, str)):
        try:
            remaining_llm_budget = max(int(remaining_llm_budget_raw), 0)
        except (TypeError, ValueError):
            remaining_llm_budget = None
    if remaining_llm_budget is not None:
        max_attempts = min(max_attempts, remaining_llm_budget)
    tool_observations: list[dict[str, Any]] = []
    tool_observation_summary: list[dict[str, Any]] = []
    llm_calls_used = 0
    dedupe_tool_names = {'resolve_node_reference', 'search_nodes'}
    dedupe_result_cache: dict[tuple[str, str], dict[str, Any]] = {}
    bulk_scope_update_intent = (
        intent_type == 'roadmap_edit'
        and _is_bulk_task_scope_update_intent(user_message)
    )
    force_include_completed_for_bulk_status = (
        intent_type == 'roadmap_edit'
        and _is_parent_scoped_bulk_status_intent(user_message)
    )
    strict_mutation_authority_enabled = (
        intent_type == 'roadmap_edit'
        and bool(
            getattr(
                planner._settings,
                'agent_strict_mutation_authority_enabled',
                False,
            )
        )
    )
    actionable_failure_clarifier_enabled = bool(
        getattr(
            planner._settings,
            'agent_edit_actionable_failure_clarifier_enabled',
            False,
        )
    )
    if session_context.get('_actor_fetch_future') is not None:
        from app.core.orchestration.planning.planning_pre_dispatcher import (
            resolve_deferred_actor_context,
        )
        resolve_deferred_actor_context(session_context)
    actor_context_for_planner = (
        session_context.get('actor_context')
        if isinstance(session_context.get('actor_context'), dict)
        else None
    )
    actor_id_for_planner = (
        str((actor_context_for_planner or {}).get('actor_id') or '').strip()
        if isinstance(actor_context_for_planner, dict)
        else ''
    )
    bulk_assign_me_update_intent = (
        intent_type == 'roadmap_edit'
        and _is_assign_me_bulk_update_intent(user_message)
    )
    schema_invalid_attempts = 0
    repair_attempted = False
    explicit_parent_type_hint = _explicit_parent_type_hint(user_message)
    operation_op_guardrail = (
        'Helper tool names are never valid operation op values. '
        'Only use operation op values: add_epic, add_feature, add_task, '
        'update_node, move_node, delete_node, mark_status, shift_dates. '
        'For assignment changes, use update_node.patch.assignee_id; for unassign, set patch.assignee_id to null.'
    )

    def _serialize_tool_args(value: dict[str, Any]) -> str:
        try:
            return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))
        except TypeError:
            return repr(value)

    def _record_tool_dedupe_hit() -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        metrics['resolve_dedup_hits'] = int(metrics.get('resolve_dedup_hits') or 0) + 1

    def _record_invalid_payload_metric(metric_label: str) -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        if metric_label == 'enum_op':
            key = 'planner_invalid_payload_enum_op'
        elif metric_label == 'missing_required':
            key = 'planner_invalid_payload_missing_required'
        else:
            key = 'planner_invalid_payload_other'
        metrics[key] = int(metrics.get(key) or 0) + 1

    def _classify_invalid_payload(error_message: str | None) -> str:
        if planner._is_invalid_operation_enum_payload(error_message):
            return 'enum_op'
        detail = str(error_message or '').strip().lower()
        if "'type': 'missing'" in detail or 'field required' in detail:
            return 'missing_required'
        return 'other'

    def _rewrite_tool_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
        effective_args = dict(args) if isinstance(args, dict) else {}
        if name == 'resolve_node_reference' and bulk_scope_update_intent:
            if explicit_parent_type_hint in {'epic', 'feature'}:
                effective_args['allowed_node_types'] = [explicit_parent_type_hint]
            else:
                effective_args['allowed_node_types'] = ['feature', 'epic']
            effective_args.pop('node_type', None)
        if name == 'bulk_update_tasks_by_parent' and force_include_completed_for_bulk_status:
            effective_args['include_completed'] = True
        if name == 'bulk_update_tasks_by_filter' and bulk_assign_me_update_intent and actor_id_for_planner:
            update_payload = effective_args.get('update')
            if isinstance(update_payload, dict) and 'assignee_id' not in update_payload:
                coerced_update = dict(update_payload)
                coerced_update['assignee_id'] = actor_id_for_planner
                effective_args['update'] = coerced_update
        return effective_args

    def _capturing_tool_executor(name: str, args: dict[str, Any]) -> dict[str, Any]:
        effective_args = _rewrite_tool_args(name, args)

        cache_key: tuple[str, str] | None = None
        if name in dedupe_tool_names and isinstance(effective_args, dict):
            cache_key = (name, _serialize_tool_args(effective_args))
            cached = dedupe_result_cache.get(cache_key)
            if cached is not None:
                _record_tool_dedupe_hit()
                result = deepcopy(cached)
                planner._record_react_tool_observation(
                    observations=tool_observations,
                    summary=tool_observation_summary,
                    tool_name=name,
                    args=effective_args,
                    result=result,
                )
                return result

        result = planner._execute_context_tool(name, effective_args, session_context)
        if cache_key is not None and isinstance(result, dict):
            dedupe_result_cache[cache_key] = deepcopy(result)
        planner._record_react_tool_observation(
            observations=tool_observations,
            summary=tool_observation_summary,
            tool_name=name,
            args=effective_args,
            result=result,
        )
        return result

    def _capturing_parallel_tool_executor(
        calls: list[tuple[str, dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """Run a group of read-only tool calls concurrently, preserving input order.

        Applies the same arg rewrites and dedupe-cache semantics as the sync
        `_capturing_tool_executor` above. Entries satisfied by the dedupe cache
        bypass the dispatch entirely; the remainder are dispatched in a single
        batch via `planner._execute_context_tools_parallel`.
        """
        prepared: list[tuple[str, dict[str, Any], tuple[str, str] | None]] = []
        for name, args in calls:
            effective_args = _rewrite_tool_args(name, args)
            cache_key: tuple[str, str] | None = None
            if name in dedupe_tool_names and isinstance(effective_args, dict):
                cache_key = (name, _serialize_tool_args(effective_args))
            prepared.append((name, effective_args, cache_key))

        results: list[dict[str, Any] | None] = [None] * len(prepared)
        pending: list[tuple[int, str, dict[str, Any]]] = []
        for idx, (name, effective_args, cache_key) in enumerate(prepared):
            if cache_key is not None:
                cached = dedupe_result_cache.get(cache_key)
                if cached is not None:
                    _record_tool_dedupe_hit()
                    results[idx] = deepcopy(cached)
                    continue
            pending.append((idx, name, effective_args))

        if pending:
            batch_calls = [(n, a) for _idx, n, a in pending]
            batch_results = planner._execute_context_tools_parallel(
                batch_calls, session_context
            )
            for offset, (idx, _name, _args) in enumerate(pending):
                results[idx] = (
                    batch_results[offset] if offset < len(batch_results) else {}
                )

        for idx, (name, effective_args, cache_key) in enumerate(prepared):
            result = results[idx] or {}
            if (
                cache_key is not None
                and isinstance(result, dict)
                and cache_key not in dedupe_result_cache
            ):
                dedupe_result_cache[cache_key] = deepcopy(result)
            planner._record_react_tool_observation(
                observations=tool_observations,
                summary=tool_observation_summary,
                tool_name=name,
                args=effective_args,
                result=result,
            )

        return [r if r is not None else {} for r in results]

    def _finalize_state(
        next_state: dict[str, Any],
        *,
        used_calls: int | None = None,
    ) -> dict[str, Any]:
        next_state['react_tool_observation_summary'] = tool_observation_summary[-10:]
        effective_used = llm_calls_used if used_calls is None else used_calls
        next_state['llm_calls_used'] = max(int(effective_used or 0), 0)
        return next_state

    def _build_outage_edit_state(
        *,
        provider_error_code: str | None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
    ) -> dict[str, Any]:
        return _finalize_state(
            {
                'assistant_message': build_outage_clarifier_message(),
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'llm_first_edit_outage',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': provider_error_code,
                'tokens_input': tokens_input,
                'tokens_output': tokens_output,
                'tokens_total': tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
                'clarifier_action': 'ask_clarifier',
                'clarifier_reason': 'provider_outage',
                'clarifier_options': ['Retry', 'Narrow to one target', 'Cancel'],
                'clarifier_schema_retries': schema_invalid_attempts,
                'planner_schema_invalid_attempts': schema_invalid_attempts,
                'planner_repair_attempted': repair_attempted,
                'draft_action': 'continue',
                'tool_plan': [],
                'needs_more_info': True,
                'stop_reason': 'provider_outage',
            }
        )

    def _is_assignee_contract_failure(error_message: str | None) -> bool:
        detail = str(error_message or '').strip().lower()
        if not detail:
            return False
        if "('assignee',)" in detail and 'extra' in detail and ('forbidden' in detail or 'not permitted' in detail):
            return True
        return (
            'assignee' in detail
            and 'extra' in detail
            and ('forbidden' in detail or 'not permitted' in detail)
        )

    def _build_actionable_planner_failure_state(
        *,
        provider_error_code: str | None,
        provider_error_message: str | None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
    ) -> dict[str, Any]:
        normalized_code = str(provider_error_code or '').strip().lower()
        clarifier_reason = 'planner_contract_failure'
        question = (
            'I resolved context but could not produce a valid operation plan this turn. '
            'Should I retry now, or narrow to one target first?'
        )
        options = ['Retry now', 'Narrow to one target', 'Cancel']

        if normalized_code == 'missing_tool_call':
            clarifier_reason = 'planner_missing_tool_call'
            if _is_global_bulk_filter_update_intent(user_message):
                question = (
                    'I resolved context but did not receive a valid plan tool call. '
                    'Should I retry now, or narrow to one filter first?'
                )
                options = ['Retry now', 'Narrow to one filter', 'Cancel']
            else:
                question = (
                    'I resolved context but did not receive a valid plan tool call. '
                    'Should I retry now, or narrow to one epic/feature first?'
                )
                options = ['Retry now', 'Narrow to one epic/feature', 'Cancel']
        elif normalized_code == 'invalid_operation_payload':
            if _is_assignee_contract_failure(provider_error_message):
                clarifier_reason = 'planner_invalid_assignee_shape'
                question = (
                    'I found the target scope, but assignment payload shape was invalid for "assign to me". '
                    'Should I retry and assign using your actor identity?'
                )
                options = ['Retry assign to me', 'Narrow to one target', 'Cancel']
            else:
                clarifier_reason = 'planner_invalid_operation_payload'
                question = (
                    'I found the target scope, but the generated operation payload was invalid. '
                    'Should I retry now, or narrow to one target first?'
                )
                options = ['Retry now', 'Narrow to one target', 'Cancel']

        assistant_message, clarifier_options = build_clarifier_contract(
            reason=clarifier_reason,
            question=question,
            options=options,
        )
        return _finalize_state(
            {
                'assistant_message': assistant_message,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'llm_first_planner_contract_failure',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': provider_error_code,
                'tokens_input': tokens_input,
                'tokens_output': tokens_output,
                'tokens_total': tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
                'clarifier_action': 'ask_clarifier',
                'clarifier_reason': clarifier_reason,
                'clarifier_options': clarifier_options,
                'clarifier_schema_retries': schema_invalid_attempts,
                'planner_schema_invalid_attempts': schema_invalid_attempts,
                'planner_repair_attempted': repair_attempted,
                'draft_action': 'continue',
                'tool_plan': [],
                'needs_more_info': True,
                'stop_reason': 'awaiting_user_input',
            }
        )

    def _build_llm_first_failure_state(
        *,
        provider_error_code: str | None,
        provider_error_message: str | None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
    ) -> tuple[dict[str, Any], str]:
        normalized_code = str(provider_error_code or '').strip().lower()
        if (
            actionable_failure_clarifier_enabled
            and normalized_code in {'missing_tool_call', 'invalid_operation_payload'}
        ):
            return (
                _build_actionable_planner_failure_state(
                    provider_error_code=provider_error_code,
                    provider_error_message=provider_error_message,
                    tokens_input=tokens_input,
                    tokens_output=tokens_output,
                    tokens_total=tokens_total,
                ),
                'planner_contract_failure',
            )
        return (
            _build_outage_edit_state(
                provider_error_code=provider_error_code,
                tokens_input=tokens_input,
                tokens_output=tokens_output,
                tokens_total=tokens_total,
            ),
            'provider_outage',
        )

    def _is_strict_synthesis_fallback_allowed(
        *,
        provider_error_code: str | None,
    ) -> bool:
        if not strict_mutation_authority_enabled:
            return True
        normalized_error_code = str(provider_error_code or '').strip().lower()
        if normalized_error_code not in {'invalid_operation_payload', 'missing_tool_call'}:
            return False
        return bool(tool_observations)

    def _try_synthesize_react_closure_state(
        *,
        reason: str,
        provider_error_code: str | None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
    ) -> dict[str, Any] | None:
        normalized_error_code = str(provider_error_code or '').strip().lower()
        llm_first_bulk_helper_fallback_allowed = (
            normalized_error_code == 'missing_tool_call'
            and _has_bulk_helper_operations(tool_observations)
        )
        if llm_first_bulk_helper_fallback_allowed:
            log_event(
                planner._logger,
                'deterministic_path_allowed',
                settings=planner._settings,
                trace_id=trace_id,
                llm_first_mode_enabled=True,
                deterministic_path_allowed=True,
                reason=f'llm_first_bulk_helper:{reason}',
                provider_error_code=provider_error_code,
                tool_observation_count=len(tool_observations),
            )
        else:
            log_event(
                planner._logger,
                'deterministic_path_skipped',
                settings=planner._settings,
                trace_id=trace_id,
                llm_first_mode_enabled=True,
                deterministic_path_skipped=True,
                reason=f'llm_first_mode:{reason}',
            )
            return None
        if not _is_strict_synthesis_fallback_allowed(provider_error_code=provider_error_code):
            if strict_mutation_authority_enabled:
                log_event(
                    planner._logger,
                    'react_synthesis_skipped_strict_authority',
                    settings=planner._settings,
                    trace_id=trace_id,
                    reason=reason,
                    provider_error_code=provider_error_code,
                    tool_observation_count=len(tool_observations),
                )
            return None

        synthesized_operations = planner._maybe_synthesize_react_closure_operations(
            user_message=user_message,
            tool_observations=tool_observations,
            session_context=session_context,
            force_include_completed=force_include_completed_for_bulk_status,
        )
        if not synthesized_operations:
            return None

        if strict_mutation_authority_enabled:
            log_event(
                planner._logger,
                'react_synthesis_used_strict_fallback',
                settings=planner._settings,
                trace_id=trace_id,
                reason=reason,
                provider_error_code=provider_error_code,
                operations_count=len(synthesized_operations),
            )

        return _finalize_state(
            planner._build_synthesized_react_closure_state(
                operations=synthesized_operations,
                schema_invalid_attempts=schema_invalid_attempts,
                repair_attempted=repair_attempted,
                draft_action='continue',
                tool_plan=[],
                tokens_input=tokens_input,
                tokens_output=tokens_output,
                tokens_total=tokens_total,
            )
        )

    if max_attempts <= 0:
        return _finalize_state(
            planner._neutral_edit_clarifier_state(
                provider_error_code='llm_call_budget_exhausted',
                schema_retries=0,
                stop_reason='tool_budget_exhausted',
                llm_calls_used=0,
            ),
            used_calls=0,
        )

    staged_operations_payload = json.dumps(
        [op.model_dump(exclude_none=True) for op in existing_operations],
        ensure_ascii=True,
        separators=(',', ':'),
    )
    roadmap_id_value = session_context.get('roadmap_id')
    deictic_parent_hint = (
        session_context.get('deictic_parent_hint')
        if isinstance(session_context.get('deictic_parent_hint'), dict)
        else None
    )
    prior_observation = session_context.get('_react_loop_observation')
    prior_provider_error_code = ''
    resolved_node_ids: list[str] = []
    prior_observation_tool_summary: list[dict[str, Any]] = []
    if isinstance(prior_observation, dict) and prior_observation:
        prior_provider_error_code = str(
            prior_observation.get('provider_error_code') or ''
        ).strip().lower()
        resolved_ids_raw = prior_observation.get('resolved_node_ids')
        if isinstance(resolved_ids_raw, list):
            for raw_id in resolved_ids_raw:
                if isinstance(raw_id, str) and raw_id.strip():
                    resolved_node_ids.append(raw_id.strip())
        tool_summary_raw = prior_observation.get('tool_observation_summary')
        if isinstance(tool_summary_raw, list):
            prior_observation_tool_summary = [
                item
                for item in tool_summary_raw
                if isinstance(item, dict)
            ]

    prior_tool_summary = session_context.get('_react_tool_observation_summary')
    prior_tool_summary_list: list[dict[str, Any]] = []
    if isinstance(prior_tool_summary, list):
        prior_tool_summary_list = [
            item
            for item in prior_tool_summary
            if isinstance(item, dict)
        ]
    effective_tool_summary = (
        prior_observation_tool_summary
        if prior_observation_tool_summary
        else prior_tool_summary_list
    )

    followup_closed_world_turn = (
        react_loop_turn > 1
        and prior_provider_error_code == 'max_tool_turns_exceeded'
        and bool(resolved_node_ids or effective_tool_summary)
    )
    bulk_scope_parent_guard = (
        bulk_scope_update_intent
        and _has_resolved_parent_context(
            deictic_parent_hint=deictic_parent_hint,
            effective_tool_summary=effective_tool_summary,
        )
    )
    strict_parent_bulk_status_guard = (
        bulk_scope_parent_guard
        and _is_parent_scoped_bulk_status_intent(user_message)
    )
    parent_scoped_bulk_filter_guard = (
        bulk_scope_parent_guard
        and _is_parent_scoped_bulk_filter_update_intent(user_message)
    )
    global_bulk_filter_guard = (
        bulk_scope_update_intent
        and _is_global_bulk_filter_update_intent(user_message)
        and react_loop_turn <= 1
    )
    helper_guarded_bulk_scope_intent = (
        strict_parent_bulk_status_guard
        or parent_scoped_bulk_filter_guard
        or global_bulk_filter_guard
    )
    if followup_closed_world_turn or intent_type == 'roadmap_plan':
        tool_definitions = get_operation_tools()
    elif helper_guarded_bulk_scope_intent:
        helper_tools = get_edit_helper_tools()
        if strict_parent_bulk_status_guard:
            tool_definitions = [
                *_select_tools_by_name(helper_tools, {'bulk_update_tasks_by_parent'}),
                get_planning_tool(),
            ]
        elif parent_scoped_bulk_filter_guard:
            tool_definitions = [
                *_select_tools_by_name(
                    helper_tools,
                    {'bulk_update_tasks_by_parent', 'bulk_update_tasks_by_filter'},
                ),
                get_planning_tool(),
            ]
        else:
            tool_definitions = [
                *_select_tools_by_name(helper_tools, {'bulk_update_tasks_by_filter'}),
                get_planning_tool(),
            ]
        edit_turns = max(1, min(edit_turns, 2))

    planner_profile: str | None = None

    if intent_type == 'roadmap_plan':
        planner_prompt = (
            'You are in roadmap planning mode.\n'
            'Call plan_roadmap_operations exactly once.\n'
            'Generate safe roadmap structure with epic -> feature -> task hierarchy.\n'
            'Only stage operations that are valid with available IDs and parent constraints.\n'
            'If required IDs are missing, call plan_roadmap_operations with an empty operations list and place a concise structured plan in assistant_message.\n'
            'Do not call resolve_node_reference, get_children, or other discovery tools in this mode.\n\n'
            f'{operation_op_guardrail}\n\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    elif helper_guarded_bulk_scope_intent and not followup_closed_world_turn:
        helper_call_guidance = (
            'Call bulk_update_tasks_by_parent exactly once with include_completed=true, then call '
            'plan_roadmap_operations exactly once.'
            if strict_parent_bulk_status_guard
            else (
                'Call one helper first (bulk_update_tasks_by_parent or '
                'bulk_update_tasks_by_filter), then call plan_roadmap_operations exactly once.'
                if parent_scoped_bulk_filter_guard
                else (
                    'Call bulk_update_tasks_by_filter first with explicit filter criteria, '
                    'then call plan_roadmap_operations exactly once.'
                )
            )
        )
        context_lane_header = (
            'You are in edit planning mode for a global bulk task update with explicit filters.\n'
            if global_bulk_filter_guard
            else 'You are in edit planning mode with resolved parent context for a bulk task update.\n'
        )
        planner_prompt = (
            f'{context_lane_header}'
            f'ReAct loop turn: {react_loop_turn}.\n'
            f'Max tool calls this turn: {edit_turns}.\n'
            'Do not call discovery/read tools in this turn.\n'
            f'{helper_call_guidance}\n'
            'Avoid low-level task-by-task discovery when helper filters can define the target set.\n\n'
            f'{operation_op_guardrail}\n\n'
            'Resolved context summary:\n'
            f'{json.dumps(effective_tool_summary[:10], ensure_ascii=True, separators=(",", ":"))}\n\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    elif followup_closed_world_turn:
        planner_prompt = (
            'You are in edit planning mode, follow-up ReAct turn.\n'
            f'ReAct loop turn: {react_loop_turn}.\n'
            f'Max tool calls this turn: {edit_turns}.\n'
            'ALL CONTEXT BELOW IS ALREADY RESOLVED.\n'
            'Do not call resolve_node_reference or get_children again for the same target.\n'
            'Your primary action in this turn is to call plan_roadmap_operations exactly once.\n'
            'For intents like "mark/update all tasks in or under X", use '
            'bulk_update_tasks_by_parent with include_completed=true and the resolved parent ID instead of asking for task IDs.\n'
            'For combined scope + filter updates (for example assignee/status/keyword), use bulk_update_tasks_by_filter.\n'
            'If task_ids or task summaries are already present in prior observations, stage operations immediately.\n'
            'If you still cannot produce safe operations, call plan_roadmap_operations with an empty '
            'operations list and place the clarifying question in assistant_message.\n\n'
            f'{operation_op_guardrail}\n\n'
            'Resolved node IDs:\n'
            f'{json.dumps(resolved_node_ids[:20], ensure_ascii=True, separators=(",", ":"))}\n\n'
            'Prior tool observation summary:\n'
            f'{json.dumps(effective_tool_summary[:10], ensure_ascii=True, separators=(",", ":"))}\n\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    else:
        planner_prompt = (
            'You are in edit planning mode.\n'
            'Resolve named targets to node IDs with resolve_node_reference before asking for IDs.\n'
            'Use context tools when needed to resolve node IDs and hierarchy before drafting operations.\n'
            'Use intent-level helper tools for common actions (create_*, move_*, reorder_*, bulk_*).\n'
            f'{operation_op_guardrail}\n'
            'For "all tasks under a feature/epic" status updates, prefer bulk_update_tasks_by_parent with include_completed=true.\n'
            'For broad task updates with filters, prefer bulk_update_tasks_by_filter.\n'
            'When ready, call plan_roadmap_operations exactly once with assistant_message and operations.\n'
            'Do not call commit or discard tools. Commit remains a UI action.\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}\n\n'
            'If request is ambiguous, use context tools first, then produce the safest possible operation plan.'
        )
        if isinstance(prior_observation, dict) and prior_observation:
            planner_prompt += (
                '\n\nPrevious ReAct observation:\n'
                f'{json.dumps(prior_observation, ensure_ascii=True, separators=(",", ":"))}'
            )
            if prior_provider_error_code == 'max_tool_turns_exceeded':
                planner_prompt += (
                    '\n\nPlanning retry guidance:\n'
                    'The previous planning turn reached its tool-call budget before finalizing operations. '
                    'Use the prior observations, avoid repeating resolved lookups, and call '
                    'plan_roadmap_operations as soon as the minimum safe context is available.'
                )
            if resolved_node_ids:
                planner_prompt += (
                    '\n\nResolved node IDs from previous turn:\n'
                    f'{json.dumps(resolved_node_ids[:20], ensure_ascii=True, separators=(",", ":"))}'
                )
        if prior_tool_summary_list:
            planner_prompt += (
                '\n\nPrevious tool observation summary:\n'
                f'{json.dumps(prior_tool_summary_list[:5], ensure_ascii=True, separators=(",", ":"))}'
            )
        if remaining_llm_budget is not None:
            planner_prompt += (
                '\n\nRemaining planner call budget for this turn:\n'
                f'{remaining_llm_budget}'
            )
        if react_loop_turn > 1:
            planner_prompt += (
                '\n\nFollow-up planning turn guidance:\n'
                f'This is ReAct loop turn {react_loop_turn}. '
                f'You have at most {edit_turns} tool calls this turn. '
                'Prefer previously resolved context and call plan_roadmap_operations '
                'as soon as a safe operation plan can be staged.'
            )
    if strict_mutation_authority_enabled:
        planner_prompt += (
            '\n\nStrict mutation-authority policy:\n'
            'Only plan_roadmap_operations may finalize staged operations. '
            'Treat helper tool results as intermediate context or drafts.'
        )

    planner_prompt += (
        '\n\nassistant_message requirement:\n'
        'When you call plan_roadmap_operations, set assistant_message to a concise '
        'user-visible planning summary (1-2 sentences) that states what you analyzed '
        'and what operations you are staging.\n'
        'Do not include hidden chain-of-thought, policy text, confidence scores, or '
        'internal deliberation.'
    )
    schema_invalid_attempts = 0
    repair_attempted = False
    last_provider_error_code: str | None = None
    planner_prompt_bytes = len(planner_prompt.encode('utf-8'))
    history_messages_count = len(history_messages)

    def _invoke_plan_with_tools(adapter: Any) -> tuple[str, list[RoadmapOperation]]:
        base_kwargs: dict[str, Any] = {
            'system_prompt': system_prompt,
            'planner_prompt': planner_prompt,
            'history_messages': history_messages,
            'tools': tool_definitions,
            'tool_executor': _capturing_tool_executor,
            'max_tool_turns': edit_turns,
        }
        current_planner_profile = str(planner_profile or '').strip()
        if current_planner_profile:
            base_kwargs['planner_profile'] = current_planner_profile
        if actor_context_for_planner is not None:
            base_kwargs['actor_context'] = actor_context_for_planner
        base_kwargs['parallel_tool_executor'] = _capturing_parallel_tool_executor
        base_kwargs['parallel_safe_tools'] = CONTEXT_TOOL_NAMES

        try:
            return adapter.plan_operations_with_tools(**base_kwargs)
        except TypeError:
            # Backward compatibility for test doubles and legacy adapters.
            fallback_kwargs = dict(base_kwargs)
            fallback_kwargs.pop('parallel_tool_executor', None)
            fallback_kwargs.pop('parallel_safe_tools', None)
            try:
                return adapter.plan_operations_with_tools(**fallback_kwargs)
            except TypeError:
                fallback_kwargs.pop('actor_context', None)
                try:
                    return adapter.plan_operations_with_tools(**fallback_kwargs)
                except TypeError:
                    fallback_kwargs.pop('planner_profile', None)
                    return adapter.plan_operations_with_tools(**fallback_kwargs)

    for attempt in range(max_attempts):
        if attempt > 0:
            repair_attempted = True
        try:
            llm_calls_used += 1
            result = planner._provider_orchestrator.call(
                _invoke_plan_with_tools,
                trace_context={
                    'trace_id': trace_id,
                    'phase': 'edit_plan',
                    'planner_profile': planner_profile or 'default',
                    'planner_prompt_bytes': planner_prompt_bytes,
                    'history_messages_count': history_messages_count,
                },
            )
        except ProviderAdapterError as exc:
            last_provider_error_code = exc.code
            if exc.code == 'invalid_operation_payload':
                _record_invalid_payload_metric(_classify_invalid_payload(exc.message))
                if attempt == 0:
                    synthesized_state = _try_synthesize_react_closure_state(
                        reason='provider_invalid_operation_payload_initial',
                        provider_error_code=exc.code,
                        tokens_input=exc.tokens_input,
                        tokens_output=exc.tokens_output,
                        tokens_total=exc.tokens_total,
                    )
                    if synthesized_state is not None:
                        return synthesized_state
            if exc.code == 'max_tool_turns_exceeded':
                provider_used = (
                    'openai'
                    if str(exc.provider).strip().lower() == 'openai'
                    else 'rule_based'
                )
                planner._logger.warning(
                    'Edit tool-call budget exhausted; returning replanning observation. code=%s message=%s',
                    exc.code,
                    exc.message,
                )
                return _finalize_state(
                    {
                        'assistant_message': (
                            'Collected partial context and will continue edit planning in the next turn.'
                        ),
                        'planned_operations': [],
                        'response_mode': 'edit_plan',
                        'preview_recommended': False,
                        'parse_mode': 'deterministic_react_tool_budget_replan',
                        'provider_used': provider_used,
                        'fallback_used': False,
                        'provider_error_code': exc.code,
                        'tokens_input': exc.tokens_input,
                        'tokens_output': exc.tokens_output,
                        'tokens_total': exc.tokens_total,
                        'pending_context_resolution': None,
                        'clear_pending_context_resolution': False,
                        'clarifier_action': None,
                        'clarifier_reason': None,
                        'clarifier_options': None,
                        'clarifier_schema_retries': schema_invalid_attempts,
                        'planner_schema_invalid_attempts': schema_invalid_attempts,
                        'planner_repair_attempted': repair_attempted,
                        'draft_action': 'continue',
                        'tool_plan': [],
                        'needs_more_info': True,
                        'stop_reason': 'tool_budget_exhausted',
                        'llm_calls_used': llm_calls_used,
                    },
                    used_calls=llm_calls_used,
                )
            if (
                exc.code == 'missing_tool_call'
                and attempt + 1 < max_attempts
            ):
                synthesized_state = _try_synthesize_react_closure_state(
                    reason='provider_missing_tool_call_pre_retry',
                    provider_error_code=exc.code,
                    tokens_input=exc.tokens_input,
                    tokens_output=exc.tokens_output,
                    tokens_total=exc.tokens_total,
                )
                if synthesized_state is not None:
                    return synthesized_state
            if exc.code in {'invalid_operation_payload', 'missing_tool_call'} and attempt + 1 < max_attempts:
                enum_op_payload = (
                    exc.code == 'invalid_operation_payload'
                    and planner._is_invalid_operation_enum_payload(exc.message)
                )
                schema_invalid_attempts += 1
                repair_attempted = True
                planner_prompt = planner._augment_repair_planner_prompt(
                    planner_prompt=planner_prompt,
                    error_code=exc.code,
                    error_message=exc.message,
                )
                if exc.code == 'missing_tool_call' or enum_op_payload:
                    # Retry in planning-only mode to avoid rediscovery churn.
                    tool_definitions = get_operation_tools()
                    if exc.code == 'missing_tool_call':
                        planner_profile = 'repair_retry'
                    planner_prompt = planner._augment_missing_tool_call_retry_prompt(
                        planner_prompt=planner_prompt,
                        user_message=user_message,
                        tool_observations=tool_observations,
                    )
                planner_prompt_bytes = len(planner_prompt.encode('utf-8'))
                continue
            planner._logger.warning(
                'Provider operation planning failed in react mode, using edit clarifier lane. code=%s message=%s',
                exc.code,
                exc.message,
            )
            synthesized_state = _try_synthesize_react_closure_state(
                reason='provider_react_exception_fallback',
                provider_error_code=exc.code,
                tokens_input=exc.tokens_input,
                tokens_output=exc.tokens_output,
                tokens_total=exc.tokens_total,
            )
            if synthesized_state is not None:
                return synthesized_state
            failure_state, clarifier_classification = _build_llm_first_failure_state(
                provider_error_code=exc.code,
                provider_error_message=exc.message,
                tokens_input=exc.tokens_input,
                tokens_output=exc.tokens_output,
                tokens_total=exc.tokens_total,
            )
            event_name = (
                'edit_outage_clarifier_returned'
                if clarifier_classification == 'provider_outage'
                else 'edit_actionable_failure_clarifier_returned'
            )
            log_event(
                planner._logger,
                event_name,
                settings=planner._settings,
                trace_id=trace_id,
                provider_error_code=exc.code,
                llm_first_mode_enabled=True,
                outage_clarifier_returned=(clarifier_classification == 'provider_outage'),
                planner_contract_failure_returned=(
                    clarifier_classification == 'planner_contract_failure'
                ),
                clarifier_classification=clarifier_classification,
            )
            return failure_state

        if not isinstance(result.value, tuple) or len(result.value) != 2:
            if attempt + 1 < max_attempts:
                schema_invalid_attempts += 1
                repair_attempted = True
                continue
            break

        assistant_message, raw_operations = result.value
        assistant_message = (
            assistant_message if isinstance(assistant_message, str) else str(assistant_message or '')
        )
        planning_tool_args = {
            'assistant_message': assistant_message.strip()[:200],
            'operations_count': len(raw_operations) if isinstance(raw_operations, list) else 0,
        }
        log_event(
            planner._logger,
            'tool_call_requested',
            settings=planner._settings,
            trace_id=trace_id,
            tool_name=PLANNING_TOOL_NAME,
            tool_args=planning_tool_args,
            arg_keys=sorted(planning_tool_args.keys()),
            roadmap_id=roadmap_id_value,
        )
        if raw_operations is None:
            operations = []
        elif isinstance(raw_operations, list):
            try:
                normalized_raw_operations: list[Any] = []
                for item in raw_operations:
                    if isinstance(item, RoadmapOperation):
                        normalized_raw_operations.append(
                            item.model_dump(mode='json', exclude_none=True)
                        )
                    else:
                        normalized_raw_operations.append(item)
                _, operations = parse_plan_tool_args(
                    {
                        'assistant_message': assistant_message or 'Prepared roadmap edit operations.',
                        'operations': normalized_raw_operations,
                    }
                )
                operations = _coerce_parent_scoped_bulk_task_status_operations(
                    user_message=user_message,
                    operations=operations,
                )
                operations = _maybe_complete_hierarchical_create_operations(
                    user_message=user_message,
                    operations=operations,
                )
            except Exception:
                log_event(
                    planner._logger,
                    'tool_call_result',
                    settings=planner._settings,
                    trace_id=trace_id,
                    tool_name=PLANNING_TOOL_NAME,
                    tool_error_code='invalid_operation_payload',
                    result_summary={
                        'result_type': 'dict',
                        'error_code': 'invalid_operation_payload',
                        'operations_count': planning_tool_args.get('operations_count'),
                    },
                )
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    continue
                break
        else:
            log_event(
                planner._logger,
                'tool_call_result',
                settings=planner._settings,
                trace_id=trace_id,
                tool_name=PLANNING_TOOL_NAME,
                tool_error_code='invalid_operation_payload',
                result_summary={
                    'result_type': 'dict',
                    'error_code': 'invalid_operation_payload',
                    'operations_count': 0,
                },
            )
            if attempt + 1 < max_attempts:
                schema_invalid_attempts += 1
                repair_attempted = True
                continue
            break

        log_event(
            planner._logger,
            'tool_call_result',
            settings=planner._settings,
            trace_id=trace_id,
            tool_name=PLANNING_TOOL_NAME,
            result_summary={
                'result_type': 'dict',
                'operations_count': len(operations),
                'operation_types': [operation.op.value for operation in operations],
                'assistant_message_present': bool(assistant_message.strip()),
            },
        )

        if operations:
            (
                operations,
                parent_hint_applied,
                parent_uuid_violations,
            ) = planner._coerce_parent_hint_for_operations(
                operations=operations,
                deictic_parent_hint=deictic_parent_hint,
            )
            if parent_uuid_violations:
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    planner_prompt = planner._augment_parent_uuid_retry_prompt(
                        planner_prompt=planner_prompt,
                        parent_uuid_violations=parent_uuid_violations,
                        deictic_parent_hint=deictic_parent_hint,
                    )
                    continue

                required_parent_types = sorted(
                    {
                        str(item.get('required_parent_type') or '').strip()
                        for item in parent_uuid_violations
                        if str(item.get('required_parent_type') or '').strip()
                    }
                )
                if required_parent_types:
                    target_text = ' or '.join(required_parent_types)
                    question = (
                        'I need the exact parent node before I can safely stage this edit. '
                        f'Please provide the parent {target_text} name.'
                    )
                else:
                    question = (
                        'I need the exact parent node before I can safely stage this edit. '
                        'Please provide the parent name.'
                    )
                clarifier_state = planner._build_edit_clarifier_state(
                    user_message=question,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    trace_id=trace_id,
                    provider_error_code='invalid_parent_uuid_unresolved',
                    llm_calls_used_base=llm_calls_used,
                )
                return _finalize_state(
                    clarifier_state,
                    used_calls=clarifier_state.get('llm_calls_used'),
                )


            semantic_validation_error = _first_semantic_contract_error(operations)
            if semantic_validation_error is not None:
                log_event(
                    planner._logger,
                    'semantic_operation_contract_violation',
                    settings=planner._settings,
                    trace_id=trace_id,
                    validation_error=semantic_validation_error,
                    operation_payloads=_operation_payloads(operations),
                )
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    planner_prompt = _augment_semantic_contract_retry_prompt(
                        planner_prompt=planner_prompt,
                        validation_error=semantic_validation_error,
                    )
                    continue

                reason = str(semantic_validation_error.get('reason') or '').strip()
                if reason == 'update_node.mutation_missing':
                    question = (
                        'I could not safely stage this edit because one or more update operations '
                        'did not include any actual changes. Please confirm the exact fields to change '
                        '(for unassign, use assignee_id=null).'
                    )
                elif reason == 'mark_status.status_invalid':
                    question = (
                        'I could not safely stage this edit because one or more status values were invalid. '
                        'Please confirm using one of: todo, in_progress, in_review, done, blocked.'
                    )
                else:
                    question = (
                        'I could not safely stage this edit because the generated operations were '
                        'semantically invalid. Please confirm the exact target and change.'
                    )

                clarifier_state = planner._build_edit_clarifier_state(
                    user_message=question,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    trace_id=trace_id,
                    provider_error_code='invalid_operation_contract',
                    llm_calls_used_base=llm_calls_used,
                )
                return _finalize_state(
                    clarifier_state,
                    used_calls=clarifier_state.get('llm_calls_used'),
                )
            if _has_bulk_task_status_semantic_mismatch(
                user_message=user_message,
                operations=operations,
            ):
                log_event(
                    planner._logger,
                    'bulk_task_scope_operation_mismatch',
                    settings=planner._settings,
                    trace_id=trace_id,
                    operation_payloads=_operation_payloads(operations),
                )
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    planner_prompt = _augment_bulk_task_status_contract_retry_prompt(
                        planner_prompt=planner_prompt,
                        operations=operations,
                    )
                    helper_tools = get_edit_helper_tools()
                    helper_names = (
                        {'bulk_update_tasks_by_parent', 'bulk_update_tasks_by_filter'}
                        if _is_parent_scoped_bulk_filter_update_intent(user_message)
                        else {'bulk_update_tasks_by_parent'}
                    )
                    tool_definitions = [
                        *_select_tools_by_name(helper_tools, helper_names),
                        get_planning_tool(),
                    ]
                    edit_turns = max(1, min(edit_turns, 2))
                    continue
                synthesized_state = _try_synthesize_react_closure_state(
                    reason='bulk_task_scope_operation_mismatch',
                    provider_error_code=result.provider_error_code,
                    tokens_input=result.tokens_input,
                    tokens_output=result.tokens_output,
                    tokens_total=result.tokens_total,
                )
                if synthesized_state is not None:
                    synthesized_operations = synthesized_state.get('planned_operations')
                    if isinstance(synthesized_operations, list) and synthesized_operations:
                        operations = synthesized_operations
                    else:
                        return synthesized_state
                else:
                    clarifier_state = planner._build_edit_clarifier_state(
                        user_message=(
                            'I could not safely stage this update because the plan targeted a '
                            'feature instead of child tasks.'
                        ),
                        system_prompt=system_prompt,
                        history_messages=history_messages,
                        trace_id=trace_id,
                        provider_error_code='bulk_task_scope_operation_mismatch',
                        llm_calls_used_base=llm_calls_used,
                    )
                    return _finalize_state(
                        clarifier_state,
                        used_calls=clarifier_state.get('llm_calls_used'),
                    )

            operation_types = [op.op.value for op in operations]
            planner_summary_text, planner_summary_source = _build_planner_summary_payload(
                assistant_message=assistant_message,
                operations=operations,
            )
            log_event(
                planner._logger,
                'planner_summary',
                settings=planner._settings,
                trace_id=trace_id,
                roadmap_id=roadmap_id_value,
                response_mode='edit_plan',
                summary_text=planner_summary_text,
                summary_source=planner_summary_source,
                operations_count=len(operations),
                operation_types=operation_types,
            )

            operation_payloads = _operation_payloads(operations)
            log_event(
                planner._logger,
                'plan_generated',
                settings=planner._settings,
                trace_id=trace_id,
                provider_used=result.provider_used,
                fallback_used=result.fallback_used,
                operations_count=len(operations),
                operation_types=operation_types,
                operation_payloads=operation_payloads,
                parent_hint_applied=parent_hint_applied,
                planner_prompt_bytes=planner_prompt_bytes,
                history_messages_count=history_messages_count,
                tokens_input=result.tokens_input,
                tokens_output=result.tokens_output,
                tokens_total=result.tokens_total,
            )
            for operation_index, operation_payload in enumerate(operation_payloads):
                log_event(
                    planner._logger,
                    'llm_planned_operation',
                    settings=planner._settings,
                    trace_id=trace_id,
                    provider_used=result.provider_used,
                    operation_index=operation_index,
                    operation=operation_payload,
                )
            return _finalize_state(
                {
                    'assistant_message': (
                        assistant_message.strip()
                        if isinstance(assistant_message, str) and assistant_message.strip()
                        else 'Prepared roadmap edit operations.'
                    ),
                    'planned_operations': operations,
                    'response_mode': 'edit_plan',
                    'preview_recommended': bool(operations),
                    'parse_mode': f'{result.provider_used}_tool_calling',
                    'provider_used': result.provider_used,
                    'fallback_used': result.fallback_used,
                    'provider_error_code': result.provider_error_code,
                    'tokens_input': result.tokens_input,
                    'tokens_output': result.tokens_output,
                    'tokens_total': result.tokens_total,
                    'pending_context_resolution': None,
                    'clear_pending_context_resolution': False,
                    'clarifier_action': None,
                    'clarifier_reason': None,
                    'clarifier_options': None,
                    'clarifier_schema_retries': schema_invalid_attempts,
                    'planner_schema_invalid_attempts': schema_invalid_attempts,
                    'planner_repair_attempted': repair_attempted,
                    'draft_action': 'continue',
                    'tool_plan': [],
                    'needs_more_info': False,
                    'stop_reason': 'ready_to_stage',
                }
            )

        synthesized_state = _try_synthesize_react_closure_state(
            reason='planner_returned_empty_operations',
            provider_error_code=result.provider_error_code,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            tokens_total=result.tokens_total,
        )
        if synthesized_state is not None:
            return synthesized_state
        clarifier_message = (
            assistant_message.strip()
            if isinstance(assistant_message, str) and assistant_message.strip()
            else (
                'I can help with that edit. Could you confirm the exact target '
                'or provide more details so I can stage the operation safely?'
            )
        )
        clarifier_action = 'ask_clarifier'
        clarifier_reason = 'discovery_unresolved'
        clarifier_options = [
            'Confirm the exact target label',
            'Provide the exact name',
            'Cancel',
        ]
        clarifier_message, clarifier_options = build_clarifier_contract(
            reason=clarifier_reason,
            question=clarifier_message,
            options=clarifier_options,
        )
        return _finalize_state(
            {
                'assistant_message': clarifier_message,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': f'{result.provider_used}_tool_calling_clarifier',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': last_provider_error_code or result.provider_error_code,
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
                'clarifier_action': clarifier_action,
                'clarifier_reason': clarifier_reason,
                'clarifier_options': clarifier_options,
                'clarifier_schema_retries': schema_invalid_attempts,
                'planner_schema_invalid_attempts': schema_invalid_attempts,
                'planner_repair_attempted': repair_attempted,
                'draft_action': 'continue',
                'tool_plan': [],
                'needs_more_info': True,
                'stop_reason': 'awaiting_user_input',
            }
        )

    synthesized_state = _try_synthesize_react_closure_state(
        reason='planner_attempts_exhausted',
        provider_error_code=last_provider_error_code,
    )
    if synthesized_state is not None:
        return synthesized_state

    return _finalize_state(
        _build_outage_edit_state(
            provider_error_code=last_provider_error_code or 'invalid_planner_schema',
        )
    )
