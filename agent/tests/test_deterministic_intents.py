import unittest

from app.core.llm.deterministic_intents import (
    is_generic_roadmap_label,
    match_deterministic_context_intent,
    match_global_overview_intent,
    normalize_context_label,
)


class DeterministicIntentsTests(unittest.TestCase):
    def test_match_global_overview_intent_requires_scope(self) -> None:
        match = match_global_overview_intent(
            'Tell me all the epics, features and tasks of this roadmap'
        )
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.pending_kind, 'roadmap_overview')
        self.assertEqual(label, '')

    def test_specific_question_not_hijacked_by_overview_matcher(self) -> None:
        self.assertIsNone(match_global_overview_intent('What are the tasks for Authentication System?'))

    def test_match_deterministic_context_intent_for_specific_label(self) -> None:
        match = match_deterministic_context_intent('What are the tasks for Authentication System?')
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.pending_kind, 'tasks_of_feature')
        self.assertEqual(label, 'Authentication System')

    def test_match_deterministic_context_intent_for_my_tasks(self) -> None:
        match = match_deterministic_context_intent('Can you give me all tasks assigned to me?')
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.pending_kind, 'my_tasks')
        self.assertEqual(label, '')

    def test_normalize_context_label(self) -> None:
        self.assertEqual(normalize_context_label('the epic Platform Foundation?'), 'Platform Foundation')

    def test_generic_roadmap_label_detection(self) -> None:
        self.assertTrue(is_generic_roadmap_label('this roadmap'))
        self.assertTrue(is_generic_roadmap_label('overall roadmap'))
        self.assertFalse(is_generic_roadmap_label('Platform Foundation'))


if __name__ == '__main__':
    unittest.main()
