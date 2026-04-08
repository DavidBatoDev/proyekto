from __future__ import annotations

import unittest
from dataclasses import dataclass
from typing import Any

from app.core.llm.planning import planner_rule_fallback


@dataclass
class FakePlanningResult:
    assistant_message: str
    operations: list[Any]
    parse_mode: str
    intent_type: str
    response_mode: str
    preview_recommended: bool
    provider_used: str
    fallback_used: bool
    provider_error_code: str | None
    draft_action: str | None = None
    tool_plan: list[dict[str, Any]] | None = None
    needs_more_info: bool | None = None
    stop_reason: str | None = None
    clarifier_action: str | None = None
    clarifier_reason: str | None = None


class PlannerRuleFallbackTests(unittest.TestCase):
    def test_rule_based_chat_response_smalltalk(self) -> None:
        response = planner_rule_fallback.rule_based_chat_response('hello', 'smalltalk')
        self.assertIn('chat normally', response)

    def test_rule_based_operation_plan_parses_rename(self) -> None:
        result = planner_rule_fallback.rule_based_operation_plan(
            user_message='rename 123e4567-e89b-12d3-a456-426614174000 to "New Title"',
            planning_result_cls=FakePlanningResult,
        )
        self.assertEqual(result.parse_mode, 'rule_based_edit')
        self.assertEqual(len(result.operations), 1)
        op = result.operations[0]
        self.assertEqual(op.op.value, 'update_node')
        self.assertEqual(op.node_id, '123e4567-e89b-12d3-a456-426614174000')
        self.assertEqual(op.patch, {'title': 'New Title'})

    def test_rule_based_operation_plan_returns_clarifier_when_no_match(self) -> None:
        result = planner_rule_fallback.rule_based_operation_plan(
            user_message='please help me',
            planning_result_cls=FakePlanningResult,
        )
        self.assertEqual(result.parse_mode, 'neutral_edit_clarifier')
        self.assertEqual(result.operations, [])
        self.assertEqual(result.stop_reason, 'awaiting_user_input')

    def test_plan_with_rules_routes_edit_to_operation_plan(self) -> None:
        result = planner_rule_fallback.plan_with_rules(
            user_message='delete 123e4567-e89b-12d3-a456-426614174000',
            existing_operations=[],
            planning_result_cls=FakePlanningResult,
            heuristic_intent_resolver=lambda _: 'roadmap_edit',
        )
        self.assertEqual(result.response_mode, 'edit_plan')
        self.assertEqual(result.parse_mode, 'rule_based_edit')
        self.assertEqual(len(result.operations), 1)

    def test_plan_with_rules_routes_non_edit_to_chat(self) -> None:
        result = planner_rule_fallback.plan_with_rules(
            user_message='What can you do?',
            existing_operations=[],
            planning_result_cls=FakePlanningResult,
            heuristic_intent_resolver=lambda _: 'general_question',
        )
        self.assertEqual(result.response_mode, 'chat')
        self.assertEqual(result.parse_mode, 'rule_based_chat')
        self.assertEqual(result.operations, [])


if __name__ == '__main__':
    unittest.main()
