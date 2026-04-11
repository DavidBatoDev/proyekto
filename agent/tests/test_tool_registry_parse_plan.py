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
        with self.assertRaises(ValueError) as ctx:
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
        self.assertIn('op=unsupported_op', str(ctx.exception))

    def test_parse_update_task_status_alias_normalizes(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update status',
                'operations': [
                    {
                        'op': 'update_task_status',
                        'task_id': '123e4567-e89b-12d3-a456-426614174000',
                        'status': 'done',
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].op.value, 'mark_status')
        self.assertEqual(operations[0].node_type.value, 'task')
        self.assertEqual(operations[0].node_id, '123e4567-e89b-12d3-a456-426614174000')
        self.assertEqual(operations[0].status, 'done')

    def test_parse_plan_normalizes_uuid_variants(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'mark status',
                'operations': [
                    {
                        'op': 'mark_status',
                        'node_type': 'task',
                        'node_id': 'URN:UUID:{123E4567-E89B-12D3-A456-426614174000}',
                        'status': 'in_review',
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].node_id, '123e4567-e89b-12d3-a456-426614174000')

    def test_parse_bulk_helper_alias_not_auto_converted(self) -> None:
        with self.assertRaises(ValueError):
            parse_plan_tool_args(
                {
                    'assistant_message': 'bulk update',
                    'operations': [
                        {
                            'op': 'bulk_update_tasks_by_parent',
                            'parent_type': 'feature',
                            'parent_id': '123e4567-e89b-12d3-a456-426614174000',
                            'status': 'done',
                        }
                    ],
                }
            )

    def test_parse_add_feature_accepts_parent_ref(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create feature',
                'operations': [
                    {
                        'op': 'add_feature',
                        'parent_ref': 'tmp_epic_1',
                        'temp_id': 'tmp_feature_1',
                        'data': {'title': 'Authentication'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].parent_ref, 'tmp_epic_1')
        self.assertEqual(operations[0].temp_id, 'tmp_feature_1')

    def test_parse_update_node_accepts_node_ref(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update temp node',
                'operations': [
                    {
                        'op': 'update_node',
                        'node_type': 'feature',
                        'node_ref': 'tmp_feature_1',
                        'patch': {'title': 'Auth V2'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].node_ref, 'tmp_feature_1')
        self.assertEqual(operations[0].patch, {'title': 'Auth V2'})

    def test_parse_add_feature_rejects_parent_id_parent_ref_conflict(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_plan_tool_args(
                {
                    'assistant_message': 'create feature',
                    'operations': [
                        {
                            'op': 'add_feature',
                            'parent_id': '123e4567-e89b-12d3-a456-426614174000',
                            'parent_ref': 'tmp_epic_1',
                            'data': {'title': 'Authentication'},
                        }
                    ],
                }
            )
        self.assertIn('parent target conflict', str(ctx.exception))

    def test_parse_add_epic_rejects_data_id_temp_id_conflict(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_plan_tool_args(
                {
                    'assistant_message': 'create epic',
                    'operations': [
                        {
                            'op': 'add_epic',
                            'temp_id': 'tmp_epic_1',
                            'data': {
                                'id': '123e4567-e89b-12d3-a456-426614174000',
                                'title': 'Platform',
                            },
                        }
                    ],
                }
            )
        self.assertIn('creation identity conflict', str(ctx.exception))

    def test_parse_move_node_rejects_new_parent_id_ref_conflict(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_plan_tool_args(
                {
                    'assistant_message': 'move node',
                    'operations': [
                        {
                            'op': 'move_node',
                            'node_type': 'task',
                            'node_id': '123e4567-e89b-12d3-a456-426614174000',
                            'new_parent_id': '123e4567-e89b-12d3-a456-426614174111',
                            'new_parent_ref': 'tmp_feature_2',
                        }
                    ],
                }
            )
        self.assertIn('move destination conflict', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
