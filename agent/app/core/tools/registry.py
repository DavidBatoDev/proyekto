from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.core.contracts.operations import OperationType, RoadmapOperation
from app.core.uuid_utils import normalize_uuid

TASK_STATUS_VALUES = ['todo', 'in_progress', 'in_review', 'done', 'blocked']
TASK_STATUS_FILTER_VALUES = [*TASK_STATUS_VALUES, 'all']
FEATURE_STATUS_FILTER_VALUES = [
    'not_started',
    'in_progress',
    'in_review',
    'completed',
    'blocked',
    'all',
]
EPIC_PRIORITY_FILTER_VALUES = ['critical', 'nice_to_have', 'low', 'medium', 'high', 'all']

PLANNING_TOOL_NAME = 'plan_roadmap_operations'
CONTEXT_TOOL_NAMES = {
    'get_roadmap_summary',
    'get_roadmap_overview',
    'resolve_node_reference',
    'search_nodes',
    'search_tasks',
    'get_node_details',
    'get_children',
    'get_children_from_resolution',
    'get_features_by_epic',
    'get_feature_details',
    'get_epics_by_roadmap',
    'get_epic_progress',
    'get_tasks_assigned_to_me',
    'get_tasks_by_status',
    'get_tasks_by_parent',
    'get_tasks_by_feature',
    'get_tasks_by_epic',
    'get_overdue_tasks',
    'get_blocked_items',
}

EDIT_HELPER_TOOL_NAMES = {
    'create_epic',
    'create_feature',
    'create_task',
    'update_task_status',
    'update_task_priority',
    'update_task_assignee',
    'update_feature_status',
    'update_epic_status',
    'update_titles',
    'delete_task',
    'delete_feature',
    'delete_epic',
    'move_task_to_feature',
    'move_feature_to_epic',
    'reorder_tasks',
    'reorder_features',
    'reorder_epics',
    'bulk_update_task_status',
    'bulk_update_tasks_by_parent',
    'bulk_update_tasks_by_filter',
    'bulk_assign_tasks',
    'bulk_delete_tasks',
    'bulk_move_tasks_to_feature',
    'bulk_update_feature_status',
    'bulk_update_epic_status',
}

EXECUTABLE_TOOL_NAMES = CONTEXT_TOOL_NAMES | EDIT_HELPER_TOOL_NAMES


def _function_tool(
    *,
    name: str,
    description: str,
    required: list[str],
    properties: dict[str, Any],
) -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': name,
            'description': description,
            'parameters': {
                'type': 'object',
                'required': required,
                'properties': properties,
            },
        },
    }


def get_context_tools() -> list[dict[str, Any]]:
    return [
        _function_tool(
            name='get_roadmap_summary',
            description=(
                'Fetch a lightweight roadmap summary for context. '
                'Use this before planning edits when the roadmap context is unclear.'
            ),
            required=['roadmap_id'],
            properties={'roadmap_id': {'type': 'string'}},
        ),
        _function_tool(
            name='get_roadmap_overview',
            description=(
                'Get a high-level roadmap overview with epic, feature, and task totals '
                'plus per-epic progress snapshots.'
            ),
            required=['roadmap_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'include_epics': {'type': 'boolean'},
                'max_epics': {'type': 'integer', 'minimum': 1, 'maximum': 100},
            },
        ),
        _function_tool(
            name='resolve_node_reference',
            description=(
                'Primary tool for resolving user-mentioned epics, features, or tasks by name '
                'to a concrete node id. Use this before asking for manual IDs. '
                'Set node_type only when the user explicitly names epic, feature, or task. '
                'If the user does not explicitly name the type, omit node_type so resolution can '
                'consider all node types safely. Use allowed_node_types to scope candidate kinds '
                'without over-constraining to a single node type.'
            ),
            required=['roadmap_id', 'label'],
            properties={
                'roadmap_id': {'type': 'string'},
                'label': {'type': 'string'},
                'node_type': {'type': 'string', 'enum': ['epic', 'feature', 'task']},
                'allowed_node_types': {
                    'type': 'array',
                    'items': {'type': 'string', 'enum': ['epic', 'feature', 'task']},
                    'minItems': 1,
                    'maxItems': 3,
                },
                'auto_correct': {'type': 'boolean', 'default': True},
                'fuzzy': {'type': 'boolean', 'default': False},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
            },
        ),
        _function_tool(
            name='search_nodes',
            description=(
                'Search roadmap nodes by text query for broad keyword exploration. '
                'Use only when resolve_node_reference fails to disambiguate.'
            ),
            required=['roadmap_id', 'query'],
            properties={
                'roadmap_id': {'type': 'string'},
                'query': {'type': 'string'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
            },
        ),
        _function_tool(
            name='search_tasks',
            description='Search task nodes by keyword.',
            required=['roadmap_id', 'query'],
            properties={
                'roadmap_id': {'type': 'string'},
                'query': {'type': 'string'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100},
            },
        ),
        _function_tool(
            name='get_node_details',
            description='Get full details for a roadmap node by ID.',
            required=['roadmap_id', 'node_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'node_id': {'type': 'string'},
            },
        ),
        _function_tool(
            name='get_children_from_resolution',
            description=(
                'Get child nodes by selecting a candidate from resolve_node_reference '
                'using a backend-issued resolution_id and choice index.'
            ),
            required=['roadmap_id', 'resolution_id', 'choice'],
            properties={
                'roadmap_id': {'type': 'string'},
                'resolution_id': {'type': 'string'},
                'choice': {'type': 'integer', 'minimum': 1},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100},
            },
        ),
        _function_tool(
            name='get_features_by_epic',
            description='List features for an epic id.',
            required=['roadmap_id', 'epic_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'epic_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': FEATURE_STATUS_FILTER_VALUES},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100},
            },
        ),
        _function_tool(
            name='get_feature_details',
            description='Get details for a feature node by feature_id.',
            required=['roadmap_id', 'feature_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'feature_id': {'type': 'string'},
            },
        ),
        _function_tool(
            name='get_epics_by_roadmap',
            description='List epics in a roadmap with status and feature counts.',
            required=['roadmap_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': FEATURE_STATUS_FILTER_VALUES},
                'priority': {'type': 'string', 'enum': EPIC_PRIORITY_FILTER_VALUES},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200},
            },
        ),
        _function_tool(
            name='get_epic_progress',
            description='Compute completion progress for an epic based on feature/task status.',
            required=['roadmap_id', 'epic_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'epic_id': {'type': 'string'},
            },
        ),
        _function_tool(
            name='get_tasks_assigned_to_me',
            description='Get roadmap tasks assigned to the authenticated actor in the current roadmap.',
            required=['roadmap_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': TASK_STATUS_FILTER_VALUES},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200},
            },
        ),
        _function_tool(
            name='get_tasks_by_status',
            description='List tasks in the roadmap filtered by status.',
            required=['roadmap_id', 'status'],
            properties={
                'roadmap_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': TASK_STATUS_FILTER_VALUES},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500},
            },
        ),
        _function_tool(
            name='get_tasks_by_parent',
            description=(
                'List tasks under a parent epic or feature. '
                'By default, completed tasks are excluded unless include_completed is true.'
            ),
            required=['roadmap_id', 'parent_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'parent_id': {'type': 'string'},
                'parent_type': {'type': 'string', 'enum': ['epic', 'feature']},
                'status': {'type': 'string', 'enum': TASK_STATUS_FILTER_VALUES},
                'include_completed': {'type': 'boolean'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500},
            },
        ),
        _function_tool(
            name='get_overdue_tasks',
            description='List overdue tasks (due_date before reference_date and not completed).',
            required=['roadmap_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'reference_date': {'type': 'string'},
                'include_completed': {'type': 'boolean'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500},
            },
        ),
        _function_tool(
            name='get_blocked_items',
            description='List blocked epics, features, and tasks in the roadmap.',
            required=['roadmap_id'],
            properties={
                'roadmap_id': {'type': 'string'},
                'include_epics': {'type': 'boolean'},
                'include_features': {'type': 'boolean'},
                'include_tasks': {'type': 'boolean'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500},
            },
        ),
    ]


def get_edit_helper_tools() -> list[dict[str, Any]]:
    return [
        _function_tool(
            name='create_epic',
            description='Draft an add_epic operation for a new epic.',
            required=['title'],
            properties={
                'title': {'type': 'string'},
                'description': {'type': 'string'},
                'status': {'type': 'string'},
            },
        ),
        _function_tool(
            name='create_feature',
            description='Draft an add_feature operation under an epic.',
            required=['epic_id', 'title'],
            properties={
                'epic_id': {'type': 'string'},
                'title': {'type': 'string'},
                'description': {'type': 'string'},
                'status': {'type': 'string'},
            },
        ),
        _function_tool(
            name='create_task',
            description='Draft an add_task operation under a feature.',
            required=['feature_id', 'title'],
            properties={
                'feature_id': {'type': 'string'},
                'title': {'type': 'string'},
                'description': {'type': 'string'},
                'status': {'type': 'string'},
                'priority': {'type': 'string'},
                'assignee_id': {'type': 'string'},
                'due_date': {'type': 'string'},
            },
        ),
        _function_tool(
            name='update_task_status',
            description='Draft a status update for a single task.',
            required=['task_id', 'status'],
            properties={
                'task_id': {'type': 'string'},
                'status': {'type': 'string'},
            },
        ),
        _function_tool(
            name='update_task_priority',
            description='Draft a priority update for a single task.',
            required=['task_id', 'priority'],
            properties={
                'task_id': {'type': 'string'},
                'priority': {'type': 'string'},
            },
        ),
        _function_tool(
            name='update_task_assignee',
            description='Draft an assignee update for a single task.',
            required=['task_id', 'assignee_id'],
            properties={
                'task_id': {'type': 'string'},
                'assignee_id': {'type': 'string'},
            },
        ),
        _function_tool(
            name='update_feature_status',
            description='Draft a status update for a single feature.',
            required=['feature_id', 'status'],
            properties={
                'feature_id': {'type': 'string'},
                'status': {'type': 'string'},
            },
        ),
        _function_tool(
            name='update_epic_status',
            description='Draft a status update for a single epic.',
            required=['epic_id', 'status'],
            properties={
                'epic_id': {'type': 'string'},
                'status': {'type': 'string'},
            },
        ),
        _function_tool(
            name='update_titles',
            description='Draft a title rename operation for an epic, feature, or task.',
            required=['node_type', 'node_id', 'title'],
            properties={
                'node_type': {'type': 'string', 'enum': ['epic', 'feature', 'task']},
                'node_id': {'type': 'string'},
                'title': {'type': 'string'},
            },
        ),
        _function_tool(
            name='delete_task',
            description='Draft a delete_node operation for a task.',
            required=['task_id'],
            properties={'task_id': {'type': 'string'}},
        ),
        _function_tool(
            name='delete_feature',
            description='Draft a delete_node operation for a feature.',
            required=['feature_id'],
            properties={'feature_id': {'type': 'string'}},
        ),
        _function_tool(
            name='delete_epic',
            description='Draft a delete_node operation for an epic.',
            required=['epic_id'],
            properties={'epic_id': {'type': 'string'}},
        ),
        _function_tool(
            name='move_task_to_feature',
            description='Draft a move_node operation that reparents a task under a feature.',
            required=['task_id', 'feature_id'],
            properties={
                'task_id': {'type': 'string'},
                'feature_id': {'type': 'string'},
                'position': {'type': 'integer', 'minimum': 0},
            },
        ),
        _function_tool(
            name='move_feature_to_epic',
            description='Draft a move_node operation that reparents a feature under an epic.',
            required=['feature_id', 'epic_id'],
            properties={
                'feature_id': {'type': 'string'},
                'epic_id': {'type': 'string'},
                'position': {'type': 'integer', 'minimum': 0},
            },
        ),
        _function_tool(
            name='reorder_tasks',
            description='Draft ordered move_node operations for tasks within the same feature.',
            required=['feature_id', 'task_ids'],
            properties={
                'feature_id': {'type': 'string'},
                'task_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
            },
        ),
        _function_tool(
            name='reorder_features',
            description='Draft ordered move_node operations for features within the same epic.',
            required=['epic_id', 'feature_ids'],
            properties={
                'epic_id': {'type': 'string'},
                'feature_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
            },
        ),
        _function_tool(
            name='reorder_epics',
            description='Draft ordered move_node operations for epics within the roadmap.',
            required=['epic_ids'],
            properties={
                'epic_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
            },
        ),
        _function_tool(
            name='bulk_update_task_status',
            description='Draft status updates for multiple tasks.',
            required=['task_ids', 'status'],
            properties={
                'task_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
            },
        ),
        _function_tool(
            name='bulk_update_tasks_by_parent',
            description=(
                'Draft status updates for all tasks under a resolved feature or epic '
                'without manually listing task IDs. '
                'By default, completed tasks are NOT modified unless include_completed is true.'
            ),
            required=['parent_type', 'parent_id', 'status'],
            properties={
                'parent_type': {
                    'type': 'string',
                    'enum': ['feature', 'epic'],
                },
                'parent_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
                'include_completed': {'type': 'boolean'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 2000},
            },
        ),
        _function_tool(
            name='bulk_update_tasks_by_filter',
            description=(
                'Draft status and/or priority updates for tasks selected by scope and filters '
                '(for example parent, assignee, status, keyword). '
                'By default, completed tasks are NOT modified unless filters.include_completed is true.'
            ),
            required=['filters', 'update'],
            properties={
                'filters': {
                    'type': 'object',
                    'properties': {
                        'parent_id': {'type': 'string'},
                        'parent_type': {'type': 'string', 'enum': ['epic', 'feature']},
                        'assignee_id': {'type': 'string'},
                        'status': {'type': 'string', 'enum': TASK_STATUS_FILTER_VALUES},
                        'keyword': {'type': 'string'},
                        'include_completed': {'type': 'boolean'},
                    },
                },
                'update': {
                    'type': 'object',
                    'properties': {
                        'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
                        'priority': {'type': 'string'},
                    },
                },
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 2000},
            },
        ),
        _function_tool(
            name='bulk_assign_tasks',
            description='Draft assignee updates for multiple tasks.',
            required=['task_ids', 'assignee_id'],
            properties={
                'task_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'assignee_id': {'type': 'string'},
            },
        ),
        _function_tool(
            name='bulk_delete_tasks',
            description='Draft delete_node operations for multiple tasks.',
            required=['task_ids'],
            properties={
                'task_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
            },
        ),
        _function_tool(
            name='bulk_move_tasks_to_feature',
            description='Draft move_node operations for multiple tasks into one feature.',
            required=['task_ids', 'feature_id'],
            properties={
                'task_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'feature_id': {'type': 'string'},
                'start_position': {'type': 'integer', 'minimum': 0},
            },
        ),
        _function_tool(
            name='bulk_update_feature_status',
            description='Draft status updates for multiple features.',
            required=['feature_ids', 'status'],
            properties={
                'feature_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'status': {'type': 'string'},
            },
        ),
        _function_tool(
            name='bulk_update_epic_status',
            description='Draft status updates for multiple epics.',
            required=['epic_ids', 'status'],
            properties={
                'epic_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'status': {'type': 'string'},
            },
        ),
    ]


def get_planning_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': PLANNING_TOOL_NAME,
            'description': (
                'Generate safe roadmap edit operations. Never rewrite full JSON and never mutate unrelated fields. '
                'For add_epic/add_feature/add_task, include data.title. '
                'For add_feature/add_task, include a valid parent_id or parent_ref. '
                'For transactional creation chains, use temp_id on created nodes and *_ref fields to point to those temp IDs.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['assistant_message', 'operations'],
                'properties': {
                    'assistant_message': {'type': 'string'},
                    'operations': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'required': ['op'],
                            'properties': {
                                'op': {
                                    'type': 'string',
                                    'enum': [item.value for item in OperationType],
                                },
                                'node_type': {
                                    'type': 'string',
                                    'enum': ['roadmap', 'epic', 'feature', 'task'],
                                },
                                'node_id': {'type': 'string'},
                                'node_ref': {'type': 'string'},
                                'parent_id': {'type': 'string'},
                                'parent_ref': {'type': 'string'},
                                'new_parent_id': {'type': 'string'},
                                'new_parent_ref': {'type': 'string'},
                                'temp_id': {'type': 'string'},
                                'position': {'type': 'integer', 'minimum': 0},
                                'patch': {'type': 'object'},
                                'status': {'type': 'string'},
                                'delta_days': {'type': 'integer'},
                                'scope': {'type': 'object'},
                                'data': {'type': 'object'},
                            },
                        },
                    },
                },
            },
        },
    }


def get_operation_tools() -> list[dict[str, Any]]:
    # Backward-compatible helper used by provider adapters.
    return [get_planning_tool()]


def get_edit_mode_tools() -> list[dict[str, Any]]:
    return [*get_context_tools(), *get_edit_helper_tools(), get_planning_tool()]


def parse_plan_tool_args(raw_args: Any) -> tuple[str, list[RoadmapOperation]]:
    args = raw_args
    if isinstance(args, str):
        args = json.loads(args)
    if not isinstance(args, dict):
        raise ValueError('Plan tool arguments must be an object.')

    raw_operations = args.get('operations', [])
    if not isinstance(raw_operations, list):
        raise ValueError('Plan tool operations must be an array.')

    operations: list[RoadmapOperation] = []
    for index, item in enumerate(raw_operations):
        normalized = _normalize_operation_payload(item)
        _validate_operation_identity_payload(normalized, index=index)
        try:
            operations.append(RoadmapOperation.model_validate(normalized))
        except ValidationError as exc:
            op_value = ''
            if isinstance(normalized, dict):
                op_value = _sanitize_op_value(normalized.get('op'))
            op_suffix = f' (op={op_value})' if op_value else ''
            raise ValueError(
                f'Invalid operation payload at index {index}{op_suffix}: {exc.errors(include_url=False)}'
            ) from exc
    assistant_message = str(args.get('assistant_message', 'Prepared roadmap operations.'))
    return assistant_message, operations


def _normalize_operation_payload(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return item

    payload = dict(item)
    payload = _normalize_single_item_helper_alias(payload)
    payload = _normalize_uuid_fields(payload)
    op = payload.get('op')
    if op in {'add_epic', 'add_feature', 'add_task'}:
        data = payload.get('data')
        if data is None:
            data = {}
        if isinstance(data, dict):
            normalized_data = dict(data)
            if 'title' not in normalized_data and isinstance(
                normalized_data.get('name'), str
            ):
                normalized_data['title'] = normalized_data.pop('name')
            if 'title' not in normalized_data and isinstance(payload.get('title'), str):
                normalized_data['title'] = payload.pop('title')
            if 'title' not in normalized_data and isinstance(payload.get('name'), str):
                normalized_data['title'] = payload.pop('name')
            if normalized_data:
                payload['data'] = normalized_data
        return payload

    if op != 'update_node':
        return payload

    patch = payload.get('patch')
    if patch is None:
        patch = {}
    if not isinstance(patch, dict):
        return payload

    top_level_patch_aliases = {
        'title',
        'description',
        'priority',
        'color',
        'start_date',
        'end_date',
        'tags',
        'is_deliverable',
        'assignee_id',
        'due_date',
        'name',
        'settings',
    }
    for key in top_level_patch_aliases:
        if key in payload and key not in patch:
            patch[key] = payload.pop(key)

    if patch:
        payload['patch'] = patch
    return payload


def _normalize_uuid_fields(payload: dict[str, Any]) -> dict[str, Any]:
    for field_name in ('node_id', 'parent_id', 'new_parent_id'):
        normalized = normalize_uuid(payload.get(field_name))
        if normalized is not None:
            payload[field_name] = normalized
    return payload


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _validate_operation_identity_payload(payload: Any, *, index: int) -> None:
    if not isinstance(payload, dict):
        raise ValueError(f'Invalid operation payload at index {index}: operation must be an object.')

    op = str(payload.get('op') or '').strip()
    if not op:
        raise ValueError(f'Invalid operation payload at index {index}: missing op value.')

    data = payload.get('data') if isinstance(payload.get('data'), dict) else {}
    data_id = data.get('id') if isinstance(data, dict) else None
    temp_id = payload.get('temp_id')

    def _raise(reason: str) -> None:
        raise ValueError(f'Invalid operation payload at index {index} (op={op}): {reason}')

    if op in {'add_epic', 'add_feature', 'add_task'}:
        if _is_non_empty_string(data_id) and _is_non_empty_string(temp_id):
            _raise('creation identity conflict: provide either data.id or temp_id, not both.')

    if op in {'add_feature', 'add_task'}:
        parent_id = payload.get('parent_id')
        parent_ref = payload.get('parent_ref')
        if _is_non_empty_string(parent_id) and _is_non_empty_string(parent_ref):
            _raise('parent target conflict: provide either parent_id or parent_ref, not both.')
        if not _is_non_empty_string(parent_id) and not _is_non_empty_string(parent_ref):
            _raise('parent target missing: add_feature/add_task require parent_id or parent_ref.')

    if op in {'update_node', 'delete_node', 'move_node', 'mark_status', 'shift_dates'}:
        node_id = payload.get('node_id')
        node_ref = payload.get('node_ref')
        if _is_non_empty_string(node_id) and _is_non_empty_string(node_ref):
            _raise('target conflict: provide either node_id or node_ref, not both.')
        if not _is_non_empty_string(node_id) and not _is_non_empty_string(node_ref):
            _raise('target missing: operation requires node_id or node_ref.')

    if op == 'move_node':
        new_parent_id = payload.get('new_parent_id')
        new_parent_ref = payload.get('new_parent_ref')
        if _is_non_empty_string(new_parent_id) and _is_non_empty_string(new_parent_ref):
            _raise('move destination conflict: provide either new_parent_id or new_parent_ref, not both.')


def _sanitize_op_value(value: Any) -> str:
    if not isinstance(value, str):
        return ''
    sanitized = ''.join(ch for ch in value.strip() if 31 < ord(ch) < 127)
    if not sanitized:
        return ''
    return sanitized[:48]


def _normalize_single_item_helper_alias(payload: dict[str, Any]) -> dict[str, Any]:
    op = str(payload.get('op') or '').strip()
    if not op:
        return payload

    def _str_arg(*keys: str) -> str:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ''

    if op == 'update_task_status':
        task_id = _str_arg('task_id', 'node_id')
        status = _str_arg('status')
        if task_id and status:
            payload['op'] = 'mark_status'
            payload['node_type'] = 'task'
            payload['node_id'] = task_id
            payload['status'] = status
            payload.pop('task_id', None)
        return payload

    if op == 'update_feature_status':
        feature_id = _str_arg('feature_id', 'node_id')
        status = _str_arg('status')
        if feature_id and status:
            payload['op'] = 'mark_status'
            payload['node_type'] = 'feature'
            payload['node_id'] = feature_id
            payload['status'] = status
            payload.pop('feature_id', None)
        return payload

    if op == 'update_epic_status':
        epic_id = _str_arg('epic_id', 'node_id')
        status = _str_arg('status')
        if epic_id and status:
            payload['op'] = 'mark_status'
            payload['node_type'] = 'epic'
            payload['node_id'] = epic_id
            payload['status'] = status
            payload.pop('epic_id', None)
        return payload

    if op == 'update_task_priority':
        task_id = _str_arg('task_id', 'node_id')
        priority = _str_arg('priority')
        if task_id and priority:
            payload['op'] = 'update_node'
            payload['node_type'] = 'task'
            payload['node_id'] = task_id
            payload['patch'] = {'priority': priority}
            payload.pop('task_id', None)
            payload.pop('priority', None)
        return payload

    if op == 'update_task_assignee':
        task_id = _str_arg('task_id', 'node_id')
        assignee_id = _str_arg('assignee_id')
        if task_id and assignee_id:
            payload['op'] = 'update_node'
            payload['node_type'] = 'task'
            payload['node_id'] = task_id
            payload['patch'] = {'assignee_id': assignee_id}
            payload.pop('task_id', None)
            payload.pop('assignee_id', None)
        return payload

    if op == 'update_titles':
        node_type = _str_arg('node_type')
        node_id = _str_arg('node_id', 'task_id', 'feature_id', 'epic_id')
        title = _str_arg('title')
        if node_type in {'task', 'feature', 'epic'} and node_id and title:
            payload['op'] = 'update_node'
            payload['node_type'] = node_type
            payload['node_id'] = node_id
            payload['patch'] = {'title': title}
            payload.pop('title', None)
            payload.pop('task_id', None)
            payload.pop('feature_id', None)
            payload.pop('epic_id', None)
        return payload

    if op == 'delete_task':
        task_id = _str_arg('task_id', 'node_id')
        if task_id:
            payload['op'] = 'delete_node'
            payload['node_type'] = 'task'
            payload['node_id'] = task_id
            payload.pop('task_id', None)
        return payload

    if op == 'delete_feature':
        feature_id = _str_arg('feature_id', 'node_id')
        if feature_id:
            payload['op'] = 'delete_node'
            payload['node_type'] = 'feature'
            payload['node_id'] = feature_id
            payload.pop('feature_id', None)
        return payload

    if op == 'delete_epic':
        epic_id = _str_arg('epic_id', 'node_id')
        if epic_id:
            payload['op'] = 'delete_node'
            payload['node_type'] = 'epic'
            payload['node_id'] = epic_id
            payload.pop('epic_id', None)
        return payload

    if op == 'move_task_to_feature':
        task_id = _str_arg('task_id', 'node_id')
        feature_id = _str_arg('feature_id', 'new_parent_id')
        if task_id and feature_id:
            payload['op'] = 'move_node'
            payload['node_type'] = 'task'
            payload['node_id'] = task_id
            payload['new_parent_id'] = feature_id
            payload.pop('task_id', None)
            payload.pop('feature_id', None)
        return payload

    if op == 'move_feature_to_epic':
        feature_id = _str_arg('feature_id', 'node_id')
        epic_id = _str_arg('epic_id', 'new_parent_id')
        if feature_id and epic_id:
            payload['op'] = 'move_node'
            payload['node_type'] = 'feature'
            payload['node_id'] = feature_id
            payload['new_parent_id'] = epic_id
            payload.pop('feature_id', None)
            payload.pop('epic_id', None)
        return payload

    return payload
