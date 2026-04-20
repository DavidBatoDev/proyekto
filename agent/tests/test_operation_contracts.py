from __future__ import annotations

import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.orchestration.shared.operation_contracts import (
    operation_validation_guidance,
    validate_operation_contract,
)
from app.core.tools.registry import (
    parse_plan_tool_args,
    reset_active_handle_map,
    set_active_handle_map,
)
from app.core.uuid_utils import is_uuid_like


class OperationContractsTests(unittest.TestCase):
    @staticmethod
    def _is_uuid(value: str | None) -> bool:
        return is_uuid_like(value)

    def test_move_node_allows_reorder_without_new_parent(self) -> None:
        operations = [
            RoadmapOperation(
                op='move_node',
                node_type='task',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                position=0,
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNone(validation_error)

    def test_mark_status_requires_non_empty_status(self) -> None:
        operations = [
            RoadmapOperation(
                op='mark_status',
                node_type='task',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                status=' ',
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error.get('reason'), 'mark_status.status_missing')

    def test_mark_status_rejects_invalid_status_value(self) -> None:
        operations = [
            RoadmapOperation(
                op='mark_status',
                node_type='task',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                status='inprogress',
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error.get('reason'), 'mark_status.status_invalid')

    def test_mark_status_epic_accepts_backlog_and_rejects_not_started(self) -> None:
        valid_operations = [
            RoadmapOperation(
                op='mark_status',
                node_type='epic',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                status='backlog',
            )
        ]
        validation_error = validate_operation_contract(
            valid_operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNone(validation_error)

        invalid_operations = [
            RoadmapOperation(
                op='mark_status',
                node_type='epic',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                status='not_started',
            )
        ]
        validation_error = validate_operation_contract(
            invalid_operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error.get('reason'), 'mark_status.status_invalid')

    def test_shift_dates_requires_delta_days(self) -> None:
        operations = [
            RoadmapOperation(
                op='shift_dates',
                node_type='feature',
                node_id='123e4567-e89b-12d3-a456-426614174000',
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error.get('reason'), 'shift_dates.delta_days_missing')

    def test_shift_dates_bounds_delta_days(self) -> None:
        operations = [
            RoadmapOperation(
                op='shift_dates',
                node_type='feature',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                delta_days=4001,
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error.get('reason'), 'shift_dates.delta_days_out_of_range')

    def test_shift_dates_allows_valid_range(self) -> None:
        operations = [
            RoadmapOperation(
                op='shift_dates',
                node_type='feature',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                delta_days=-30,
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNone(validation_error)

    def test_update_node_requires_effective_mutation_payload(self) -> None:
        operations = [
            RoadmapOperation(
                op='update_node',
                node_type='task',
                node_id='123e4567-e89b-12d3-a456-426614174000',
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error.get('reason'), 'update_node.mutation_missing')

    def test_update_node_allows_assignee_clear_with_null_patch_value(self) -> None:
        operations = [
            RoadmapOperation(
                op='update_node',
                node_type='task',
                node_id='123e4567-e89b-12d3-a456-426614174000',
                patch={'assignee_id': None},
            )
        ]
        validation_error = validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )
        self.assertIsNone(validation_error)

    def test_operation_validation_guidance_for_new_reasons(self) -> None:
        self.assertIn(
            'missing a status value',
            operation_validation_guidance('mark_status.status_missing').lower(),
        )
        self.assertIn(
            'status value is not valid',
            operation_validation_guidance('mark_status.status_invalid').lower(),
        )
        self.assertIn(
            'include patch fields',
            operation_validation_guidance('update_node.mutation_missing').lower(),
        )
        self.assertIn(
            'between -3650 and 3650',
            operation_validation_guidance('shift_dates.delta_days_out_of_range').lower(),
        )
        self.assertIn(
            'temporary reference',
            operation_validation_guidance('add_epic.temp_id_invalid_ref').lower(),
        )

    def test_roadmap_operation_semantic_hook_reports_expected_issues(self) -> None:
        operation = RoadmapOperation(
            op='shift_dates',
            node_type='feature',
            node_id='invalid',
            delta_days=5000,
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('shift_dates.node_id_invalid_uuid', issues)
        self.assertIn('shift_dates.delta_days_out_of_range', issues)

    def test_roadmap_operation_semantic_hook_accepts_reorder_move(self) -> None:
        operation = RoadmapOperation(
            op='move_node',
            node_type='task',
            node_id='123e4567-e89b-12d3-a456-426614174000',
            position=1,
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_roadmap_operation_semantic_hook_accepts_uppercase_uuid(self) -> None:
        operation = RoadmapOperation(
            op='update_node',
            node_type='task',
            node_id='123E4567-E89B-12D3-A456-426614174000',
            patch={'title': 'Updated'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_roadmap_operation_semantic_hook_accepts_braced_uuid(self) -> None:
        operation = RoadmapOperation(
            op='delete_node',
            node_type='task',
            node_id='{123e4567-e89b-12d3-a456-426614174000}',
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_roadmap_operation_semantic_hook_accepts_urn_uuid(self) -> None:
        operation = RoadmapOperation(
            op='mark_status',
            node_type='task',
            node_id='urn:uuid:123e4567-e89b-12d3-a456-426614174000',
            status='in_review',
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_roadmap_operation_semantic_hook_accepts_hyphenless_uuid(self) -> None:
        operation = RoadmapOperation(
            op='mark_status',
            node_type='task',
            node_id='123e4567e89b12d3a456426614174000',
            status='done',
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_feature_accepts_parent_ref_target(self) -> None:
        operation = RoadmapOperation(
            op='add_feature',
            parent_ref='tmp_epic_1',
            temp_id='tmp_feature_1',
            data={'title': 'Authentication'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_epic_accepts_epic_prefix_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_epic',
            temp_id='epic_temp_1',
            data={'title': 'Platform'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_epic_accepts_t_prefix_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_epic',
            temp_id='t_epic_agent_module',
            data={'title': 'Agent Module'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_epic_accepts_temp_dash_prefix_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_epic',
            temp_id='temp-epic-agent-module',
            data={'title': 'Agent Module'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_feature_accepts_feature_prefix_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_feature',
            parent_ref='epic_temp_1',
            temp_id='feature_temp_1',
            data={'title': 'Authentication'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_feature_accepts_feat_prefix_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_feature',
            parent_ref='epic_temp_1',
            temp_id='feat_auth_t1',
            data={'title': 'Authentication'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_feature_accepts_t_prefix_refs(self) -> None:
        operation = RoadmapOperation(
            op='add_feature',
            parent_ref='t_epic_agent_module',
            temp_id='t_feature_system_arch',
            data={'title': 'System Architecture'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_feature_accepts_temp_dash_prefix_refs(self) -> None:
        operation = RoadmapOperation(
            op='add_feature',
            parent_ref='temp-epic-agent-module',
            temp_id='temp-feature-system-architecture',
            data={'title': 'System Architecture'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_task_accepts_task_prefix_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_task',
            parent_ref='feature_temp_1',
            temp_id='task_temp_1',
            data={'title': 'Implement login flow'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_task_accepts_feat_prefix_parent_ref(self) -> None:
        operation = RoadmapOperation(
            op='add_task',
            parent_ref='feat_auth_t1',
            temp_id='task_temp_1',
            data={'title': 'Implement login flow'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_add_epic_rejects_malformed_temp_id(self) -> None:
        operation = RoadmapOperation(
            op='add_epic',
            temp_id='temp:epic:1',
            data={'title': 'Platform'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('add_epic.temp_id_invalid_ref', issues)

    def test_add_feature_rejects_parent_target_conflict(self) -> None:
        operation = RoadmapOperation(
            op='add_feature',
            parent_id='123e4567-e89b-12d3-a456-426614174000',
            parent_ref='tmp_epic_1',
            data={'title': 'Authentication'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('add_feature.parent_target_conflict', issues)

    def test_add_epic_rejects_temp_identity_conflict(self) -> None:
        operation = RoadmapOperation(
            op='add_epic',
            temp_id='tmp_epic_1',
            data={
                'id': '123e4567-e89b-12d3-a456-426614174000',
                'title': 'Platform',
            },
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('add_epic.identity_conflict', issues)

    def test_update_node_accepts_node_ref_target(self) -> None:
        operation = RoadmapOperation(
            op='update_node',
            node_type='task',
            node_ref='tmp_task_1',
            patch={'title': 'Updated'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_move_node_rejects_new_parent_target_conflict(self) -> None:
        operation = RoadmapOperation(
            op='move_node',
            node_type='task',
            node_id='123e4567-e89b-12d3-a456-426614174000',
            new_parent_id='123e4567-e89b-12d3-a456-426614174111',
            new_parent_ref='tmp_feature_2',
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('move_node.new_parent_target_conflict', issues)


    def test_delete_node_missing_target_raises(self) -> None:
        args = {
            'assistant_message': 'delete epic',
            'operations': [{'op': 'delete_node'}],
        }
        with self.assertRaises(ValueError) as context:
            parse_plan_tool_args(args)
        message = str(context.exception)
        self.assertIn('delete_node', message)
        self.assertIn('target missing', message)

    def test_parse_plan_tool_accepts_bulk_update_with_only_targets(self) -> None:
        # Regression: "Assign all tasks to me" was rejected by the
        # identity payload validator even though targets[] was populated,
        # because the validator only knew about node_id/node_ref. Make
        # sure a bulk payload passes through cleanly end-to-end.
        target_ids = [f'{i:08x}-1111-1111-1111-111111111111' for i in range(25)]
        args = {
            'assistant_message': 'Assigning all 25 tasks to the current user.',
            'operations': [
                {
                    'op': 'update_node',
                    'node_type': 'task',
                    'targets': target_ids,
                    'patch': {'assignee_id': '9cdd95e6-f0eb-411f-941d-647d3061e0f2'},
                }
            ],
        }
        assistant_message, operations = parse_plan_tool_args(args)
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].targets, target_ids)
        self.assertIsNone(operations[0].node_id)
        self.assertIsNone(operations[0].node_ref)
        self.assertTrue(assistant_message)

    def test_parse_plan_tool_rejects_targets_mixed_with_node_id(self) -> None:
        args = {
            'assistant_message': 'invalid',
            'operations': [
                {
                    'op': 'update_node',
                    'node_id': '11111111-1111-1111-1111-111111111111',
                    'targets': ['22222222-2222-2222-2222-222222222222'],
                    'patch': {'assignee_id': '33333333-3333-3333-3333-333333333333'},
                }
            ],
        }
        with self.assertRaises(ValueError) as context:
            parse_plan_tool_args(args)
        self.assertIn('target conflict', str(context.exception))

    def test_update_node_accepts_targets_without_single_target(self) -> None:
        operation = RoadmapOperation(
            op='update_node',
            targets=[
                '123e4567-e89b-12d3-a456-426614174000',
                '123e4567-e89b-12d3-a456-426614174001',
                'task_assign_me_1',
            ],
            patch={'assignee_id': '123e4567-e89b-12d3-a456-426614174222'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertEqual(issues, [])

    def test_update_node_targets_rejects_invalid_entries(self) -> None:
        operation = RoadmapOperation(
            op='update_node',
            targets=['not-a-uuid-and-not-a-ref'],
            patch={'title': 'X'},
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('update_node.targets[0].invalid', issues)

    def test_mark_status_targets_conflict_with_node_id(self) -> None:
        operation = RoadmapOperation(
            op='mark_status',
            node_type='task',
            node_id='123e4567-e89b-12d3-a456-426614174000',
            targets=['123e4567-e89b-12d3-a456-426614174001'],
            status='done',
        )
        issues = operation.semantic_contract_issues(is_uuid=self._is_uuid)
        self.assertIn('mark_status.target_conflict', issues)

    def test_empty_targets_array_rejected_by_pydantic(self) -> None:
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            RoadmapOperation(
                op='update_node',
                targets=[],
                patch={'title': 'Y'},
            )

    def test_model_json_schema_exposes_targets_bounds(self) -> None:
        # Guards against an accidental Field(...) tweak silently dropping the
        # targets[] min/max that the runtime tool schema relies on.
        schema = RoadmapOperation.model_json_schema()
        targets_spec = schema['properties']['targets']
        variants = targets_spec.get('anyOf', [])
        array_variant = next(
            (v for v in variants if v.get('type') == 'array'), None
        )
        self.assertIsNotNone(array_variant)
        assert array_variant is not None
        self.assertEqual(array_variant.get('items'), {'type': 'string'})
        self.assertEqual(array_variant.get('minItems'), 1)
        self.assertEqual(array_variant.get('maxItems'), 500)


class HandleExpansionTests(unittest.TestCase):
    """Verify that roadmap-overview handles (E1, E3.F2) are expanded to real
    UUIDs before `RoadmapOperation` validation runs. Expansion is gated on the
    ``_ACTIVE_HANDLE_MAP`` contextvar installed by the planner flow."""

    _EPIC_1 = '123e4567-e89b-12d3-a456-426614174001'
    _EPIC_2 = '123e4567-e89b-12d3-a456-426614174002'
    _FEATURE_1 = '123e4567-e89b-12d3-a456-426614174101'
    _FEATURE_2 = '123e4567-e89b-12d3-a456-426614174102'

    def setUp(self) -> None:
        self._handle_map = {
            'E1': {'id': self._EPIC_1, 'type': 'epic', 'title': 'Alpha'},
            'E2': {'id': self._EPIC_2, 'type': 'epic', 'title': 'Beta'},
            'E1.F1': {'id': self._FEATURE_1, 'type': 'feature', 'title': 'Login'},
            'E1.F2': {'id': self._FEATURE_2, 'type': 'feature', 'title': 'Signup'},
        }
        self._token = set_active_handle_map(self._handle_map)

    def tearDown(self) -> None:
        reset_active_handle_map(self._token)

    def test_expands_single_node_id_handle(self) -> None:
        args = {
            'assistant_message': 'Delete epic.',
            'operations': [
                {'op': 'delete_node', 'node_type': 'epic', 'node_id': 'E1'},
            ],
        }
        _, ops = parse_plan_tool_args(args)
        self.assertEqual(ops[0].node_id, self._EPIC_1)

    def test_expands_targets_bulk_delete(self) -> None:
        args = {
            'assistant_message': 'Delete all epics.',
            'operations': [
                {
                    'op': 'delete_node',
                    'node_type': 'epic',
                    'targets': ['E1', 'E2'],
                },
            ],
        }
        _, ops = parse_plan_tool_args(args)
        self.assertEqual(ops[0].targets, [self._EPIC_1, self._EPIC_2])

    def test_expands_mixed_handles_and_uuids_in_targets(self) -> None:
        # A raw UUID passes through untouched — this is the compatibility hinge
        # that lets resolve_node_reference continue to work for nodes that
        # aren't in the overview (truncated, large roadmaps).
        args = {
            'assistant_message': 'Delete mixed.',
            'operations': [
                {
                    'op': 'delete_node',
                    'node_type': 'epic',
                    'targets': ['E1', self._EPIC_2],
                },
            ],
        }
        _, ops = parse_plan_tool_args(args)
        self.assertEqual(ops[0].targets, [self._EPIC_1, self._EPIC_2])

    def test_expands_feature_handle_in_parent_id(self) -> None:
        args = {
            'assistant_message': 'Add task under feature.',
            'operations': [
                {
                    'op': 'add_task',
                    'node_type': 'task',
                    'parent_id': 'E1.F1',
                    'temp_id': 'tmp-task-1',
                    'data': {'title': 'New task'},
                },
            ],
        }
        _, ops = parse_plan_tool_args(args)
        self.assertEqual(ops[0].parent_id, self._FEATURE_1)

    def test_unknown_handle_is_left_unchanged_for_downstream_validation(self) -> None:
        # Shape matches (E99 looks like a handle) but no such entry exists.
        # Expander deliberately leaves the value unchanged so downstream
        # ``validate_operation_contract`` surfaces a precise UUID-invalid
        # reason, and so a coincidental user-supplied string that happens to
        # match the handle shape isn't silently rewritten.
        args = {
            'assistant_message': 'Delete unknown.',
            'operations': [
                {'op': 'delete_node', 'node_type': 'epic', 'node_id': 'E99'},
            ],
        }
        _, ops = parse_plan_tool_args(args)
        self.assertEqual(ops[0].node_id, 'E99')
        validation_error = validate_operation_contract(
            ops,
            is_uuid=lambda v: is_uuid_like(v),
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(
            validation_error.get('reason'),
            'delete_node.node_id_invalid_uuid',
        )

    def test_no_handle_map_installed_is_passthrough(self) -> None:
        # Guards against accidental cross-turn leakage: when no handle_map is
        # active, a value that happens to match the handle shape is passed
        # through so downstream validation (not the expander) decides its
        # legitimacy.
        reset_active_handle_map(self._token)  # undo setUp's set
        self._token = set_active_handle_map(None)
        args = {
            'assistant_message': 'Delete.',
            'operations': [
                {'op': 'delete_node', 'node_type': 'epic', 'node_id': 'E1'},
            ],
        }
        _, ops = parse_plan_tool_args(args)
        self.assertEqual(ops[0].node_id, 'E1')


if __name__ == '__main__':
    unittest.main()
