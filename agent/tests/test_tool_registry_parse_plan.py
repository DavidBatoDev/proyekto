from __future__ import annotations

import unittest

from app.core.tools.registry import (
    ALL_STATUS_VALUES,
    EPIC_STATUS_VALUES,
    FEATURE_STATUS_VALUES,
    TASK_STATUS_VALUES,
    get_edit_helper_tools,
    get_planning_tool,
    parse_plan_tool_args,
)


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

        any_of = operations_item.get('anyOf')
        self.assertIsInstance(any_of, list)
        assert isinstance(any_of, list)

        def _branches_for(op_name: str) -> list[dict[str, object]]:
            return [
                branch
                for branch in any_of
                if isinstance(branch, dict)
                and branch.get('properties', {}).get('op', {}).get('const') == op_name
            ]

        for op_name in ('add_epic', 'add_feature', 'add_task'):
            branches = _branches_for(op_name)
            self.assertTrue(branches, f'{op_name} must have at least one branch')
            for branch in branches:
                self.assertIn('data', branch.get('required', []))
                data_schema = branch.get('properties', {}).get('data', {})
                self.assertEqual(data_schema.get('type'), 'object')
                self.assertIn('title', data_schema.get('required', []))

        add_feature_branches = _branches_for('add_feature')
        parent_id_variants = [
            b for b in add_feature_branches
            if b['properties']['parent_id'].get('type') == 'string'
        ]
        parent_ref_variants = [
            b for b in add_feature_branches
            if b['properties']['parent_ref'].get('type') == 'string'
        ]
        self.assertEqual(len(parent_id_variants), 1)
        self.assertEqual(len(parent_ref_variants), 1)
        # The XOR sibling must be forced to null in the promoted branch.
        self.assertEqual(
            parent_id_variants[0]['properties']['parent_ref'].get('type'), 'null'
        )
        self.assertEqual(
            parent_ref_variants[0]['properties']['parent_id'].get('type'), 'null'
        )

        add_task_branches = _branches_for('add_task')
        self.assertEqual(
            sum(
                1 for b in add_task_branches
                if b['properties']['parent_id'].get('type') == 'string'
            ),
            1,
        )
        self.assertEqual(
            sum(
                1 for b in add_task_branches
                if b['properties']['parent_ref'].get('type') == 'string'
            ),
            1,
        )

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


class PlanToolStatusEnumSchemaTests(unittest.TestCase):
    """Locks in the status enum constraints on the planner's tool schema.

    Without these, the LLM can emit display-formatted values like
    `"Not started"` or `"Todo"`, which parse fine in Python but fail the
    backend commit validator. OpenAI's tool-calling enforces declared
    enums at generation time, so keeping the schema strict is the cheapest
    way to prevent that class of 400s.
    """

    def _operation_branches(self) -> list[dict[str, object]]:
        tool = get_planning_tool()
        return (
            tool['function']['parameters']['properties']['operations']['items']['anyOf']  # type: ignore[index]
        )

    def _any_branch(self) -> dict[str, object]:
        # In the anyOf layout, common nullable field shapes (type, enum) are
        # identical across every branch — pick the first to inspect.
        branches = self._operation_branches()
        self.assertTrue(branches)
        return branches[0]

    def test_top_level_status_allows_null_string(self) -> None:
        branch = self._any_branch()
        status_schema = branch['properties']['status']  # type: ignore[index]
        self.assertEqual(status_schema.get('type'), ['string', 'null'])
        self.assertEqual(
            status_schema.get('enum'), [*ALL_STATUS_VALUES, None]
        )

    def test_patch_status_enforces_full_enum_union(self) -> None:
        branch = self._any_branch()
        patch_schema = branch['properties']['patch']  # type: ignore[index]
        patch_status = patch_schema['properties']['status']  # type: ignore[index]
        self.assertEqual(patch_status.get('enum'), [*ALL_STATUS_VALUES, None])

    def test_add_epic_data_status_enforces_epic_enum(self) -> None:
        branches = self._operation_branches()
        epic_branches = [
            b for b in branches
            if b.get('properties', {}).get('op', {}).get('const') == 'add_epic'
        ]
        self.assertTrue(epic_branches)
        epic_status = (
            epic_branches[0]['properties']['data']['properties']['status']  # type: ignore[index]
        )
        self.assertEqual(epic_status['enum'], EPIC_STATUS_VALUES)

    def test_add_feature_data_status_enforces_feature_enum(self) -> None:
        branches = self._operation_branches()
        feature_branches = [
            b for b in branches
            if b.get('properties', {}).get('op', {}).get('const') == 'add_feature'
        ]
        self.assertTrue(feature_branches)
        feature_status = (
            feature_branches[0]['properties']['data']['properties']['status']  # type: ignore[index]
        )
        self.assertEqual(feature_status['enum'], FEATURE_STATUS_VALUES)

    def test_add_task_data_status_enforces_task_enum(self) -> None:
        branches = self._operation_branches()
        task_branches = [
            b for b in branches
            if b.get('properties', {}).get('op', {}).get('const') == 'add_task'
        ]
        self.assertTrue(task_branches)
        task_status = (
            task_branches[0]['properties']['data']['properties']['status']  # type: ignore[index]
        )
        self.assertEqual(task_status['enum'], TASK_STATUS_VALUES)

    def test_edit_helper_status_fields_are_type_specific(self) -> None:
        tools = get_edit_helper_tools()
        by_name = {tool['function']['name']: tool for tool in tools}
        expectations = {
            'create_epic': EPIC_STATUS_VALUES,
            'create_feature': FEATURE_STATUS_VALUES,
            'create_task': TASK_STATUS_VALUES,
            'update_task_status': TASK_STATUS_VALUES,
            'update_feature_status': FEATURE_STATUS_VALUES,
            'update_epic_status': EPIC_STATUS_VALUES,
            'bulk_update_feature_status': FEATURE_STATUS_VALUES,
            'bulk_update_epic_status': EPIC_STATUS_VALUES,
        }
        for tool_name, expected_enum in expectations.items():
            tool = by_name.get(tool_name)
            self.assertIsNotNone(tool, f'tool {tool_name} missing from edit helpers')
            assert tool is not None
            status_schema = tool['function']['parameters']['properties']['status']
            self.assertEqual(
                status_schema.get('enum'),
                expected_enum,
                f'{tool_name} status enum mismatch',
            )

    def test_all_status_union_contains_every_node_type_value(self) -> None:
        expected = sorted(
            {*EPIC_STATUS_VALUES, *FEATURE_STATUS_VALUES, *TASK_STATUS_VALUES}
        )
        self.assertEqual(ALL_STATUS_VALUES, expected)

    def test_planning_tool_requires_target_for_target_taking_ops(self) -> None:
        from app.core.tools.registry import get_planning_tool

        tool = get_planning_tool()
        branches = tool['function']['parameters']['properties']['operations']['items'][
            'anyOf'
        ]
        by_op: dict[str, list[dict]] = {}
        for branch in branches:
            op_const = branch['properties']['op']['const']
            by_op.setdefault(op_const, []).append(branch)
        for op_name in (
            'update_node',
            'delete_node',
            'move_node',
            'mark_status',
            'shift_dates',
        ):
            op_branches = by_op.get(op_name, [])
            has_node_id_branch = any(
                'node_id' in branch.get('required', [])
                and branch['properties']['node_id'].get('type') == 'string'
                for branch in op_branches
            )
            has_node_ref_branch = any(
                'node_ref' in branch.get('required', [])
                and branch['properties']['node_ref'].get('type') == 'string'
                for branch in op_branches
            )
            self.assertTrue(
                has_node_id_branch and has_node_ref_branch,
                f'{op_name} must have branches for node_id and node_ref',
            )

    def test_planning_tool_requires_parent_for_parent_requiring_ops(self) -> None:
        from app.core.tools.registry import get_planning_tool

        tool = get_planning_tool()
        branches = tool['function']['parameters']['properties']['operations']['items'][
            'anyOf'
        ]
        by_op: dict[str, list[dict]] = {}
        for branch in branches:
            op_const = branch['properties']['op']['const']
            by_op.setdefault(op_const, []).append(branch)
        for op_name in ('add_feature', 'add_task'):
            op_branches = by_op.get(op_name, [])
            has_parent_id_branch = any(
                'parent_id' in branch.get('required', [])
                and branch['properties']['parent_id'].get('type') == 'string'
                for branch in op_branches
            )
            has_parent_ref_branch = any(
                'parent_ref' in branch.get('required', [])
                and branch['properties']['parent_ref'].get('type') == 'string'
                for branch in op_branches
            )
            self.assertTrue(
                has_parent_id_branch and has_parent_ref_branch,
                f'{op_name} must have branches for parent_id and parent_ref',
            )

    def test_planning_tool_schema_has_additional_properties_false_on_branches(
        self,
    ) -> None:
        from app.core.tools.registry import get_planning_tool

        tool = get_planning_tool()
        branches = tool['function']['parameters']['properties']['operations']['items'][
            'anyOf'
        ]
        self.assertEqual(len(branches), 15)
        for branch in branches:
            self.assertFalse(
                branch.get('additionalProperties', True),
                f'branch for {branch["properties"]["op"]["const"]} must be closed',
            )

    def test_planning_tool_schema_closes_every_property_as_required(self) -> None:
        from app.core.tools.registry import get_planning_tool

        tool = get_planning_tool()
        branches = tool['function']['parameters']['properties']['operations']['items'][
            'anyOf'
        ]
        for branch in branches:
            prop_names = set(branch['properties'].keys())
            required = set(branch['required'])
            self.assertEqual(
                prop_names,
                required,
                f'branch {branch["properties"]["op"]["const"]} must require every property',
            )


if __name__ == '__main__':
    unittest.main()
