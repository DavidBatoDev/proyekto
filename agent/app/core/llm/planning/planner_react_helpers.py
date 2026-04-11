from __future__ import annotations

import json
import re
from typing import Any

from app.core.contracts.operations import OperationType, RoadmapOperation
from app.core.llm.contracts.clarifier_contract import build_clarifier_contract
from app.core.llm.react.react_executor import map_provider_error_to_stop_reason
from app.core.llm.providers import ProviderAdapterError
from app.core.logging_utils import log_event
from app.core.uuid_utils import normalize_uuid


def summarize_react_tool_observations(
    planner: Any,
    observations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    summary: list[dict[str, Any]] = []
    for observation in observations[-10:]:
        if not isinstance(observation, dict):
            continue
        summary_item = summarize_react_tool_observation(
            tool_name=str(observation.get('tool_name') or ''),
            args=observation.get('args'),
            result=observation.get('result'),
        )
        if summary_item is not None:
            summary.append(summary_item)
    return summary


def record_react_tool_observation(
    planner: Any,
    *,
    observations: list[dict[str, Any]],
    summary: list[dict[str, Any]],
    tool_name: str,
    args: dict[str, Any],
    result: dict[str, Any],
) -> None:
    observation = {
        'tool_name': tool_name,
        'args': dict(args) if isinstance(args, dict) else {},
        'result': result,
    }
    observations.append(observation)
    summary_item = summarize_react_tool_observation(
        tool_name=tool_name,
        args=observation.get('args'),
        result=result,
    )
    if summary_item is not None:
        summary.append(summary_item)
    if len(summary) > 10:
        del summary[: len(summary) - 10]


def summarize_react_tool_observation(
    *,
    tool_name: str,
    args: Any,
    result: Any,
) -> dict[str, Any] | None:
    normalized_tool_name = str(tool_name or '').strip()
    if not normalized_tool_name:
        return None
    summary_item: dict[str, Any] = {'tool_name': normalized_tool_name}

    if isinstance(args, dict):
        summary_item['arg_keys'] = sorted(str(key) for key in args.keys())[:6]
        label = args.get('label')
        if isinstance(label, str) and label.strip():
            summary_item['label'] = label.strip()[:80]
        node_id_arg = args.get('node_id')
        if isinstance(node_id_arg, str) and node_id_arg.strip():
            summary_item['queried_node_id'] = node_id_arg.strip()

    if isinstance(result, dict):
        status = result.get('status')
        if isinstance(status, str) and status.strip():
            summary_item['status'] = status.strip()[:48]
        error_payload = result.get('error')
        if isinstance(error_payload, dict):
            error_code = error_payload.get('code')
            if error_code is not None:
                summary_item['error_code'] = str(error_code)[:80]
        selected = result.get('selected')
        if isinstance(selected, dict):
            selected_id = selected.get('id')
            if isinstance(selected_id, str) and selected_id.strip():
                summary_item['selected_id'] = selected_id.strip()
        node_id = result.get('id')
        if isinstance(node_id, str) and node_id.strip():
            summary_item['node_id'] = node_id.strip()
        node_type = result.get('type')
        if isinstance(node_type, str) and node_type.strip():
            summary_item['node_type'] = node_type.strip()[:32]
        node_status = result.get('status') or result.get('state')
        if isinstance(node_status, str) and node_status.strip():
            summary_item['node_status'] = node_status.strip()[:48]
        node_title = result.get('title')
        if isinstance(node_title, str) and node_title.strip():
            summary_item['node_title'] = node_title.strip()[:80]
        feature_id = result.get('feature_id')
        if isinstance(feature_id, str) and feature_id.strip():
            summary_item['feature_id'] = feature_id.strip()
        epic_id = result.get('epic_id')
        if isinstance(epic_id, str) and epic_id.strip():
            summary_item['epic_id'] = epic_id.strip()
        operations = result.get('operations')
        if isinstance(operations, list):
            summary_item['operation_count'] = len(operations)

        task_ids: list[str] = []
        task_items: list[dict[str, str]] = []
        task_statuses: dict[str, str] = {}
        task_ids_seen: set[str] = set()

        def _append_task_summary(
            task_id: Any,
            *,
            title: Any = '',
            status_value: Any = '',
        ) -> None:
            if not isinstance(task_id, str) or not task_id.strip():
                return
            normalized_task_id = task_id.strip()
            if normalized_task_id in task_ids_seen:
                return
            task_ids_seen.add(normalized_task_id)
            task_ids.append(normalized_task_id)
            normalized_title = str(title or '').strip()[:60]
            normalized_status = str(status_value or '').strip()
            task_items.append(
                {
                    'id': normalized_task_id,
                    'title': normalized_title,
                    'status': normalized_status[:24],
                }
            )
            if normalized_status:
                task_statuses[normalized_task_id] = normalized_status[:48]

        task_ids_raw = result.get('task_ids')
        if isinstance(task_ids_raw, list):
            for task_id in task_ids_raw[:50]:
                _append_task_summary(task_id)

        tasks = result.get('tasks')
        if isinstance(tasks, list):
            summary_item['task_count'] = len(tasks)
            for task in tasks[:50]:
                if not isinstance(task, dict):
                    continue
                task_status = task.get('status') or task.get('state')
                _append_task_summary(
                    task.get('id'),
                    title=task.get('title'),
                    status_value=task_status,
                )

        if isinstance(operations, list):
            operation_node_ids: list[str] = []
            operation_node_ids_seen: set[str] = set()
            for operation in operations[:50]:
                if not isinstance(operation, dict):
                    continue
                operation_node_id = operation.get('node_id')
                if isinstance(operation_node_id, str) and operation_node_id.strip():
                    normalized_operation_node_id = operation_node_id.strip()
                    if normalized_operation_node_id not in operation_node_ids_seen:
                        operation_node_ids_seen.add(normalized_operation_node_id)
                        operation_node_ids.append(normalized_operation_node_id)

                op_node_type = str(operation.get('node_type') or '').strip().lower()
                if op_node_type == 'task':
                    _append_task_summary(
                        operation.get('node_id'),
                        status_value=operation.get('status'),
                    )

            if operation_node_ids:
                summary_item['operation_node_ids'] = operation_node_ids

        if task_ids:
            summary_item['task_ids'] = task_ids
        if task_statuses:
            summary_item['task_statuses'] = task_statuses
        if task_items:
            summary_item['tasks'] = task_items

        matches = result.get('matches')
        if isinstance(matches, list):
            summary_item['match_count'] = len(matches)
            match_ids: list[str] = []
            match_items: list[dict[str, str]] = []
            for match in matches[:5]:
                if isinstance(match, dict):
                    match_id = match.get('id')
                    if isinstance(match_id, str) and match_id.strip():
                        normalized_match_id = match_id.strip()
                        match_ids.append(normalized_match_id)
                        match_items.append(
                            {
                                'id': normalized_match_id,
                                'title': str(match.get('title') or '').strip()[:60],
                                'type': str(
                                    match.get('type') or match.get('node_type') or ''
                                ).strip()[:24],
                                'status': str(
                                    match.get('status') or match.get('state') or ''
                                ).strip()[:24],
                            }
                        )
            if match_ids:
                summary_item['match_ids'] = match_ids
            if match_items:
                summary_item['match_items'] = match_items
        children = result.get('children')
        if isinstance(children, list):
            summary_item['children_count'] = len(children)
            child_ids: list[str] = []
            child_statuses: dict[str, str] = {}
            child_items: list[dict[str, str]] = []
            for child in children[:20]:
                if not isinstance(child, dict):
                    continue
                child_id = child.get('id')
                if not isinstance(child_id, str) or not child_id.strip():
                    continue
                normalized_child_id = child_id.strip()
                child_ids.append(normalized_child_id)
                child_status = child.get('status') or child.get('state')
                if isinstance(child_status, str) and child_status.strip():
                    child_statuses[normalized_child_id] = child_status.strip()[:48]
                child_items.append(
                    {
                        'id': normalized_child_id,
                        'title': str(child.get('title') or '').strip()[:60],
                        'type': str(
                            child.get('type') or child.get('node_type') or ''
                        ).strip()[:24],
                        'status': str(child_status or '').strip()[:24],
                    }
                )
            if child_ids:
                summary_item['child_ids'] = child_ids
            if child_statuses:
                summary_item['child_statuses'] = child_statuses
            if child_items:
                summary_item['children'] = child_items

    return summary_item


def is_uuid(value: Any) -> bool:
    return normalize_uuid(value) is not None


def coerce_parent_hint_for_operations(
    planner: Any,
    *,
    operations: list[RoadmapOperation],
    deictic_parent_hint: dict[str, Any] | None,
) -> tuple[list[RoadmapOperation], bool, list[dict[str, Any]]]:
    hint_node_id = ''
    hint_node_type = ''
    if isinstance(deictic_parent_hint, dict):
        hint_node_id = str(deictic_parent_hint.get('node_id') or '').strip()
        hint_node_type = str(deictic_parent_hint.get('node_type') or '').strip().lower()
    normalized_hint_node_id = normalize_uuid(hint_node_id)
    if normalized_hint_node_id is None:
        hint_node_id = ''
        hint_node_type = ''
    else:
        hint_node_id = normalized_hint_node_id

    corrected_operations: list[RoadmapOperation] = []
    parent_hint_applied = False
    violations: list[dict[str, Any]] = []

    for index, operation in enumerate(operations):
        op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
        required_parent_type = None
        if op_name == 'add_feature':
            required_parent_type = 'epic'
        elif op_name == 'add_task':
            required_parent_type = 'feature'

        if required_parent_type is None:
            corrected_operations.append(operation)
            continue

        if isinstance(operation.parent_ref, str) and operation.parent_ref.strip():
            corrected_operations.append(operation)
            continue

        normalized_parent_id = normalize_uuid(operation.parent_id)
        if normalized_parent_id is not None:
            if operation.parent_id == normalized_parent_id:
                corrected_operations.append(operation)
            else:
                corrected_operation = operation.model_copy(deep=True)
                corrected_operation.parent_id = normalized_parent_id
                corrected_operations.append(corrected_operation)
            continue

        if hint_node_id and (hint_node_type == required_parent_type):
            corrected_operation = operation.model_copy(deep=True)
            corrected_operation.parent_id = hint_node_id
            corrected_operations.append(corrected_operation)
            parent_hint_applied = True
            continue

        corrected_operations.append(operation)
        violations.append(
            {
                'index': index,
                'operation': op_name,
                'required_parent_type': required_parent_type,
                'parent_id': operation.parent_id,
                'parent_ref': operation.parent_ref,
            }
        )

    return corrected_operations, parent_hint_applied, violations


def augment_parent_uuid_retry_prompt(
    *,
    planner_prompt: str,
    parent_uuid_violations: list[dict[str, Any]],
    deictic_parent_hint: dict[str, Any] | None,
) -> str:
    violation_payload = json.dumps(
        parent_uuid_violations[:5],
        ensure_ascii=True,
        separators=(',', ':'),
    )
    hint_payload = (
        json.dumps(deictic_parent_hint, ensure_ascii=True, separators=(',', ':'))
        if isinstance(deictic_parent_hint, dict)
        else 'null'
    )
    return (
        f'{planner_prompt}\n\n'
        'PARENT UUID CONTRACT REPAIR:\n'
        'One or more add_feature/add_task operations are missing a valid parent target.\n'
        'Retry by calling plan_roadmap_operations exactly once and ensure every add_feature/add_task '
        'operation has either a valid UUID parent_id or a parent_ref that references a temp_id '
        'created in the same operations batch.\n'
        'If parent target is still unknown, return empty operations and ask one focused clarifier.\n\n'
        f'Parent UUID violations:\n{violation_payload}\n\n'
        f'Deictic parent hint (if available):\n{hint_payload}'
    )


def build_synthesized_react_closure_state(
    *,
    operations: list[RoadmapOperation],
    schema_invalid_attempts: int,
    repair_attempted: bool,
    draft_action: str,
    tool_plan: list[dict[str, Any]],
    tokens_input: int | None = None,
    tokens_output: int | None = None,
    tokens_total: int | None = None,
) -> dict[str, Any]:
    return {
        'assistant_message': 'Prepared roadmap edit operations from resolved target context.',
        'planned_operations': operations,
        'response_mode': 'edit_plan',
        'preview_recommended': True,
        'parse_mode': 'deterministic_react_tool_closure',
        'provider_used': 'rule_based',
        'fallback_used': False,
        'provider_error_code': None,
        'tokens_input': tokens_input,
        'tokens_output': tokens_output,
        'tokens_total': tokens_total,
        'pending_context_resolution': None,
        'clear_pending_context_resolution': False,
        'clarifier_action': None,
        'clarifier_reason': None,
        'clarifier_options': None,
        'clarifier_schema_retries': schema_invalid_attempts,
        'planner_schema_invalid_attempts': schema_invalid_attempts,
        'planner_repair_attempted': repair_attempted,
        'draft_action': draft_action,
        'tool_plan': tool_plan,
        'needs_more_info': False,
        'stop_reason': 'ready_to_stage',
    }


def maybe_synthesize_react_closure_operations(
    planner: Any,
    *,
    user_message: str,
    tool_observations: list[dict[str, Any]],
    session_context: dict[str, Any] | None = None,
    force_include_completed: bool | None = None,
) -> list[RoadmapOperation] | None:
    rename_labels = extract_rename_request_labels(user_message)
    if rename_labels is not None:
        from_label, to_title = rename_labels
        normalized_from_label = normalize_label_for_matching(from_label)
        for observation in reversed(tool_observations):
            if str(observation.get('tool_name') or '').strip() != 'resolve_node_reference':
                continue
            args = observation.get('args')
            result = observation.get('result')
            if not isinstance(args, dict) or not isinstance(result, dict):
                continue

            status = str(result.get('status') or '').strip().lower()
            selected_payload = result.get('selected')
            if not isinstance(selected_payload, dict):
                matches_payload = result.get('matches')
                if (
                    status == 'unique'
                    and isinstance(matches_payload, list)
                    and len(matches_payload) == 1
                    and isinstance(matches_payload[0], dict)
                ):
                    selected_payload = matches_payload[0]

            if status != 'unique' or not isinstance(selected_payload, dict):
                continue

            requested_label = str(args.get('label') or '').strip()
            normalized_requested_label = normalize_label_for_matching(requested_label)
            if normalized_from_label and normalized_requested_label:
                if (
                    normalized_from_label != normalized_requested_label
                    and normalized_from_label not in normalized_requested_label
                    and normalized_requested_label not in normalized_from_label
                ):
                    continue

            node_id = normalize_uuid(selected_payload.get('id'))
            if node_id is None:
                continue

            return [
                RoadmapOperation(
                    op='update_node',
                    node_id=node_id,
                    patch={'title': to_title},
                )
            ]

    for observation in reversed(tool_observations):
        if str(observation.get('tool_name') or '').strip() != 'bulk_update_tasks_by_filter':
            continue
        helper_result = observation.get('result')
        if not isinstance(helper_result, dict):
            continue
        if isinstance(helper_result.get('error'), dict):
            continue
        raw_operations = helper_result.get('operations')
        if not isinstance(raw_operations, list) or not raw_operations:
            continue
        synthesized_operations: list[RoadmapOperation] = []
        for item in raw_operations:
            if not isinstance(item, dict):
                continue
            try:
                synthesized_operations.append(RoadmapOperation.model_validate(item))
            except Exception:
                continue
        if synthesized_operations:
            return synthesized_operations

    bulk_status = extract_bulk_parent_status_target(user_message)
    if bulk_status is None:
        return None
    resolved_parent = extract_latest_unique_parent_resolution(tool_observations)
    if resolved_parent is None:
        return None

    parent_type_hint = infer_explicit_parent_type_hint(user_message)
    parent_type = parent_type_hint or resolved_parent.get('node_type')
    parent_id = normalize_uuid(resolved_parent.get('node_id')) or ''
    if parent_type not in {'epic', 'feature'} or not parent_id:
        return None

    roadmap_id = str(
        resolved_parent.get('roadmap_id')
        or (session_context or {}).get('roadmap_id')
        or ''
    ).strip()
    if not roadmap_id:
        return None

    tool_session_context = dict(session_context or {})
    if not str(tool_session_context.get('roadmap_id') or '').strip():
        tool_session_context['roadmap_id'] = roadmap_id

    helper_result = planner._execute_context_tool(
        'bulk_update_tasks_by_parent',
        {
            'roadmap_id': roadmap_id,
            'parent_type': parent_type,
            'parent_id': parent_id,
            'status': bulk_status,
            'include_completed': bool(force_include_completed),
        },
        tool_session_context,
    )
    if not isinstance(helper_result, dict) or isinstance(helper_result.get('error'), dict):
        return None

    raw_operations = helper_result.get('operations')
    if not isinstance(raw_operations, list) or not raw_operations:
        return None

    synthesized_operations: list[RoadmapOperation] = []
    for item in raw_operations:
        if not isinstance(item, dict):
            continue
        try:
            synthesized_operations.append(RoadmapOperation.model_validate(item))
        except Exception:
            continue
    return synthesized_operations or None


def extract_bulk_parent_status_target(user_message: str) -> str | None:
    normalized = ' '.join(str(user_message or '').strip().lower().split())
    if not normalized or 'task' not in normalized:
        return None
    if not re.search(r'\b(all|every)\b', normalized):
        return None
    if not re.search(r'\b(mark|update|set|change)\b', normalized):
        return None
    if not re.search(r'\b(in|under|within|inside|for)\b', normalized):
        return None

    status_patterns = [
        (r'\bin[\s_-]*review\b', 'in_review'),
        (r'\bin[\s_-]*progress\b', 'in_progress'),
        (r'\bcompleted\b', 'done'),
        (r'\bdone\b', 'done'),
        (r'\bblocked\b', 'blocked'),
        (r'\btodo\b', 'todo'),
        (r'\bto\s*do\b', 'todo'),
    ]
    for pattern, status in status_patterns:
        if re.search(pattern, normalized):
            return status
    return None


def infer_explicit_parent_type_hint(user_message: str) -> str | None:
    normalized = ' '.join(str(user_message or '').strip().lower().split())
    if not normalized:
        return None
    mentions_epic = bool(re.search(r'\bepic\b', normalized))
    mentions_feature = bool(re.search(r'\bfeature\b', normalized))
    if mentions_epic and not mentions_feature:
        return 'epic'
    if mentions_feature and not mentions_epic:
        return 'feature'
    return None


def extract_latest_unique_parent_resolution(
    tool_observations: list[dict[str, Any]],
) -> dict[str, str] | None:
    for observation in reversed(tool_observations):
        if str(observation.get('tool_name') or '').strip() != 'resolve_node_reference':
            continue
        args = observation.get('args')
        result = observation.get('result')
        if not isinstance(args, dict) or not isinstance(result, dict):
            continue
        if bool(result.get('type_relaxed')):
            continue
        if str(result.get('status') or '').strip().lower() != 'unique':
            continue

        selected = result.get('selected')
        if not isinstance(selected, dict):
            matches = result.get('matches')
            if (
                isinstance(matches, list)
                and len(matches) == 1
                and isinstance(matches[0], dict)
            ):
                selected = matches[0]
        if not isinstance(selected, dict):
            continue

        node_id = normalize_uuid(selected.get('id'))
        node_type = str(selected.get('type') or '').strip().lower()
        if node_type not in {'epic', 'feature'} or node_id is None:
            continue

        roadmap_id = str(args.get('roadmap_id') or '').strip()
        return {
            'node_id': node_id,
            'node_type': node_type,
            'roadmap_id': roadmap_id,
        }
    return None


def extract_rename_request_labels(user_message: str) -> tuple[str, str] | None:
    text = ' '.join(user_message.strip().split())
    if not text:
        return None

    patterns = [
        r'(?i)\b(?:rename|retitle)\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|as)\s+(.+)$',
        r'(?i)\bchange(?:\s+the)?\s+name(?:\s+of)?\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|as)\s+(.+)$',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match is None:
            continue
        from_label = strip_quotes_and_punctuation(match.group(1))
        to_title = strip_quotes_and_punctuation(match.group(2))
        if from_label and to_title:
            return from_label, to_title
    return None


def strip_quotes_and_punctuation(value: str) -> str:
    cleaned = value.strip()
    cleaned = cleaned.strip('"\'`')
    cleaned = re.sub(r'[.?!,;:]+$', '', cleaned)
    return ' '.join(cleaned.split())


def normalize_label_for_matching(value: str) -> str:
    lowered = value.lower().strip()
    normalized = re.sub(r'[^a-z0-9]+', ' ', lowered)
    return ' '.join(normalized.split())


def is_invalid_operation_enum_payload(error_message: str | None) -> bool:
    detail = str(error_message or '').strip().lower()
    if not detail:
        return False
    has_op_loc = "('op',)" in detail or '"op"' in detail
    has_enum_hint = "'type': 'enum'" in detail or 'input should be' in detail
    return has_op_loc and has_enum_hint


def augment_repair_planner_prompt(
    *,
    planner_prompt: str,
    error_code: str,
    error_message: str | None = None,
) -> str:
    if error_code == 'missing_tool_call':
        guidance = (
            '\n\nIMPORTANT REPAIR: Your previous response did not call '
            'plan_roadmap_operations. You MUST call plan_roadmap_operations exactly once. '
            'If clarification is still needed, return an empty operations list in that tool call '
            'and ask the clarifying question in assistant_message.'
        )
    elif error_code == 'invalid_operation_payload':
        detail = str(error_message or '').strip()
        enum_payload_failure = is_invalid_operation_enum_payload(detail)
        detail_suffix = f' Validation detail: {detail}' if detail else ''
        allowed_ops = ', '.join(item.value for item in OperationType)
        enum_guardrail = (
            ' Helper tool names are never valid operation op values. '
            f'Allowed operation op values: {allowed_ops}.'
            if enum_payload_failure
            else ''
        )
        guidance = (
            '\n\nIMPORTANT REPAIR: Your previous tool-call payload failed schema validation. '
            'Retry with a valid plan_roadmap_operations payload using only supported operation fields. '
            'Use existing resolved IDs and avoid repeating discovery tools unless IDs are still missing.'
            ' For assignment updates, use patch.assignee_id (never assignee). '
            'For unassign actions, set patch.assignee_id to null (never "unassign" as a string). '
            'For broad assignment requests, prefer bulk_assign_tasks or bulk_update_tasks_by_filter '
            'and include assignee_id. '
            'When assigning to "me", use actor_context.actor_id from runtime context.'
            f'{enum_guardrail}'
            f'{detail_suffix}'
        )
    else:
        return planner_prompt

    if guidance.strip() in planner_prompt:
        return planner_prompt
    return planner_prompt + guidance


def augment_missing_tool_call_retry_prompt(
    planner: Any,
    *,
    planner_prompt: str,
    user_message: str,
    tool_observations: list[dict[str, Any]],
) -> str:
    updated_prompt = planner_prompt
    retry_mode_marker = 'RETRY EXECUTION MODE:'
    if retry_mode_marker not in updated_prompt:
        updated_prompt += (
            '\n\nRETRY EXECUTION MODE:\n'
            'Previous attempt ended without a final planning tool call.\n'
            'You MUST call plan_roadmap_operations exactly once in this retry.\n'
            'If context is still insufficient, call plan_roadmap_operations with an empty operations list\n'
            'and put the clarifying question in assistant_message.'
        )

    summary_marker = 'RETRY TOOL OBSERVATION SUMMARY:'
    if summary_marker not in updated_prompt:
        if tool_observations:
            retry_summary = summarize_react_tool_observations(planner, tool_observations)
            summary_payload = (
                json.dumps(retry_summary[:10], ensure_ascii=True, separators=(",", ":"))
                if retry_summary
                else 'No summarized observations available from prior attempts.'
            )
            updated_prompt += (
                '\n\nRETRY TOOL OBSERVATION SUMMARY:\n'
                f'{summary_payload}'
            )
        else:
            updated_prompt += (
                '\n\nRETRY TOOL OBSERVATION SUMMARY:\n'
                'No prior tool observations were captured in earlier attempts.'
            )

    requested_count = extract_todo_delete_count(user_message)
    if requested_count is None:
        return updated_prompt

    ordered_todo_candidates = collect_ordered_todo_delete_candidates(tool_observations)
    if len(ordered_todo_candidates) < requested_count:
        return updated_prompt

    policy_marker = 'DETERMINISTIC TODO DELETE SELECTION POLICY:'
    if policy_marker in updated_prompt:
        return updated_prompt

    updated_prompt += (
        '\n\nDETERMINISTIC TODO DELETE SELECTION POLICY:\n'
        f'User requested removing {requested_count} todo tasks.\n'
        'Use ONLY the ordered candidate list below.\n'
        f'Select the first {requested_count} candidates in listed order where status is exactly "todo".\n'
        'Then call plan_roadmap_operations exactly once with delete_node operations for those IDs.\n'
        'Do not ask which tasks to delete when this deterministic candidate list is available.\n'
        'Ordered todo task candidates:\n'
        f'{json.dumps(ordered_todo_candidates[:20], ensure_ascii=True, separators=(",", ":"))}'
    )
    return updated_prompt


def extract_todo_delete_count(user_message: str) -> int | None:
    text = ' '.join(user_message.strip().lower().split())
    if not text:
        return None

    digit_match = re.search(
        r'\b(?:remove|delete)\s+(\d+)\s+(?:\w+\s+)?todo\s+tasks?\b',
        text,
    )
    if digit_match is not None:
        requested_count = int(digit_match.group(1))
        return requested_count if requested_count > 0 else None

    word_to_number = {
        'one': 1,
        'two': 2,
        'three': 3,
        'four': 4,
        'five': 5,
        'six': 6,
        'seven': 7,
        'eight': 8,
        'nine': 9,
        'ten': 10,
    }
    word_match = re.search(
        r'\b(?:remove|delete)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?todo\s+tasks?\b',
        text,
    )
    if word_match is None:
        return None

    return word_to_number.get(word_match.group(1))


def collect_ordered_todo_delete_candidates(
    tool_observations: list[dict[str, Any]],
) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    seen_ids: set[str] = set()

    for observation in tool_observations:
        if str(observation.get('tool_name') or '').strip() != 'get_children':
            continue

        result = observation.get('result')
        if not isinstance(result, dict):
            continue

        children = result.get('children')
        if not isinstance(children, list):
            continue

        for child in children:
            if not isinstance(child, dict):
                continue

            node_id = str(child.get('id') or '').strip()
            if not node_id or node_id in seen_ids:
                continue

            node_type = str(child.get('type') or child.get('node_type') or '').strip().lower()
            if node_type and node_type != 'task':
                continue

            status = str(child.get('status') or child.get('state') or '').strip().lower()
            if status != 'todo':
                continue

            seen_ids.add(node_id)
            candidates.append(
                {
                    'id': node_id,
                    'title': str(child.get('title') or '').strip()[:80],
                    'type': node_type or 'task',
                    'status': status,
                }
            )

    return candidates


def build_edit_clarifier_state(
    planner: Any,
    *,
    user_message: str,
    system_prompt: str,
    history_messages: list[Any],
    trace_id: str | None,
    provider_error_code: str,
    llm_calls_used_base: int = 0,
) -> dict[str, Any]:
    clarification_prompt = build_edit_clarifier_prompt(user_message=user_message)
    schema_retries = 0
    parse_error_code: str | None = None
    stop_reason = map_provider_error_to_stop_reason(provider_error_code)
    llm_calls_used = max(int(llm_calls_used_base), 0)

    for attempt in range(2):
        try:
            llm_calls_used += 1
            result = planner._provider_orchestrator.call(
                lambda adapter: adapter.generate_chat_reply(
                    system_prompt=system_prompt,
                    user_message=clarification_prompt,
                    history_messages=history_messages,
                ),
                trace_context={'trace_id': trace_id, 'phase': 'edit_clarifier'},
            )
        except ProviderAdapterError as clarifier_exc:
            planner._logger.warning(
                'Provider clarifier generation failed. code=%s message=%s',
                clarifier_exc.code,
                clarifier_exc.message,
            )
            return neutral_edit_clarifier_state(
                provider_error_code=provider_error_code,
                schema_retries=schema_retries,
                stop_reason=stop_reason,
                llm_calls_used=llm_calls_used,
            )

        try:
            parse_payload = getattr(planner, '_parse_edit_clarifier_payload', None)
            if callable(parse_payload):
                parsed = parse_payload(result.value)
            else:
                payload_model = getattr(planner, '_edit_clarifier_payload_model', None)
                if payload_model is None:
                    raise ValueError('invalid_clarifier_schema')
                parsed = parse_edit_clarifier_payload(
                    result.value,
                    payload_model=payload_model,
                )
            assistant_message, clarifier_options = format_edit_clarifier_message(parsed)
            log_event(
                planner._logger,
                'edit_clarifier_generated',
                settings=planner._settings,
                trace_id=trace_id,
                clarifier_action=parsed.action,
                clarifier_schema_retries=schema_retries,
                provider_used=result.provider_used,
            )
            return {
                'assistant_message': assistant_message,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': f'{result.provider_used}_edit_clarifier',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': provider_error_code,
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
                'clarifier_action': parsed.action,
                'clarifier_reason': parsed.reason,
                'clarifier_options': clarifier_options,
                'clarifier_schema_retries': schema_retries,
                'planner_schema_invalid_attempts': schema_retries,
                'planner_repair_attempted': schema_retries > 0,
                'draft_action': 'continue',
                'tool_plan': [],
                'needs_more_info': True,
                'stop_reason': stop_reason or 'awaiting_user_input',
                'llm_calls_used': llm_calls_used,
            }
        except ValueError:
            parse_error_code = 'invalid_clarifier_schema'
            if attempt == 0:
                schema_retries = 1
                continue
            break

    return neutral_edit_clarifier_state(
        provider_error_code=parse_error_code or provider_error_code,
        schema_retries=schema_retries,
        stop_reason=stop_reason,
        llm_calls_used=llm_calls_used,
    )


def build_edit_clarifier_prompt(*, user_message: str) -> str:
    return (
        'You are generating an edit clarification response for a roadmap assistant. '
        'Return STRICT JSON only with keys: action, reason, question, options.\n'
        'action must be one of: ask_clarifier, propose_safe_default, cannot_proceed.\n'
        'question must be concise and actionable.\n'
        'options must contain 2-4 short options.\n'
        'Do not include markdown, prose, or code fences.\n'
        'For propose_safe_default, suggest the safest default and ask for explicit confirmation.\n'
        f'User request: {user_message}'
    )


def parse_edit_clarifier_payload(raw: str, *, payload_model: Any) -> Any:
    text = raw.strip()
    candidate = text
    if not (text.startswith('{') and text.endswith('}')):
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            candidate = match.group(0)
    try:
        payload = payload_model.model_validate_json(candidate)
    except Exception as exc:
        raise ValueError('invalid_clarifier_schema') from exc
    if not payload.question.strip():
        raise ValueError('invalid_clarifier_schema')
    cleaned_options = [opt.strip() for opt in payload.options if isinstance(opt, str) and opt.strip()]
    if not cleaned_options:
        raise ValueError('invalid_clarifier_schema')
    if len(cleaned_options) > 5:
        cleaned_options = cleaned_options[:5]
    return payload.model_copy(update={'options': cleaned_options})


def format_edit_clarifier_message(payload: Any) -> tuple[str, list[str]]:
    question = payload.question.strip()
    if payload.action == 'propose_safe_default':
        question = f'{question} Reply "yes" to proceed, or tell me what to change.'
    return build_clarifier_contract(
        reason=payload.reason,
        question=question,
        options=payload.options,
    )


def neutral_edit_clarifier_state(
    *,
    provider_error_code: str | None,
    schema_retries: int,
    stop_reason: str | None = None,
    llm_calls_used: int | None = None,
) -> dict[str, Any]:
    resolved_stop_reason = (
        stop_reason
        or map_provider_error_to_stop_reason(provider_error_code)
        or 'awaiting_user_input'
    )
    fallback_options = [
        'Create epic "AI Module" at roadmap root',
        'Use a different title',
        'Create under a specific parent',
    ]
    assistant_message, clarifier_options = build_clarifier_contract(
        reason='edit_clarifier_fallback',
        question=(
            'I can help with that edit. Could you confirm the exact action and target '
            '(for example: create epic, rename feature, or move task)?'
        ),
        options=fallback_options,
    )
    return {
        'assistant_message': assistant_message,
        'planned_operations': [],
        'response_mode': 'chat',
        'preview_recommended': False,
        'parse_mode': 'neutral_edit_clarifier',
        'provider_used': 'rule_based',
        'fallback_used': False,
        'provider_error_code': provider_error_code,
        'tokens_input': None,
        'tokens_output': None,
        'tokens_total': None,
        'pending_context_resolution': None,
        'clear_pending_context_resolution': False,
        'clarifier_action': 'ask_clarifier',
        'clarifier_reason': 'edit_clarifier_fallback',
        'clarifier_options': clarifier_options,
        'clarifier_schema_retries': schema_retries,
        'planner_schema_invalid_attempts': schema_retries,
        'planner_repair_attempted': schema_retries > 0,
        'draft_action': 'continue',
        'tool_plan': [],
        'needs_more_info': True,
        'stop_reason': resolved_stop_reason,
        'llm_calls_used': max(int(llm_calls_used or 0), 0),
    }
