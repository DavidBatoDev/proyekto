from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from typing import Any

from app.core.llm.planning import planner_react_helpers


def _detail(op: str, index: int = 0) -> str:
    return (
        f'Invalid operation payload at index {index} (op={op}): '
        'target missing: operation requires node_id or node_ref.'
    )


def _parent_detail(op: str, index: int = 0) -> str:
    return (
        f'Invalid operation payload at index {index} (op={op}): '
        'parent target missing: add_feature/add_task require parent_id or parent_ref.'
    )


def _raw_args(ops: list[dict[str, Any]]) -> dict[str, Any]:
    return {'assistant_message': '', 'operations': ops}


def _planner_stub() -> Any:
    return SimpleNamespace()


class AugmentRepairPlannerPromptTests(unittest.TestCase):
    def test_includes_offending_operation_slice_for_delete_node(self) -> None:
        raw = _raw_args([{'op': 'delete_node'}, {'op': 'delete_node'}])
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt='BASE_PROMPT',
            error_code='invalid_operation_payload',
            error_message=_detail('delete_node'),
            raw_tool_args=raw,
            tool_observations=None,
            planner=_planner_stub(),
        )
        self.assertIn('OFFENDING OPERATIONS:', result)
        self.assertIn('"op":"delete_node"', result)
        self.assertIn(
            'For delete_node operations, you MUST include exactly one target identifier',
            result,
        )

    def test_includes_last_resolver_summary(self) -> None:
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'args': {'label': 'core foundations'},
                'result': {
                    'matches': [
                        {
                            'id': '11111111-1111-1111-1111-111111111111',
                            'title': 'Core Foundations',
                            'type': 'epic',
                        }
                    ],
                },
            }
        ]
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt='BASE_PROMPT',
            error_code='invalid_operation_payload',
            error_message=_detail('delete_node'),
            raw_tool_args=_raw_args([{'op': 'delete_node'}]),
            tool_observations=observations,
            planner=_planner_stub(),
        )
        self.assertIn('RESOLVED NODES FROM THIS TURN:', result)
        self.assertIn('11111111-1111-1111-1111-111111111111', result)

    def test_truncates_oversize_offending_operations(self) -> None:
        large_payload = {'op': 'delete_node', 'filler': 'x' * 5000}
        raw = _raw_args([large_payload])
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt='BASE_PROMPT',
            error_code='invalid_operation_payload',
            error_message=_detail('delete_node'),
            raw_tool_args=raw,
            tool_observations=None,
            planner=_planner_stub(),
        )
        self.assertIn('... [truncated]', result)

    def test_generalizes_target_missing_to_move_node(self) -> None:
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt='BASE_PROMPT',
            error_code='invalid_operation_payload',
            error_message=_detail('move_node'),
            raw_tool_args=_raw_args([{'op': 'move_node'}]),
            tool_observations=None,
            planner=_planner_stub(),
        )
        self.assertIn(
            'For move_node operations, you MUST include exactly one target identifier',
            result,
        )

    def test_parent_missing_guardrail_for_add_feature(self) -> None:
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt='BASE_PROMPT',
            error_code='invalid_operation_payload',
            error_message=_parent_detail('add_feature'),
            raw_tool_args=_raw_args([{'op': 'add_feature', 'data': {'title': 'X'}}]),
            tool_observations=None,
            planner=_planner_stub(),
        )
        self.assertIn(
            'For add_feature operations, you MUST include exactly one parent identifier',
            result,
        )

    def test_idempotent_on_repeat_call(self) -> None:
        base = 'BASE_PROMPT'
        first = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt=base,
            error_code='invalid_operation_payload',
            error_message=_detail('delete_node'),
            raw_tool_args=_raw_args([{'op': 'delete_node'}]),
            tool_observations=None,
            planner=_planner_stub(),
        )
        second = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt=first,
            error_code='invalid_operation_payload',
            error_message=_detail('delete_node'),
            raw_tool_args=_raw_args([{'op': 'delete_node'}]),
            tool_observations=None,
            planner=_planner_stub(),
        )
        self.assertEqual(first, second)

    def test_unrelated_error_code_does_not_touch_prompt(self) -> None:
        base = 'BASE_PROMPT'
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt=base,
            error_code='something_else',
            error_message='unrelated',
        )
        self.assertEqual(result, base)

    def test_resolver_summary_only_included_when_available(self) -> None:
        result = planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt='BASE_PROMPT',
            error_code='invalid_operation_payload',
            error_message=_detail('delete_node'),
            raw_tool_args=_raw_args([{'op': 'delete_node'}]),
            tool_observations=[
                {
                    'tool_name': 'get_children',
                    'args': {},
                    'result': {},
                }
            ],
            planner=_planner_stub(),
        )
        self.assertNotIn('RESOLVED NODES FROM THIS TURN:', result)


if __name__ == '__main__':
    unittest.main()
