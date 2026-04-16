from __future__ import annotations

import unittest

from app.core.llm.planning import planner_intent_classifier


class PlannerIntentClassifierTests(unittest.TestCase):
    def test_heuristic_intent_classifies_confirm_action(self) -> None:
        intent = planner_intent_classifier.heuristic_intent('yes go ahead')
        self.assertEqual(intent, 'confirm_action')

    def test_heuristic_intent_classifies_roadmap_plan(self) -> None:
        intent = planner_intent_classifier.heuristic_intent('Please plan a roadmap for checkout reliability')
        self.assertEqual(intent, 'roadmap_plan')

    def test_heuristic_intent_classifies_roadmap_edit(self) -> None:
        intent = planner_intent_classifier.heuristic_intent('rename the task to "Migrate Payments"')
        self.assertEqual(intent, 'roadmap_edit')

    def test_heuristic_intent_classifies_past_tense_assignment_as_edit(self) -> None:
        intent = planner_intent_classifier.heuristic_intent(
            'Assigned all tasks to me inside the Agent Module'
        )
        self.assertEqual(intent, 'roadmap_edit')

    def test_question_style_edit_request_detector_matches_action_question(self) -> None:
        self.assertTrue(
            planner_intent_classifier.is_question_style_edit_request(
                'Can you make all tasks in Agent Module done?'
            )
        )

    def test_question_style_edit_request_detector_rejects_info_question(self) -> None:
        self.assertFalse(
            planner_intent_classifier.is_question_style_edit_request(
                'How do we mark tasks done?'
            )
        )

    def test_informational_operation_question_detector_matches_how_to(self) -> None:
        self.assertTrue(
            planner_intent_classifier.is_informational_operation_question(
                'How do we mark tasks done?'
            )
        )

    def test_is_roadmap_question_false_for_question_style_edit_request(self) -> None:
        self.assertFalse(
            planner_intent_classifier.is_roadmap_question(
                intent_type='general_question',
                user_message='Can you make all tasks in Agent Module done?',
                session_context={'roadmap_id': 'abc'},
            )
        )

    def test_is_roadmap_question_requires_roadmap_id(self) -> None:
        self.assertFalse(
            planner_intent_classifier.is_roadmap_question(
                intent_type='general_question',
                user_message='what tasks are overdue?',
                session_context={},
            )
        )

    def test_is_roadmap_question_detects_keywords(self) -> None:
        self.assertTrue(
            planner_intent_classifier.is_roadmap_question(
                intent_type='general_question',
                user_message='what tasks are overdue?',
                session_context={'roadmap_id': 'abc'},
            )
        )
        self.assertFalse(
            planner_intent_classifier.is_roadmap_question(
                intent_type='roadmap_edit',
                user_message='rename this',
                session_context={'roadmap_id': 'abc'},
            )
        )


if __name__ == '__main__':
    unittest.main()
