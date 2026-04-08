from __future__ import annotations

import re
import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.orchestration.shared.operation_contracts import (
    operation_validation_guidance,
    validate_operation_contract,
)


class OperationContractsTests(unittest.TestCase):
    @staticmethod
    def _is_uuid(value: str | None) -> bool:
        if value is None:
            return False
        return bool(
            re.fullmatch(
                r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                value,
            )
        )

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

    def test_operation_validation_guidance_for_new_reasons(self) -> None:
        self.assertIn(
            'missing a status value',
            operation_validation_guidance('mark_status.status_missing').lower(),
        )
        self.assertIn(
            'between -3650 and 3650',
            operation_validation_guidance('shift_dates.delta_days_out_of_range').lower(),
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


if __name__ == '__main__':
    unittest.main()
