from typing import Any

from app.core.contracts.operations import OperationType


def get_operation_tools() -> list[dict[str, Any]]:
    return [
        {
            'type': 'function',
            'name': 'plan_roadmap_operations',
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
        }
    ]