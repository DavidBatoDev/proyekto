from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.core.contracts.operations import OperationType, RoadmapOperation

PLANNING_TOOL_NAME = 'plan_roadmap_operations'
CONTEXT_TOOL_NAMES = {
    'get_roadmap_summary',
    'search_nodes',
    'get_node_details',
    'get_children',
}


def get_context_tools() -> list[dict[str, Any]]:
    return [
        {
            'type': 'function',
            'function': {
                'name': 'get_roadmap_summary',
                'description': (
                    'Fetch a lightweight roadmap summary for context. '
                    'Use this before planning edits when the roadmap context is unclear.'
                ),
                'parameters': {
                    'type': 'object',
                    'required': ['roadmap_id'],
                    'properties': {
                        'roadmap_id': {'type': 'string'},
                    },
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'search_nodes',
                'description': (
                    'Search roadmap nodes by text query to resolve references like '
                    '"auth feature" or "payment task".'
                ),
                'parameters': {
                    'type': 'object',
                    'required': ['roadmap_id', 'query'],
                    'properties': {
                        'roadmap_id': {'type': 'string'},
                        'query': {'type': 'string'},
                        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
                    },
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_node_details',
                'description': 'Get full details for a roadmap node by ID.',
                'parameters': {
                    'type': 'object',
                    'required': ['roadmap_id', 'node_id'],
                    'properties': {
                        'roadmap_id': {'type': 'string'},
                        'node_id': {'type': 'string'},
                    },
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_children',
                'description': 'Get child nodes for a roadmap node.',
                'parameters': {
                    'type': 'object',
                    'required': ['roadmap_id', 'parent_id'],
                    'properties': {
                        'roadmap_id': {'type': 'string'},
                        'parent_id': {'type': 'string'},
                        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100},
                    },
                },
            },
        },
    ]


def get_planning_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': PLANNING_TOOL_NAME,
            'description': (
                'Generate safe roadmap edit operations. Never rewrite full JSON and never mutate unrelated fields.'
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
                                'parent_id': {'type': 'string'},
                                'new_parent_id': {'type': 'string'},
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
    return [*get_context_tools(), get_planning_tool()]


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
        try:
            operations.append(RoadmapOperation.model_validate(normalized))
        except ValidationError as exc:
            raise ValueError(
                f'Invalid operation payload at index {index}: {exc.errors(include_url=False)}'
            ) from exc
    assistant_message = str(args.get('assistant_message', 'Prepared roadmap operations.'))
    return assistant_message, operations


def _normalize_operation_payload(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return item

    payload = dict(item)
    op = payload.get('op')
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
