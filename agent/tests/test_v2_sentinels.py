"""Round-trip tests for the web card sentinels folded by sentinels.py.

The clarifier answer path had no coverage before the multi-question upgrade;
these tests pin both the new `answers` payload and the legacy single-answer
payload byte-for-byte.
"""

import json
import unittest

from app.core.contracts.sessions import AgentSession
from app.core.v2.sentinels import parse_and_fold


def _session():
    return AgentSession(roadmap_id='11111111-1111-1111-1111-111111111111')


def _clarifier_message(payload):
    return '__clarifier_answer__\n' + json.dumps(payload)


class ClarifierAnswerFoldTests(unittest.TestCase):
    def test_single_answer_folds_to_bare_value(self):
        # One question, one selection — the model sees just the answer text,
        # exactly like the legacy payload behaved.
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {
                        'question_id': 'q1',
                        'question': 'Which epic?',
                        'selected_options': ['Growth'],
                    }
                ],
            }
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Growth')

    def test_multi_select_single_question_joins_values(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {
                        'question_id': 'q1',
                        'question': 'Which fields?',
                        'selected_options': ['Status', 'Assignee'],
                    }
                ],
            }
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Status, Assignee')

    def test_multi_question_folds_to_replay_text(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {
                        'question_id': 'q1',
                        'question': 'Which epic?',
                        'selected_options': ['Growth'],
                    },
                    {
                        'question_id': 'q2',
                        'question': 'Which fields?',
                        'selected_options': ['Status'],
                        'custom_answer': 'also the owner',
                    },
                ],
            }
        )
        folded = parse_and_fold(_session(), message)
        self.assertIn('My answers to your questions:', folded)
        self.assertIn('- Which epic?: Growth', folded)
        self.assertIn('- Which fields?: Status, also the owner', folded)
        self.assertIn('Please continue with these answers.', folded)

    def test_entry_with_only_custom_answer(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {'question_id': 'q1', 'question': 'What deadline?', 'custom_answer': ' March 3 '}
                ],
            }
        )
        self.assertEqual(parse_and_fold(_session(), message), 'March 3')

    def test_empty_answers_falls_back_to_legacy_keys(self):
        message = _clarifier_message(
            {'lane': 'edit', 'answers': [], 'selected_option': 'Growth'}
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Growth')

    def test_legacy_selected_option_payload(self):
        message = _clarifier_message(
            {'lane': 'edit', 'question_id': 'x', 'selected_option': 'Growth'}
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Growth')

    def test_legacy_custom_answer_takes_precedence(self):
        message = _clarifier_message(
            {'lane': 'edit', 'custom_answer': 'the second one', 'selected_option': 'A'}
        )
        self.assertEqual(parse_and_fold(_session(), message), 'the second one')

    def test_malformed_json_returns_message_unchanged(self):
        message = '__clarifier_answer__\nnot json {'
        self.assertEqual(parse_and_fold(_session(), message), message)

    def test_non_sentinel_message_passes_through(self):
        self.assertEqual(parse_and_fold(_session(), 'rename the epic'), 'rename the epic')


if __name__ == '__main__':
    unittest.main()
