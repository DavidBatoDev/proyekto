from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.core.contracts.operations import OperationType, RoadmapOperation
from app.core.uuid_utils import normalize_uuid


def _load_canonical_operation_requirements() -> dict[str, dict[str, Any]]:
    schema_path = (
        Path(__file__).resolve().parents[4]
        / 'schemas'
        / 'roadmap-ai-operations.schema.json'
    )
    with schema_path.open('r', encoding='utf-8') as handle:
        document = json.load(handle)
    requirements = (
        document.get('definitions', {})
        .get('operation_requirements', {})
        .get('properties', {})
    )
    if not isinstance(requirements, dict):
        raise RuntimeError(
            'Canonical operation requirements missing from '
            'schemas/roadmap-ai-operations.schema.json',
        )
    return requirements


_CANONICAL_OPERATION_REQUIREMENTS: dict[str, dict[str, Any]] = (
    _load_canonical_operation_requirements()
)

TASK_STATUS_VALUES = ['todo', 'in_progress', 'in_review', 'done', 'blocked']
FEATURE_STATUS_VALUES = [
    'not_started',
    'in_progress',
    'in_review',
    'completed',
    'blocked',
]
EPIC_STATUS_VALUES = [
    'backlog',
    'planned',
    'in_progress',
    'in_review',
    'completed',
    'on_hold',
]
# Union of every accepted status string across node types. Used when the
# JSON schema cannot cheaply branch on `node_type` (top-level `status` for
# mark_status, and `patch.status` for update_node). The planner's
# semantic validator still enforces the per-type enum on the server side.
ALL_STATUS_VALUES = sorted(
    {*TASK_STATUS_VALUES, *FEATURE_STATUS_VALUES, *EPIC_STATUS_VALUES}
)
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

_UNASSIGN_ASSIGNEE_TOKENS = {
    'unassign',
    'unassigned',
    'none',
    'null',
    'no assignee',
    'remove assignee',
    'clear assignee',
}

_VALID_TEMP_REF_PATTERN = re.compile(
    r'(?i)^(?:tmp|t|temp|epic|feature|feat|task)[_-][a-z0-9][a-z0-9_-]{0,63}$'
)
_TEMP_REF_ALIAS_PATTERN = re.compile(
    r'(?i)^(?P<prefix>[a-z]+)(?P<sep>[_-])(?P<suffix>[a-z0-9][a-z0-9_-]{0,63})$'
)
_TEMP_REF_PREFIX_ALIASES = {
    'e': 'epic',
    'ep': 'epic',
    'f': 'feat',
    'fea': 'feat',
    'ft': 'feat',
    'tsk': 'task',
}
_TEMP_REF_NODE_TYPE_PREFIXES = {
    'epic': 'epic',
    'feat': 'feature',
    'feature': 'feature',
    'task': 'task',
}
_CREATE_OP_NODE_TYPES = {
    'add_epic': 'epic',
    'add_feature': 'feature',
    'add_task': 'task',
}


def _normalize_assignee_value(value: Any) -> tuple[bool, str | None]:
    if value is None:
        return True, None
    if not isinstance(value, str):
        return False, None
    normalized = value.strip()
    if not normalized:
        return False, None
    canonical = ' '.join(re.sub(r'[^a-z0-9]+', ' ', normalized.lower()).split())
    if canonical in _UNASSIGN_ASSIGNEE_TOKENS:
        return True, None
    return True, normalized


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
                'status': {'type': 'string', 'enum': EPIC_STATUS_VALUES},
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
                'status': {'type': 'string', 'enum': FEATURE_STATUS_VALUES},
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
                'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
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
                'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
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
            description='Draft an assignee update for a single task. Use assignee_id=null to unassign.',
            required=['task_id', 'assignee_id'],
            properties={
                'task_id': {'type': 'string'},
                'assignee_id': {
                    'anyOf': [
                        {'type': 'string'},
                        {'type': 'null'},
                    ]
                },
            },
        ),
        _function_tool(
            name='update_feature_status',
            description='Draft a status update for a single feature.',
            required=['feature_id', 'status'],
            properties={
                'feature_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': FEATURE_STATUS_VALUES},
            },
        ),
        _function_tool(
            name='update_epic_status',
            description='Draft a status update for a single epic.',
            required=['epic_id', 'status'],
            properties={
                'epic_id': {'type': 'string'},
                'status': {'type': 'string', 'enum': EPIC_STATUS_VALUES},
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
                        'assignee_id': {
                            'anyOf': [
                                {'type': 'string'},
                                {'type': 'null'},
                            ]
                        },
                    },
                },
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 2000},
            },
        ),
        _function_tool(
            name='bulk_assign_tasks',
            description='Draft assignee updates for multiple tasks. Use assignee_id=null to unassign.',
            required=['task_ids', 'assignee_id'],
            properties={
                'task_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'assignee_id': {
                    'anyOf': [
                        {'type': 'string'},
                        {'type': 'null'},
                    ]
                },
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
                'status': {'type': 'string', 'enum': FEATURE_STATUS_VALUES},
            },
        ),
        _function_tool(
            name='bulk_update_epic_status',
            description='Draft status updates for multiple epics.',
            required=['epic_ids', 'status'],
            properties={
                'epic_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                'status': {'type': 'string', 'enum': EPIC_STATUS_VALUES},
            },
        ),
    ]


_CREATE_STATUS_ENUMS: dict[str, list[str]] = {
    'add_epic': EPIC_STATUS_VALUES,
    'add_feature': FEATURE_STATUS_VALUES,
    'add_task': TASK_STATUS_VALUES,
}

_ALL_OPERATION_FIELDS: list[str] = [
    'op',
    'node_type',
    'node_id',
    'node_ref',
    'parent_id',
    'parent_ref',
    'new_parent_id',
    'new_parent_ref',
    'temp_id',
    'position',
    'patch',
    'status',
    'delta_days',
    'scope',
    'data',
]


def _base_operation_properties(op_name: str) -> dict[str, Any]:
    return {
        'op': {'type': 'string', 'const': op_name},
        'node_type': {
            'type': ['string', 'null'],
            'enum': ['roadmap', 'epic', 'feature', 'task', None],
        },
        'node_id': {'type': ['string', 'null']},
        'node_ref': {'type': ['string', 'null']},
        'parent_id': {'type': ['string', 'null']},
        'parent_ref': {'type': ['string', 'null']},
        'new_parent_id': {'type': ['string', 'null']},
        'new_parent_ref': {'type': ['string', 'null']},
        'temp_id': {'type': ['string', 'null']},
        'position': {'type': ['integer', 'null']},
        'patch': {
            'type': ['object', 'null'],
            'properties': {
                'status': {
                    'type': ['string', 'null'],
                    'enum': [*ALL_STATUS_VALUES, None],
                },
            },
        },
        'status': {
            'type': ['string', 'null'],
            'enum': [*ALL_STATUS_VALUES, None],
        },
        'delta_days': {'type': ['integer', 'null']},
        'scope': {'type': ['object', 'null']},
        'data': {'type': ['object', 'null']},
    }


def _promote_field_to_required_non_null(
    properties: dict[str, Any],
    field: str,
) -> None:
    spec = properties.get(field)
    if not isinstance(spec, dict):
        return
    spec = dict(spec)
    existing_type = spec.get('type')
    if isinstance(existing_type, list):
        spec['type'] = next(
            (candidate for candidate in existing_type if candidate != 'null'),
            existing_type[0] if existing_type else 'string',
        )
    existing_enum = spec.get('enum')
    if isinstance(existing_enum, list):
        spec['enum'] = [value for value in existing_enum if value is not None]
    properties[field] = spec


def _force_field_to_null(properties: dict[str, Any], field: str) -> None:
    spec = properties.get(field)
    if not isinstance(spec, dict):
        return
    properties[field] = {'type': 'null'}


_XOR_SIBLINGS: dict[str, str] = {
    'node_id': 'node_ref',
    'node_ref': 'node_id',
    'parent_id': 'parent_ref',
    'parent_ref': 'parent_id',
}


def _attach_create_data_shape(
    properties: dict[str, Any],
    op_name: str,
) -> None:
    status_enum = _CREATE_STATUS_ENUMS.get(op_name, ALL_STATUS_VALUES)
    properties['data'] = {
        'type': 'object',
        'required': ['title'],
        'properties': {
            'title': {'type': 'string'},
            'status': {'type': 'string', 'enum': status_enum},
        },
    }


def _build_operation_anyof_branches() -> list[dict[str, Any]]:
    """Per-op discriminated schema branches.

    Each branch is a complete, closed object schema: full property set,
    every field in `required`, optional fields modeled as nullable so the
    model emits them as JSON null when not in use. Target/parent XOR is
    encoded as two sibling branches per op (one per identifier variant).
    This shape is OpenAI strict-mode compatible at the top level; inner
    `patch`/`data`/`scope` remain loose objects so the binder falls back
    to non-strict if the current LangChain/OpenAI runtime rejects them.
    """
    branches: list[dict[str, Any]] = []
    for op_name, policy in _CANONICAL_OPERATION_REQUIREMENTS.items():
        if not isinstance(policy, dict):
            continue
        if policy.get('parent'):
            for identifier in ('parent_id', 'parent_ref'):
                properties = _base_operation_properties(op_name)
                _promote_field_to_required_non_null(properties, identifier)
                _force_field_to_null(properties, _XOR_SIBLINGS[identifier])
                if policy.get('data_title'):
                    _attach_create_data_shape(properties, op_name)
                branches.append(
                    {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': list(_ALL_OPERATION_FIELDS),
                        'properties': properties,
                    }
                )
        elif policy.get('target'):
            for identifier in ('node_id', 'node_ref'):
                properties = _base_operation_properties(op_name)
                _promote_field_to_required_non_null(properties, identifier)
                _force_field_to_null(properties, _XOR_SIBLINGS[identifier])
                branches.append(
                    {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': list(_ALL_OPERATION_FIELDS),
                        'properties': properties,
                    }
                )
        else:
            properties = _base_operation_properties(op_name)
            if policy.get('data_title'):
                _attach_create_data_shape(properties, op_name)
            branches.append(
                {
                    'type': 'object',
                    'additionalProperties': False,
                    'required': list(_ALL_OPERATION_FIELDS),
                    'properties': properties,
                }
            )
    return branches


def get_planning_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': PLANNING_TOOL_NAME,
            'description': (
                'Generate safe roadmap edit operations. Never rewrite full JSON and never mutate unrelated fields. '
                'For add_epic/add_feature/add_task, include data.title. '
                'For add_feature/add_task, include a valid parent_id or parent_ref. '
                'For transactional creation chains, use temp_id on created nodes and *_ref fields to point to those temp IDs. '
                'CLARIFIER CONTRACT — when you return operations=[] AND assistant_message contains a question, you MUST '
                'include `clarifier_options` with 3 concrete answer strings the user can click. Omit `clarifier_options` '
                'ONLY when the question is genuinely open-ended and no answer could be predicted from context. '
                'For rename/retitle questions, suggest 3 plausible new titles derived from the target\'s existing title, '
                'its children, and the roadmap theme. '
                'For ambiguous targets, list the candidate titles verbatim. '
                'For status/assignee/date questions, list the valid enum values or likely candidates. '
                'Each option must be a short full-answer string the user could select as-is — never category labels.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['assistant_message', 'operations'],
                'properties': {
                    'assistant_message': {'type': 'string'},
                    'clarifier_options': {
                        'type': 'array',
                        'description': (
                            'REQUIRED whenever operations=[] AND assistant_message contains a '
                            'clarifier question. Provide 3 concrete full-answer strings the user '
                            'could select as-is (suggested new titles, candidate target names, '
                            'valid enum values, etc.). Derive them from context the tools returned '
                            'or the roadmap overview — never generic labels like "Confirm target" '
                            'or "Provide name". Omit ONLY for questions that are genuinely '
                            'unpredictable from context.'
                        ),
                        'items': {'type': 'string', 'minLength': 1, 'maxLength': 120},
                        'minItems': 0,
                        'maxItems': 5,
                    },
                    'operations': {
                        'type': 'array',
                        'items': {'anyOf': _build_operation_anyof_branches()},
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


# Tool-name manifests per sub-intent. Keep these names in sync with
# CONTEXT_TOOL_NAMES / EDIT_HELPER_TOOL_NAMES / PLANNING_TOOL_NAME above.
SCOPED_EDIT_TOOL_MANIFESTS: dict[str, frozenset[str]] = {
    # Pure renames: planner only needs to resolve nodes by label and emit
    # update_node operations through plan_roadmap_operations.
    'rename_only': frozenset({
        'resolve_node_reference',
        'get_node_details',
        PLANNING_TOOL_NAME,
    }),
    # Pure deletions: resolve_node_reference already returns parent +
    # children in `resolved_subgraph`, so the planner has scope context
    # without needing a dedicated children tool.
    'delete_only': frozenset({
        'resolve_node_reference',
        'get_node_details',
        PLANNING_TOOL_NAME,
    }),
    # Pure status changes: single-item helpers for epic/feature/task
    # plus bulk variants scoped by parent or filter. search_tasks and
    # the get_tasks_by_* helpers let the planner find the target set for
    # "mark all tasks in Epic X done"-style asks without pulling in the
    # full discovery toolbelt.
    'status_change_only': frozenset({
        'resolve_node_reference',
        'get_node_details',
        'get_children_from_resolution',
        'search_tasks',
        'get_tasks_by_status',
        'get_tasks_by_parent',
        'get_tasks_assigned_to_me',
        'update_task_status',
        'update_feature_status',
        'update_epic_status',
        'bulk_update_task_status',
        'bulk_update_tasks_by_parent',
        'bulk_update_tasks_by_filter',
        'bulk_update_feature_status',
        'bulk_update_epic_status',
        PLANNING_TOOL_NAME,
    }),
    # Pure moves: resolve_node_reference gets both source and destination,
    # the move_* single-item helpers cover individual reparents, and the
    # bulk helper handles multi-task moves. Reorder tools are intentionally
    # omitted — reordering isn't semantically a "move" and keeps drift out
    # of this scope.
    'move_only': frozenset({
        'resolve_node_reference',
        'get_node_details',
        'move_task_to_feature',
        'move_feature_to_epic',
        'bulk_move_tasks_to_feature',
        PLANNING_TOOL_NAME,
    }),
}


def get_scoped_edit_tools(sub_intent: str | None) -> list[dict[str, Any]] | None:
    """Return a reduced tool manifest for a known sub-intent, else None.

    Returning None signals the caller should fall back to the full
    `get_edit_mode_tools()` set so the planner is never starved of options
    on an ambiguous edit.
    """
    if not sub_intent:
        return None
    allowed = SCOPED_EDIT_TOOL_MANIFESTS.get(sub_intent)
    if not allowed:
        return None
    return [
        tool
        for tool in get_edit_mode_tools()
        if isinstance(tool, dict)
        and isinstance(tool.get('function'), dict)
        and tool['function'].get('name') in allowed
    ]


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
    temp_ref_node_types: dict[str, str] = {}
    for index, item in enumerate(raw_operations):
        normalized = _normalize_operation_payload(item)
        if isinstance(normalized, dict):
            _infer_mark_status_node_type(normalized, temp_ref_node_types)
        _validate_operation_identity_payload(normalized, index=index)
        try:
            operation = RoadmapOperation.model_validate(normalized)
            operations.append(operation)
            _register_created_temp_ref_type(operation, temp_ref_node_types)
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


def parse_plan_tool_clarifier_options(raw_args: Any) -> list[str]:
    """Extract `clarifier_options` from the `plan_roadmap_operations` tool
    args. Returns [] when the field is missing / malformed / the tool call
    was not a clarifier (has non-empty operations). Each option is trimmed
    and capped at 120 chars; duplicates removed while preserving order.
    """

    args = raw_args
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            return []
    if not isinstance(args, dict):
        return []
    raw = args.get('clarifier_options')
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        normalized = item.strip()[:120]
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
        if len(out) >= 5:
            break
    return out


def _normalize_operation_payload(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return item

    payload = dict(item)
    payload = _normalize_single_item_helper_alias(payload)
    payload = _normalize_uuid_fields(payload)
    payload = _normalize_temp_ref_aliases(payload)
    op = payload.get('op')
    if op == 'mark_status':
        normalized_status = _normalize_mark_status_value(
            payload.get('status'),
            payload.get('node_type'),
        )
        if normalized_status is not None:
            payload['status'] = normalized_status
        return payload
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

            # Backend create handlers consume `data.status`, not top-level `status`.
            if 'status' not in normalized_data and isinstance(payload.get('status'), str):
                normalized_data['status'] = payload.pop('status')

            normalized_status = _normalize_create_status_value(
                str(op),
                normalized_data.get('status'),
            )
            if normalized_status is not None:
                normalized_data['status'] = normalized_status
            if normalized_data:
                payload['data'] = normalized_data
        return payload

    if op != 'update_node':
        return payload

    payload = _promote_update_node_target_aliases(payload)

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

    if 'assignee_id' in patch:
        is_valid_assignee, normalized_assignee = _normalize_assignee_value(
            patch.get('assignee_id')
        )
        if is_valid_assignee:
            patch['assignee_id'] = normalized_assignee

    if patch:
        payload['patch'] = patch
    return payload


def _normalize_uuid_fields(payload: dict[str, Any]) -> dict[str, Any]:
    for field_name in ('node_id', 'parent_id', 'new_parent_id'):
        normalized = normalize_uuid(payload.get(field_name))
        if normalized is not None:
            payload[field_name] = normalized
    return payload


def _normalize_temp_ref_aliases(payload: dict[str, Any]) -> dict[str, Any]:
    for field_name in ('temp_id', 'node_ref', 'parent_ref', 'new_parent_ref'):
        field_value = payload.get(field_name)
        if not isinstance(field_value, str):
            continue
        normalized = _normalize_temp_ref_value(field_value)
        if normalized is not None:
            payload[field_name] = normalized
    return payload


def _normalize_temp_ref_value(value: str) -> str | None:
    normalized = value.strip()
    if not normalized:
        return None
    if _VALID_TEMP_REF_PATTERN.fullmatch(normalized):
        return normalized
    match = _TEMP_REF_ALIAS_PATTERN.fullmatch(normalized)
    if match is None:
        return normalized
    prefix = str(match.group('prefix') or '').lower()
    mapped_prefix = _TEMP_REF_PREFIX_ALIASES.get(prefix)
    if not mapped_prefix:
        return normalized
    separator = str(match.group('sep') or '_')
    suffix = str(match.group('suffix') or '').lower()
    if not suffix:
        return normalized
    return f'{mapped_prefix}{separator}{suffix}'


def _promote_update_node_target_aliases(payload: dict[str, Any]) -> dict[str, Any]:
    has_node_id = _is_non_empty_string(payload.get('node_id'))
    has_node_ref = _is_non_empty_string(payload.get('node_ref'))
    if has_node_id or has_node_ref:
        return payload

    for field_name in ('target_id', 'task_id', 'feature_id', 'epic_id', 'id'):
        value = payload.get(field_name)
        if not _is_non_empty_string(value):
            continue
        payload.pop(field_name, None)
        stripped = str(value).strip()
        normalized_uuid = normalize_uuid(stripped)
        payload['node_id'] = normalized_uuid or stripped
        return payload

    for field_name in ('target_ref', 'ref'):
        value = payload.get(field_name)
        if not _is_non_empty_string(value):
            continue
        payload.pop(field_name, None)
        stripped = str(value).strip()
        normalized_ref = _normalize_temp_ref_value(stripped)
        payload['node_ref'] = normalized_ref or stripped
        return payload

    node_payload = payload.get('node')
    if isinstance(node_payload, dict):
        node_id = node_payload.get('id')
        if _is_non_empty_string(node_id):
            stripped = str(node_id).strip()
            normalized_uuid = normalize_uuid(stripped)
            payload['node_id'] = normalized_uuid or stripped
            return payload
        node_ref = node_payload.get('ref')
        if _is_non_empty_string(node_ref):
            stripped = str(node_ref).strip()
            normalized_ref = _normalize_temp_ref_value(stripped)
            payload['node_ref'] = normalized_ref or stripped
            return payload
    elif _is_non_empty_string(node_payload):
        stripped = str(node_payload).strip()
        normalized_uuid = normalize_uuid(stripped)
        if normalized_uuid is not None:
            payload['node_id'] = normalized_uuid
        else:
            normalized_ref = _normalize_temp_ref_value(stripped)
            payload['node_ref'] = normalized_ref or stripped

    return payload


def _register_created_temp_ref_type(
    operation: RoadmapOperation,
    temp_ref_node_types: dict[str, str],
) -> None:
    op_name = operation.op.value
    node_type = _CREATE_OP_NODE_TYPES.get(op_name)
    if node_type is None:
        return
    temp_id = operation.temp_id.strip() if isinstance(operation.temp_id, str) else ''
    if not temp_id:
        return
    temp_ref_node_types[temp_id] = node_type


def _infer_mark_status_node_type(
    payload: dict[str, Any],
    temp_ref_node_types: dict[str, str],
) -> None:
    op_name = str(payload.get('op') or '').strip()
    if op_name != 'mark_status':
        return
    existing_node_type = payload.get('node_type')
    if isinstance(existing_node_type, str) and existing_node_type.strip():
        return
    node_ref = payload.get('node_ref')
    if not isinstance(node_ref, str):
        return
    normalized_ref = node_ref.strip()
    if not normalized_ref:
        return

    inferred_node_type = temp_ref_node_types.get(normalized_ref)
    if inferred_node_type is None:
        inferred_node_type = _infer_node_type_from_ref(normalized_ref)
    if inferred_node_type is None:
        return

    payload['node_type'] = inferred_node_type
    normalized_status = _normalize_mark_status_value(
        payload.get('status'),
        inferred_node_type,
    )
    if normalized_status is not None:
        payload['status'] = normalized_status


def _infer_node_type_from_ref(node_ref: str) -> str | None:
    match = _TEMP_REF_ALIAS_PATTERN.fullmatch(node_ref)
    if match is None:
        return None
    prefix = str(match.group('prefix') or '').lower()
    return _TEMP_REF_NODE_TYPE_PREFIXES.get(prefix)


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


def _normalize_create_status_value(op: str, value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    normalized = re.sub(r'[^a-z0-9]+', '_', normalized).strip('_')
    if not normalized:
        return None

    if op == 'add_epic':
        alias_map = {
            'backlog': 'backlog',
            'planned': 'planned',
            'not_started': 'backlog',
            'todo': 'backlog',
            'to_do': 'backlog',
            'in_progress': 'in_progress',
            'inprogress': 'in_progress',
            'in_review': 'in_review',
            'inreview': 'in_review',
            'review': 'in_review',
            'completed': 'completed',
            'complete': 'completed',
            'done': 'completed',
            'on_hold': 'on_hold',
            'onhold': 'on_hold',
            'blocked': 'on_hold',
        }
        normalized_value = alias_map.get(normalized)
        if normalized_value in EPIC_STATUS_VALUES:
            return normalized_value
        return None

    if op == 'add_feature':
        alias_map = {
            'not_started': 'not_started',
            'backlog': 'not_started',
            'planned': 'not_started',
            'todo': 'not_started',
            'to_do': 'not_started',
            'in_progress': 'in_progress',
            'inprogress': 'in_progress',
            'in_review': 'in_review',
            'inreview': 'in_review',
            'review': 'in_review',
            'completed': 'completed',
            'complete': 'completed',
            'done': 'completed',
            'blocked': 'blocked',
            'on_hold': 'blocked',
            'onhold': 'blocked',
        }
        normalized_value = alias_map.get(normalized)
        if normalized_value in FEATURE_STATUS_VALUES:
            return normalized_value
        return None

    if op == 'add_task':
        alias_map = {
            'todo': 'todo',
            'to_do': 'todo',
            'not_started': 'todo',
            'backlog': 'todo',
            'planned': 'todo',
            'in_progress': 'in_progress',
            'inprogress': 'in_progress',
            'in_review': 'in_review',
            'inreview': 'in_review',
            'review': 'in_review',
            'blocked': 'blocked',
            'done': 'done',
            'complete': 'done',
            'completed': 'done',
        }
        normalized_value = alias_map.get(normalized)
        if normalized_value in TASK_STATUS_VALUES:
            return normalized_value
        return None

    return None


def _normalize_mark_status_value(value: Any, node_type: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    normalized = re.sub(r'[^a-z0-9]+', '_', normalized).strip('_')
    if not normalized:
        return None

    node_type_value = str(node_type or '').strip().lower()
    if node_type_value == 'epic':
        alias_map = {
            'backlog': 'backlog',
            'planned': 'planned',
            'not_started': 'backlog',
            'todo': 'backlog',
            'to_do': 'backlog',
            'in_progress': 'in_progress',
            'inprogress': 'in_progress',
            'in_review': 'in_review',
            'inreview': 'in_review',
            'review': 'in_review',
            'blocked': 'on_hold',
            'on_hold': 'on_hold',
            'onhold': 'on_hold',
            'completed': 'completed',
            'complete': 'completed',
            'done': 'completed',
        }
    elif node_type_value == 'feature':
        alias_map = {
            'not_started': 'not_started',
            'todo': 'not_started',
            'to_do': 'not_started',
            'in_progress': 'in_progress',
            'inprogress': 'in_progress',
            'in_review': 'in_review',
            'inreview': 'in_review',
            'review': 'in_review',
            'blocked': 'blocked',
            'completed': 'completed',
            'complete': 'completed',
            'done': 'completed',
        }
    else:
        alias_map = {
            'todo': 'todo',
            'to_do': 'todo',
            'in_progress': 'in_progress',
            'inprogress': 'in_progress',
            'in_review': 'in_review',
            'inreview': 'in_review',
            'review': 'in_review',
            'blocked': 'blocked',
            'done': 'done',
            'complete': 'done',
            'completed': 'done',
        }
    return alias_map.get(normalized)


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
        has_assignee_id = 'assignee_id' in payload
        is_valid_assignee, assignee_id = _normalize_assignee_value(payload.get('assignee_id'))
        if task_id and has_assignee_id and is_valid_assignee:
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
