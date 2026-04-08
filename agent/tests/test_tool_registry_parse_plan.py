from __future__ import annotations

import unittest

from app.core.tools.registry import parse_plan_tool_args


class ToolRegistryParsePlanTests(unittest.TestCase):
    def test_parse_add_feature_normalizes_title_aliases(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create feature',
                'operations': [
                    {
                        'op': 'add_feature',
                        'parent_id': '123e4567-e89b-12d3-a456-426614174000',
                        'name': 'Authentication',
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].op.value, 'add_feature')
        self.assertEqual(operations[0].data, {'title': 'Authentication'})

    def test_parse_update_node_normalizes_top_level_patch_aliases(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update task',
                'operations': [
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                        'priority': 'high',
                        'tags': ['auth', 'api'],
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(
            operations[0].patch,
            {'priority': 'high', 'tags': ['auth', 'api']},
        )

    def test_parse_shift_dates_preserves_delta_days(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'shift dates',
                'operations': [
                    {
                        'op': 'shift_dates',
                        'node_type': 'feature',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                        'delta_days': -7,
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].op.value, 'shift_dates')
        self.assertEqual(operations[0].delta_days, -7)

    def test_parse_invalid_operations_shape_raises(self) -> None:
        with self.assertRaises(ValueError):
            parse_plan_tool_args({'assistant_message': 'x', 'operations': 'not-a-list'})

    def test_parse_invalid_operation_enum_raises(self) -> None:
        with self.assertRaises(ValueError):
            parse_plan_tool_args(
                {
                    'assistant_message': 'x',
                    'operations': [
                        {
                            'op': 'unsupported_op',
                        }
                    ],
                }
            )


if __name__ == '__main__':
    unittest.main()
