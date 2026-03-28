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


if __name__ == '__main__':
    unittest.main()
