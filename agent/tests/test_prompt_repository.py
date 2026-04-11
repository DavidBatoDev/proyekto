import json
import unittest
from datetime import date, datetime

from app.core.prompts.repository import PromptRepository


class _UnknownObject:
    def __str__(self) -> str:
        return 'unknown-object'


class PromptRepositoryTests(unittest.TestCase):
    def test_format_context_serializes_nested_datetime(self) -> None:
        repository = PromptRepository()
        payload = {
            'actor_context': {
                'actor_id': 'actor-1',
                'fetched_at': datetime(2026, 3, 28, 19, 26, 26),
            },
            'pending_context_resolution': {
                'created_at': datetime(2026, 3, 28, 19, 26, 27),
            },
        }

        raw = repository._format_context(payload)
        parsed = json.loads(raw)
        self.assertEqual(parsed['actor_context']['fetched_at'], '2026-03-28T19:26:26')
        self.assertEqual(
            parsed['pending_context_resolution']['created_at'],
            '2026-03-28T19:26:27',
        )

    def test_format_context_serializes_mixed_date_values(self) -> None:
        repository = PromptRepository()
        payload = {
            'current_date': date(2026, 3, 29),
            'trace_id': 'trace-1',
            'count': 2,
        }

        raw = repository._format_context(payload)
        parsed = json.loads(raw)
        self.assertEqual(parsed['current_date'], '2026-03-29')
        self.assertEqual(parsed['trace_id'], 'trace-1')
        self.assertEqual(parsed['count'], 2)

    def test_format_context_falls_back_to_string_for_unknown_objects(self) -> None:
        repository = PromptRepository()
        payload = {'unknown': _UnknownObject()}

        raw = repository._format_context(payload)
        parsed = json.loads(raw)
        self.assertEqual(parsed['unknown'], 'unknown-object')

    def test_build_system_prompt_supports_query_and_plan_modes(self) -> None:
        repository = PromptRepository()
        prompt_context = {
            'roadmap_id': 'roadmap-1',
            'intent_type': 'roadmap_query',
        }

        query_prompt = repository.build_system_prompt('query', prompt_context)
        plan_prompt = repository.build_system_prompt('plan', prompt_context)

        self.assertIn('You are in roadmap query mode.', query_prompt)
        self.assertIn('If the user asks to perform an action', query_prompt)
        self.assertIn('misspelled item title', query_prompt)
        self.assertIn('You are in roadmap planning mode.', plan_prompt)

    def test_build_system_prompt_edit_mode_includes_question_style_guidance(self) -> None:
        repository = PromptRepository()
        prompt_context = {
            'roadmap_id': 'roadmap-1',
            'intent_type': 'roadmap_edit',
        }

        edit_prompt = repository.build_system_prompt('edit', prompt_context)

        self.assertIn('question form', edit_prompt)
        self.assertIn('ask one focused clarifier before staging', edit_prompt)
        self.assertIn('typo-tolerant resolution', edit_prompt)
        self.assertIn("preserve the user's requested new title", edit_prompt)

    def test_build_system_prompt_base_includes_typo_recovery_guidance(self) -> None:
        repository = PromptRepository()
        prompt_context = {
            'roadmap_id': 'roadmap-1',
            'intent_type': 'roadmap_edit',
        }

        edit_prompt = repository.build_system_prompt('edit', prompt_context)

        self.assertIn('Treat obvious user typos in roadmap item titles as valid, recoverable input', edit_prompt)

    def test_intent_classifier_prompt_includes_roadmap_query_and_question_style_rules(self) -> None:
        repository = PromptRepository()
        prompt = repository.intent_classifier_prompt()

        self.assertIn('roadmap_query', prompt)
        self.assertIn('Question-style action requests', prompt)


if __name__ == '__main__':
    unittest.main()
