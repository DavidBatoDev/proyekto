from __future__ import annotations

import unittest

from app.core.tools.registry import get_planning_tool, parse_plan_tool_args


class ToolRegistryParsePlanTests(unittest.TestCase):
    def test_get_planning_tool_requires_create_titles_and_parent_targets(self) -> None:
        tool = get_planning_tool()
        operations_item = (
            tool.get('function', {})
            .get('parameters', {})
            .get('properties', {})
            .get('operations', {})
            .get('items', {})
        )

        all_of = operations_item.get('allOf')
        self.assertIsInstance(all_of, list)
        assert isinstance(all_of, list)

        def _rule_for(op_name: str) -> dict[str, object] | None:
            for rule in all_of:
                if not isinstance(rule, dict):
                    continue
                if_op = (
                    rule.get('if', {})
                    .get('properties', {})
                    .get('op', {})
                    .get('const')
                )
                if if_op == op_name:
                    return rule
            return None

        for op_name in ('add_epic', 'add_feature', 'add_task'):
            op_rule = _rule_for(op_name)
            self.assertIsNotNone(op_rule)
            assert isinstance(op_rule, dict)
            then_block = op_rule.get('then', {})
            self.assertIn('data', then_block.get('required', []))
            data_schema = then_block.get('properties', {}).get('data', {})
            self.assertIn('title', data_schema.get('required', []))

        add_feature_rule = _rule_for('add_feature')
        self.assertIsNotNone(add_feature_rule)
        assert isinstance(add_feature_rule, dict)
        add_feature_parent_one_of = add_feature_rule.get('then', {}).get('oneOf', [])
        self.assertIn({'required': ['parent_id']}, add_feature_parent_one_of)
        self.assertIn({'required': ['parent_ref']}, add_feature_parent_one_of)

        add_task_rule = _rule_for('add_task')
        self.assertIsNotNone(add_task_rule)
        assert isinstance(add_task_rule, dict)
        add_task_parent_one_of = add_task_rule.get('then', {}).get('oneOf', [])
        self.assertIn({'required': ['parent_id']}, add_task_parent_one_of)
        self.assertIn({'required': ['parent_ref']}, add_task_parent_one_of)

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

    def test_parse_add_epic_status_alias_normalizes_for_backend_enum(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create epic',
                'operations': [
                    {
                        'op': 'add_epic',
                        'data': {
                            'title': 'Agent Core',
                            'status': 'Not started',
                        },
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual((operations[0].data or {}).get('status'), 'backlog')

    def test_parse_add_feature_status_alias_normalizes_for_backend_enum(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create feature',
                'operations': [
                    {
                        'op': 'add_feature',
                        'parent_id': '123e4567-e89b-12d3-a456-426614174000',
                        'data': {
                            'title': 'Authentication',
                            'status': 'Not started',
                        },
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual((operations[0].data or {}).get('status'), 'not_started')

    def test_parse_add_task_status_alias_moves_into_data_and_normalizes(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create task',
                'operations': [
                    {
                        'op': 'add_task',
                        'parent_id': '123e4567-e89b-12d3-a456-426614174000',
                        'status': 'Todo',
                        'data': {
                            'title': 'Login flow',
                        },
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual((operations[0].data or {}).get('status'), 'todo')
        self.assertIsNone(operations[0].status)

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

    def test_parse_mark_status_normalizes_inprogress_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update status',
                'operations': [
                    {
                        'op': 'mark_status',
                        'node_type': 'task',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                        'status': 'inprogress',
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].status, 'in_progress')

    def test_parse_mark_status_normalizes_epic_not_started_to_backlog(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update epic status',
                'operations': [
                    {
                        'op': 'mark_status',
                        'node_type': 'epic',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                        'status': 'Not started',
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].status, 'backlog')

    def test_parse_mark_status_infers_node_type_from_create_temp_refs(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create and mark',
                'operations': [
                    {
                        'op': 'add_epic',
                        'temp_id': 'epic_agent_core',
                        'data': {'title': 'Agent Core'},
                    },
                    {
                        'op': 'add_feature',
                        'parent_ref': 'epic_agent_core',
                        'temp_id': 'f_auth',
                        'data': {'title': 'Authentication'},
                    },
                    {
                        'op': 'mark_status',
                        'node_ref': 'epic_agent_core',
                        'status': 'Not started',
                    },
                    {
                        'op': 'mark_status',
                        'node_ref': 'f_auth',
                        'status': 'todo',
                    },
                ],
            }
        )
        self.assertEqual(len(operations), 4)
        self.assertEqual(operations[2].node_type.value, 'epic')
        self.assertEqual(operations[2].status, 'backlog')
        self.assertEqual(operations[3].node_type.value, 'feature')
        self.assertEqual(operations[3].status, 'not_started')

    def test_parse_update_task_assignee_alias_normalizes_unassign_token(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'unassign task',
                'operations': [
                    {
                        'op': 'update_task_assignee',
                        'task_id': '123e4567-e89b-12d3-a456-426614174000',
                        'assignee_id': 'unassign',
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].op.value, 'update_node')
        self.assertEqual((operations[0].patch or {}).get('assignee_id'), None)

    def test_parse_update_node_patch_normalizes_assignee_null_token(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'clear assignee',
                'operations': [
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                        'patch': {'assignee_id': 'null'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual((operations[0].patch or {}).get('assignee_id'), None)

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

    def test_parse_add_feature_normalizes_short_temp_id_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create feature',
                'operations': [
                    {
                        'op': 'add_feature',
                        'parent_ref': 'epic_1',
                        'temp_id': 'f_auth',
                        'data': {'title': 'Authentication'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].temp_id, 'feat_auth')

    def test_parse_add_task_normalizes_short_parent_ref_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create task',
                'operations': [
                    {
                        'op': 'add_task',
                        'parent_ref': 'f_auth',
                        'temp_id': 't_login_flow',
                        'data': {'title': 'Login flow'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].parent_ref, 'feat_auth')

    def test_parse_create_chain_keeps_refs_consistent_after_alias_normalization(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'create chain',
                'operations': [
                    {
                        'op': 'add_epic',
                        'temp_id': 'epic_1',
                        'data': {'title': 'Agent Core'},
                    },
                    {
                        'op': 'add_feature',
                        'parent_ref': 'epic_1',
                        'temp_id': 'f_auth',
                        'data': {'title': 'Authentication'},
                    },
                    {
                        'op': 'add_task',
                        'parent_ref': 'f_auth',
                        'temp_id': 't_login',
                        'data': {'title': 'Login flow'},
                    },
                ],
            }
        )
        self.assertEqual(len(operations), 3)
        self.assertEqual(operations[1].temp_id, 'feat_auth')
        self.assertEqual(operations[2].parent_ref, 'feat_auth')

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

    def test_parse_update_node_promotes_target_id_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update node target alias',
                'operations': [
                    {
                        'op': 'update_node',
                        'target_id': '123e4567-e89b-12d3-a456-426614174000',
                        'patch': {'title': 'Auth V2'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].node_id, '123e4567-e89b-12d3-a456-426614174000')
        self.assertEqual(operations[0].patch, {'title': 'Auth V2'})

    def test_parse_update_node_promotes_feature_id_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update node feature alias',
                'operations': [
                    {
                        'op': 'update_node',
                        'feature_id': '123e4567-e89b-12d3-a456-426614174000',
                        'patch': {'description': 'Updated'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].node_id, '123e4567-e89b-12d3-a456-426614174000')
        self.assertEqual(operations[0].patch, {'description': 'Updated'})

    def test_parse_update_node_promotes_target_ref_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'update node target ref alias',
                'operations': [
                    {
                        'op': 'update_node',
                        'target_ref': 'f_auth',
                        'patch': {'description': 'Updated'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].node_ref, 'feat_auth')
        self.assertEqual(operations[0].patch, {'description': 'Updated'})

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
