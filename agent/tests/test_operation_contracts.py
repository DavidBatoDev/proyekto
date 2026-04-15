from __future__ import annotations

import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.orchestration.shared.operation_contracts import (
    operation_validation_guidance,
    validate_operation_contract,
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


if __name__ == '__main__':
    unittest.main()
